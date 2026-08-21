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

async function request(method: string, body?: object): Promise<unknown> {
  const options: RequestInit = {
    method,
    headers: { 'Content-Type': 'application/json' },
  }
  if (body !== undefined) options.body = JSON.stringify(body)
  const response = await fetch(API, options)
  const data: unknown = await response.json()
  if (!response.ok) throw new Error((data as { error?: string }).error ?? `HTTP ${response.status}`)
  return data
}

export async function fetchProfiles(): Promise<ApiDocument> {
  return request('GET') as Promise<ApiDocument>
}

export async function fetchAttention(): Promise<AttentionResponse> {
  return fetch(`${API}?view=attention`).then(r => r.json()) as Promise<AttentionResponse>
}

export async function createProfile(
  expectedRevision: number,
  fields: Record<string, unknown>,
  capabilities?: ApiCapability[],
): Promise<ApiDocument> {
  return request('POST', { action: 'create', expectedRevision, fields, capabilities }) as Promise<ApiDocument>
}

export async function updateProfile(
  expectedRevision: number,
  profileId: string,
  fields: Record<string, unknown>,
  capabilities?: ApiCapability[],
): Promise<ApiDocument> {
  return request('POST', { action: 'update', expectedRevision, profileId, fields, capabilities }) as Promise<ApiDocument>
}

export async function archiveProfile(
  expectedRevision: number,
  profileId: string,
  archived: boolean,
): Promise<ApiDocument> {
  return request('POST', { action: 'archive', expectedRevision, profileId, archived }) as Promise<ApiDocument>
}

export async function deleteProfile(
  expectedRevision: number,
  profileId: string,
): Promise<ApiDocument> {
  return request('POST', { action: 'delete', expectedRevision, profileId }) as Promise<ApiDocument>
}

export async function cloneProfile(
  expectedRevision: number,
  profileId: string,
): Promise<ApiDocument> {
  return request('POST', { action: 'clone', expectedRevision, profileId }) as Promise<ApiDocument>
}

export async function reorderProfiles(
  expectedRevision: number,
  order: string[],
): Promise<ApiDocument> {
  return request('POST', { action: 'reorder', expectedRevision, order }) as Promise<ApiDocument>
}

export async function clearAttention(sessionId: string): Promise<AttentionResponse> {
  return request('POST', { action: 'attention.clear', sessionId, expectedRevision: 0 }) as Promise<AttentionResponse>
}
