# Governance

## Project Structure

**@dsh-local/company-profiles** is a plugin for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness), maintained under the [DeepSeek AI](https://github.com/deepseek-ai) organization.

## Roles

### Maintainers

Maintainers have write access to the repository and are responsible for:

- Reviewing and merging pull requests
- Triaging issues
- Releasing new versions
- Enforcing the Code of Conduct

Current maintainers are listed in the repository's GitHub team settings.

### Contributors

Anyone who submits a pull request, opens an issue, or participates in discussions is a contributor. All contributions are subject to the [Contributing Guide](./CONTRIBUTING.md) and [Code of Conduct](./CODE_OF_CONDUCT.md).

## Decision Making

- **Minor changes** (bug fixes, documentation, dependency updates): A single maintainer review and approval is sufficient.
- **Significant changes** (new features, API changes, schema changes, new dependencies): Require discussion in an issue or PR and approval from at least one maintainer.
- **Breaking changes** (schema version bumps, peer dependency range changes, removal of public API): Require discussion and consensus among maintainers.

## Releases

Releases follow [Semantic Versioning](https://semver.org/):

- **Patch**: Bug fixes, documentation updates
- **Minor**: New features, non-breaking additions
- **Major**: Breaking changes

Releases are triggered by pushing a version tag (`v*`) and automated through the CI release workflow.

## Relationship to DeepSeek Harness

This plugin depends on Harness APIs (`@deepseek-ai/dsh-*` packages) as peer dependencies. Changes to Harness may require corresponding updates here. Coordination happens through:

- Peer dependency version ranges in `package.json`
- CI testing against supported Node.js versions
- Issue tracking in this repository for plugin-specific concerns

## Amendments

This governance document may be updated by maintainers. Significant changes should be discussed in an issue before merging.
