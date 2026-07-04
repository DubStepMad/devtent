# Security Policy

## Supported versions

| Version | Supported |
| ------- | --------- |
| 1.1.x   | Yes       |
| 1.0.x   | Yes       |
| < 1.0   | No        |

## Reporting a vulnerability

Please **do not** open public GitHub issues for security vulnerabilities.

Email or DM the maintainers via [GitHub Security Advisories](https://github.com/DubStepMad/devtent/security/advisories/new) or open a private report through GitHub's "Report a vulnerability" button on the repository Security tab.

Include:

- Affected version
- Steps to reproduce
- Impact assessment
- Suggested fix (if any)

We aim to acknowledge reports within **72 hours** and publish a fix or mitigation plan within **14 days** for confirmed issues.

## Threat model notes

DevTent is a **local development environment manager**. It intentionally:

- Spawns user-defined Procfile commands with `shell: true`
- Downloads and extracts third-party runtimes from official URLs in manifests
- May update the system hosts file via an elevated Windows helper when direct write is blocked (DevTent itself does not require admin)
- Copies data from user-selected environment folders during import
- Backs up MySQL with `mysqldump` when stopping the service or on schedule (desktop app)

Do not run DevTent or edit the Procfile with untrusted content on production machines.

## Hardening in v1.0

- Electron: `contextIsolation`, no `nodeIntegration`, narrow preload API
- `openExternal` limited to `http:`, `https:`, `mailto:`
- `openPath` restricted to paths under the active DevTent root
- Quick Add validates manifest platform/arch before install
