import assert from 'node:assert/strict'
import test from 'node:test'
import { ProfileAttention } from '../src/attention.ts'

type SessionId = string & { readonly __brand: 'SessionId' }
function sid(id: string): SessionId { return id as SessionId }

function mockSession(id: string, profileId?: string) {
  return {
    id: sid(id),
    header: { version: 0, id: sid(id), createdAt: 0, profileId },
  } as any
}

function mockEvent(type: string, data: Record<string, unknown> = {}) {
  return { type, data } as any
}

test('observe tracks approvals and clears on decision', () => {
  const attention = new ProfileAttention()
  const session = mockSession('s1', 'acme')
  
  attention.observe(session, mockEvent('approval/asked', { id: 'a1' }))
  assert.equal(attention.list().length, 1)
  assert.deepEqual(attention.list()[0]!.reasons, ['approval'])
  
  attention.observe(session, mockEvent('approval/decided', { id: 'a1' }))
  assert.equal(attention.list().length, 0)
})

test('observe tracks multiple approvals', () => {
  const attention = new ProfileAttention()
  const session = mockSession('s1', 'acme')
  
  attention.observe(session, mockEvent('approval/asked', { id: 'a1' }))
  attention.observe(session, mockEvent('approval/asked', { id: 'a2' }))
  assert.equal(attention.list().length, 1)
  assert.deepEqual(attention.list()[0]!.reasons, ['approval'])
  
  attention.observe(session, mockEvent('approval/decided', { id: 'a1' }))
  // Still one approval pending
  assert.equal(attention.list().length, 1)
  
  attention.observe(session, mockEvent('approval/decided', { id: 'a2' }))
  assert.equal(attention.list().length, 0)
})

test('observe tracks agent errors and clears on turn start', () => {
  const attention = new ProfileAttention()
  const session = mockSession('s1', 'acme')
  
  attention.observe(session, mockEvent('turn/error'))
  assert.deepEqual(attention.list()[0]!.reasons, ['agent-error'])
  
  attention.observe(session, mockEvent('turn/start'))
  assert.equal(attention.list().length, 0)
})

test('ignores sessions without profileId', () => {
  const attention = new ProfileAttention()
  const session = mockSession('s1') // no profileId
  
  attention.observe(session, mockEvent('approval/asked', { id: 'a1' }))
  assert.equal(attention.list().length, 0)
})

test('disposeSession clears all tracking', () => {
  const attention = new ProfileAttention()
  const session = mockSession('s1', 'acme')
  
  attention.observe(session, mockEvent('approval/asked', { id: 'a1' }))
  attention.observe(session, mockEvent('turn/error'))
  assert.equal(attention.list().length, 1)
  
  attention.disposeSession(sid('s1'))
  assert.equal(attention.list().length, 0)
})

test('setQuestion manages question reason', () => {
  const attention = new ProfileAttention()
  
  attention.setQuestion('acme', sid('s1'), true)
  assert.deepEqual(attention.list()[0]!.reasons, ['question'])
  
  attention.setQuestion('acme', sid('s1'), false)
  assert.equal(attention.list().length, 0)
})

test('clear removes all reasons for a session', () => {
  const attention = new ProfileAttention()
  const session = mockSession('s1', 'acme')
  
  attention.observe(session, mockEvent('approval/asked', { id: 'a1' }))
  attention.setQuestion('acme', sid('s1'), true)
  assert.equal(attention.list().length, 1)
  assert.equal(attention.list()[0]!.reasons.length, 2)
  
  attention.clear(sid('s1'))
  assert.equal(attention.list().length, 0)
})

test('counts aggregates per profile', () => {
  const attention = new ProfileAttention()
  const s1 = mockSession('s1', 'acme')
  const s2 = mockSession('s2', 'acme')
  const s3 = mockSession('s3', 'beta')
  
  attention.observe(s1, mockEvent('approval/asked', { id: 'a1' }))
  attention.observe(s2, mockEvent('turn/error'))
  attention.observe(s3, mockEvent('approval/asked', { id: 'a2' }))
  
  const counts = attention.counts()
  assert.equal(counts['acme'], 2)
  assert.equal(counts['beta'], 1)
})

test('reasons are sorted alphabetically', () => {
  const attention = new ProfileAttention()
  const session = mockSession('s1', 'acme')
  
  attention.observe(session, mockEvent('turn/error'))
  attention.observe(session, mockEvent('approval/asked', { id: 'a1' }))
  attention.setQuestion('acme', sid('s1'), true)
  
  assert.deepEqual(attention.list()[0]!.reasons, ['agent-error', 'approval', 'question'])
})
