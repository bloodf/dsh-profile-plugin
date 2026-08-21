/* Same-origin JSON Host API and OAuth callback routes. */
import { randomBytes, timingSafeEqual } from 'node:crypto'
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
  beginAuth?(input: { profileId: string; serverId: string; accountId: string }): Promise<string>
}

export interface HostApiOptions {
  registry: CompanyProfileRegistry
  oauth: OAuthVault
  attention: ProfileAttention
  siteOrigin: string
  oauthFinish?: OAuthFinishManager
}

interface RegisteredHostApiOptions extends HostApiOptions {
  csrfToken: string
}

export function registerHostRoutes(webServer: WebServer, options: HostApiOptions): () => void {
  const registered: RegisteredHostApiOptions = { ...options, csrfToken: randomBytes(32).toString('base64url') }
  const disposeApi = webServer.register({ kind: 'exact', path: API_PATH, handler: (req, res) => handleApi(req, res, registered) })
  const disposeCallback = webServer.register({ kind: 'exact', path: CALLBACK_PATH, handler: (req, res) => handleCallback(req, res, registered) })
  return () => { disposeCallback(); disposeApi() }
}

async function handleApi(req: IncomingMessage, res: ServerResponse, options: RegisteredHostApiOptions): Promise<void> {
  try {
    assertSameOrigin(req, options.siteOrigin)
    if (req.method === 'GET') {
      const url = requestUrl(req, options.siteOrigin)
      if (url.searchParams.get('view') === 'attention') return json(res, 200, { entries: options.attention.list(), counts: options.attention.counts() })
      if (url.searchParams.get('view') === 'oauth') return json(res, 200, { bindings: await options.oauth.status(requiredQuery(url, 'profileId')) })
      return json(res, 200, profileView(options.registry.snapshot(), options.registry, options.csrfToken))
    }
    if (req.method !== 'POST') return json(res, 405, { error: 'method-not-allowed' })
    assertCsrf(req, options.csrfToken)
    assertJson(req)
    const body = await readJson(req)
    const action = stringField(body, 'action')
    const revision = integerField(body, 'expectedRevision')
    let document: Readonly<ProfileDocument>
    switch (action) {
      case 'create': {
        const id = optionalString(body, 'id')
        const fields = objectField(body, 'fields')
        const capabilities = capabilityArray(body.capabilities)
        document = await options.registry.create(revision, {
          ...(id === undefined ? {} : { id }),
          ...(fields === undefined ? {} : { fields }),
          ...(capabilities === undefined ? {} : { capabilities }),
        })
        break
      }
      case 'update': {
        const fields = objectField(body, 'fields')
        const capabilities = capabilityArray(body.capabilities)
        document = await options.registry.update(revision, stringField(body, 'profileId'), {
          ...(fields === undefined ? {} : { fields }),
          ...(capabilities === undefined ? {} : { capabilities }),
        })
        break
      }
      case 'clone': document = await options.registry.clone(revision, stringField(body, 'profileId'), optionalString(body, 'id')); break
      case 'archive': document = await options.registry.archive(revision, stringField(body, 'profileId'), booleanField(body, 'archived')); break
      case 'delete': document = await options.registry.delete(revision, stringField(body, 'profileId')); break
      case 'reorder': document = await options.registry.reorder(revision, stringArray(body, 'order')); break
      case 'oauth-revoke':
        await options.oauth.revokeAccount({ profileId: stringField(body, 'profileId'), serverId: stringField(body, 'serverId'), accountId: stringField(body, 'accountId') })
        return json(res, 200, { ok: true })
      case 'oauth-begin': {
        if (options.oauthFinish?.beginAuth === undefined) return json(res, 503, { error: 'oauth-unavailable' })
        const authorizationUrl = await options.oauthFinish.beginAuth({ profileId: stringField(body, 'profileId'), serverId: stringField(body, 'serverId'), accountId: stringField(body, 'accountId') })
        return json(res, 200, { authorizationUrl })
      }
      case 'attention.clear': {
        const sessionId = stringField(body, 'sessionId') as SessionId
        if (options.attention.profileOf(sessionId) === undefined) return json(res, 404, { error: 'session-not-found' })
        options.attention.clear(sessionId)
        return json(res, 200, { entries: options.attention.list(), counts: options.attention.counts() })
      }
      case 'attention.question': {
        const profileId = stringField(body, 'profileId')
        const sessionId = stringField(body, 'sessionId') as SessionId
        if (options.attention.profileOf(sessionId) !== profileId) return json(res, 403, { error: 'attention-owner-mismatch' })
        options.attention.setQuestion(profileId, sessionId, booleanField(body, 'pending'))
        return json(res, 200, { entries: options.attention.list(), counts: options.attention.counts() })
      }
      default: return json(res, 400, { error: 'unknown-action' })
    }
    return json(res, 200, profileView(document, options.registry, options.csrfToken))
  } catch (error) {
    if (error instanceof RevisionConflictError) return json(res, 409, { error: 'revision-conflict', expected: error.expected, actual: error.actual })
    if (error instanceof RequestError) return json(res, error.status, { error: error.code })
    return json(res, 500, { error: 'internal-error' })
  }
}

async function handleCallback(req: IncomingMessage, res: ServerResponse, options: RegisteredHostApiOptions): Promise<void> {
  let claim: Awaited<ReturnType<OAuthVault['claimCallback']>> | undefined
  res.setHeader('referrer-policy', 'no-referrer')
  res.setHeader('cache-control', 'no-store')
  try {
    if (req.method !== 'GET' || options.oauthFinish === undefined) return redirect(res, '/?companyProfilesOAuth=error')
    const url = requestUrl(req, options.siteOrigin)
    const state = requiredQuery(url, 'state')
    const code = requiredQuery(url, 'code')
    const claimed = await options.oauth.claimCallbackByState(state)
    claim = claimed.claim
    await options.oauthFinish.finishAuth({ ...claimed.binding, code })
    await claim.complete()
    redirect(res, '/?companyProfilesOAuth=complete')
  } catch {
    await claim?.fail().catch(() => {})
    redirect(res, '/?companyProfilesOAuth=error')
  }
}

function profileView(document: Readonly<ProfileDocument>, registry: CompanyProfileRegistry, csrfToken: string): object {
  return {
    revision: document.revision,
    defaultProfileId: document.defaultProfileId,
    order: document.order,
    profiles: document.order.map(id => registry.resolve(id)),
    csrfToken,
  }
}

function assertSameOrigin(req: IncomingMessage, siteOrigin: string): void {
  const expected = new URL(siteOrigin)
  if (req.headers.host !== expected.host) throw new RequestError(403, 'origin-invalid')
  const origin = req.headers.origin
  if (origin !== undefined && origin !== expected.origin) throw new RequestError(403, 'origin-invalid')
  const site = req.headers['sec-fetch-site']
  if (site !== undefined && site !== 'same-origin' && site !== 'none') throw new RequestError(403, 'origin-invalid')
}
function assertCsrf(req: IncomingMessage, expected: string): void {
  const actual = req.headers['x-dsh-profile-csrf']
  if (typeof actual !== 'string') throw new RequestError(403, 'csrf-invalid')
  const left = Buffer.from(actual); const right = Buffer.from(expected)
  if (left.length !== right.length || !timingSafeEqual(left, right)) throw new RequestError(403, 'csrf-invalid')
}
function assertJson(req: IncomingMessage): void { if (!String(req.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) throw new RequestError(415, 'content-type-invalid') }
function requestUrl(req: IncomingMessage, siteOrigin: string): URL { return new URL(req.url ?? '/', siteOrigin) }
function browserBinding(req: IncomingMessage): string { const value = req.headers['x-company-profiles-browser']; if (typeof value !== 'string' || value.length < 16) throw new RequestError(400, 'oauth-binding-invalid'); return value }
function requiredQuery(url: URL, key: string): string { const value = url.searchParams.get(key); if (value === null || value.length === 0) throw new RequestError(400, 'oauth-callback-invalid'); return value }
async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  let size = 0; const chunks: Buffer[] = []
  for await (const chunk of req) { const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk); size += buffer.length; if (size > MAX_BODY_BYTES) throw new RequestError(413, 'body-too-large'); chunks.push(buffer) }
  let value: unknown
  try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { throw new RequestError(400, 'json-invalid') }
  if (!isRecord(value)) throw new RequestError(400, 'json-invalid')
  return value
}
function redirect(res: ServerResponse, location: string): void { if (res.writableEnded) return; res.statusCode = 303; res.setHeader('location', location); res.end() }
function json(res: ServerResponse, status: number, value: unknown): void { if (res.writableEnded) return; res.statusCode = status; res.setHeader('content-type', 'application/json; charset=utf-8'); res.setHeader('cache-control', 'no-store'); res.end(JSON.stringify(value)) }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) }
function stringField(value: Record<string, unknown>, key: string): string { const result = value[key]; if (typeof result !== 'string' || result.length === 0) throw new Error(`${key} must be a non-empty string`); return result }
function optionalString(value: Record<string, unknown>, key: string): string | undefined { const result = value[key]; if (result === undefined) return undefined; if (typeof result !== 'string' || result.length === 0) throw new Error(`${key} must be a non-empty string`); return result }
function integerField(value: Record<string, unknown>, key: string): number { const result = value[key]; if (!Number.isSafeInteger(result) || Number(result) < 0) throw new Error(`${key} must be a non-negative safe integer`); return Number(result) }
function booleanField(value: Record<string, unknown>, key: string): boolean { const result = value[key]; if (typeof result !== 'boolean') throw new Error(`${key} must be boolean`); return result }
function objectField(value: Record<string, unknown>, key: string): Record<string, unknown> | undefined { const result = value[key]; if (result === undefined) return undefined; if (!isRecord(result)) throw new Error(`${key} must be an object`); return result }
function stringArray(value: Record<string, unknown>, key: string): string[] { const result = value[key]; if (!Array.isArray(result) || result.some(item => typeof item !== 'string')) throw new Error(`${key} must be a string array`); return result }
function capabilityArray(value: unknown): CapabilityOverride[] | undefined { if (value === undefined) return undefined; if (!Array.isArray(value)) throw new Error('capabilities must be an array'); return structuredClone(value) as CapabilityOverride[] }

class RequestError extends Error {
  constructor(readonly status: number, readonly code: string) { super(code) }
}
