/** Sidebar footer action: compact profile switcher dropdown. */
import React, { useState } from 'react'
import css from './ProfileSwitcher.module.css'
import type { ProfileView } from './store.ts'

export interface ProfileSwitcherProps {
  profiles: ProfileView[]
  selected: string
  onSelect: (id: string) => void
  wide: boolean
}

export function ProfileSwitcher(props: ProfileSwitcherProps): React.ReactNode {
  const { profiles, selected, onSelect, wide } = props
  const [open, setOpen] = useState(false)
  const active = profiles.find(profile => profile.id === selected)
  const activeProfiles = profiles.filter(profile => !profile.archived)
  if (!wide) {
    return (
      <div className={css.root} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false) }}>
        <button type="button" className={css.railButton} aria-label={`Active profile: ${active?.name ?? 'none'}`} aria-haspopup="listbox" aria-expanded={open} title={active?.name} onClick={() => setOpen(value => !value)} onKeyDown={(event) => { if (event.key === 'Escape') setOpen(false) }}>
          {active && <img src={active.avatarUri} alt="" className={css.avatar} style={{ '--profile-color': active.color } as React.CSSProperties} />}
          {(active?.attention ?? 0) > 0 && <span className={css.badge} style={{ '--profile-color': active!.color } as React.CSSProperties} aria-label={`${active!.attention} sessions need attention`}>{active!.attention}</span>}
        </button>
        {open && <select autoFocus className={`${css.select} ${css.railSelect}`} value={selected} aria-label="Choose profile" onChange={(event) => { onSelect(event.target.value); setOpen(false) }} onKeyDown={(event) => { if (event.key === 'Escape') setOpen(false) }}>
          {activeProfiles.map(profile => <option key={profile.id} value={profile.id}>{profile.name}{profile.attention > 0 ? ` (${profile.attention})` : ''}</option>)}
        </select>}
      </div>
    )
  }

  return (
    <div className={css.root}>
      <div className={css.wideControl}>
        {active && <img src={active.avatarUri} alt="" className={css.wideAvatar} style={{ '--profile-color': active.color } as React.CSSProperties} />}
        <select className={css.select} value={selected} aria-label="Active profile" onChange={(event) => onSelect(event.target.value)}>
          {activeProfiles.map(profile => <option key={profile.id} value={profile.id}>{profile.name}{profile.attention > 0 ? ` (${profile.attention})` : ''}</option>)}
        </select>
      </div>
    </div>
  )
}
