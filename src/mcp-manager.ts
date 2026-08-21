/*
 * Live MCP connection manager: one Client per (profileId, serverName, generation).
 * Supports stdio and streamable-http transports. OAuth via OAuthVault provider.
 * Connections are profile-scoped — no cross-profile reuse. Discovery publishes
 * exact tool names for capability generation reconciliation.
 * @module @dsh-local/company-profiles/mcp-manager
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import {
  StdioClientTransport,
  getDefaultEnvironment,
  type StdioServerParameters,
} from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import { ToolListChangedNotificationSchema } from '@modelcontextprotocol/sdk/types.js'
import type { CredentialProvider } from '@deepseek-ai/dsh-credentials'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type { ToolDefinition, ToolRuntime } from '@deepseek-ai/dsh-tools'
import type { McpDefinition, ResolvedCompanyProfile, EffectiveCapability } from './model.js'
import type { OAuthVault } from './oauth.js'

/** Discovered tool names for one connection. */
export interface McpDiscovery {
  readonly profileId: string
  readonly serverName: string
  readonly generation: number
  /** Exact MCP tool names in `mcp__<server>__<tool>` format. */
  readonly toolNames: readonly string[]
}

/** Callback from the manager when discovered tools change. */
export type McpDiscoveryListener = (discovery: McpDiscovery) => void

/** Connection identity key — never shared across profiles. */
function connectionKey(profileId: string, serverName: string): string {
  return `${profileId}\0${serverName}`
}

interface ManagedConnection {
  readonly profileId: string
  readonly serverName: string
  readonly generation: number
  readonly client: Client
  readonly transport: StdioClientTransport | StreamableHTTPClientTransport
  readonly rawToolNames: Map<string, string>
  toolNames: readonly string[]
  closed: boolean
  activeCalls: number
  drain?: { promise: Promise<void>; resolve: () => void }
}

export interface McpManagerOptions {
  /** Harness tool registry used to expose discovered MCP tools. */
  toolsRuntime?: Pick<ToolRuntime, 'register'>
  /** Harness credential provider for configured env/header references. */
  credentials?: CredentialProvider
  /** OAuth vault for streamable-http connections with `oauth: true`. */
  oauth?: OAuthVault
  /** Callback URL base for OAuth redirects (e.g. `http://127.0.0.1:3080`). */
  oauthRedirectBase?: string
  /** Listener for tool discovery changes. */
  onDiscovery?: McpDiscoveryListener
  /** Diagnostics. */
  onError?: (error: unknown, context: string) => void
}

export class McpManager {
  private readonly connections = new Map<string, ManagedConnection>()
  private readonly registrations = new Map<string, () => void>()
  private readonly options: McpManagerOptions

  constructor(options: McpManagerOptions = {}) {
    this.options = options
  }

  /** Exact discovered tool names across all connections for one profile. */
  tools(profileId: string): readonly string[] {
    const result: string[] = []
    for (const conn of this.connections.values()) {
      if (conn.profileId === profileId && !conn.closed) {
        result.push(...conn.toolNames)
      }
    }
    return result
  }

  /**
   * Reconcile connections for a resolved profile at a given generation.
   * Opens new connections for enabled MCP capabilities, closes removed ones,
   * reconnects changed ones — one connection per (profile, server, generation).
   */
  async reconcile(profile: ResolvedCompanyProfile, generation: number): Promise<void> {
    const wanted = new Map<string, EffectiveCapability>()
    for (const cap of profile.capabilities) {
      if (cap.kind === 'mcp' && cap.state === 'enabled' && cap.config !== undefined) {
        wanted.set(cap.key, cap)
      }
    }

    // Retire old connections without blocking replacement discovery.
    for (const [key, conn] of this.connections) {
      if (conn.profileId !== profile.id) continue
      if (!wanted.has(conn.serverName) || conn.generation < generation) void this.closeConnection(key)
    }

    // Open new/updated connections
    for (const [serverName, cap] of wanted) {
      const key = connectionKey(profile.id, serverName)
      const existing = this.connections.get(key)
      if (existing !== undefined && existing.generation >= generation && !existing.closed) continue
      try {
        await this.openConnection(profile.id, serverName, generation, cap.config as McpDefinition)
      } catch (error) {
        this.options.onError?.(error, `mcp-manager: failed to open ${serverName} for ${profile.id}`)
      }
    }
  }

  /** Finish OAuth for a specific profile/server after callback. */
  async finishAuth(input: { profileId: string; serverId: string; accountId: string; code: string }): Promise<void> {
    const key = connectionKey(input.profileId, input.serverId)
    const conn = this.connections.get(key)
    if (conn === undefined) throw new Error(`no connection for ${input.serverId} on profile ${input.profileId}`)
    const transport = conn.transport
    if (!(transport instanceof StreamableHTTPClientTransport)) {
      throw new Error('finishAuth only applies to streamable-http transport')
    }
    await transport.finishAuth(input.code)
    // Re-discover tools after auth
    await this.discoverTools(conn)
  }

  /** Close all connections for a profile. */
  async closeProfile(profileId: string): Promise<void> {
    for (const [key, conn] of this.connections) {
      if (conn.profileId === profileId) await this.closeConnection(key)
    }
  }

  /** Close all connections. */
  async closeAll(): Promise<void> {
    const keys = [...this.connections.keys()]
    await Promise.all(keys.map(key => this.closeConnection(key)))
    for (const dispose of this.registrations.values()) dispose()
    this.registrations.clear()
  }

  private async openConnection(
    profileId: string,
    serverName: string,
    generation: number,
    definition: McpDefinition,
  ): Promise<void> {
    const key = connectionKey(profileId, serverName)
    // Close existing if present
    if (this.connections.has(key)) await this.closeConnection(key)

    const transport = await this.createTransport(profileId, serverName, definition)
    const client = new Client(
      { name: `dsh-profile-${profileId}`, version: '1.0.0' },
      { capabilities: {} },
    )

    const conn: ManagedConnection = {
      profileId,
      serverName,
      generation,
      client,
      transport,
      rawToolNames: new Map(),
      toolNames: [],
      closed: false,
      activeCalls: 0,
    }

    transport.onerror = (error) => {
      this.options.onError?.(error, `mcp-manager: transport error ${serverName}@${profileId}`)
    }
    transport.onclose = () => {
      if (!conn.closed) {
        conn.closed = true
        this.connections.delete(key)
      }
    }

    await client.connect(transport as Transport)
    // Set up tools/changed notification
    client.setNotificationHandler(ToolListChangedNotificationSchema, async () => {
      try { await this.discoverTools(conn) }
      catch (error) { this.options.onError?.(error, `mcp-manager: re-discovery ${serverName}@${profileId}`) }
    })
    await this.discoverTools(conn)
  }

  private async createTransport(
    profileId: string,
    serverName: string,
    definition: McpDefinition,
  ): Promise<StdioClientTransport | StreamableHTTPClientTransport> {
    if (definition.transport === 'stdio') {
      if (definition.command === undefined) throw new TypeError('stdio transport requires command')
      const env = { ...getDefaultEnvironment(), ...definition.env }
      for (const [name, ref] of Object.entries(definition.envRefs ?? {})) {
        const resolved = await this.options.credentials?.resolve(credentialRef(ref))
        if (resolved === undefined) throw new Error(`required credential for MCP env ${name} is unavailable`)
        env[name] = resolved.value
      }
      const server: StdioServerParameters = {
        command: definition.command,
        ...(definition.args !== undefined ? { args: definition.args } : {}),
        ...(Object.keys(env).length > 0 ? { env } : {}),
        ...(definition.cwd !== undefined ? { cwd: definition.cwd } : {}),
      }
      return new StdioClientTransport(server)
    }

    if (definition.transport === 'streamable-http') {
      if (definition.url === undefined) throw new TypeError('streamable-http transport requires url')
      const url = new URL(definition.url)
      const headers: Record<string, string> = { ...definition.headers }
      for (const [name, ref] of Object.entries(definition.headerRefs ?? {})) {
        const resolved = await this.options.credentials?.resolve(credentialRef(ref))
        if (resolved === undefined) throw new Error(`required credential for MCP header ${name} is unavailable`)
        headers[name] = resolved.value
      }
      const requestInit: RequestInit = { ...(Object.keys(headers).length > 0 ? { headers } : {}) }
      const transportOpts: ConstructorParameters<typeof StreamableHTTPClientTransport>[1] = { requestInit }

      if (definition.oauth === true && this.options.oauth !== undefined) {
        if (this.options.oauthRedirectBase === undefined) throw new Error('canonical OAuth redirect origin is unavailable')
        const redirectUrl = `${this.options.oauthRedirectBase}/company-profiles/oauth/callback`
        const authProvider = this.createOAuthProvider(profileId, serverName, url.origin, redirectUrl)
        transportOpts.authProvider = authProvider
      }

      return new StreamableHTTPClientTransport(url, transportOpts)
    }

    throw new TypeError(`unsupported MCP transport: ${String((definition as { transport: unknown }).transport)}`)
  }

  private createOAuthProvider(
    profileId: string,
    serverName: string,
    issuer: string,
    redirectUrl: string,
  ): OAuthClientProvider {
    const vault = this.options.oauth
    if (vault === undefined) throw new Error('OAuth vault required for OAuth-enabled MCP server')

    const binding = {
      profileId,
      serverId: serverName,
      accountId: 'default',
      issuer: issuer.startsWith('https://') ? issuer : `https://${new URL(issuer).host}`,
      redirectUrl,
      browserBinding: `mcp-${profileId}-${serverName}`,
    }

    return vault.provider({
      ...binding,
      metadata: {
        redirect_uris: [redirectUrl],
        client_name: `DSH profile ${profileId}`,
      },
      onRedirect: () => {
        this.options.onError?.(
          new Error('OAuth authorization is required'),
          `mcp-manager: OAuth authorization required ${serverName}@${profileId}`,
        )
      },
    })
  }

  private async discoverTools(conn: ManagedConnection): Promise<void> {
    if (conn.closed) return
    const result = await conn.client.listTools()
    const prefix = sanitizeServerName(conn.serverName)
    const rawToolNames = new Map<string, string>()
    for (const tool of result.tools) {
      const publicName = `mcp__${prefix}__${sanitizeToolName(tool.name)}`
      if (rawToolNames.has(publicName)) throw new Error(`MCP tool name collision for ${publicName}`)
      rawToolNames.set(publicName, tool.name)
      this.registerDispatcher(publicName, tool.description ?? '', tool.inputSchema as Record<string, unknown>)
    }
    conn.rawToolNames.clear()
    for (const [publicName, rawName] of rawToolNames) conn.rawToolNames.set(publicName, rawName)
    conn.toolNames = [...rawToolNames.keys()]
    this.options.onDiscovery?.({ profileId: conn.profileId, serverName: conn.serverName, generation: conn.generation, toolNames: conn.toolNames })
  }

  private registerDispatcher(publicName: string, description: string, parameters: Record<string, unknown>): void {
    if (this.registrations.has(publicName) || this.options.toolsRuntime === undefined) return
    const definition: ToolDefinition = {
      name: publicName,
      description,
      parameters: parameters as ToolDefinition['parameters'],
      output: {
        schema: { type: 'object' },
        render: (_args, value) => [{ type: 'text', text: renderMcpValue(value) }],
      },
      execute: async (args, exec) => {
        const header = exec.agent?.session.header as { readonly profileId?: string } | undefined
        const profileId = header?.profileId
        if (profileId === undefined) throw new Error('PROFILE_ID_UNAVAILABLE')
        const connection = [...this.connections.values()].find(candidate => !candidate.closed && candidate.profileId === profileId && candidate.rawToolNames.has(publicName))
        if (connection === undefined) throw new Error('PROFILE_CAPABILITY_UNAVAILABLE')
        const rawName = connection.rawToolNames.get(publicName)!
        const argumentsValue = typeof args === 'object' && args !== null ? args as Record<string, unknown> : {}
        connection.activeCalls++
        try {
          return await connection.client.callTool({ name: rawName, arguments: argumentsValue }, undefined, { signal: exec.signal }) as never
        } finally {
          connection.activeCalls--
          if (connection.activeCalls === 0) connection.drain?.resolve()
        }
      },
    }
    this.registrations.set(publicName, this.options.toolsRuntime.register(definition))
  }

  private async closeConnection(key: string): Promise<void> {
    const conn = this.connections.get(key)
    if (conn === undefined) return
    conn.closed = true
    this.connections.delete(key)
    if (conn.activeCalls > 0) {
      let resolve!: () => void
      const promise = new Promise<void>(done => { resolve = done })
      conn.drain = { promise, resolve }
      await promise
    }
    try { await conn.transport.close() }
    catch { this.options.onError?.(new Error('MCP connection close failed'), `mcp-manager: close ${conn.serverName}@${conn.profileId}`) }
  }
}

/** Sanitize server name to valid MCP tool name segment. */
function sanitizeServerName(name: string): string {
  return name.replace(/[^A-Za-z0-9_-]/g, '_')
}

function sanitizeToolName(name: string): string {
  return name.replace(/[^A-Za-z0-9_-]/g, '_')
}

function renderMcpValue(value: unknown): string {
  if (typeof value === 'object' && value !== null && 'content' in value && Array.isArray(value.content)) {
    const text = value.content.flatMap(block => typeof block === 'object' && block !== null && 'text' in block && typeof block.text === 'string' ? [block.text] : [])
    if (text.length > 0) return text.join('\n')
  }
  return JSON.stringify(value)
}
