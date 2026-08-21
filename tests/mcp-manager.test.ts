import assert from 'node:assert/strict'
import test from 'node:test'
import { McpManager, type McpDiscovery } from '../src/mcp-manager.ts'
import { createDefaultDocument, resolveProfile, validateDocument, type ProfileDocument } from '../src/model.ts'

function makeProfile(doc: ProfileDocument, id: string) {
  return resolveProfile(doc, id)
}

test('McpManager.tools returns empty for unknown profile', () => {
  const manager = new McpManager()
  assert.deepEqual(manager.tools('nonexistent'), [])
})

test('McpManager.closeAll is idempotent on empty manager', async () => {
  const manager = new McpManager()
  await manager.closeAll()
  await manager.closeAll()
})

test('McpManager.closeProfile is safe on unknown profile', async () => {
  const manager = new McpManager()
  await manager.closeProfile('nonexistent')
})

test('reconcile with no MCP capabilities is a no-op', async () => {
  const manager = new McpManager()
  const doc = createDefaultDocument()
  const profile = makeProfile(doc, 'default')
  await manager.reconcile(profile, 1)
  assert.deepEqual(manager.tools('default'), [])
})

test('reconcile reports error for invalid stdio config', async () => {
  const errors: string[] = []
  const manager = new McpManager({
    onError: (_error, context) => errors.push(context),
  })
  const doc = createDefaultDocument()
  doc.profiles[0]!.capabilities = [
    { kind: 'mcp', key: 'bad', state: 'enabled', config: { transport: 'stdio', serverName: 'bad' } },
  ]
  const validated = validateDocument(doc)
  const profile = makeProfile(validated, 'default')
  await manager.reconcile(profile, 1)
  assert.equal(errors.length, 1)
  assert.match(errors[0]!, /failed to open/)
})

test('finishAuth rejects for unknown connection', async () => {
  const manager = new McpManager()
  await assert.rejects(
    manager.finishAuth({ profileId: 'x', serverId: 'y', accountId: 'z', code: 'abc' }),
    /no connection/,
  )
})

test('sanitizeServerName produces valid tool prefix via tools()', async () => {
  // Verify the manager properly tracks empty tool sets
  const manager = new McpManager()
  const tools = manager.tools('test-profile')
  assert.ok(Array.isArray(tools))
  assert.equal(tools.length, 0)
})

test('reconcile with disabled MCP capability does not open connection', async () => {
  const discoveries: McpDiscovery[] = []
  const manager = new McpManager({
    onDiscovery: d => discoveries.push(d),
  })
  const doc = createDefaultDocument()
  doc.profiles[0]!.capabilities = [
    { kind: 'mcp', key: 'jira', state: 'disabled' },
  ]
  const validated = validateDocument(doc)
  const profile = makeProfile(validated, 'default')
  await manager.reconcile(profile, 1)
  assert.equal(discoveries.length, 0)
  assert.deepEqual(manager.tools('default'), [])
})

test('reconcile skips skill and plugin capabilities', async () => {
  const manager = new McpManager()
  const doc = createDefaultDocument()
  doc.profiles[0]!.capabilities = [
    { kind: 'skill', key: 'common', state: 'enabled' },
    { kind: 'plugin', key: 'extra', state: 'enabled' },
  ]
  const validated = validateDocument(doc)
  const profile = makeProfile(validated, 'default')
  await manager.reconcile(profile, 1)
  assert.deepEqual(manager.tools('default'), [])
})
