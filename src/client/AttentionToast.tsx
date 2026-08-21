/** Shell overlay: attention toast with optional sound and click navigation. */
import React, { useCallback, useEffect, useRef, useState } from 'react'
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
  const playedRef = useRef(new Set<string>())

  useEffect(() => {
    const unsub = store.subscribe(() => {
      const snap = store.getSnapshot()
      setToasts(snap.toasts)
      // Play sound for new toasts
      for (const toast of snap.toasts) {
        if (toast.sound && !playedRef.current.has(toast.id)) {
          playedRef.current.add(toast.id)
          playNotificationSound()
        }
      }
    })
    return unsub
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
    if (toast.sessionId) {
      // Navigate to the session — set hash for the shell to pick up
      window.location.hash = `session=${toast.sessionId}`
    }
    store.dismissToast(toast.id)
  }, [store])

  const handleDismiss = useCallback((e: React.MouseEvent, id: string) => {
    e.stopPropagation()
    store.dismissToast(id)
  }, [store])

  if (toasts.length === 0) return null

  return (
    <div
      role="log"
      aria-label="Profile attention notifications"
      aria-live="polite"
      style={{
        position: 'fixed',
        top: 12,
        right: 12,
        zIndex: 10000,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        pointerEvents: 'auto',
        maxWidth: 360,
      }}
    >
      {toasts.map(toast => (
        <div
          key={toast.id}
          role="alert"
          onClick={() => handleClick(toast)}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleClick(toast) }}
          tabIndex={0}
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 8,
            padding: '10px 12px',
            background: 'var(--dsh-bg-primary, #fff)',
            border: `2px solid ${toast.profileColor}`,
            borderRadius: 8,
            boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
            cursor: toast.sessionId ? 'pointer' : 'default',
            animation: 'dsh-profile-toast-in 0.3s ease-out',
            fontSize: 13,
          }}
        >
          <div
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: toast.profileColor,
              flexShrink: 0,
              marginTop: 5,
            }}
          />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 600, fontSize: 12, color: toast.profileColor }}>
              {toast.profileName}
            </div>
            <div style={{ fontSize: 12, color: 'var(--dsh-text-primary, #374151)' }}>
              {toast.message}
            </div>
            {toast.sessionId && (
              <div style={{ fontSize: 11, color: 'var(--dsh-text-secondary, #9ca3af)', marginTop: 2 }}>
                Click to open session
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={(e) => handleDismiss(e, toast.id)}
            aria-label="Dismiss notification"
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              fontSize: 16,
              color: 'var(--dsh-text-secondary, #9ca3af)',
              padding: 0,
              lineHeight: 1,
            }}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  )
}

/** Inject keyframe animation for toast entrance. */
export function injectToastStyles(): () => void {
  const id = 'dsh-profile-toast-keyframes'
  if (typeof document === 'undefined' || document.getElementById(id)) return () => {}
  const style = document.createElement('style')
  style.id = id
  style.textContent = `@keyframes dsh-profile-toast-in { from { opacity: 0; transform: translateX(24px); } to { opacity: 1; transform: translateX(0); } }`
  document.head.appendChild(style)
  return () => { style.remove() }
}
