/** Native profile editor with URL-only MCP setup and automatic OAuth discovery. */
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Button, IconPlusOutline16, Input, Modal, StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ProfileStore, ProfileView } from './store.ts'
import type { ApiCapability, McpServerStatus } from './api.ts'
import styles from './ProfilesSettings.module.css'

// ── Main section ────────────────────────────────────────────────────────
export interface ProfilesSettingsProps {
  store: ProfileStore
  close: () => void
}

export function ProfilesSettings({ store, close }: ProfilesSettingsProps): React.ReactNode {
  const snap = useSyncStore(store)
  const { profiles, editingId } = snap
  const [deleteTarget, setDeleteTarget] = useState<ProfileView | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteFailure, setDeleteFailure] = useState<string | null>(null)

  const closeDelete = (): void => {
    if (deleting) return
    setDeleteTarget(null)
    setDeleteFailure(null)
  }

  const confirmDelete = async (): Promise<void> => {
    if (deleteTarget === null || deleting) return
    setDeleting(true)
    setDeleteFailure(null)
    try {
      await store.remove(deleteTarget.id)
      setDeleteTarget(null)
    } catch {
      setDeleteFailure('Could not delete profile. Try again.')
    } finally {
      setDeleting(false)
    }
  }

  if (editingId !== null) {
    const profile = profiles.find(p => p.id === editingId)
    if (profile) {
      return <ProfileEditor profile={profile} store={store} />
    }
  }

  return (
    <section aria-label="Company Profiles" className={styles.section}>
      <h2 className={styles.heading}>Company Profiles</h2>
      <p className={styles.intro}>Keep workspaces, credentials, and MCP servers isolated by profile.</p>
      <ul className={styles.list} role="list">
        {profiles.map(p => (
          <ProfileRow
            key={p.id}
            profile={p}
            store={store}
            isDefault={p.id === snap.defaultProfileId}
            onDelete={setDeleteTarget}
          />
        ))}
      </ul>
      <Button
        variant="outline"
        className={styles.addButton}
        icon={<IconPlusOutline16 size={14} />}
        onClick={() => {
          void store.create({ displayName: 'New Profile' })
        }}
      >
        New profile
      </Button>
      {snap.error && <p role="alert" className={styles.error}>Error: {snap.error}</p>}
      <Modal
        open={deleteTarget !== null}
        onClose={closeDelete}
        title={deleteTarget === null ? '' : `Delete ${deleteTarget.name}?`}
        description="This permanently deletes the profile and its local configuration."
        closeLabel="Close"
        className={styles.deleteDialog!}
        footer={(
          <>
            <Button variant="outline" autoFocus disabled={deleting} onClick={closeDelete}>Cancel</Button>
            <Button
              variant="outline"
              className={styles.deleteConfirm}
              disabled={deleting}
              onClick={() => { void confirmDelete() }}
            >
              {deleting ? 'Deleting…' : 'Delete'}
            </Button>
          </>
        )}
      >
        {deleteFailure === null ? null : <p role="alert" className={styles.error}>{deleteFailure}</p>}
      </Modal>
    </section>
  )
}

// ── Profile list row ────────────────────────────────────────────────────
function ProfileRow({
  profile,
  store,
  isDefault,
  onDelete,
}: {
  profile: ProfileView
  store: ProfileStore
  isDefault: boolean
  onDelete: (profile: ProfileView) => void
}): React.ReactNode {
  return (
    <li className={`${styles.row}${profile.archived ? ` ${styles.rowArchived}` : ''}`}>
      <div className={styles.rowHead}>
        <div className={styles.rowIdentity}>
          <img
            src={profile.avatarUri}
            alt=""
            width={28}
            height={28}
            className={styles.avatar}
            style={{ '--profile-ring-color': profile.color } as React.CSSProperties}
          />
          <div className={styles.rowBody}>
            <div className={styles.rowNameLine}>
              <span className={styles.rowName}>{profile.name}</span>
              {isDefault && <span className={styles.rowTag}>default</span>}
              {profile.archived && <span className={styles.rowTag}>archived</span>}
              {profile.attention > 0 && (
                <span className={styles.attention}>
                  <StateDot state="warning" />
                  {profile.attention} {profile.attention === 1 ? 'item needs' : 'items need'} attention
                </span>
              )}
            </div>
            {profile.parentId && <div className={styles.rowSub}>inherits from {profile.parentId}</div>}
          </div>
        </div>
        <div className={styles.rowActions}>
          <Button variant="outline" size="sm" onClick={() => store.setEditing(profile.id)} aria-label={`Edit ${profile.name}`}>
            Edit
          </Button>
          <Button variant="ghost" size="sm" onClick={() => { void store.clone(profile.id) }} aria-label={`Clone ${profile.name}`}>
            Clone
          </Button>
          {!isDefault && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => { void store.archive(profile.id, !profile.archived) }}
              aria-label={profile.archived ? `Unarchive ${profile.name}` : `Archive ${profile.name}`}
            >
              {profile.archived ? 'Unarchive' : 'Archive'}
            </Button>
          )}
          {!isDefault && !profile.archived && (
            <Button
              variant="ghost"
              size="sm"
              className={styles.danger}
              onClick={() => onDelete(profile)}
              aria-label={`Delete ${profile.name}`}
            >
              Delete
            </Button>
          )}
        </div>
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
  const [statuses, setStatuses] = useState<Record<string, McpServerStatus>>({})
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
      {validationError && <p role="alert" className={styles.error}>{validationError}</p>}

      <section className={styles.editorCard} aria-labelledby="profile-fields-heading">
        <h3 id="profile-fields-heading" className={styles.editorHeading}>Profile Fields</h3>
        <div className={styles.fieldGrid}>
          <label className={styles.label}>Display Name *<Input value={fields.displayName} onChange={event => setFields(value => ({ ...value, displayName: event.target.value }))} required /></label>
          <label className={styles.label}>Legal Name<Input value={fields.legalName} onChange={event => setFields(value => ({ ...value, legalName: event.target.value }))} /></label>
          <label className={`${styles.label} ${styles.fieldFull}`}>Description<textarea className={styles.textarea} value={fields.description} onChange={event => setFields(value => ({ ...value, description: event.target.value }))} /></label>
          <label className={styles.label}>Website<Input type="url" value={fields.website} onChange={event => setFields(value => ({ ...value, website: event.target.value }))} placeholder="https://" /></label>
          <label className={styles.label}>Color<span className={styles.colorRow}><span aria-hidden="true" className={styles.colorSwatch} style={{ backgroundColor: fields.color }} /><Input className={styles.colorField!} value={fields.color} onChange={event => setFields(value => ({ ...value, color: event.target.value }))} pattern="#[0-9a-fA-F]{6}" /></span></label>
        </div>
      </section>

      <section className={styles.editorCard} aria-labelledby="mcp-servers-heading">
        <h3 id="mcp-servers-heading" className={styles.editorHeading}>MCP Servers</h3>
        <p className={styles.sectionHint}>Add a server URL. Authentication is detected automatically.</p>
        {effectiveMcp.length === 0 && draft === null && <p className={styles.emptyNote}>No MCP servers configured.</p>}
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
                {config?.url && <Button variant="outline" size="sm" onClick={() => setDraft({ originalKey: capability.key, name: capability.key, url: config.url! })}>Edit</Button>}
                <Button variant="ghost" size="sm" className={styles.danger} onClick={() => { void removeServer(capability) }}>Remove</Button>
              </div>
            </li>
          })}
          {draft !== null && <li className={styles.mcpForm}>
            <div className={styles.mcpFormFields}>
              <label className={styles.label}>Server name<Input autoFocus value={draft.name} onChange={event => setDraft(value => value && ({ ...value, name: event.target.value }))} placeholder="e.g. Jira" /></label>
              <label className={styles.label}>Server URL<Input type="url" value={draft.url} onChange={event => setDraft(value => value && ({ ...value, url: event.target.value }))} placeholder="https://mcp.example.com" /></label>
            </div>
            <div className={styles.formActions}><Button variant="outline" onClick={() => setDraft(null)}>Cancel</Button><Button variant="primary" disabled={saving} onClick={() => { void saveServer() }}>{saving ? 'Saving…' : 'Save server'}</Button></div>
          </li>}
        </ul>
        {draft === null && (
          <Button
            variant="outline"
            className={styles.addButton}
            icon={<IconPlusOutline16 size={14} />}
            onClick={() => setDraft({ name: '', url: '' })}
          >
            Add MCP server
          </Button>
        )}
      </section>

      <div className={styles.actions}>
        <Button variant="outline" onClick={() => store.setEditing(null)}>Cancel</Button>
        <Button variant="primary" onClick={() => { void handleSave() }} disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</Button>
      </div>
    </section>
  )
}

function McpStatus({ status }: { status: McpServerStatus['status'] | undefined }): React.ReactNode {
  const state = status === 'connected' ? 'done' : status === 'oauth-required' ? 'warning' : status === 'error' ? 'error' : 'ongoing'
  const label = status === 'connected' ? 'Connected' : status === 'oauth-required' ? 'Authorization required' : status === 'error' ? 'Connection failed' : 'Connecting…'
  return <span className={styles.mcpStatus}><StateDot state={state} /><span>{label}</span></span>
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
