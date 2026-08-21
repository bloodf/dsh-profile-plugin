import assert from 'node:assert/strict'
import test from 'node:test'
import { createDefaultDocument, resolveProfile, validateDocument } from '../src/model.ts'
import { ProfileRuntime } from '../src/runtime.ts'

function profile() {
  return resolveProfile(createDefaultDocument('2026-01-01T00:00:00Z'), 'default')
}

test('default capabilities inherit while local disabled state remains inspectable', () => {
  const document = createDefaultDocument('x')
  document.profiles[0]!.capabilities = [
    { kind: 'mcp', key: 'jira', state: 'enabled', config: { transport: 'streamable-http', serverName: 'jira', url: 'https://jira.test/mcp' } },
    { kind: 'skill', key: 'common', state: 'enabled' },
  ]
  document.profiles.push({
    id: 'acme', parentId: 'default', archived: false, createdAt: 'x', updatedAt: 'x', fields: {},
    capabilities: [{ kind: 'skill', key: 'common', state: 'disabled' }],
  })
  document.order.push('acme')
  const resolved = resolveProfile(validateDocument(document), 'acme')
  assert.equal(resolved.capabilities.find(item => item.key === 'jira')?.executionProfileId, 'acme')
  assert.deepEqual(resolved.localOverrides, [{ kind: 'skill', key: 'common', state: 'disabled' }])
})

test('runtime admits exact discovered name and rejects prefix lookalikes', () => {
  const runtime = new ProfileRuntime()
  runtime.publish(profile(), 1, ['mcp__jira__search'])
  const lease = runtime.admit('default', 'mcp__jira__search')
  assert.equal(lease.snapshot.generation, 1)
  assert.throws(() => runtime.admit('default', 'mcp__jira__search_extra'), /disabled/)
  lease.release()
})

test('admitted call retains old immutable generation while next call uses new', () => {
  const runtime = new ProfileRuntime()
  runtime.publish(profile(), 1, ['mcp__jira__old'])
  const old = runtime.admit('default', 'mcp__jira__old')
  runtime.publish(profile(), 2, ['mcp__jira__new'])
  assert.equal(old.snapshot.generation, 1)
  assert.throws(() => runtime.admit('default', 'mcp__jira__old'), /disabled/)
  assert.equal(runtime.admit('default', 'mcp__jira__new').snapshot.generation, 2)
  assert.equal(runtime.retiredGenerationCount(), 1)
  old.release()
  assert.equal(runtime.retiredGenerationCount(), 0)
})
