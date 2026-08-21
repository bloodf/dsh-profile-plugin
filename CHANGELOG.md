# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2025-08-20

### Added

- Atomic owner-only JSON profile registry with optimistic CAS revisions and subscriptions.
- Default profile with create, update, clone, reorder, and archive operations.
- Deterministic avatar seed and color generation from profile ID.
- Single-parent capability inheritance model (MCP, skill, plugin).
- Local enabled/disabled overrides with inherited MCP definitions executing under child profile identity.
- Immutable capability generation snapshots with lease-based tool admission.
- Owner-only OAuth vault keyed by `(profileId, serverId, accountId)`.
- OAuth state expiry, one-time consumption, PKCE verifier, token/client persistence, refresh single-flight, and revocation generation.
- MCP SDK `OAuthClientProvider` adapter.
- Profile-scoped session attention aggregation (approval, question, agent-error).
- Same-origin JSON Host API with capability CRUD and OAuth endpoints.
- Accessible React profile switcher and settings components (browser bundle).
- Cordis tool-policy hooks for pre-execute and execute admission.

[Unreleased]: https://github.com/deepseek-ai/plugins/compare/company-profiles-v0.1.0...HEAD
[0.1.0]: https://github.com/deepseek-ai/plugins/releases/tag/company-profiles-v0.1.0
