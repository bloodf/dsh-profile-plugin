import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { CompanyProfileRegistry, RevisionConflictError } from '../src/registry.ts'
import { defaultAvatarSeed, defaultColor } from '../src/model.ts'

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'company-profiles-'))
  let tick = 0
  let id = 0
  const path = join(directory, 'profiles.json')
  const registry = await CompanyProfileRegistry.open({
    path,
    now: () => `2026-01-01T00:00:0${tick++}.000Z`,
    id: () => `generated-${++id}`,
  })
  return { directory, path, registry }
}

test('creates durable default and resolves deterministic visual defaults', async t => {
  const { directory, path, registry } = await fixture()
  t.after(() => rm(directory, { recursive: true, force: true }))
  const document = registry.snapshot()
  assert.equal(document.revision, 0)
  assert.equal(document.defaultProfileId, 'default')
  assert.equal(registry.resolve('default').fields.color, defaultColor('default'))
  assert.equal(registry.resolve('default').fields.avatarSeed, defaultAvatarSeed('default'))
  assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), document)
})

test('resolves inherited, cleared, and overridden fields', async t => {
  const { directory, registry } = await fixture()
  t.after(() => rm(directory, { recursive: true, force: true }))
  await registry.update(0, 'default', { fields: { displayName: 'Parent', legalName: 'Parent LLC', website: 'https://parent.test' } })
  await registry.create(1, { id: 'child', fields: { legalName: null, website: 'https://child.test' } })
  const child = registry.resolve('child')
  assert.equal(child.fields.displayName, 'Parent')
  assert.equal(child.fields.legalName, null)
  assert.equal(child.fields.website, 'https://child.test')
})

test('supports clone, reorder, archive, subscriptions, and persistence reopen', async t => {
  const { directory, path, registry } = await fixture()
  t.after(() => rm(directory, { recursive: true, force: true }))
  const revisions: number[] = []
  const unsubscribe = registry.subscribe(document => revisions.push(document.revision))
  await registry.create(0, { id: 'alpha', fields: { displayName: 'Alpha' } })
  await registry.clone(1, 'alpha', 'alpha-copy')
  await registry.reorder(2, ['alpha-copy', 'default', 'alpha'])
  await registry.archive(3, 'alpha')
  unsubscribe()
  assert.deepEqual(revisions, [0, 1, 2, 3, 4])
  assert.equal(registry.snapshot().profiles.find(profile => profile.id === 'alpha')?.archived, true)
  assert.equal(registry.resolve('alpha-copy').fields.displayName, 'Alpha')
  const reopened = await CompanyProfileRegistry.open({ path })
  assert.deepEqual(reopened.snapshot(), registry.snapshot())
})

test('rejects stale concurrent mutation without changing disk', async t => {
  const { directory, path, registry } = await fixture()
  t.after(() => rm(directory, { recursive: true, force: true }))
  await registry.create(0, { id: 'winner' })
  const afterWinner = await readFile(path, 'utf8')
  await assert.rejects(registry.create(0, { id: 'loser' }), RevisionConflictError)
  assert.equal(await readFile(path, 'utf8'), afterWinner)
  assert.equal(registry.snapshot().profiles.some(profile => profile.id === 'loser'), false)
})

test('rejects a non-default parent without committing', async t => {
  const { directory, path, registry } = await fixture()
  t.after(() => rm(directory, { recursive: true, force: true }))
  await registry.create(0, { id: 'a' })
  const before = await readFile(path, 'utf8')
  await assert.rejects(registry.create(1, { id: 'b', parentId: 'a' }), /only from default/)
  assert.equal(registry.snapshot().revision, 1)
  assert.equal(await readFile(path, 'utf8'), before)
})

test('rejects invalid reorder atomically', async t => {
  const { directory, path, registry } = await fixture()
  t.after(() => rm(directory, { recursive: true, force: true }))
  await registry.create(0, { id: 'a' })
  const before = await readFile(path, 'utf8')
  await assert.rejects(registry.reorder(1, ['default']), /order/)
  assert.equal(registry.snapshot().revision, 1)
  assert.equal(await readFile(path, 'utf8'), before)
})

test('contains listener failures after commit and guards profile deletion', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'company-profiles-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const errors: unknown[] = []
  const registry = await CompanyProfileRegistry.open({
    path: join(directory, 'profiles.json'),
    hasActiveSessions: id => id === 'active',
    onListenerError: error => errors.push(error),
  })
  const revisions: number[] = []
  registry.subscribe(() => { throw new Error('observer failed') })
  registry.subscribe(document => revisions.push(document.revision))
  await registry.create(0, { id: 'active' })
  await assert.rejects(registry.delete(1, 'active'), /active sessions/)
  await registry.create(1, { id: 'removable' })
  await registry.delete(2, 'removable')
  assert.deepEqual(revisions, [0, 1, 2, 3])
  assert.equal(errors.length, 4)
  assert.equal(registry.snapshot().profiles.some(profile => profile.id === 'removable'), false)
})

test('protects default profile', async t => {
  const { directory, registry } = await fixture()
  t.after(() => rm(directory, { recursive: true, force: true }))
  await assert.rejects(registry.archive(0, 'default'), /cannot be archived/)
  await assert.rejects(registry.update(0, 'default', { parentId: 'missing' }), /cannot inherit/)
})
