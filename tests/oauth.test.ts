import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import type { CredentialInfo, CredentialRef, ResolvedCredential } from '@deepseek-ai/dsh-credentials'
import { OAuthVault, type OAuthCredentialStore } from '../src/oauth.ts'

class MemoryCredentials implements OAuthCredentialStore {
  readonly values = new Map<string, string>()
  async resolve(ref: CredentialRef): Promise<ResolvedCredential | undefined> {
    const value = this.values.get(ref)
    return value === undefined ? undefined : { value, source: 'memory' }
  }
  async describe(ref: CredentialRef): Promise<CredentialInfo> {
    return { configured: this.values.has(ref), source: 'memory', writable: true }
  }
  async set(ref: CredentialRef, value: string): Promise<void> { this.values.set(ref, value) }
  async unset(ref: CredentialRef): Promise<void> { this.values.delete(ref) }
}

const binding = {
  profileId: 'acme', serverId: 'jira', accountId: 'me', issuer: 'https://auth.test',
  redirectUrl: 'http://127.0.0.1/oauth/callback', browserBinding: 'browser-session',
}

async function fixture(t: Parameters<typeof test>[1] extends (...args: infer P) => unknown ? P[0] : never) {
  const directory = await mkdtemp(join(tmpdir(), 'oauth-vault-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const path = join(directory, 'oauth.json')
  const credentials = new MemoryCredentials()
  const vault = await OAuthVault.open(path, credentials, () => 1_000)
  return { path, credentials, vault }
}

test('metadata stores only refs and callback is bound, retryable, then one-time', async t => {
  const { path, vault } = await fixture(t)
  const { state } = await vault.begin(binding)
  const raw = await readFile(path, 'utf8')
  assert.doesNotMatch(raw, /access_token|refresh_token|code verifier/)
  await assert.rejects(vault.claimCallback({ ...binding, browserBinding: 'other', state }), /binding mismatch/)
  const first = await vault.claimCallback({ ...binding, state })
  await first.fail()
  const retry = await vault.claimCallback({ ...binding, state })
  await retry.complete()
  await assert.rejects(vault.claimCallback({ ...binding, state }), /invalid, expired, or consumed/)
})

test('SDK provider keeps PKCE and tokens in credential provider, not metadata', async t => {
  const { path, credentials, vault } = await fixture(t)
  await vault.begin(binding)
  const provider = vault.provider({
    ...binding,
    metadata: { redirect_uris: [binding.redirectUrl], client_name: 'DSH profiles' },
    onRedirect() {},
  })
  await provider.saveCodeVerifier('sdk-verifier')
  await provider.saveTokens({ access_token: 'secret-token', token_type: 'bearer' })
  assert.equal(await provider.codeVerifier(), 'sdk-verifier')
  assert.equal((await provider.tokens())?.access_token, 'secret-token')
  assert.equal(credentials.values.size, 2)
  assert.doesNotMatch(await readFile(path, 'utf8'), /sdk-verifier|secret-token/)
})

test('refresh cannot restore tokens after revocation', async t => {
  const { vault } = await fixture(t)
  await vault.begin(binding)
  let resolveRefresh!: (value: { access_token: string; token_type: 'bearer' }) => void
  const remote = new Promise<{ access_token: string; token_type: 'bearer' }>(resolve => { resolveRefresh = resolve })
  const refresh = vault.refreshSingleFlight(binding, () => remote)
  await vault.revoke(binding)
  resolveRefresh({ access_token: 'late', token_type: 'bearer' })
  await assert.rejects(refresh, /revoked during refresh/)
  const provider = vault.provider({
    ...binding,
    metadata: { redirect_uris: [binding.redirectUrl], client_name: 'DSH profiles' },
    onRedirect() {},
  })
  assert.equal(await provider.tokens(), undefined)
})

test('strict parser rejects malformed record contents', async t => {
  const { path, credentials } = await fixture(t)
  await BunLikeWrite(path, JSON.stringify({ schemaVersion: 1, revision: 0, records: { bad: { profileId: 7 } } }))
  await assert.rejects(OAuthVault.open(path, credentials), /invalid OAuth record/)
})

async function BunLikeWrite(path: string, value: string): Promise<void> {
  const { writeFile } = await import('node:fs/promises')
  await writeFile(path, value)
}
