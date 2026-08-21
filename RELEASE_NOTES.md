# Release Notes

## 1.0.1 — Production Release

Production multi-profile workspaces for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness), shipped as one Cordis 4 Host/client bundle.

### Highlights

- Atomic owner-only JSON profile registry with optimistic CAS revisions and change subscriptions.
- Single-parent MCP/skill/plugin capability inheritance with local enable/disable overrides.
- Immutable capability generation snapshots gating tool admission at pre-execute and execute.
- PKCE OAuth vault scoped to `(profileId, serverId, accountId)`, with timing-safe state verification, TTL expiry, single-flight refresh, and revocation generations.
- Session attention aggregation (approval, question, agent-error) per profile.
- Same-origin JSON Host API (`/company-profiles/api`) and OAuth callback route.
- React browser components (profile switcher, settings panel, attention toast) — exported but not yet wired into Harness UI slots pending stable `ProfileId` session seams.

See [CHANGELOG.md](./CHANGELOG.md) for the full itemized history.

### Known Limitations

- Session lists are not yet filtered by profile.
- Model/provider selection remains global by design.
- Legacy sessions without `header.profileId` fall back to the `'default'` profile.

## Cutting a Release

1. Update [CHANGELOG.md](./CHANGELOG.md) with the new version section.
2. Bump `version` in `package.json`.
3. Commit and push to `main`.
4. Tag the release: `git tag vX.Y.Z && git push origin vX.Y.Z`.
5. The [release workflow](./.github/workflows/release.yml) runs the frozen-lockfile install, tests, build, and `pnpm pack`, then publishes the packed tarball plus its `SHA256SUMS` as GitHub Release assets. GitHub auto-generates the release description from commits; this file supplements it with a human-curated summary and known limitations.

No package is published to the npm registry — install from the tagged tarball or a git checkout.
