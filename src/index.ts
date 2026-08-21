/* Persistent company profiles Host plugin: registry, policy, OAuth, routes, attention. */
import { dirname, join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { CredentialProvider } from '@deepseek-ai/dsh-credentials'
import type { Session } from '@deepseek-ai/dsh-session'
import type { WebServer } from '@deepseek-ai/dsh-host-webserver'
import { CompanyProfileRegistry } from './registry.js'
import { OAuthVault } from './oauth.js'
import { ProfileAttention } from './attention.js'
import { installHostRuntime } from './host-runtime.js'
import { McpManager } from './mcp-manager.js'
import { registerHostRoutes } from './host-api.js'

export * from './model.js'
export * from './registry.js'
export * from './oauth.js'
export * from './runtime.js'
export * from './attention.js'
export * from './host-runtime.js'
export * from './host-api.js'
export * from './mcp-manager.js'

export interface Config {
  /** Absolute profile metadata JSON path. */
  path: string
  /** Canonical HTTP(S) origin serving the Host UI. */
  origin: string
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    companyProfiles: CompanyProfileRegistry
  }
}

export const name = 'company-profiles'
export const inject = ['credentials', 'tools']

export async function apply(ctx: Context, config: Config): Promise<void> {
  if (typeof config.path !== 'string' || config.path.length === 0) throw new TypeError('company-profiles: path is required')
  let siteOrigin: string
  try {
    const url = new URL(config.origin)
    if (!['http:', 'https:'].includes(url.protocol) || url.origin !== config.origin || url.pathname !== '/' || url.search !== '' || url.hash !== '' || url.username !== '' || url.password !== '') throw new TypeError()
    siteOrigin = url.origin
  } catch {
    throw new TypeError('company-profiles: origin must be a canonical HTTP(S) origin')
  }
  const credentials = ctx.get('credentials') as CredentialProvider | undefined
  if (credentials === undefined) throw new Error('company-profiles requires Harness credentials service')
  const attention = new ProfileAttention()
  const sessions = ctx.get('sessions') as { list?: () => readonly Session[] } | undefined
  const hasActiveSessions = sessions?.list === undefined ? undefined : (profileId: string): boolean => sessions.list!().some(session => {
    const header = session.header as { readonly profileId?: string }
    return header.profileId === profileId
  })
  const registry = await CompanyProfileRegistry.open({
    path: config.path,
    ...(hasActiveSessions === undefined ? {} : { hasActiveSessions }),
    onListenerError: () => ctx.logger.warn('company-profiles listener failed'),
  })
  const oauth = await OAuthVault.open(join(dirname(config.path), 'oauth.json'), credentials)
  ctx.provide('companyProfiles', registry)

  const manager = new McpManager({
    oauth,
    oauthRedirectBase: siteOrigin,
    credentials,
    toolsRuntime: ctx.tools,
    onError: (_error, context) => ctx.logger.warn(context),
  })
  const controller = installHostRuntime(ctx, registry, manager)
  const reconcile = async (): Promise<void> => {
    const document = registry.snapshot()
    for (const profileId of document.order) await manager.reconcile(registry.resolve(profileId), document.revision)
    controller.reconcile()
  }
  await reconcile()
  ctx.effect(() => registry.subscribe(() => { void reconcile() }), 'company-profiles: MCP reconciliation')
  ctx.effect(() => () => manager.closeAll(), 'company-profiles: MCP cleanup')
  ctx.on('session/event', (session, event) => {
    const header = session.header as { readonly profileId?: string }
    attention.observe({ id: session.id, header }, event)
  })
  ctx.on('session/disposed', (session: Session) => { attention.disposeSession(session.id) })

  const webServer = ctx.get('webServer') as WebServer | undefined
  if (webServer !== undefined) {
    ctx.effect(() => registerHostRoutes(webServer, {
      registry,
      oauth,
      attention,
      siteOrigin,
      oauthFinish: manager,
    }), 'company-profiles: HTTP API and OAuth callback')
  }
}
