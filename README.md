# Company Profiles

Persistent DeepSeek Harness bundle foundation for company profiles.

## Install

```sh
dsh plugin --profile web add /absolute/path/to/company-profiles
```

Package declares one Host row in `cordis.patch.yml`; Harness discovers `./client` through `dsh.client`. Data lives at `$DSH_HOME/company-profiles/profiles.json`, outside Harness installation, so supported Harness updates do not overwrite it.

## Complete now

- Atomic owner-only JSON profile registry with optimistic revisions and subscriptions.
- Default profile, create/update/clone/reorder/archive, deterministic avatar seed/color.
- Default inheritance for MCP, skill, and plugin capabilities.
- Local enabled/disabled overrides; inherited MCP definitions execute under child profile identity.
- Immutable capability generation and MCP tool-name admission helper.
- Owner-only OAuth vault keyed by profile/server/account.
- OAuth state expiry, one-time consumption, PKCE verifier, token/client persistence, refresh single-flight, revocation generation, and MCP SDK `OAuthClientProvider` adapter.
- Accessible React profile switcher and settings components exported by browser bundle.

## Compatibility and current gaps

This package is tested against Cordis 4 and MCP SDK 1.29/1.30. It fails through normal dependency resolution on unsupported installations; expand peer ranges only after testing.

Harness currently lacks released first-class company `ProfileId` session/RPC seams. Therefore Host `apply()` exposes durable registry only. Browser components are not registered into Settings/sidebar slots, session lists are not filtered, MCP connections are not mounted, OAuth callback HTTP route is not installed, skills/plugins are not dynamically reconciled, and attention toast/sound/navigation are not wired. Enabling those before authoritative session profile identity exists would create cross-company leakage risk.

Model/provider remain global by design.

## Checks

```sh
pnpm test
pnpm build
pnpm pack --pack-destination .
```
