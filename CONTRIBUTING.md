# Contributing to DevTent

Thank you for helping build a free, open local development environment. Every contribution matters.

## Ways to contribute

### 1. Quick-add manifests

Add a YAML file to `manifests/` to let anyone install a new runtime with `devtent quick-add`.

**Windows** (filename `name.yaml` or `name.win32-x64.yaml`):

```yaml
name: php-8.4
version: "8.4.3"
description: PHP 8.4 NTS x64 for Windows
platform: win32
arch: x64
url: https://windows.php.net/downloads/releases/archives/php-8.4.3-nts-Win32-vs17-x64.zip
installPath: bin/php/php-8.4
binary: php.exe
postInstall:
  - copy: php.ini-development → php.ini
```

**macOS / Linux** — use a platform suffix so Windows and Unix can share the same logical name:

- `php-8.4.darwin-arm64.yaml`
- `php-8.4.linux-x64.yaml`

Loader preference: `name.platform-arch.yaml` → `name.platform.yaml` → `name.yaml`.

```yaml
name: php-8.4
version: "8.4.6"
description: PHP 8.4 FPM+CLI (static-php.dev) for macOS arm64
platform: darwin
arch: arm64
url: https://dl.static-php.dev/static-php-cli/common/php-8.4.6-fpm-macos-aarch64.tar.gz
installPath: bin/php/php-8.4
binary: sbin/php-fpm
downloadType: tar.gz
```

Supported `downloadType` values: `zip`, `tar.gz`, `tar.xz`, `binary` / `exe` (single file), `system` (symlink from PATH — used for nginx/redis on Unix).

### 2. Quick-app templates

Add templates under `templates/` with a `template.yaml` manifest. See `templates/laravel/` for the pattern.

### 3. Code

```bash
git clone git@github.com:DubStepMad/devtent.git
# or: git clone https://github.com/DubStepMad/devtent.git
cd devtent
npm install
npm run build
npm test
```

- `packages/core` — engine (config, services, vhosts, profiles)
- `packages/cli` — command-line interface
- `packages/desktop` — Electron tray + dashboard

Desktop development: `npm run start` (or `npm run dev`) builds once, launches Electron, then watches `packages/desktop/src` — UI edits reload the window; main/preload edits restart the app. Use `npm run start:once` for a single build-and-run with no watcher.

### 4. Issues & discussions

- **Bug reports** — include OS version, DevTent version, and steps to reproduce
- **Feature requests** — describe the workflow you need and your proposed UX
- **Manifest requests** — "Please add PHP 8.5 when released"

## Development guidelines

- **DTCL v1.0 license** — all contributions are licensed under the DevTent Community License v1.0. By contributing, you agree your work remains free, open, and cannot be sold by anyone.
- **Minimal scope** — focused PRs merge faster
- **Match existing style** — TypeScript strict mode, no unnecessary abstractions
- **Test behavior** — add tests in `packages/core` for engine logic
- **Community-first** — prefer features that help beginners and keep the stack free for everyone

## Pull request process

1. Fork the repo
2. Create a branch: `feature/quick-add-redis` or `manifest/php-8.5`
3. Run `npm run build && npm test`
4. Open a PR — GitHub will pre-fill [the PR template](.github/pull_request_template.md). Add screenshots for UI changes.

## Issue templates

When reporting bugs or requesting features, use **New issue** on GitHub and pick a template:

| Template | Auto-label |
|----------|------------|
| **Bug Report** | `bug` |
| **Feature Request** | `enhancement` |
| **Manifest / Runtime Request** | `manifest` |
| **Documentation** | `documentation` |

Questions belong in [Discussions](https://github.com/DubStepMad/devtent/discussions), not issues — use the **Questions & help** link on the issue chooser.

### Labels (maintainers & contributors)

| Label | When to use |
|-------|-------------|
| `bug` | Something isn't working |
| `enhancement` | New feature or improvement |
| `manifest` | Quick Add runtime requests or manifest PRs |
| `documentation` | Docs-only issues or PRs |
| `good first issue` | Small, well-scoped tasks for newcomers |
| `help wanted` | Maintainer would welcome a community PR |
| `question` | Needs more info from the reporter (prefer closing → Discussions) |
| `duplicate` | Already reported |
| `invalid` | Not actionable or out of scope |
| `wontfix` | Closed by decision, not oversight |

Issue templates apply the first four labels automatically. Maintainers add the rest as needed.

## Code of conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md). Be respectful — DevTent exists to lower barriers for developers. Gatekeeping has no place here.

## Questions?

Open a [GitHub Discussion](https://github.com/DubStepMad/devtent/discussions) or [issue](https://github.com/DubStepMad/devtent/issues). We're friendly.
