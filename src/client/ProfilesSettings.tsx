/** Settings section: profile CRUD, editor, capability matrix, OAuth connections, validation. */
import React, { useCallback, useRef, useState } from 'react'
import type { ProfileStore, ProfileView } from './store.ts'
import type { ApiCapability } from './api.ts'

// ── Reusable style constants ────────────────────────────────────────────
const BTN: React.CSSProperties = {
  padding: '4px 12px', borderRadius: 4, border: '1px solid var(--dsh-border, #d1d5db)',
  background: 'var(--dsh-bg-secondary, #f9fafb)', cursor: 'pointer', fontSize: 13,
}
const BTN_DANGER: React.CSSProperties = { ...BTN, color: '#dc2626', borderColor: '#fca5a5' }
const FIELD: React.CSSProperties = {
  width: '100%', padding: '4px 8px', borderRadius: 4,
  border: '1px solid var(--dsh-border, #d1d5db)', fontSize: 13, boxSizing: 'border-box',
}
const LABEL: React.CSSProperties = { display: 'block', fontSize: 12, fontWeight: 500, marginBottom: 2 }
const BADGE: React.CSSProperties = {
  display: 'inline-block', fontSize: 10, padding: '1px 6px', borderRadius: 8,
  background: 'var(--dsh-bg-tertiary, #e5e7eb)', color: 'var(--dsh-text-secondary, #6b7280)',
}

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
    <section aria-label="Company Profiles" style={{ padding: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h2 style={{ margin: 0, fontSize: 16 }}>Company Profiles</h2>
        <button
          type="button"
          style={{ ...BTN, background: 'var(--dsh-accent, #2563eb)', color: '#fff', border: 'none' }}
          onClick={() => {
            void store.create({ displayName: 'New Profile' })
          }}
        >
          + New Profile
        </button>
      </div>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0 }} role="list">
        {profiles.map(p => (
          <ProfileRow key={p.id} profile={p} store={store} isDefault={p.id === snap.defaultProfileId} />
        ))}
      </ul>
      {snap.error && (
        <div role="alert" style={{ color: '#dc2626', marginTop: 8, fontSize: 13 }}>
          Error: {snap.error}
        </div>
      )}
    </section>
  )
}

// ── Profile list row ────────────────────────────────────────────────────
function ProfileRow({ profile, store, isDefault }: { profile: ProfileView; store: ProfileStore; isDefault: boolean }): React.ReactNode {
  return (
    <li
      style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0',
        borderBottom: '1px solid var(--dsh-border, #e5e7eb)',
        opacity: profile.archived ? 0.5 : 1,
      }}
    >
      <img
        src={profile.avatarUri}
        alt=""
        width={32}
        height={32}
        style={{ borderRadius: 4, border: `2px solid ${profile.color}`, flexShrink: 0 }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 500, fontSize: 14, display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {profile.name}
          </span>
          {isDefault && <span style={BADGE}>default</span>}
          {profile.archived && <span style={BADGE}>archived</span>}
          {profile.attention > 0 && (
            <span style={{ ...BADGE, background: '#fef3c7', color: '#92400e' }}>
              {profile.attention} ⚠
            </span>
          )}
        </div>
        {profile.parentId && (
          <div style={{ fontSize: 11, color: 'var(--dsh-text-secondary, #9ca3af)' }}>
            inherits from {profile.parentId}
          </div>
        )}
      </div>
      <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
        <button type="button" style={BTN} onClick={() => store.setEditing(profile.id)} aria-label={`Edit ${profile.name}`}>
          Edit
        </button>
        <button type="button" style={BTN} onClick={() => { void store.clone(profile.id) }} aria-label={`Clone ${profile.name}`}>
          Clone
        </button>
        {!isDefault && (
          <button
            type="button"
            style={BTN}
            onClick={() => { void store.archive(profile.id, !profile.archived) }}
            aria-label={profile.archived ? `Unarchive ${profile.name}` : `Archive ${profile.name}`}
          >
            {profile.archived ? 'Unarchive' : 'Archive'}
          </button>
        )}
        {!isDefault && !profile.archived && (
          <button
            type="button"
            style={BTN_DANGER}
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
    <section aria-label={`Edit ${profile.name}`} style={{ padding: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2 style={{ margin: 0, fontSize: 16 }}>Edit: {profile.name}</h2>
        <button type="button" style={BTN} onClick={() => store.setEditing(null)}>← Back</button>
      </div>

      {validationError && (
        <div role="alert" style={{ background: '#fef2f2', border: '1px solid #fca5a5', padding: '8px 12px', borderRadius: 4, marginBottom: 12, fontSize: 13, color: '#dc2626' }}>
          {validationError}
        </div>
      )}

      {/* Fields */}
      <fieldset style={{ border: 'none', padding: 0, margin: '0 0 16px' }}>
        <legend style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Profile Fields</legend>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div>
            <label style={LABEL}>Display Name *
              <input style={FIELD} value={fields.displayName} onChange={e => setFields(f => ({ ...f, displayName: e.target.value }))} required />
            </label>
          </div>
          <div>
            <label style={LABEL}>Legal Name
              <input style={FIELD} value={fields.legalName} onChange={e => setFields(f => ({ ...f, legalName: e.target.value }))} />
            </label>
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <label style={LABEL}>Description
              <textarea style={{ ...FIELD, minHeight: 48, resize: 'vertical' }} value={fields.description} onChange={e => setFields(f => ({ ...f, description: e.target.value }))} />
            </label>
          </div>
          <div>
            <label style={LABEL}>Website
              <input style={FIELD} type="url" value={fields.website} onChange={e => setFields(f => ({ ...f, website: e.target.value }))} placeholder="https://" />
            </label>
          </div>
          <div>
            <label style={LABEL}>Color
              <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                <input type="color" value={fields.color} onChange={e => setFields(f => ({ ...f, color: e.target.value }))} style={{ width: 32, height: 28, padding: 0, border: 'none', cursor: 'pointer' }} />
                <input style={{ ...FIELD, flex: 1 }} value={fields.color} onChange={e => setFields(f => ({ ...f, color: e.target.value }))} pattern="#[0-9a-fA-F]{6}" />
              </div>
            </label>
          </div>
        </div>
      </fieldset>

      {/* Capability matrix */}
      <fieldset style={{ border: 'none', padding: 0, margin: '0 0 16px' }}>
        <legend style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Capability Matrix</legend>
        {capabilities.length === 0 && (
          <div style={{ fontSize: 13, color: 'var(--dsh-text-secondary, #9ca3af)', marginBottom: 8 }}>
            No capabilities configured. Inherits all from parent profile.
          </div>
        )}
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }} role="grid" aria-label="Capabilities">
          <thead>
            <tr style={{ borderBottom: '2px solid var(--dsh-border, #d1d5db)' }}>
              <th style={{ textAlign: 'left', padding: '4px 8px' }}>Type</th>
              <th style={{ textAlign: 'left', padding: '4px 8px' }}>Key</th>
              <th style={{ textAlign: 'center', padding: '4px 8px' }}>State</th>
              <th style={{ textAlign: 'right', padding: '4px 8px' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {capabilities.map((cap, i) => (
              <CapabilityRow key={i} cap={cap} index={i} onToggle={toggleCapability} onRemove={removeCapability} />
            ))}
          </tbody>
        </table>
        <button type="button" style={{ ...BTN, marginTop: 8 }} onClick={addCapability}>
          + Add Capability
        </button>
      </fieldset>

      {/* OAuth connections (read-only display) */}
      <fieldset style={{ border: 'none', padding: 0, margin: '0 0 16px' }}>
        <legend style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>OAuth Connections</legend>
        {capabilities.filter(c => c.kind === 'mcp' && c.state === 'enabled' && (c.config as Record<string, unknown>)?.oauth).length === 0
          ? <div style={{ fontSize: 13, color: 'var(--dsh-text-secondary, #9ca3af)' }}>No OAuth-enabled MCP servers.</div>
          : capabilities
            .filter(c => c.kind === 'mcp' && c.state === 'enabled' && (c.config as Record<string, unknown>)?.oauth)
            .map((c, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', fontSize: 13 }}>
                <span style={{ ...BADGE, background: '#dcfce7', color: '#166534' }}>OAuth</span>
                <span>{c.key}</span>
                <span style={{ color: 'var(--dsh-text-secondary, #9ca3af)' }}>
                  ({((c.config as Record<string, unknown>)?.serverName as string) ?? 'unknown server'})
                </span>
              </div>
            ))
        }
      </fieldset>

      {/* Actions */}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', paddingTop: 12, borderTop: '1px solid var(--dsh-border, #e5e7eb)' }}>
        <button type="button" style={BTN} onClick={() => store.setEditing(null)}>Cancel</button>
        <button
          type="button"
          style={{ ...BTN, background: 'var(--dsh-accent, #2563eb)', color: '#fff', border: 'none' }}
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
  return (
    <tr style={{ borderBottom: '1px solid var(--dsh-border, #e5e7eb)' }}>
      <td style={{ padding: '4px 8px' }}>
        <span style={BADGE}>{cap.kind}</span>
      </td>
      <td style={{ padding: '4px 8px', fontFamily: 'monospace', fontSize: 12 }}>{cap.key}</td>
      <td style={{ padding: '4px 8px', textAlign: 'center' }}>
        <button
          type="button"
          style={{
            ...BTN,
            padding: '2px 8px',
            fontSize: 11,
            background: cap.state === 'enabled' ? '#dcfce7' : '#fee2e2',
            color: cap.state === 'enabled' ? '#166534' : '#991b1b',
            borderColor: cap.state === 'enabled' ? '#86efac' : '#fca5a5',
          }}
          onClick={() => onToggle(index)}
          aria-label={`Toggle ${cap.key} ${cap.state === 'enabled' ? 'off' : 'on'}`}
        >
          {cap.state}
        </button>
      </td>
      <td style={{ padding: '4px 8px', textAlign: 'right' }}>
        <button type="button" style={{ ...BTN_DANGER, padding: '2px 8px', fontSize: 11 }} onClick={() => onRemove(index)} aria-label={`Remove ${cap.key}`}>
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
