# Security Policy

## Supported Versions

| Version | Supported          |
|---------|--------------------|
| 0.1.x   | :white_check_mark: |

## Reporting a Vulnerability

**Do not open a public issue for security vulnerabilities.**

Instead, please report vulnerabilities privately:

**GitHub Security Advisory:** Open a [private security advisory](https://github.com/bloodf/dsh-profile-plugin/security/advisories/new).

### What to Include

- Description of the vulnerability
- Steps to reproduce
- Impact assessment
- Suggested fix (if any)

### Response Timeline

- **Acknowledgment:** Within 3 business days
- **Initial assessment:** Within 7 business days
- **Fix or mitigation:** Depends on severity; critical issues are prioritized

## Security Design

This plugin's security architecture is documented in the [README Security Model](./README.md#security-model) section. Key properties:

- **Atomic file writes** with file-level locking prevent corruption from concurrent access
- **Optimistic CAS revisions** prevent silent overwrites
- **PKCE OAuth** with timing-safe state verification and TTL-based expiry
- **Same-origin enforcement** on all HTTP API routes
- **Credential isolation** through the Harness `CredentialProvider` — no plaintext secrets in profile data
- **Single-parent inheritance** prevents cross-profile capability leakage
- **Generation-based tool admission** with lease verification at both pre-execute and execute phases

## Scope

This policy covers the `dsh-profile-plugin` package. For vulnerabilities in DeepSeek Harness itself, refer to the [Harness security policy](https://github.com/deepseek-ai/deepseek-harness/security).
