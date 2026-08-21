/** Reactive profile store: fetches from /company-profiles/api, provides snapshots. */
import type { ApiDocument, ApiProfile, AttentionEntry } from './api.ts'
import * as api from './api.ts'
import { avatarDataUri, defaultAvatarSeed, defaultColor } from './avatar.ts'

export interface ProfileView {
  id: string
  name: string
  color: string
  avatarSeed: string
  avatarUri: string
  archived: boolean
  parentId: string | null
  attention: number
  profile: ApiProfile
}

export interface ProfileStoreState {
  profiles: ProfileView[]
  selected: string
  revision: number
  csrfToken: string
  defaultProfileId: string
  order: string[]
  attention: AttentionEntry[]
  attentionCounts: Record<string, number>
  loading: boolean
  error: string | null
  /** Profile currently being edited in settings, null = list view */
  editingId: string | null
  /** Pending toast messages */
  toasts: ToastMessage[]
  soundEnabled: boolean
}

export interface ToastMessage {
  id: string
  profileId: string
  profileName: string
  profileColor: string
  message: string
  sessionId?: string
  timestamp: number
  sound?: boolean
  dedupeKey: string
}

export type ProfileStoreListener = () => void

function profileView(profile: ApiProfile, attentionCounts: Record<string, number>): ProfileView {
  const color = profile.fields.color ?? defaultColor(profile.id)
  const seed = profile.fields.avatarSeed ?? defaultAvatarSeed(profile.id)
  return {
    id: profile.id,
    name: profile.fields.displayName ?? profile.id,
    color,
    avatarSeed: seed,
    avatarUri: avatarDataUri(seed, color),
    archived: profile.archived,
    parentId: profile.parentId,
    attention: attentionCounts[profile.id] ?? 0,
    profile,
  }
}

function initialState(): ProfileStoreState {
  return {
    profiles: [],
    selected: '',
    revision: -1,
    csrfToken: '',
    defaultProfileId: '',
    order: [],
    attention: [],
    attentionCounts: {},
    loading: true,
    error: null,
    editingId: null,
    toasts: [],
    soundEnabled: false,
  }
}

export class ProfileStore {
  private state: ProfileStoreState = initialState()
  private listeners = new Set<ProfileStoreListener>()
  private pollTimer: ReturnType<typeof setInterval> | undefined
  private toastId = 0
  private readonly seenAttention = new Set<string>()

  constructor(
    private readonly openSessionCallback?: (profileId: string, sessionId: string) => void,
    private readonly selectProfileCallback?: (profileId: string) => void,
  ) {}

  getSnapshot(): ProfileStoreState {
    return this.state
  }

  subscribe(fn: ProfileStoreListener): () => void {
    this.listeners.add(fn)
    return () => { this.listeners.delete(fn) }
  }

  private emit(): void {
    for (const fn of this.listeners) fn()
  }

  private update(patch: Partial<ProfileStoreState>): void {
    this.state = { ...this.state, ...patch }
    this.emit()
  }

  private applyDocument(doc: ApiDocument): void {
    const profiles = doc.profiles.map(p => profileView(p, this.state.attentionCounts))
    const selected = this.state.selected && doc.order.includes(this.state.selected)
      ? this.state.selected
      : doc.defaultProfileId
    const selectedChanged = selected !== this.state.selected
    this.update({
      profiles,
      revision: doc.revision,
      csrfToken: doc.csrfToken,
      defaultProfileId: doc.defaultProfileId,
      order: doc.order,
      selected,
      loading: false,
      error: null,
    })
    if (selectedChanged) this.selectProfileCallback?.(selected)
  }

  private applyAttention(entries: AttentionEntry[], counts: Record<string, number>): void {
    for (const entry of entries) {
      const dedupeKey = `${entry.profileId}/${entry.sessionId}/${[...entry.reasons].sort().join(',')}`
      if (this.seenAttention.has(dedupeKey)) continue
      this.seenAttention.add(dedupeKey)
      const profile = this.state.profiles.find(candidate => candidate.id === entry.profileId)
      if (profile !== undefined) {
        this.addToast({
          profileId: entry.profileId,
          profileName: profile.name,
          profileColor: profile.color,
          message: 'Attention needed',
          sessionId: entry.sessionId,
          sound: this.state.soundEnabled,
          dedupeKey,
        })
      }
    }
    this.update({
      attention: entries,
      attentionCounts: counts,
      profiles: this.state.profiles.map(profile => ({
        ...profile,
        attention: counts[profile.id] ?? 0,
      })),
    })
  }

  private addToast(toast: Omit<ToastMessage, 'id' | 'timestamp'>): void {
    const id = `toast-${++this.toastId}`
    const msg: ToastMessage = { ...toast, id, timestamp: Date.now() }
    this.update({ toasts: [...this.state.toasts, msg] })
  }

  dismissToast(id: string): void {
    this.update({ toasts: this.state.toasts.filter(toast => toast.id !== id) })
  }

  enableSound(): void {
    this.update({ soundEnabled: true })
  }

  openSession(profileId: string, sessionId: string): void {
    this.selectProfile(profileId)
    this.openSessionCallback?.(profileId, sessionId)
  }

  selectProfile(id: string): void {
    this.update({ selected: id })
    this.selectProfileCallback?.(id)
  }

  setEditing(id: string | null): void {
    this.update({ editingId: id })
  }

  async refresh(): Promise<void> {
    try {
      const [doc, att] = await Promise.all([api.fetchProfiles(), api.fetchAttention()])
      this.applyDocument(doc)
      this.applyAttention(att.entries, att.counts)
    } catch (err) {
      this.update({ loading: false, error: err instanceof Error ? err.message : String(err) })
    }
  }

  async create(fields: Record<string, unknown>, capabilities?: ApiCapability[]): Promise<void> {
    const doc = await api.createProfile(this.state.revision, fields, this.state.csrfToken, capabilities)
    this.applyDocument(doc)
  }

  async save(profileId: string, fields: Record<string, unknown>, capabilities?: ApiCapability[]): Promise<void> {
    const doc = await api.updateProfile(this.state.revision, profileId, fields, this.state.csrfToken, capabilities)
    this.applyDocument(doc)
  }

  async archive(profileId: string, archived: boolean): Promise<void> {
    const doc = await api.archiveProfile(this.state.revision, profileId, archived, this.state.csrfToken)
    this.applyDocument(doc)
  }

  async remove(profileId: string): Promise<void> {
    const doc = await api.deleteProfile(this.state.revision, profileId, this.state.csrfToken)
    this.applyDocument(doc)
  }

  async clone(profileId: string): Promise<void> {
    const doc = await api.cloneProfile(this.state.revision, profileId, this.state.csrfToken)
    this.applyDocument(doc)
  }

  async clearAttention(sessionId: string): Promise<void> {
    const att = await api.clearAttention(sessionId, this.state.csrfToken)
    this.applyAttention(att.entries, att.counts)
  }

  oauthStatus(profileId: string): Promise<api.OAuthStatusResponse> {
    return api.fetchOAuthStatus(profileId)
  }

  async connectOAuth(profileId: string, serverId: string, accountId = 'default'): Promise<void> {
    const result = await api.oauthBegin(this.state.revision, profileId, serverId, accountId, this.state.csrfToken)
    window.location.assign(result.authorizationUrl)
  }

  async disconnectOAuth(profileId: string, serverId: string, accountId = 'default'): Promise<void> {
    await api.oauthRevoke(this.state.revision, profileId, serverId, accountId, this.state.csrfToken)
  }

  startPolling(intervalMs = 15_000): void {
    this.stopPolling()
    void this.refresh()
    this.pollTimer = setInterval(() => { void this.refreshAttention() }, intervalMs)
  }

  stopPolling(): void {
    if (this.pollTimer !== undefined) {
      clearInterval(this.pollTimer)
      this.pollTimer = undefined
    }
  }

  private async refreshAttention(): Promise<void> {
    try {
      const att = await api.fetchAttention()
      this.applyAttention(att.entries, att.counts)
    } catch {
      // swallow poll errors silently
    }
  }

  dispose(): void {
    this.stopPolling()
    this.listeners.clear()
  }
}

type ApiCapability = api.ApiCapability
