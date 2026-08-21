/*
 * Live MCP connection manager: one Client per (profileId, serverName, generation).
 * Supports stdio and streamable-http transports. OAuth via OAuthVault provider.
 * Connections are profile-scoped — no cross-profile reuse. Discovery publishes
 * exact tool names for capability generation reconciliation.
 * @module @dsh-local/company-profiles/mcp-manager
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { auth } from '@modelcontextprotocol/sdk/client/auth.js'
import type { OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js'
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
  toolNames: readonly string[]
  closed: boolean
}

export interface McpManagerOptions {
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

    // Close connections no longer wanted
    for (const [key, conn] of this.connections) {
      if (conn.profileId !== profile.id) continue
      if (!wanted.has(conn.serverName) || conn.generation < generation) {
        await this.closeConnection(key)
      }
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

    const transport = this.createTransport(profileId, serverName, definition)
    const client = new Client(
      { name: `dsh-profile-${profileId}`, version: '0.1.0' },
      { capabilities: { tools: {} } },
    )

    const conn: ManagedConnection = {
      profileId,
      serverName,
      generation,
      client,
      transport,
      toolNames: [],
      closed: false,
    }
    this.connections.set(key, conn)

    transport.onerror = (error) => {
      this.options.onError?.(error, `mcp-manager: transport error ${serverName}@${profileId}`)
    }
    transport.onclose = () => {
      if (!conn.closed) {
        conn.closed = true
        this.connections.delete(key)
      }
    }

    await client.connect(transport)
    // Set up tools/changed notification
    client.setNotificationHandler({ method: 'notifications/tools/list_changed' }, async () => {
      try { await this.discoverTools(conn) }
      catch (error) { this.options.onError?.(error, `mcp-manager: re-discovery ${serverName}@${profileId}`) }
    })
    await this.discoverTools(conn)
  }

  private createTransport(
    profileId: string,
    serverName: string,
    definition: McpDefinition,
  ): StdioClientTransport | StreamableHTTPClientTransport {
    if (definition.transport === 'stdio') {
      if (definition.command === undefined) throw new TypeError('stdio transport requires command')
      return new StdioClientTransport({
        command: definition.command,
        args: definition.args,
        env: { ...getDefaultEnvironment(), ...definition.env },
        cwd: definition.cwd,
      })
    }

    if (definition.transport === 'streamable-http') {
      if (definition.url === undefined) throw new TypeError('streamable-http transport requires url')
      const url = new URL(definition.url)
      const requestInit: RequestInit = {}
      if (definition.headers !== undefined) {
        requestInit.headers = { ...definition.headers }
      }
      const transportOpts: ConstructorParameters<typeof StreamableHTTPClientTransport>[1] = { requestInit }

      if (definition.oauth === true && this.options.oauth !== undefined) {
        const redirectUrl = this.options.oauthRedirectBase
          ? `${this.options.oauthRedirectBase}/company-profiles/oauth/callback`
          : 'http://127.0.0.1:3080/company-profiles/oauth/callback'
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
      onRedirect: (url) => {
        this.options.onError?.(
          new Error(`OAuth redirect required: ${url.toString()}`),
          `mcp-manager: OAuth redirect ${serverName}@${profileId}`,
        )
      },
    })
  }

  private async discoverTools(conn: ManagedConnection): Promise<void> {
    if (conn.closed) return
    const result = await conn.client.listTools()
    const prefix = sanitizeServerName(conn.serverName)
    const toolNames = result.tools.map(tool => `mcp__${prefix}__${tool.name}`)
    conn.toolNames = toolNames
    this.options.onDiscovery?.({
      profileId: conn.profileId,
      serverName: conn.serverName,
      generation: conn.generation,
      toolNames,
    })
  }

  private async closeConnection(key: string): Promise<void> {
    const conn = this.connections.get(key)
    if (conn === undefined) return
    conn.closed = true
    this.connections.delete(key)
    try { await conn.transport.close() }
    catch (error) { this.options.onError?.(error, `mcp-manager: close ${conn.serverName}@${conn.profileId}`) }
  }
}

/** Sanitize server name to valid MCP tool name segment. */
function sanitizeServerName(name: string): string {
  return name.replace(/[^A-Za-z0-9_-]/g, '_')
}
