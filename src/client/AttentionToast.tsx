/** Shell overlay: attention toast with optional sound and click navigation. */
import React, { useCallback, useEffect, useRef, useState } from 'react'
import css from './AttentionToast.module.css'
import type { ProfileStore, ToastMessage } from './store.ts'

const TOAST_TTL = 8_000
const SOUND_FREQ = 660
const SOUND_DURATION = 0.12

function playNotificationSound(): void {
  try {
    const ctx = new AudioContext()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'sine'
    osc.frequency.value = SOUND_FREQ
    gain.gain.value = 0.15
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.start()
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + SOUND_DURATION)
    osc.stop(ctx.currentTime + SOUND_DURATION + 0.01)
    // Let GC collect after sound ends
    osc.onended = () => { void ctx.close() }
  } catch {
    // AudioContext unavailable — silent fallback
  }
}

export interface AttentionToastLayerProps {
  store: ProfileStore
}

export function AttentionToastLayer({ store }: AttentionToastLayerProps): React.ReactNode {
  const [toasts, setToasts] = useState<ToastMessage[]>([])
  const [soundEnabled, setSoundEnabled] = useState(store.getSnapshot().soundEnabled)
  const playedRef = useRef(new Set<string>())

  useEffect(() => {
    const update = () => {
      const snap = store.getSnapshot()
      setToasts(snap.toasts)
      setSoundEnabled(snap.soundEnabled)
      for (const toast of snap.toasts) {
        if (snap.soundEnabled && toast.sound && !playedRef.current.has(toast.id)) {
          playedRef.current.add(toast.id)
          playNotificationSound()
        }
      }
    }
    update()
    return store.subscribe(update)
  }, [store])

  // Auto-dismiss after TTL
  useEffect(() => {
    if (toasts.length === 0) return
    const timers = toasts.map(t => {
      const remaining = TOAST_TTL - (Date.now() - t.timestamp)
      if (remaining <= 0) {
        store.dismissToast(t.id)
        return undefined
      }
      return setTimeout(() => store.dismissToast(t.id), remaining)
    })
    return () => { timers.forEach(t => { if (t !== undefined) clearTimeout(t) }) }
  }, [toasts, store])

  const handleClick = useCallback((toast: ToastMessage) => {
    if (toast.sessionId) store.openSession(toast.profileId, toast.sessionId)
    store.dismissToast(toast.id)
  }, [store])

  const handleDismiss = useCallback((e: React.MouseEvent, id: string) => {
    e.stopPropagation()
    store.dismissToast(id)
  }, [store])

  if (toasts.length === 0 && soundEnabled) return null

  return (
    <div role="log" aria-label="Profile attention notifications" aria-live="polite" className={css.layer}>
      {!soundEnabled && <button type="button" onClick={() => store.enableSound()} className={css.sound}>Enable notification sound</button>}
      {toasts.map(toast => (
        <div key={toast.id} role="alert" onClick={() => handleClick(toast)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') handleClick(toast) }} tabIndex={0} className={css.toast} style={{ '--profile-color': toast.profileColor } as React.CSSProperties}>
          <span className={css.dot} />
          <div className={css.body}>
            <div className={css.profile}>{toast.profileName}</div>
            <div className={css.message}>{toast.message}</div>
            {toast.sessionId && <div className={css.hint}>Open session</div>}
          </div>
          <button type="button" onClick={(event) => handleDismiss(event, toast.id)} aria-label="Dismiss notification" className={css.dismiss}>×</button>
        </div>
      ))}
    </div>
  )
}
