/** Sidebar footer action: compact profile switcher dropdown. */
import React, { useState } from 'react'
import { IconChevronDownOutline14, Menu } from '@deepseek-ai/dsh-client-ui-primitives'
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
  const activeLabel = `Active profile: ${active?.name ?? 'none'}`

  return (
    <div className={`${css.root} ${wide ? css.wide : ''}`}>
      <Menu
        open={open}
        onClose={() => { setOpen(false) }}
        items={activeProfiles.map(profile => ({
          id: profile.id,
          label: `${profile.name}${profile.attention > 0 ? ` (${profile.attention})` : ''}`,
        }))}
        selectedId={selected}
        onSelect={(id) => {
          onSelect(id)
          setOpen(false)
        }}
        side={wide ? 'top' : 'right'}
        portal
        anchor={wide ? (
          <button type="button" className={css.wideTrigger} aria-label={activeLabel} aria-haspopup="menu" aria-expanded={open} onClick={() => { setOpen(value => !value) }}>
            {active && <img src={active.avatarUri} alt="" className={css.wideAvatar} style={{ '--profile-color': active.color } as React.CSSProperties} />}
            <span className={css.name}>{active?.name ?? 'No profile'}</span>
            <IconChevronDownOutline14 className={css.chevron} />
          </button>
        ) : (
          <button type="button" className={css.railTrigger} aria-label={activeLabel} aria-haspopup="menu" aria-expanded={open} title={active?.name} onClick={() => { setOpen(value => !value) }}>
            {active && <img src={active.avatarUri} alt="" className={css.avatar} style={{ '--profile-color': active.color } as React.CSSProperties} />}
            {(active?.attention ?? 0) > 0 && <span className={css.badge} style={{ '--profile-color': active!.color } as React.CSSProperties} aria-label={`${active!.attention} sessions need attention`}>{active!.attention}</span>}
          </button>
        )}
      />
    </div>
  )
}
