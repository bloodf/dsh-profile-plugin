/*
 * Durable profile registry with cross-process CAS writes and contained observers.
 * @module @dsh-local/company-profiles/registry
 */
import { randomUUID } from 'node:crypto'
import { mkdir, readFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import type {
  CapabilityOverride,
  CompanyProfile,
  ProfileDocument,
  ProfileFields,
  ResolvedCompanyProfile,
} from './model.js'
import { createDefaultDocument, resolveProfile, validateDocument } from './model.js'

export class RevisionConflictError extends Error {
  constructor(readonly expected: number, readonly actual: number) {
    super(`company profiles revision conflict: expected ${expected}, actual ${actual}`)
    this.name = 'RevisionConflictError'
  }
}

export interface RegistryOptions {
  path: string
  now?: () => string
  id?: () => string
  /** Must return true while profile owns active sessions. */
  hasActiveSessions?: (profileId: string) => boolean | Promise<boolean>
  /** Observer diagnostics; observer failure never rolls back committed state. */
  onListenerError?: (error: unknown) => void
}

export interface CreateProfileInput {
  id?: string
  parentId?: string | null
  fields?: ProfileFields
  capabilities?: CapabilityOverride[]
}

export interface UpdateProfileInput {
  parentId?: string | null
  fields?: ProfileFields
  capabilities?: CapabilityOverride[]
}

export type ProfileSubscription = (document: Readonly<ProfileDocument>) => void | Promise<void>

export class CompanyProfileRegistry {
  private document!: ProfileDocument
  private readonly listeners = new Set<ProfileSubscription>()
  private queue: Promise<void> = Promise.resolve()

  private constructor(
    private readonly options: Required<Pick<RegistryOptions, 'path' | 'now' | 'id'>> & {
      hasActiveSessions: RegistryOptions['hasActiveSessions']
      onListenerError: RegistryOptions['onListenerError']
    },
  ) {}

  static async open(options: RegistryOptions): Promise<CompanyProfileRegistry> {
    const registry = new CompanyProfileRegistry({
      path: options.path,
      now: options.now ?? (() => new Date().toISOString()),
      id: options.id ?? randomUUID,
      hasActiveSessions: options.hasActiveSessions,
      onListenerError: options.onListenerError,
    })
    await mkdir(dirname(options.path), { recursive: true, mode: 0o700 })
    await withFileLock(options.path, async () => {
      try {
        registry.document = await readDocument(options.path)
      } catch (error) {
        if (!isNotFound(error)) throw error
        registry.document = createDefaultDocument(registry.options.now())
        await persist(options.path, registry.document)
      }
    })
    return registry
  }

  snapshot(): Readonly<ProfileDocument> {
    return deepFreeze(structuredClone(this.document))
  }

  resolve(id: string): ResolvedCompanyProfile {
    return resolveProfile(this.document, id)
  }

  subscribe(listener: ProfileSubscription): () => void {
    this.listeners.add(listener)
    this.notifyOne(listener, this.snapshot())
    return () => this.listeners.delete(listener)
  }

  create(expectedRevision: number, input: CreateProfileInput): Promise<Readonly<ProfileDocument>> {
    return this.mutate(expectedRevision, draft => {
      const id = input.id ?? this.options.id()
      assertId(id)
      if (draft.profiles.some(profile => profile.id === id)) throw new RangeError(`profile '${id}' already exists`)
      const parentId = input.parentId === undefined ? draft.defaultProfileId : input.parentId
      assertParent(draft, id, parentId)
      const now = this.options.now()
      draft.profiles.push({
        id,
        parentId,
        archived: false,
        createdAt: now,
        updatedAt: now,
        fields: structuredClone(input.fields ?? {}),
        capabilities: structuredClone(input.capabilities ?? []),
      })
      draft.order.push(id)
    })
  }

  update(expectedRevision: number, id: string, input: UpdateProfileInput): Promise<Readonly<ProfileDocument>> {
    return this.mutate(expectedRevision, draft => {
      const profile = requireProfile(draft, id)
      if (input.parentId !== undefined) {
        if (id === draft.defaultProfileId && input.parentId !== null) throw new TypeError('default profile cannot inherit')
        assertParent(draft, id, input.parentId)
        profile.parentId = input.parentId
      }
      if (input.fields !== undefined) profile.fields = structuredClone(input.fields)
      if (input.capabilities !== undefined) profile.capabilities = structuredClone(input.capabilities)
      profile.updatedAt = this.options.now()
    })
  }

  async archive(expectedRevision: number, id: string, archived = true): Promise<Readonly<ProfileDocument>> {
    if (archived && await this.hasActiveSessions(id)) {
      throw new Error(`profile '${id}' has active sessions and cannot be archived`)
    }
    return this.mutate(expectedRevision, draft => {
      if (id === draft.defaultProfileId && archived) throw new TypeError('default profile cannot be archived')
      const profile = requireProfile(draft, id)
      profile.archived = archived
      profile.updatedAt = this.options.now()
    })
  }

  async delete(expectedRevision: number, id: string): Promise<Readonly<ProfileDocument>> {
    if (await this.hasActiveSessions(id)) throw new Error(`profile '${id}' has active sessions and cannot be deleted`)
    return this.mutate(expectedRevision, draft => {
      if (id === draft.defaultProfileId) throw new TypeError('default profile cannot be deleted')
      requireProfile(draft, id)
      draft.profiles = draft.profiles.filter(profile => profile.id !== id)
      draft.order = draft.order.filter(profileId => profileId !== id)
    })
  }

  reorder(expectedRevision: number, order: readonly string[]): Promise<Readonly<ProfileDocument>> {
    return this.mutate(expectedRevision, draft => { draft.order = [...order] })
  }

  clone(expectedRevision: number, sourceId: string, id = this.options.id()): Promise<Readonly<ProfileDocument>> {
    return this.mutate(expectedRevision, draft => {
      assertId(id)
      const source = requireProfile(draft, sourceId)
      if (draft.profiles.some(profile => profile.id === id)) throw new RangeError(`profile '${id}' already exists`)
      const now = this.options.now()
      draft.profiles.push({ ...structuredClone(source), id, archived: false, createdAt: now, updatedAt: now })
      draft.order.splice(draft.order.indexOf(sourceId) + 1, 0, id)
    })
  }

  private mutate(expectedRevision: number, change: (draft: ProfileDocument) => void): Promise<Readonly<ProfileDocument>> {
    const operation = this.queue.then(async () => {
      await withFileLock(this.options.path, async () => {
        const current = await readDocument(this.options.path)
        if (current.revision !== expectedRevision) throw new RevisionConflictError(expectedRevision, current.revision)
        const draft = structuredClone(current)
        change(draft)
        draft.revision++
        const valid = validateDocument(draft)
        await persist(this.options.path, valid)
        // Publish only after durable commit. Failed writes leave memory unchanged.
        this.document = valid
      })
      const snapshot = this.snapshot()
      for (const listener of this.listeners) this.notifyOne(listener, snapshot)
    })
    this.queue = operation.catch(() => {})
    return operation.then(() => this.snapshot())
  }

  private async hasActiveSessions(id: string): Promise<boolean> {
    if (this.options.hasActiveSessions === undefined) return true
    return await this.options.hasActiveSessions(id)
  }

  private notifyOne(listener: ProfileSubscription, snapshot: Readonly<ProfileDocument>): void {
    try {
      const result = listener(snapshot)
      if (result !== undefined) void Promise.resolve(result).catch(error => this.options.onListenerError?.(error))
    } catch (error) {
      this.options.onListenerError?.(error)
    }
  }
}

async function readDocument(path: string): Promise<ProfileDocument> {
  return validateDocument(JSON.parse(await readFile(path, 'utf8')))
}

async function persist(path: string, document: ProfileDocument): Promise<void> {
  await writeFileAtomic(path, `${JSON.stringify(document, null, 2)}\n`, { mode: 0o600, dirMode: 0o700 })
}

function requireProfile(document: ProfileDocument, id: string): CompanyProfile {
  const profile = document.profiles.find(item => item.id === id)
  if (profile === undefined) throw new RangeError(`unknown profile '${id}'`)
  return profile
}

function assertParent(document: ProfileDocument, id: string, parentId: string | null): void {
  if (parentId === id) throw new TypeError('profile cannot inherit itself')
  if (id !== document.defaultProfileId && parentId !== document.defaultProfileId) {
    throw new TypeError('company profiles may inherit only from default profile')
  }
}

function assertId(id: string): void {
  if (!/^[a-z0-9][a-z0-9._-]{0,127}$/i.test(id)) throw new TypeError(`invalid profile id '${id}'`)
}

function isNotFound(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value
  Object.freeze(value)
  for (const item of Object.values(value)) deepFreeze(item)
  return value
}
