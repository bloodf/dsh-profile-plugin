/* Same-origin JSON Host API and OAuth callback routes. */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { WebServer } from '@deepseek-ai/dsh-host-webserver'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { CapabilityOverride, ProfileDocument } from './model.js'
import type { CompanyProfileRegistry } from './registry.js'
import { RevisionConflictError } from './registry.js'
import type { OAuthVault } from './oauth.js'
import type { ProfileAttention } from './attention.js'

const API_PATH = '/company-profiles/api'
const CALLBACK_PATH = '/company-profiles/oauth/callback'
const MAX_BODY_BYTES = 256 * 1024

export interface OAuthFinishManager {
  finishAuth(input: {
    profileId: string
    serverId: string
    accountId: string
    code: string
  }): Promise<void>
}

export interface HostApiOptions {
  registry: CompanyProfileRegistry
  oauth: OAuthVault
  attention: ProfileAttention
  oauthFinish?: OAuthFinishManager
}

export function registerHostRoutes(webServer: WebServer, options: HostApiOptions): () => void {
  const disposeApi = webServer.register({ kind: 'exact', path: API_PATH, handler: (req, res) => handleApi(req, res, options) })
  const disposeCallback = webServer.register({ kind: 'exact', path: CALLBACK_PATH, handler: (req, res) => handleCallback(req, res, options) })
  return () => { disposeCallback(); disposeApi() }
}

async function handleApi(req: IncomingMessage, res: ServerResponse, options: HostApiOptions): Promise<void> {
  try {
    assertSameOrigin(req)
    if (req.method === 'GET') {
      const url = requestUrl(req)
      if (url.searchParams.get('view') === 'attention') return json(res, 200, { entries: options.attention.list(), counts: options.attention.counts() })
      return json(res, 200, profileView(options.registry.snapshot(), options.registry))
    }
    if (req.method !== 'POST') return json(res, 405, { error: 'method-not-allowed' })
    assertJson(req)
    const body = await readJson(req)
    const action = stringField(body, 'action')
    const revision = integerField(body, 'expectedRevision')
    let document: Readonly<ProfileDocument>
    switch (action) {
      case 'create':
        document = await options.registry.create(revision, {
          ...(optionalString(body, 'id') === undefined ? {} : { id: optionalString(body, 'id') }),
          fields: objectField(body, 'fields'),
          capabilities: capabilityArray(body.capabilities),
        })
        break
      case 'update':
        document = await options.registry.update(revision, stringField(body, 'profileId'), {
          fields: objectField(body, 'fields'),
          capabilities: capabilityArray(body.capabilities),
        })
        break
      case 'clone': document = await options.registry.clone(revision, stringField(body, 'profileId'), optionalString(body, 'id')); break
      case 'archive': document = await options.registry.archive(revision, stringField(body, 'profileId'), booleanField(body, 'archived')); break
      case 'delete': document = await options.registry.delete(revision, stringField(body, 'profileId')); break
      case 'reorder': document = await options.registry.reorder(revision, stringArray(body, 'order')); break
      case 'attention.clear':
        options.attention.clear(stringField(body, 'sessionId') as SessionId)
        return json(res, 200, { entries: options.attention.list(), counts: options.attention.counts() })
      case 'attention.question':
        options.attention.setQuestion(stringField(body, 'profileId'), stringField(body, 'sessionId') as SessionId, booleanField(body, 'pending'))
        return json(res, 200, { entries: options.attention.list(), counts: options.attention.counts() })
      default: return json(res, 400, { error: 'unknown-action' })
    }
    return json(res, 200, profileView(document, options.registry))
  } catch (error) {
    if (error instanceof RevisionConflictError) return json(res, 409, { error: 'revision-conflict', expected: error.expected, actual: error.actual })
    return json(res, 400, { error: error instanceof Error ? error.message : String(error) })
  }
}

async function handleCallback(req: IncomingMessage, res: ServerResponse, options: HostApiOptions): Promise<void> {
  let claim: Awaited<ReturnType<OAuthVault['claimCallback']>> | undefined
  try {
    if (req.method !== 'GET') return json(res, 405, { error: 'method-not-allowed' })
    assertSameOrigin(req)
    if (options.oauthFinish === undefined) throw new Error('OAuth completion manager is unavailable')
    const url = requestUrl(req)
    const binding = {
      profileId: requiredQuery(url, 'profileId'),
      serverId: requiredQuery(url, 'serverId'),
      accountId: requiredQuery(url, 'accountId'),
      issuer: requiredQuery(url, 'issuer'),
      redirectUrl: `${url.origin}${CALLBACK_PATH}`,
      browserBinding: browserBinding(req),
    }
    claim = await options.oauth.claimCallback({ ...binding, state: requiredQuery(url, 'state') })
    await options.oauthFinish.finishAuth({ ...binding, code: requiredQuery(url, 'code') })
    await claim.complete()
    res.statusCode = 303
    res.setHeader('location', '/?companyProfilesOAuth=complete')
    res.end()
  } catch (error) {
    await claim?.fail().catch(() => {})
    json(res, 400, { error: error instanceof Error ? error.message : String(error) })
  }
}

function profileView(document: Readonly<ProfileDocument>, registry: CompanyProfileRegistry): object {
  return {
    revision: document.revision,
    defaultProfileId: document.defaultProfileId,
    order: document.order,
    profiles: document.order.map(id => registry.resolve(id)),
  }
}

function assertSameOrigin(req: IncomingMessage): void {
  const host = req.headers.host
  if (host === undefined) throw new Error('missing Host header')
  const origin = req.headers.origin
  if (origin !== undefined && new URL(origin).host !== host) throw new Error('cross-origin request rejected')
  const site = req.headers['sec-fetch-site']
  if (site !== undefined && site !== 'same-origin' && site !== 'same-site' && site !== 'none') throw new Error('cross-site request rejected')
}
function assertJson(req: IncomingMessage): void { if (!String(req.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) throw new Error('application/json required') }
function requestUrl(req: IncomingMessage): URL { return new URL(req.url ?? '/', `http://${req.headers.host ?? 'invalid'}`) }
function browserBinding(req: IncomingMessage): string { const value = req.headers['x-company-profiles-browser']; if (typeof value !== 'string' || value.length < 16) throw new Error('browser binding header required'); return value }
function requiredQuery(url: URL, key: string): string { const value = url.searchParams.get(key); if (value === null || value.length === 0) throw new Error(`missing ${key}`); return value }
async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  let size = 0; const chunks: Buffer[] = []
  for await (const chunk of req) { const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk); size += buffer.length; if (size > MAX_BODY_BYTES) throw new Error('request body too large'); chunks.push(buffer) }
  const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  if (!isRecord(value)) throw new Error('JSON body must be an object')
  return value
}
function json(res: ServerResponse, status: number, value: unknown): void { if (res.writableEnded) return; res.statusCode = status; res.setHeader('content-type', 'application/json; charset=utf-8'); res.setHeader('cache-control', 'no-store'); res.end(JSON.stringify(value)) }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) }
function stringField(value: Record<string, unknown>, key: string): string { const result = value[key]; if (typeof result !== 'string' || result.length === 0) throw new Error(`${key} must be a non-empty string`); return result }
function optionalString(value: Record<string, unknown>, key: string): string | undefined { const result = value[key]; if (result === undefined) return undefined; if (typeof result !== 'string' || result.length === 0) throw new Error(`${key} must be a non-empty string`); return result }
function integerField(value: Record<string, unknown>, key: string): number { const result = value[key]; if (!Number.isSafeInteger(result) || Number(result) < 0) throw new Error(`${key} must be a non-negative safe integer`); return Number(result) }
function booleanField(value: Record<string, unknown>, key: string): boolean { const result = value[key]; if (typeof result !== 'boolean') throw new Error(`${key} must be boolean`); return result }
function objectField(value: Record<string, unknown>, key: string): Record<string, unknown> | undefined { const result = value[key]; if (result === undefined) return undefined; if (!isRecord(result)) throw new Error(`${key} must be an object`); return result }
function stringArray(value: Record<string, unknown>, key: string): string[] { const result = value[key]; if (!Array.isArray(result) || result.some(item => typeof item !== 'string')) throw new Error(`${key} must be a string array`); return result }
function capabilityArray(value: unknown): CapabilityOverride[] | undefined { if (value === undefined) return undefined; if (!Array.isArray(value)) throw new Error('capabilities must be an array'); return structuredClone(value) as CapabilityOverride[] }
