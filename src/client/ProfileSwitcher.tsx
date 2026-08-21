/** Sidebar footer action: compact profile switcher dropdown. */
import React from 'react'
import type { ProfileView } from './store.ts'

export interface ProfileSwitcherProps {
  profiles: ProfileView[]
  selected: string
  onSelect: (id: string) => void
  wide: boolean
}

export function ProfileSwitcher(props: ProfileSwitcherProps): React.ReactNode {
  const { profiles, selected, onSelect, wide } = props
  const active = profiles.find(p => p.id === selected)
  const activeProfiles = profiles.filter(p => !p.archived)

  if (!wide) {
    // Rail mode: small avatar only
    return (
      <button
        type="button"
        aria-label={`Active profile: ${active?.name ?? 'none'}`}
        title={active?.name}
        style={{
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          padding: 4,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {active && (
          <img
            src={active.avatarUri}
            alt=""
            width={24}
            height={24}
            style={{ borderRadius: 4, border: `2px solid ${active.color}` }}
          />
        )}
      </button>
    )
  }

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '4px 8px',
        minWidth: 0,
      }}
    >
      {active && (
        <img
          src={active.avatarUri}
          alt=""
          width={20}
          height={20}
          style={{ borderRadius: 3, flexShrink: 0, border: `2px solid ${active.color}` }}
        />
      )}
      <select
        value={selected}
        aria-label="Active profile"
        onChange={(e) => onSelect(e.target.value)}
        style={{
          flex: 1,
          minWidth: 0,
          background: 'transparent',
          border: '1px solid var(--dsh-border, #d1d5db)',
          borderRadius: 4,
          padding: '2px 4px',
          fontSize: 12,
          color: 'inherit',
          cursor: 'pointer',
        }}
      >
        {activeProfiles.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
            {p.attention > 0 ? ` (${p.attention})` : ''}
          </option>
        ))}
      </select>
    </div>
  )
}
