/** Native profile editor with URL-only MCP setup and automatic OAuth discovery. */
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Button, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ProfileStore, ProfileView } from './store.ts'
import type { ApiCapability } from './api.ts'
import styles from './ProfilesSettings.module.css'

// ── Main section ────────────────────────────────────────────────────────
export interface ProfilesSettingsProps {
  store: ProfileStore
  close: () => void
}

export function ProfilesSettings({ store, close }: ProfilesSettingsProps): React.ReactNode {
  const snap = useSyncStore(store)
  const { profiles, editingId } = snap

  if (editingId !== null) {
    const profile = profiles.find(p => p.id === editingId)
    if (profile) {
      return <ProfileEditor profile={profile} store={store} />
    }
  }

  return (
    <section aria-label="Company Profiles" className={styles.section}>
      <div className={styles.header}>
        <h2 className={styles.heading}>Company Profiles</h2>
        <Button
          variant="primary"
          onClick={() => {
            void store.create({ displayName: 'New Profile' })
          }}
        >
          + New Profile
        </Button>
      </div>
      <ul className={styles.list} role="list">
        {profiles.map(p => (
          <ProfileRow key={p.id} profile={p} store={store} isDefault={p.id === snap.defaultProfileId} />
        ))}
      </ul>
      {snap.error && (
        <div role="alert" className={styles.alert}>
          Error: {snap.error}
        </div>
      )}
    </section>
  )
}

// ── Profile list row ────────────────────────────────────────────────────
function ProfileRow({ profile, store, isDefault }: { profile: ProfileView; store: ProfileStore; isDefault: boolean }): React.ReactNode {
  return (
    <li className={`${styles.row}${profile.archived ? ` ${styles.rowArchived}` : ''}`}>
      <img
        src={profile.avatarUri}
        alt=""
        width={32}
        height={32}
        className={styles.avatar}
        style={{ '--profile-ring-color': profile.color } as React.CSSProperties}
      />
      <div className={styles.rowBody}>
        <div className={styles.rowNameLine}>
          <span className={styles.rowName}>
            {profile.name}
          </span>
          {isDefault && <span className={styles.badge}>default</span>}
          {profile.archived && <span className={styles.badge}>archived</span>}
          {profile.attention > 0 && (
            <span className={styles.badgeAttention}>
              {profile.attention} ⚠
            </span>
          )}
        </div>
        {profile.parentId && (
          <div className={styles.rowSub}>
            inherits from {profile.parentId}
          </div>
        )}
      </div>
      <div className={styles.rowActions}>
        <Button size="sm" onClick={() => store.setEditing(profile.id)} aria-label={`Edit ${profile.name}`}>
          Edit
        </Button>
        <Button size="sm" onClick={() => { void store.clone(profile.id) }} aria-label={`Clone ${profile.name}`}>
          Clone
        </Button>
        {!isDefault && (
          <Button
            size="sm"
            onClick={() => { void store.archive(profile.id, !profile.archived) }}
            aria-label={profile.archived ? `Unarchive ${profile.name}` : `Archive ${profile.name}`}
          >
            {profile.archived ? 'Unarchive' : 'Archive'}
          </Button>
        )}
        {!isDefault && !profile.archived && (
          <Button
            size="sm"
            className={styles.danger}
            onClick={() => {
              if (confirm(`Delete profile "${profile.name}"? This cannot be undone.`)) {
                void store.remove(profile.id)
              }
            }}
            aria-label={`Delete ${profile.name}`}
          >
            Delete
          </Button>
        )}
      </div>
    </li>
  )
}

// ── Profile editor ───────────────────────────────────────────────────────
function ProfileEditor({ profile, store }: { profile: ProfileView; store: ProfileStore }): React.ReactNode {
  const [fields, setFields] = useState({
    displayName: profile.profile.fields.displayName ?? '',
    legalName: profile.profile.fields.legalName ?? '',
    description: profile.profile.fields.description ?? '',
    website: profile.profile.fields.website ?? '',
    color: profile.color,
    avatarSeed: profile.avatarSeed,
  })
  const [capabilities, setCapabilities] = useState<ApiCapability[]>([...profile.profile.localOverrides])
  const [statuses, setStatuses] = useState<Record<string, import('./api.ts').McpServerStatus>>({})
  const [draft, setDraft] = useState<{ originalKey?: string; name: string; url: string } | null>(null)
  const [saving, setSaving] = useState(false)
  const [validationError, setValidationError] = useState<string | null>(null)

  const refreshStatuses = useCallback(() => {
    void store.mcpStatus(profile.id).then(result => {
      setStatuses(Object.fromEntries(result.servers.map(server => [server.serverId, server])))
    }).catch(() => {})
  }, [profile.id, store])

  useEffect(() => {
    refreshStatuses()
    const timer = window.setInterval(refreshStatuses, 2_000)
    return () => window.clearInterval(timer)
  }, [refreshStatuses])

  const handleSave = useCallback(async () => {
    if (!fields.displayName.trim()) return setValidationError('Display name is required')
    if (fields.website && !/^https?:\/\/.+/.test(fields.website)) return setValidationError('Website must start with http:// or https://')
    setSaving(true)
    try {
      await store.save(profile.id, fields, capabilities)
      store.setEditing(null)
    } catch (error) {
      setValidationError(error instanceof Error ? error.message : String(error))
    } finally {
      setSaving(false)
    }
  }, [fields, capabilities, profile.id, store])

  const saveServer = useCallback(async () => {
    if (draft === null) return
    const name = draft.name.trim()
    if (!name) return setValidationError('Server name is required')
    let url: URL
    try { url = new URL(draft.url) } catch { return setValidationError('Server URL must start with http:// or https://') }
    if (!['http:', 'https:'].includes(url.protocol)) return setValidationError('Server URL must start with http:// or https://')
    if (capabilities.some(capability => capability.kind === 'mcp' && capability.key === name && capability.key !== draft.originalKey)) return setValidationError(`MCP server "${name}" already exists`)
    const next = capabilities.filter(capability => capability.kind !== 'mcp' || capability.key !== draft.originalKey)
    next.push({ kind: 'mcp', key: name, state: 'enabled', config: { transport: 'streamable-http', serverName: name, url: url.toString() } })
    setSaving(true)
    try {
      await store.save(profile.id, undefined, next)
      setCapabilities(next)
      setDraft(null)
      setValidationError(null)
      window.setTimeout(refreshStatuses, 250)
    } catch (error) {
      setValidationError(error instanceof Error ? error.message : String(error))
    } finally {
      setSaving(false)
    }
  }, [capabilities, draft, profile.id, refreshStatuses, store])

  const removeServer = useCallback(async (capability: ApiCapability) => {
    const withoutLocal = capabilities.filter(item => item.kind !== 'mcp' || item.key !== capability.key)
    const next = profile.parentId === null
      ? withoutLocal
      : [...withoutLocal, { kind: 'mcp' as const, key: capability.key, state: 'disabled' as const }]
    setSaving(true)
    try {
      await store.save(profile.id, undefined, next)
      setCapabilities(next)
      setValidationError(null)
    } catch (error) {
      setValidationError(error instanceof Error ? error.message : String(error))
    } finally {
      setSaving(false)
    }
  }, [capabilities, profile.id, profile.parentId, store])

  const effectiveMcp = profile.profile.capabilities.filter(capability => capability.kind === 'mcp' && capability.state === 'enabled')

  return (
    <section aria-label={`Edit ${profile.name}`} className={styles.section}>
      <div className={styles.header}>
        <h2 className={styles.heading}>Edit: {profile.name}</h2>
        <Button variant="outline" onClick={() => store.setEditing(null)}>← Back</Button>
      </div>
      {validationError && <div role="alert" className={styles.alert}>{validationError}</div>}

      <fieldset className={styles.fieldset}>
        <legend className={styles.legend}>Profile Fields</legend>
        <div className={styles.fieldGrid}>
          <label className={styles.label}>Display Name *<Input value={fields.displayName} onChange={event => setFields(value => ({ ...value, displayName: event.target.value }))} required /></label>
          <label className={styles.label}>Legal Name<Input value={fields.legalName} onChange={event => setFields(value => ({ ...value, legalName: event.target.value }))} /></label>
          <label className={`${styles.label} ${styles.fieldFull}`}>Description<textarea className={styles.textarea} value={fields.description} onChange={event => setFields(value => ({ ...value, description: event.target.value }))} /></label>
          <label className={styles.label}>Website<Input type="url" value={fields.website} onChange={event => setFields(value => ({ ...value, website: event.target.value }))} placeholder="https://" /></label>
          <label className={styles.label}>Color<span className={styles.colorRow}><input type="color" value={fields.color} onChange={event => setFields(value => ({ ...value, color: event.target.value }))} className={styles.colorSwatch} /><Input className={styles.colorField!} value={fields.color} onChange={event => setFields(value => ({ ...value, color: event.target.value }))} pattern="#[0-9a-fA-F]{6}" /></span></label>
        </div>
      </fieldset>

      <fieldset className={styles.fieldset}>
        <legend className={styles.legend}>MCP Servers</legend>
        <p className={styles.sectionHint}>Add a server URL. Authentication is detected automatically.</p>
        {effectiveMcp.length === 0 && draft === null && <div className={styles.emptyNote}>No MCP servers configured.</div>}
        <ul className={styles.mcpList}>
          {effectiveMcp.map(capability => {
            const config = capability.config as { url?: string; serverName?: string } | undefined
            const serverId = config?.serverName ?? capability.key
            const status = statuses[serverId]
            return <li key={capability.key} className={styles.mcpRow}>
              <div className={styles.mcpBody}>
                <div className={styles.mcpTitle}><strong>{capability.key}</strong><McpStatus status={status?.status} /></div>
                <div className={styles.mcpUrl}>{config?.url ?? 'Local stdio server'}</div>
              </div>
              <div className={styles.rowActions}>
                {status?.status === 'oauth-required' && <Button variant="primary" size="sm" onClick={() => { void store.connectOAuth(profile.id, serverId) }} aria-label={`Connect ${capability.key}; opens authorization page`}>Connect</Button>}
                {config?.url && <Button size="sm" onClick={() => setDraft({ originalKey: capability.key, name: capability.key, url: config.url! })}>Edit</Button>}
                <Button size="sm" className={styles.danger} onClick={() => { void removeServer(capability) }}>Remove</Button>
              </div>
            </li>
          })}
          {draft !== null && <li className={styles.mcpForm}>
            <label className={styles.label}>Server name<Input autoFocus value={draft.name} onChange={event => setDraft(value => value && ({ ...value, name: event.target.value }))} placeholder="e.g. Jira" /></label>
            <label className={styles.label}>Server URL<Input type="url" value={draft.url} onChange={event => setDraft(value => value && ({ ...value, url: event.target.value }))} placeholder="https://mcp.example.com" /></label>
            <div className={styles.formActions}><Button variant="outline" onClick={() => setDraft(null)}>Cancel</Button><Button variant="primary" disabled={saving} onClick={() => { void saveServer() }}>{saving ? 'Saving…' : 'Save server'}</Button></div>
          </li>}
        </ul>
        {draft === null && <Button variant="outline" onClick={() => setDraft({ name: '', url: '' })}>+ Add MCP Server</Button>}
      </fieldset>

      <div className={styles.actions}>
        <Button variant="outline" onClick={() => store.setEditing(null)}>Cancel</Button>
        <Button variant="primary" onClick={() => { void handleSave() }} disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</Button>
      </div>
    </section>
  )
}

function McpStatus({ status }: { status: import('./api.ts').McpServerStatus['status'] | undefined }): React.ReactNode {
  const label = status === 'connected' ? 'Connected' : status === 'oauth-required' ? 'Authorization required' : status === 'error' ? 'Connection failed' : 'Connecting…'
  return <span className={status === 'connected' ? styles.badgeSuccess : status === 'error' ? styles.badgeAttention : styles.badge}>{label}</span>
}

// ── Sync external store hook ────────────────────────────────────────────
function useSyncStore(store: ProfileStore) {
  const snapRef = useRef(store.getSnapshot())
  const [, forceRender] = useState(0)
  React.useEffect(() => {
    const unsub = store.subscribe(() => {
      snapRef.current = store.getSnapshot()
      forceRender(n => n + 1)
    })
    // Sync in case store changed between render and effect
    snapRef.current = store.getSnapshot()
    forceRender(n => n + 1)
    return unsub
  }, [store])
  return snapRef.current
}
