/*
 * Profile-bound OAuth transaction metadata over Harness-owned credential references.
 * @module @dsh-local/company-profiles/oauth
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import type { CredentialInfo, CredentialProvider, CredentialRef, ResolvedCredential } from '@deepseek-ai/dsh-credentials'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import type { OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js'
import type { OAuthClientInformationMixed, OAuthClientMetadata, OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js'

interface OAuthBinding {
  profileId: string
  serverId: string
  accountId: string
  issuer: string
  redirectUrl: string
  browserBinding: string
}

interface OAuthRecord extends OAuthBinding {
  stateHash?: string
  expiresAt?: number
  callbackClaimed?: boolean
  revokedGeneration: number
  tokenRef: string
  clientRef: string
  verifierRef: string
}

interface OAuthDocument {
  schemaVersion: 1
  revision: number
  records: Record<string, OAuthRecord>
}

export interface OAuthBeginInput extends OAuthBinding {
  ttlMs?: number
}

export interface OAuthCallbackInput extends OAuthBinding {
  state: string
}

export interface OAuthCallbackClaim {
  complete(): Promise<void>
  fail(): Promise<void>
}

/** Small credential face used by production CredentialProvider and memory tests. */
export interface OAuthCredentialStore {
  resolve(ref: CredentialRef): Promise<ResolvedCredential | undefined>
  describe(ref: CredentialRef): Promise<CredentialInfo>
  set(ref: CredentialRef, value: string): Promise<void>
  unset(ref: CredentialRef): Promise<void>
}

export interface OAuthBindingStatus {
  serverId: string
  accountId: string
  connected: boolean
  generation: number
}
export class OAuthVault {
  private document: OAuthDocument = { schemaVersion: 1, revision: 0, records: {} }
  private queue: Promise<void> = Promise.resolve()
  private readonly refreshes = new Map<string, Promise<OAuthTokens>>()

  private constructor(
    private readonly path: string,
    private readonly credentials: OAuthCredentialStore,
    private readonly now: () => number,
  ) {}

  static async open(
    path: string,
    credentials: OAuthCredentialStore | CredentialProvider,
    now: () => number = Date.now,
  ): Promise<OAuthVault> {
    const vault = new OAuthVault(path, credentials, now)
    await withFileLock(path, async () => {
      try {
        vault.document = parseDocument(JSON.parse(await readFile(path, 'utf8')))
      } catch (error) {
        if (!isNotFound(error)) throw error
        await persist(path, vault.document)
      }
    })
    return vault
  }

  async begin(input: OAuthBeginInput): Promise<{ state: string }> {
    validateBinding(input)
    const ttlMs = input.ttlMs ?? 300_000
    if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0) throw new TypeError('OAuth ttlMs must be a positive safe integer')
    const state = randomBytes(32).toString('base64url')
    const key = recordKey(input)
    await this.change(draft => {
      const refs = secretRefs(input)
      draft.records[key] = {
        profileId: input.profileId,
        serverId: input.serverId,
        accountId: input.accountId,
        issuer: input.issuer,
        redirectUrl: input.redirectUrl,
        browserBinding: input.browserBinding,
        stateHash: hash(state),
        expiresAt: this.now() + ttlMs,
        callbackClaimed: false,
        revokedGeneration: draft.records[key]?.revokedGeneration ?? 0,
        ...refs,
      }
    })
    return { state }
  }

  /** Claim callback once; `fail()` reopens same transaction for a safe retry. */
  async claimCallback(input: OAuthCallbackInput): Promise<OAuthCallbackClaim> {
    validateBinding(input)
    const key = recordKey(input)
    await this.change(draft => {
      const record = requireRecord(draft, key)
      assertBinding(record, input)
      if (record.callbackClaimed || record.expiresAt === undefined || record.expiresAt < this.now()
        || record.stateHash === undefined || !equal(record.stateHash, hash(input.state))) {
        throw new Error('invalid, expired, or consumed OAuth state')
      }
      record.callbackClaimed = true
    })
    let settled = false
    return {
      complete: async () => {
        if (settled) return
        settled = true
        await this.change(draft => {
          const record = requireRecord(draft, key)
          delete record.stateHash
          delete record.expiresAt
          delete record.callbackClaimed
        })
      },
      fail: async () => {
        if (settled) return
        settled = true
        await this.change(draft => { requireRecord(draft, key).callbackClaimed = false })
      },
    }
  }

  async claimCallbackByState(state: string): Promise<{ binding: OAuthBinding; claim: OAuthCallbackClaim }> {
    const stateHash = hash(state)
    const record = Object.values(this.document.records).find(candidate => candidate.stateHash !== undefined && equal(candidate.stateHash, stateHash))
    if (record === undefined) throw new Error('invalid, expired, or consumed OAuth state')
    const binding: OAuthBinding = {
      profileId: record.profileId,
      serverId: record.serverId,
      accountId: record.accountId,
      issuer: record.issuer,
      redirectUrl: record.redirectUrl,
      browserBinding: record.browserBinding,
    }
    return { binding, claim: await this.claimCallback({ ...binding, state }) }
  }

  async revoke(binding: OAuthBinding): Promise<void> {
    validateBinding(binding)
    const key = recordKey(binding)
    await this.enqueue(async () => {
      await withFileLock(this.path, async () => {
        const current = await readDocumentOr(this.path, this.document)
        const draft = structuredClone(current)
        const record = requireRecord(draft, key)
        assertBinding(record, binding)
        record.revokedGeneration++
        await Promise.all([
          this.credentials.unset(credentialRef(record.tokenRef)),
          this.credentials.unset(credentialRef(record.clientRef)),
          this.credentials.unset(credentialRef(record.verifierRef)),
        ])
        draft.revision++
        const valid = parseDocument(draft)
        await persist(this.path, valid)
        this.document = valid
      })
    })
  }

  generation(binding: Pick<OAuthBinding, 'profileId' | 'serverId' | 'accountId'>): number {
    return this.document.records[recordKey(binding)]?.revokedGeneration ?? 0
  }

  async status(profileId: string): Promise<OAuthBindingStatus[]> {
    const statuses: OAuthBindingStatus[] = []
    for (const record of Object.values(this.document.records)) {
      if (record.profileId !== profileId) continue
      const info = await this.credentials.describe(credentialRef(record.tokenRef))
      statuses.push({ serverId: record.serverId, accountId: record.accountId, connected: info.configured, generation: record.revokedGeneration })
    }
    return statuses
  }

  async revokeAccount(binding: Pick<OAuthBinding, 'profileId' | 'serverId' | 'accountId'>): Promise<void> {
    const record = requireRecord(this.document, recordKey(binding))
    await this.revoke({
      profileId: record.profileId,
      serverId: record.serverId,
      accountId: record.accountId,
      issuer: record.issuer,
      redirectUrl: record.redirectUrl,
      browserBinding: record.browserBinding,
    })
  }

  refreshSingleFlight(binding: OAuthBinding, run: () => Promise<OAuthTokens>): Promise<OAuthTokens> {
    const key = recordKey(binding)
    const existing = this.refreshes.get(key)
    if (existing !== undefined) return existing
    const generation = this.generation(binding)
    const pending = run().then(async tokens => {
      await this.enqueue(async () => {
        const record = requireRecord(this.document, key)
        if (record.revokedGeneration !== generation) throw new Error('OAuth credentials were revoked during refresh')
        await this.saveJson(record.tokenRef, tokens)
      })
      return tokens
    }).finally(() => this.refreshes.delete(key))
    this.refreshes.set(key, pending)
    return pending
  }

  provider(input: OAuthBinding & {
    metadata: OAuthClientMetadata
    onRedirect: (url: URL) => void | Promise<void>
  }): OAuthClientProvider {
    const key = recordKey(input)
    const record = () => requireRecord(this.document, key)
    return {
      redirectUrl: input.redirectUrl,
      clientMetadata: input.metadata,
      state: async () => (await this.begin(input)).state,
      clientInformation: () => this.loadJson<OAuthClientInformationMixed>(record().clientRef),
      saveClientInformation: value => this.saveJson(record().clientRef, value),
      tokens: () => this.loadJson<OAuthTokens>(record().tokenRef),
      saveTokens: value => this.saveJson(record().tokenRef, value),
      redirectToAuthorization: input.onRedirect,
      saveCodeVerifier: verifier => this.credentials.set(credentialRef(record().verifierRef), verifier),
      codeVerifier: async () => {
        const resolved = await this.credentials.resolve(credentialRef(record().verifierRef))
        if (resolved === undefined) throw new Error('missing PKCE verifier')
        return resolved.value
      },
      invalidateCredentials: async scope => {
        const refs = record()
        const removals: Promise<void>[] = []
        if (scope === 'all' || scope === 'tokens') removals.push(this.credentials.unset(credentialRef(refs.tokenRef)))
        if (scope === 'all' || scope === 'client') removals.push(this.credentials.unset(credentialRef(refs.clientRef)))
        if (scope === 'all' || scope === 'verifier') removals.push(this.credentials.unset(credentialRef(refs.verifierRef)))
        await Promise.all(removals)
      },
    }
  }

  metadata(): Readonly<OAuthDocument> {
    return deepFreeze(structuredClone(this.document))
  }

  private change(change: (draft: OAuthDocument) => void): Promise<void> {
    return this.enqueue(() => withFileLock(this.path, async () => {
      const current = await readDocumentOr(this.path, this.document)
      const draft = structuredClone(current)
      change(draft)
      draft.revision++
      const valid = parseDocument(draft)
      await persist(this.path, valid)
      this.document = valid
    }))
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const pending = this.queue.then(operation)
    this.queue = pending.then(() => undefined, () => undefined)
    return pending
  }

  private async saveJson(ref: string, value: unknown): Promise<void> {
    await this.credentials.set(credentialRef(ref), JSON.stringify(value))
  }

  private async loadJson<T>(ref: string): Promise<T | undefined> {
    const resolved = await this.credentials.resolve(credentialRef(ref))
    if (resolved === undefined) return undefined
    return JSON.parse(resolved.value) as T
  }
}

function secretRefs(binding: Pick<OAuthBinding, 'profileId' | 'serverId' | 'accountId'>): {
  tokenRef: string; clientRef: string; verifierRef: string
} {
  const suffix = hash(`${binding.profileId}\0${binding.serverId}\0${binding.accountId}`).toUpperCase()
  return {
    tokenRef: `DSH_PROFILE_OAUTH_TOKEN_${suffix}`,
    clientRef: `DSH_PROFILE_OAUTH_CLIENT_${suffix}`,
    verifierRef: `DSH_PROFILE_OAUTH_PKCE_${suffix}`,
  }
}

function recordKey(binding: Pick<OAuthBinding, 'profileId' | 'serverId' | 'accountId'>): string {
  return `${binding.profileId}\0${binding.serverId}\0${binding.accountId}`
}

function validateBinding(binding: OAuthBinding): void {
  for (const [key, value] of Object.entries(binding)) {
    if (typeof value !== 'string' || value.length === 0) throw new TypeError(`OAuth ${key} must be a non-empty string`)
  }
  const issuer = new URL(binding.issuer)
  const redirect = new URL(binding.redirectUrl)
  if (issuer.protocol !== 'https:') throw new TypeError('OAuth issuer must use HTTPS')
  if (!['http:', 'https:'].includes(redirect.protocol)) throw new TypeError('OAuth redirect URL must use HTTP(S)')
}

function assertBinding(record: OAuthRecord, binding: OAuthBinding): void {
  for (const key of ['profileId', 'serverId', 'accountId', 'issuer', 'redirectUrl', 'browserBinding'] as const) {
    if (record[key] !== binding[key]) throw new Error(`OAuth callback ${key} binding mismatch`)
  }
}

function parseDocument(value: unknown): OAuthDocument {
  if (!isRecord(value) || value.schemaVersion !== 1 || !Number.isSafeInteger(value.revision)
    || Number(value.revision) < 0 || !isRecord(value.records)) throw new TypeError('invalid OAuth vault')
  const records: Record<string, OAuthRecord> = {}
  for (const [key, candidate] of Object.entries(value.records)) {
    if (!isRecord(candidate)) throw new TypeError(`invalid OAuth record '${key}'`)
    const record = candidate as unknown as OAuthRecord
    for (const field of ['profileId', 'serverId', 'accountId', 'issuer', 'redirectUrl', 'browserBinding', 'tokenRef', 'clientRef', 'verifierRef'] as const) {
      if (typeof record[field] !== 'string' || record[field].length === 0) throw new TypeError(`invalid OAuth record '${key}' field '${field}'`)
    }
    if (key !== recordKey(record) || !Number.isSafeInteger(record.revokedGeneration) || record.revokedGeneration < 0
      || (record.stateHash !== undefined && !/^[a-f0-9]{64}$/.test(record.stateHash))
      || (record.expiresAt !== undefined && (!Number.isSafeInteger(record.expiresAt) || record.expiresAt < 0))
      || (record.callbackClaimed !== undefined && typeof record.callbackClaimed !== 'boolean')) {
      throw new TypeError(`invalid OAuth record '${key}'`)
    }
    credentialRef(record.tokenRef); credentialRef(record.clientRef); credentialRef(record.verifierRef)
    records[key] = structuredClone(record)
  }
  return { schemaVersion: 1, revision: value.revision as number, records }
}

function requireRecord(document: OAuthDocument, key: string): OAuthRecord {
  const record = document.records[key]
  if (record === undefined) throw new Error('OAuth account not found')
  return record
}

async function readDocumentOr(path: string, fallback: OAuthDocument): Promise<OAuthDocument> {
  try { return parseDocument(JSON.parse(await readFile(path, 'utf8'))) }
  catch (error) { if (isNotFound(error)) return fallback; throw error }
}

async function persist(path: string, document: OAuthDocument): Promise<void> {
  await writeFileAtomic(path, `${JSON.stringify(document, null, 2)}\n`, { mode: 0o600, dirMode: 0o700 })
}

function hash(value: string): string { return createHash('sha256').update(value).digest('hex') }
function equal(left: string, right: string): boolean {
  const a = Buffer.from(left); const b = Buffer.from(right)
  return a.length === b.length && timingSafeEqual(a, b)
}
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) }
function isNotFound(error: unknown): boolean { return error instanceof Error && 'code' in error && error.code === 'ENOENT' }
function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value
  Object.freeze(value)
  for (const item of Object.values(value)) deepFreeze(item)
  return value
}
