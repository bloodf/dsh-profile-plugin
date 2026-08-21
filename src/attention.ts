/* Profile-scoped attention aggregation from durable Session events. */
import type { SessionId } from '@deepseek-ai/dsh-session'

export type AttentionReason = 'approval' | 'question' | 'agent-error'

export interface AttentionEntry {
  readonly profileId: string
  readonly sessionId: SessionId
  readonly reasons: readonly AttentionReason[]
}

/** Minimal session shape — avoids depending on module augmentation order. */
interface AttentionSession {
  readonly id: SessionId
  readonly header: { readonly profileId?: string }
}

/** Loose event shape — approval events may come from external augmentations. */
interface AttentionEvent {
  readonly type: string
  readonly data: Record<string, unknown>
}

export class ProfileAttention {
  private readonly reasons = new Map<SessionId, Set<AttentionReason>>()
  private readonly profiles = new Map<SessionId, string>()
  private readonly openApprovals = new Map<SessionId, Set<string>>()

  observe(session: AttentionSession, event: AttentionEvent): void {
    const profileId = session.header.profileId
    if (profileId === undefined) return
    this.profiles.set(session.id, profileId)
    if (event.type === 'approval/asked') {
      const approvals = this.openApprovals.get(session.id) ?? new Set<string>()
      approvals.add(String(event.data['id']))
      this.openApprovals.set(session.id, approvals)
      this.setReason(session.id, 'approval', true)
    } else if (event.type === 'approval/decided') {
      const approvals = this.openApprovals.get(session.id)
      approvals?.delete(String(event.data['id']))
      this.setReason(session.id, 'approval', (approvals?.size ?? 0) > 0)
    } else if (event.type === 'turn/error') {
      this.setReason(session.id, 'agent-error', true)
    } else if (event.type === 'turn/start') {
      this.setReason(session.id, 'agent-error', false)
    }
  }

  disposeSession(sessionId: SessionId): void {
    this.reasons.delete(sessionId)
    this.profiles.delete(sessionId)
    this.openApprovals.delete(sessionId)
  }

  setQuestion(profileId: string, sessionId: SessionId, pending: boolean): void {
    this.profiles.set(sessionId, profileId)
    this.setReason(sessionId, 'question', pending)
  }

  clear(sessionId: SessionId): void {
    this.reasons.delete(sessionId)
  }

  list(): AttentionEntry[] {
    const entries: AttentionEntry[] = []
    for (const [sessionId, reasons] of this.reasons) {
      const profileId = this.profiles.get(sessionId)
      if (profileId === undefined || reasons.size === 0) continue
      entries.push({ profileId, sessionId, reasons: [...reasons].sort() })
    }
    return entries
  }

  counts(): Record<string, number> {
    const counts: Record<string, number> = {}
    for (const entry of this.list()) counts[entry.profileId] = (counts[entry.profileId] ?? 0) + 1
    return counts
  }

  private setReason(sessionId: SessionId, reason: AttentionReason, enabled: boolean): void {
    const reasons = this.reasons.get(sessionId) ?? new Set<AttentionReason>()
    if (enabled) reasons.add(reason)
    else reasons.delete(reason)
    if (reasons.size === 0) this.reasons.delete(sessionId)
    else this.reasons.set(sessionId, reasons)
  }
}
