/** Same-origin JSON API client for /company-profiles/api. */

const API = '/company-profiles/api'

export interface ApiProfile {
  id: string
  parentId: string | null
  archived: boolean
  createdAt: string
  updatedAt: string
  fields: {
    displayName: string | null
    legalName: string | null
    description: string | null
    website: string | null
    color: string | null
    avatarSeed: string | null
  }
  capabilities: ApiCapability[]
  localOverrides: ApiCapability[]
}

export interface ApiCapability {
  kind: 'mcp' | 'skill' | 'plugin'
  key: string
  state: 'enabled' | 'disabled'
  config?: unknown
  source?: 'inherited' | 'local'
  definitionProfileId?: string
  executionProfileId?: string
}

export interface ApiDocument {
  revision: number
  defaultProfileId: string
  order: string[]
  profiles: ApiProfile[]
  /** High-entropy, process-lifetime anti-CSRF token; echoed on every POST via `x-dsh-profile-csrf`. */
  csrfToken: string
}

export interface AttentionEntry {
  profileId: string
  sessionId: string
  reasons: readonly string[]
}

export interface AttentionResponse {
  entries: AttentionEntry[]
  counts: Record<string, number>
}

export interface OAuthBindingStatus {
  serverId: string
  accountId: string
  connected: boolean
  generation: number
}

export interface OAuthStatusResponse {
  bindings: OAuthBindingStatus[]
}

/** Optimistic-concurrency conflict: `expectedRevision` no longer matches the Host document. */
export class RevisionConflictError extends Error {
  constructor(readonly expected: number, readonly actual: number) {
    super(`company profiles revision conflict: expected ${expected}, actual ${actual}`)
    this.name = 'RevisionConflictError'
  }
}

/** CSRF token rejected or missing; caller should refetch `fetchProfiles()` for a fresh token and retry once. */
export class CsrfError extends Error {
  constructor() {
    super('company profiles CSRF token rejected — refetch and retry')
    this.name = 'CsrfError'
  }
}

async function request(method: string, body?: object, csrfToken?: string): Promise<unknown> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (method === 'POST') {
    if (!csrfToken) throw new CsrfError()
    headers['x-dsh-profile-csrf'] = csrfToken
  }
  const options: RequestInit = { method, headers }
  if (body !== undefined) options.body = JSON.stringify(body)
  const response = await fetch(API, options)
  const data: unknown = await response.json()
  if (!response.ok) {
    const err = data as { error?: string; expected?: number; actual?: number }
    if (response.status === 409 && err.error === 'revision-conflict'
      && typeof err.expected === 'number' && typeof err.actual === 'number') {
      throw new RevisionConflictError(err.expected, err.actual)
    }
    if (response.status === 403 && (err.error === 'csrf-invalid' || err.error === undefined)) throw new CsrfError()
    throw new Error(err.error ?? `HTTP ${response.status}`)
  }
  return data
}

export async function fetchProfiles(): Promise<ApiDocument> {
  return request('GET') as Promise<ApiDocument>
}

export async function fetchAttention(): Promise<AttentionResponse> {
  return fetch(`${API}?view=attention`).then(r => r.json()) as Promise<AttentionResponse>
}

export async function fetchOAuthStatus(profileId: string): Promise<OAuthStatusResponse> {
  return fetch(`${API}?view=oauth&profileId=${encodeURIComponent(profileId)}`)
    .then(r => r.json()) as Promise<OAuthStatusResponse>
}

export async function createProfile(
  expectedRevision: number,
  fields: Record<string, unknown>,
  csrfToken: string,
  capabilities?: ApiCapability[],
): Promise<ApiDocument> {
  return request('POST', { action: 'create', expectedRevision, fields, capabilities }, csrfToken) as Promise<ApiDocument>
}

export async function updateProfile(
  expectedRevision: number,
  profileId: string,
  fields: Record<string, unknown>,
  csrfToken: string,
  capabilities?: ApiCapability[],
): Promise<ApiDocument> {
  return request('POST', { action: 'update', expectedRevision, profileId, fields, capabilities }, csrfToken) as Promise<ApiDocument>
}

export async function archiveProfile(
  expectedRevision: number,
  profileId: string,
  archived: boolean,
  csrfToken: string,
): Promise<ApiDocument> {
  return request('POST', { action: 'archive', expectedRevision, profileId, archived }, csrfToken) as Promise<ApiDocument>
}

export async function deleteProfile(
  expectedRevision: number,
  profileId: string,
  csrfToken: string,
): Promise<ApiDocument> {
  return request('POST', { action: 'delete', expectedRevision, profileId }, csrfToken) as Promise<ApiDocument>
}

export async function cloneProfile(
  expectedRevision: number,
  profileId: string,
  csrfToken: string,
): Promise<ApiDocument> {
  return request('POST', { action: 'clone', expectedRevision, profileId }, csrfToken) as Promise<ApiDocument>
}

export async function reorderProfiles(
  expectedRevision: number,
  order: string[],
  csrfToken: string,
): Promise<ApiDocument> {
  return request('POST', { action: 'reorder', expectedRevision, order }, csrfToken) as Promise<ApiDocument>
}

export async function clearAttention(sessionId: string, csrfToken: string): Promise<AttentionResponse> {
  return request('POST', { action: 'attention.clear', sessionId, expectedRevision: 0 }, csrfToken) as Promise<AttentionResponse>
}

export async function oauthBegin(
  expectedRevision: number,
  profileId: string,
  serverId: string,
  accountId: string,
  csrfToken: string,
): Promise<{ authorizationUrl: string }> {
  return request('POST', { action: 'oauth-begin', expectedRevision, profileId, serverId, accountId }, csrfToken) as Promise<{ authorizationUrl: string }>
}

export async function oauthRevoke(
  expectedRevision: number,
  profileId: string,
  serverId: string,
  accountId: string,
  csrfToken: string,
): Promise<{ ok: true }> {
  return request('POST', { action: 'oauth-revoke', expectedRevision, profileId, serverId, accountId }, csrfToken) as Promise<{ ok: true }>
}
