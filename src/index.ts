/* Persistent company profiles Host plugin: registry, policy, OAuth, routes, attention. */
import { dirname, join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { CredentialProvider } from '@deepseek-ai/dsh-credentials'
import type { Session } from '@deepseek-ai/dsh-session'
import type { WebServer } from '@deepseek-ai/dsh-host-webserver'
import { CompanyProfileRegistry } from './registry.js'
import { OAuthVault } from './oauth.js'
import { ProfileAttention } from './attention.js'
import { installHostRuntime, type DiscoveredToolsProvider } from './host-runtime.js'
import { registerHostRoutes, type OAuthFinishManager } from './host-api.js'

export * from './model.js'
export * from './registry.js'
export * from './oauth.js'
export * from './runtime.js'
export * from './attention.js'
export * from './host-runtime.js'
export * from './host-api.js'

export interface Config {
  /** Absolute profile metadata JSON path. */
  path: string
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    companyProfiles: CompanyProfileRegistry
    companyProfileOAuthFinish?: OAuthFinishManager
    companyProfileDiscoveredTools?: DiscoveredToolsProvider
  }
}

export const name = 'company-profiles'
export const inject = ['credentials', 'tools', 'sessions']

export async function apply(ctx: Context, config: Config): Promise<void> {
  if (typeof config.path !== 'string' || config.path.length === 0) throw new TypeError('company-profiles: path is required')
  const credentials = ctx.get('credentials') as CredentialProvider | undefined
  if (credentials === undefined) throw new Error('company-profiles requires Harness credentials service')
  const attention = new ProfileAttention()
  const registry = await CompanyProfileRegistry.open({
    path: config.path,
    hasActiveSessions: profileId => ctx.sessions.list().some(session => session.header.profileId === profileId),
    onListenerError: error => ctx.logger.warn(`company-profiles listener failed: ${String(error)}`),
  })
  const oauth = await OAuthVault.open(join(dirname(config.path), 'oauth.json'), credentials)
  ctx.provide('companyProfiles', registry)

  const discovered = ctx.get('companyProfileDiscoveredTools') ?? { tools: () => [] }
  installHostRuntime(ctx, registry, discovered)
  ctx.on('session/event', (session, event) => { attention.observe(session, event) })
  ctx.on('session/disposed', (session: Session) => { attention.disposeSession(session.id) })

  const webServer = ctx.get('webServer') as WebServer | undefined
  if (webServer !== undefined) {
    ctx.effect(() => registerHostRoutes(webServer, {
      registry,
      oauth,
      attention,
      oauthFinish: ctx.get('companyProfileOAuthFinish'),
    }), 'company-profiles: HTTP API and OAuth callback')
  }
}
