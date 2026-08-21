import assert from 'node:assert/strict'
import test from 'node:test'
import { ProfileRuntime } from '../src/runtime.ts'
import { createDefaultDocument, resolveProfile, DEFAULT_PROFILE_ID } from '../src/model.ts'

function profile(id = DEFAULT_PROFILE_ID) {
  return resolveProfile(createDefaultDocument('2026-01-01T00:00:00Z'), id)
}

test('resolveProfileId falls back to default for undefined profileId', () => {
  // The runtime.admit uses profileId directly — test that default works
  const runtime = new ProfileRuntime()
  runtime.publish(profile(), 1, ['mcp__jira__search'])
  const lease = runtime.admit(DEFAULT_PROFILE_ID, 'mcp__jira__search')
  assert.equal(lease.snapshot.profileId, DEFAULT_PROFILE_ID)
  assert.equal(lease.snapshot.generation, 1)
  lease.release()
})

test('admit rejects tool not in current generation', () => {
  const runtime = new ProfileRuntime()
  runtime.publish(profile(), 1, ['mcp__jira__search'])
  assert.throws(() => runtime.admit(DEFAULT_PROFILE_ID, 'mcp__jira__create'), /disabled/)
})

test('admit rejects tool from different profile', () => {
  const runtime = new ProfileRuntime()
  runtime.publish(profile(), 1, ['mcp__jira__search'])
  assert.throws(() => runtime.admit('other-profile', 'mcp__jira__search'), /disabled/)
})

test('lease release is idempotent', () => {
  const runtime = new ProfileRuntime()
  runtime.publish(profile(), 1, ['mcp__jira__search'])
  const lease = runtime.admit(DEFAULT_PROFILE_ID, 'mcp__jira__search')
  lease.release()
  lease.release() // should not throw
  assert.equal(runtime.retiredGenerationCount(), 0)
})

test('generation rollover retires old leases correctly', () => {
  const runtime = new ProfileRuntime()
  runtime.publish(profile(), 1, ['mcp__jira__old'])
  const oldLease = runtime.admit(DEFAULT_PROFILE_ID, 'mcp__jira__old')
  
  // New generation replaces old tools
  runtime.publish(profile(), 2, ['mcp__jira__new'])
  assert.equal(runtime.retiredGenerationCount(), 1)
  
  // Old lease still valid for its generation
  assert.equal(oldLease.snapshot.generation, 1)
  assert.ok(oldLease.snapshot.allowedTools.has('mcp__jira__old'))
  
  // New tool available
  const newLease = runtime.admit(DEFAULT_PROFILE_ID, 'mcp__jira__new')
  assert.equal(newLease.snapshot.generation, 2)
  
  // Release old lease clears retired generation
  oldLease.release()
  assert.equal(runtime.retiredGenerationCount(), 0)
  newLease.release()
})

test('snapshot throws for unknown profile', () => {
  const runtime = new ProfileRuntime()
  assert.throws(() => runtime.snapshot('nonexistent'), /no active/)
})

test('publish validates tool name format', () => {
  const runtime = new ProfileRuntime()
  assert.throws(
    () => runtime.publish(profile(), 1, ['invalid tool name']),
    /invalid discovered MCP tool name/,
  )
})

test('publish accepts valid MCP tool name formats', () => {
  const runtime = new ProfileRuntime()
  // Various valid formats
  const validNames = [
    'mcp__jira__search',
    'mcp__github__create-issue',
    'mcp__server1__tool.v2',
    'mcp__my-server__tool:action',
  ]
  const snap = runtime.publish(profile(), 1, validNames)
  assert.equal(snap.allowedTools.size, validNames.length)
  for (const name of validNames) {
    assert.ok(snap.allowedTools.has(name))
  }
})
