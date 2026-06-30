# Changelog

All notable changes to DevTent are documented in this file.

## [1.0.0] - 2026-06-29

First public release.

### Added

- **Recommended stack** — one-click install of PHP 8.3, Nginx, MySQL 8.4, Composer, and mkcert on first-run setup (desktop + `devtent stack install`)
- **MySQL backups** — automatic dump before MySQL stops, daily while the desktop app is open, manual backup in Settings, 7-day retention (`data/backups/mysql/`)
- **In-app updates** — check GitHub Releases, download installer, and apply updates from Settings
- **Update rollback** — automatic backup of `DevTent.exe` before updates; restore previous version from Settings
- **App diagnostics** — crash and error log at `%APPDATA%/DevTent/logs/app.log`, viewable in Dashboard → Logs
- **Profile-driven stack** — Apache / PostgreSQL profile options wired to Procfile; nginx/mysql mutual exclusion in toggles
- **Quick Add** — PHP 8.2–8.4, Nginx, Apache 2.4, MySQL 8.4, Composer, Node 22, mkcert, Redis, Mailpit, PostgreSQL 16
- Windows NSIS installer with tent icon, running-app prompt, and optional environment import
- Environment import: projects, php.ini, MySQL/MariaDB data, and PHP/Nginx/MySQL runtimes
- Desktop tray app with setup wizard, dashboard, draggable quick panel, Procfile toggles, and logs viewer
- CLI for init, services, profiles, vhosts, Quick Add, stack install, MySQL backup, environment import, and SSL
- GitHub Actions CI (build, lint, tests, CLI smoke, Electron E2E smoke) and release workflow for tagged builds
- Issue and PR templates; README screenshots
- DTCL v1.0 license, LICENSE-FAQ, CONTRIBUTING, and SECURITY policy

### Security

- IPC validation for `openExternal` (http/https/mailto only) and `openPath` (root-scoped)
- Quick Add enforces manifest `platform` / `arch` before download

### Fixed

- Installer uses forceful `taskkill /F /T` and no longer hangs when DevTent is in the tray
- App exits promptly on quit (no blocking MySQL backup during shutdown)
- Setup wizard no longer appears on reinstall/update when data already exists
- Installer welcome/finish pages explain **SmartScreen** (unsigned build)
- Hosts-file sync failures surfaced to the UI with manual instructions

### Known limitations

- Windows installer is **unsigned** — SmartScreen guidance in installer UI and [docs/SIGNING.md](docs/SIGNING.md)
- `*.test` domains use the Windows hosts file; DevTent launches an elevated CMD helper when admin is required (app does not need admin)
- Linux/macOS desktop builds are planned; CLI/core have partial non-Windows support

[1.0.0]: https://github.com/DubStepMad/devtent/releases/tag/v1.0.0
