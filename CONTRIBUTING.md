# Contributing to dsh-profile-plugin

Thank you for your interest in contributing! This document explains how to get started.

## Code of Conduct

This project follows the [Contributor Covenant Code of Conduct](./CODE_OF_CONDUCT.md). By participating, you agree to uphold it.

## How to Contribute

### Reporting Bugs

1. Search [existing issues](https://github.com/bloodf/dsh-profile-plugin/issues) to avoid duplicates.
2. Use the **Bug Report** issue template.
3. Include: Node.js version, Harness version, steps to reproduce, expected vs. actual behavior.

### Suggesting Features

1. Open an issue using the **Feature Request** template.
2. Describe the use case, not just the solution.

### Submitting Pull Requests

1. Fork and clone the repository.
2. Create a branch from `main`: `git checkout -b feat/my-change`.
3. Install dependencies: `pnpm install`.
4. Make your changes. Do **not** modify generated files in `lib/`.
5. Run checks:

   ```sh
   pnpm test
   pnpm build
   ```

6. Commit with a [Conventional Commit](https://www.conventionalcommits.org/) message:

   ```
   feat: add profile export support
   fix: handle concurrent archive race
   docs: update OAuth setup instructions
   ```

7. Push and open a pull request against `main`.
8. Fill out the PR template completely.

## Development Setup

```sh
git clone https://github.com/bloodf/dsh-profile-plugin.git
cd dsh-profile-plugin
pnpm install
pnpm test    # Run tests
pnpm build   # Compile TypeScript
```

### Requirements

- Node.js ^22.19.0 or >=24.0.0
- pnpm

## Style Guide

- Pure ESM (`"type": "module"`)
- Strict TypeScript — the project uses `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`
- JSX for browser components (`.tsx`), plain `React.createElement` at plugin slot-registration boundaries
- Atomic file operations for all persistent state mutations
- Optimistic concurrency (CAS revisions) for registry mutations

## Scope

This plugin is a Cordis 4 bundle patch for DeepSeek Harness. Changes must:

- Maintain backward compatibility with the profile JSON schema (`schemaVersion: 1`)
- Preserve atomic write and file-lock guarantees
- Not introduce new peer dependencies without discussion
- Include tests for new behavior

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](./LICENSE).
