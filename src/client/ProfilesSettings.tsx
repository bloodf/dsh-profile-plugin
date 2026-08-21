/** Settings section: profile CRUD, editor, capability matrix, OAuth connections, validation. */
import React, { useCallback, useRef, useState } from 'react'
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
        <button
          type="button"
          className={styles.btnPrimary}
          onClick={() => {
            void store.create({ displayName: 'New Profile' })
          }}
        >
          + New Profile
        </button>
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
        <button type="button" className={styles.btn} onClick={() => store.setEditing(profile.id)} aria-label={`Edit ${profile.name}`}>
          Edit
        </button>
        <button type="button" className={styles.btn} onClick={() => { void store.clone(profile.id) }} aria-label={`Clone ${profile.name}`}>
          Clone
        </button>
        {!isDefault && (
          <button
            type="button"
            className={styles.btn}
            onClick={() => { void store.archive(profile.id, !profile.archived) }}
            aria-label={profile.archived ? `Unarchive ${profile.name}` : `Archive ${profile.name}`}
          >
            {profile.archived ? 'Unarchive' : 'Archive'}
          </button>
        )}
        {!isDefault && !profile.archived && (
          <button
            type="button"
            className={styles.btnDanger}
            onClick={() => {
              if (confirm(`Delete profile "${profile.name}"? This cannot be undone.`)) {
                void store.remove(profile.id)
              }
            }}
            aria-label={`Delete ${profile.name}`}
          >
            Delete
          </button>
        )}
      </div>
    </li>
  )
}

// ── Profile editor with capability matrix ────────────────────────────────
function ProfileEditor({ profile, store }: { profile: ProfileView; store: ProfileStore }): React.ReactNode {
  const [fields, setFields] = useState({
    displayName: profile.profile.fields.displayName ?? '',
    legalName: profile.profile.fields.legalName ?? '',
    description: profile.profile.fields.description ?? '',
    website: profile.profile.fields.website ?? '',
    color: profile.color,
    avatarSeed: profile.avatarSeed,
  })
  const [capabilities, setCapabilities] = useState<ApiCapability[]>(
    profile.profile.localOverrides?.length ? [...profile.profile.localOverrides] : [...profile.profile.capabilities],
  )
  const [saving, setSaving] = useState(false)
  const [validationError, setValidationError] = useState<string | null>(null)

  const validate = useCallback((): boolean => {
    if (!fields.displayName.trim()) {
      setValidationError('Display name is required')
      return false
    }
    if (fields.website && !/^https?:\/\/.+/.test(fields.website)) {
      setValidationError('Website must start with http:// or https://')
      return false
    }
    // Validate MCP capabilities
    for (const cap of capabilities) {
      if (cap.kind === 'mcp' && cap.state === 'enabled') {
        const config = cap.config as Record<string, unknown> | undefined
        if (!config?.transport) {
          setValidationError(`MCP capability "${cap.key}" requires a transport type`)
          return false
        }
        if (config.transport === 'stdio' && !config.command) {
          setValidationError(`MCP capability "${cap.key}" (stdio) requires a command`)
          return false
        }
        if (config.transport === 'streamable-http' && !config.url) {
          setValidationError(`MCP capability "${cap.key}" (streamable-http) requires a URL`)
          return false
        }
      }
    }
    setValidationError(null)
    return true
  }, [fields, capabilities])

  const handleSave = useCallback(async () => {
    if (!validate()) return
    setSaving(true)
    try {
      await store.save(profile.id, fields, capabilities)
      store.setEditing(null)
    } catch (err) {
      setValidationError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }, [fields, capabilities, profile.id, store, validate])

  const toggleCapability = useCallback((index: number) => {
    setCapabilities(prev => {
      const next = [...prev]
      const cap = next[index]!
      next[index] = { ...cap, state: cap.state === 'enabled' ? 'disabled' : 'enabled' }
      return next
    })
  }, [])

  const addCapability = useCallback(() => {
    setCapabilities(prev => [
      ...prev,
      { kind: 'mcp', key: `mcp-${Date.now()}`, state: 'enabled', config: { transport: 'stdio', serverName: '', command: '' } },
    ])
  }, [])

  const removeCapability = useCallback((index: number) => {
    setCapabilities(prev => prev.filter((_, i) => i !== index))
  }, [])

  return (
    <section aria-label={`Edit ${profile.name}`} className={styles.section}>
      <div className={styles.header}>
        <h2 className={styles.heading}>Edit: {profile.name}</h2>
        <button type="button" className={styles.btn} onClick={() => store.setEditing(null)}>← Back</button>
      </div>

      {validationError && (
        <div role="alert" className={styles.alert}>
          {validationError}
        </div>
      )}

      {/* Fields */}
      <fieldset className={styles.fieldset}>
        <legend className={styles.legend}>Profile Fields</legend>
        <div className={styles.fieldGrid}>
          <div>
            <label className={styles.label}>Display Name *
              <input className={styles.field} value={fields.displayName} onChange={e => setFields(f => ({ ...f, displayName: e.target.value }))} required />
            </label>
          </div>
          <div>
            <label className={styles.label}>Legal Name
              <input className={styles.field} value={fields.legalName} onChange={e => setFields(f => ({ ...f, legalName: e.target.value }))} />
            </label>
          </div>
          <div className={styles.fieldFull}>
            <label className={styles.label}>Description
              <textarea className={styles.textarea} value={fields.description} onChange={e => setFields(f => ({ ...f, description: e.target.value }))} />
            </label>
          </div>
          <div>
            <label className={styles.label}>Website
              <input className={styles.field} type="url" value={fields.website} onChange={e => setFields(f => ({ ...f, website: e.target.value }))} placeholder="https://" />
            </label>
          </div>
          <div>
            <label className={styles.label}>Color
              <div className={styles.colorRow}>
                <input type="color" value={fields.color} onChange={e => setFields(f => ({ ...f, color: e.target.value }))} className={styles.colorSwatch} />
                <input className={styles.colorField} value={fields.color} onChange={e => setFields(f => ({ ...f, color: e.target.value }))} pattern="#[0-9a-fA-F]{6}" />
              </div>
            </label>
          </div>
        </div>
      </fieldset>

      {/* Capability matrix */}
      <fieldset className={styles.fieldset}>
        <legend className={styles.legend}>Capability Matrix</legend>
        {capabilities.length === 0 && (
          <div className={styles.emptyNote}>
            No capabilities configured. Inherits all from parent profile.
          </div>
        )}
        <table className={styles.table} role="grid" aria-label="Capabilities">
          <thead>
            <tr className={styles.tableHeadRow}>
              <th className={styles.th}>Type</th>
              <th className={styles.th}>Key</th>
              <th className={styles.thCenter}>State</th>
              <th className={styles.thRight}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {capabilities.map((cap, i) => (
              <CapabilityRow key={i} cap={cap} index={i} onToggle={toggleCapability} onRemove={removeCapability} />
            ))}
          </tbody>
        </table>
        <button type="button" className={`${styles.btn} ${styles.mt8}`} onClick={addCapability}>
          + Add Capability
        </button>
      </fieldset>

      {/* OAuth connections (read-only display) */}
      <fieldset className={styles.fieldset}>
        <legend className={styles.legend}>OAuth Connections</legend>
        {capabilities.filter(c => c.kind === 'mcp' && c.state === 'enabled' && (c.config as Record<string, unknown>)?.oauth).length === 0
          ? <div className={styles.emptyNote}>No OAuth-enabled MCP servers.</div>
          : capabilities
            .filter(c => c.kind === 'mcp' && c.state === 'enabled' && (c.config as Record<string, unknown>)?.oauth)
            .map((c, i) => (
              <div key={i} className={styles.oauthRow}>
                <span className={styles.badgeSuccess}>OAuth</span>
                <span>{c.key}</span>
                <span className={styles.oauthServer}>
                  ({((c.config as Record<string, unknown>)?.serverName as string) ?? 'unknown server'})
                </span>
              </div>
            ))
        }
      </fieldset>

      {/* Actions */}
      <div className={styles.actions}>
        <button type="button" className={styles.btn} onClick={() => store.setEditing(null)}>Cancel</button>
        <button
          type="button"
          className={styles.btnPrimary}
          onClick={() => { void handleSave() }}
          disabled={saving}
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </section>
  )
}

// ── Capability row ──────────────────────────────────────────────────────
function CapabilityRow({ cap, index, onToggle, onRemove }: {
  cap: ApiCapability; index: number
  onToggle: (i: number) => void; onRemove: (i: number) => void
}): React.ReactNode {
  const stateClass = cap.source === 'inherited' ? styles.stateInherited : cap.state === 'enabled' ? styles.stateEnabled : styles.stateDisabled
  return (
    <tr className={styles.tableRow}>
      <td className={styles.td}>
        <span className={styles.badge}>{cap.kind}</span>
      </td>
      <td className={styles.tdMono}>{cap.key}</td>
      <td className={styles.tdCenter}>
        <button
          type="button"
          className={stateClass}
          onClick={() => onToggle(index)}
          aria-label={`Toggle ${cap.key} ${cap.state === 'enabled' ? 'off' : 'on'}`}
        >
          {cap.source === 'inherited' ? 'Inherited' : cap.state === 'enabled' ? 'Enabled locally' : 'Disabled locally'}
        </button>
      </td>
      <td className={styles.tdRight}>
        <button type="button" className={styles.btnDangerSmall} onClick={() => onRemove(index)} aria-label={`Remove ${cap.key}`}>
          ✕
        </button>
      </td>
    </tr>
  )
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
