/**
 * Client plugin entry: registers profile UI into harness slots.
 *
 * - sidebar.footer.action  → ProfileSwitcher (compact dropdown)
 * - settings.section       → Profiles CRUD/editor/capabilities/OAuth
 * - shell.overlay          → Attention toast with sound + click navigation
 *
 * Uses React.createElement at the slot boundary (TSX in components).
 */
import React from 'react'
import type { Context } from '@deepseek-ai/cordis'
import { ProfileStore } from './store.ts'
import { ProfileSwitcher } from './ProfileSwitcher.tsx'
import { ProfilesSettings } from './ProfilesSettings.tsx'
import { AttentionToastLayer, injectToastStyles } from './AttentionToast.tsx'

// Re-export component types for tests
export { ProfileStore } from './store.ts'
export { ProfileSwitcher } from './ProfileSwitcher.tsx'
export { ProfilesSettings } from './ProfilesSettings.tsx'
export { AttentionToastLayer } from './AttentionToast.tsx'
export { avatarDataUri, stableHash, defaultColor, defaultAvatarSeed, avatarInitials } from './avatar.ts'
export type { ProfileView, ProfileStoreState, ToastMessage } from './store.ts'

/** Client services this plugin consumes. */
export const inject = ['slots']

export function apply(ctx: Context): void {
  const slots = ctx.get('slots') as import('@deepseek-ai/dsh-client-ui-slots').SlotRegistry
  if (!slots) return

  const store = new ProfileStore()

  ctx.effect(() => {
    store.startPolling()
    return () => { store.dispose() }
  }, 'company-profiles: store lifecycle')

  // Toast keyframe injection
  ctx.effect(() => {
    return injectToastStyles()
  }, 'company-profiles: toast styles')

  // ── sidebar.footer.action: profile switcher ───────────────────────────
  slots.inject('sidebar.footer.action', () =>
    slots.register(
      {
        name: 'sidebar.footer.action',
        id: 'company-profiles',
        order: -10, // Before other footer actions
        label: 'Profile',
        inject: () => ({ store }),
      },
      (props: { wide: boolean; store: ProfileStore }) => {
        const snap = useSync(props.store)
        return React.createElement(ProfileSwitcher, {
          profiles: snap.profiles,
          selected: snap.selected,
          onSelect: (id: string) => props.store.selectProfile(id),
          wide: props.wide,
        })
      },
    ),
  )

  // ── settings.section: profiles manager ────────────────────────────────
  slots.inject('settings.section', () =>
    slots.register(
      {
        name: 'settings.section',
        id: 'company-profiles',
        order: 20,
        label: 'Profiles',
      },
      (props: { close: () => void }) => {
        return React.createElement(ProfilesSettings, { store, close: props.close })
      },
    ),
  )

  // ── shell.overlay: attention toast ────────────────────────────────────
  slots.inject('shell.overlay', () =>
    slots.register(
      {
        name: 'shell.overlay',
        id: 'company-profiles-toast',
        order: 100,
      },
      () => React.createElement(AttentionToastLayer, { store }),
    ),
  )
}

/** Minimal useSyncExternalStore for the store. */
function useSync(store: ProfileStore) {
  const snapRef = React.useRef(store.getSnapshot())
  const [, bump] = React.useState(0)
  React.useEffect(() => {
    const unsub = store.subscribe(() => {
      snapRef.current = store.getSnapshot()
      bump(n => n + 1)
    })
    snapRef.current = store.getSnapshot()
    bump(n => n + 1)
    return unsub
  }, [store])
  return snapRef.current
}
