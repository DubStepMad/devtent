# Changelog

All notable changes to DevTent are documented in this file.

## [1.1.0] - 2026-07-02

Feature release: SSL workflow, health dashboard, portability, Node management, enhanced logs, and profile-driven optional services.

### Added

- **SSL workflow** — Enable HTTPS per domain from the UI; regenerates Nginx/Apache vhosts and restarts the web server; dashboard links use `https://` when a cert exists
- **Environment health dashboard** — Surfaces missing runtimes, stopped services, MySQL backup status, hosts sync, and SSL gaps with quick-fix actions
- **MySQL restore** — Restore from saved backups in Settings and via `devtent mysql restore <id>`
- **Portability** — Export/import environment bundles (www, profiles, data, configs) from Settings and CLI (`devtent export`, `devtent import-bundle`)
- **Node version management** — Install and switch Node 18/20/21/22 per profile; new **Node** sidebar tab; CLI `devtent node list|install|use`
- **Enhanced log viewer** — Search, PHP file-location parsing, auto-refresh, and open-in-editor from the Logs tab
- **Profile optional services** — Toggle Redis and Mailpit per profile; Services tab and tray show only the active profile's stack
- **Onboarding wizard** — Post-setup guided flow to create a demo project, sync vhosts, and open in browser
- **Graceful quit** — Settings toggle to stop all services when the app exits
- **CLI parity** — `devtent open`, `health`, `export`, `import-bundle`; profile `--redis` / `--mailpit`
- Quick Add manifests for Node 18, 20, and 21
- Tests for SSL, vhosts, portability, log viewer, and hosts elevation guard

### Changed

- Tray quick panel lists profile services instead of raw Procfile toggles
- Profile Procfile sync uses replace mode for optional services (no Redis/Mailpit leftovers after profile edit)
- Apache `httpd.conf` bumped to **v4** — loads `mod_ssl`, `mod_socache_shmcb`, and `Listen 443` for HTTPS vhosts

### Fixed

- **Apache SSL** — `SSLEngine` invalid command when using Apache with SSL vhosts (missing mod_ssl)
- **Test/build spam** — Windows Script Host popups during `npm test` from missing temp `devtent-elevate-hosts.vbs` files; elevation is skipped in automated test runs

## [1.0.2] - 2026-07-01

### Fixed

- **In-app updater** — recognizes GitHub release assets named `DevTent.Setup.*.exe` (electron-builder default); fixes false “Release has no Windows installer attached” on update check
- **Release builds** — pin installer `artifactName` to `DevTent Setup ${version}.exe` and broaden CI asset discovery

## [1.0.1] - 2026-07-01

Bug-fix and UX release focused on Apache, profiles, installer reliability, and the Services page.

### Added

- **Profile-driven Services page** — dropdown to switch profiles; list shows only that profile's stack; Start / Stop / Restart per service (Procfile toggles removed)
- **Profile switch warnings** — confirms before stopping services not in the new profile
- **`restartService`** API and UI action
- **Laravel-style document roots** — virtual hosts use `public/` (or Symfony `web/`) automatically, matching Laragon
- **Apache support module** — portable `httpd.conf` v3, procfile auto-repair, Windows-safe PHP-CGI proxy handler
- **Profile repair** — restores active profile from `profiles/.active` when `devtent.toml` is lost on reinstall
- **Install lock** — blocks DevTent from starting during NSIS install/update; fixes false "cannot close" and copy/delete loops
- **Hosts elevation dialog** — UAC prompt only from "Update hosts file (Admin)"; Sync Virtual Hosts no longer spams elevation
- **Portable installer update** — skips destructive legacy uninstaller; preserves `www/`, `bin/`, profiles, and Procfile
- Tests for Apache, hosts elevation, profile services, config repair, install lock, and Laragon migration guards

### Changed

- `getState()` lists virtual hosts without rewriting the hosts file on every page load
- Laragon import removed from setup wizard (Settings → Import environment only, with `explicitImport` guard)
- `switchProfile()` stops running services not in the new profile and syncs Procfile with merge/replace logic
- Setup wizard no longer re-runs on reinstall when environment data already exists

### Fixed

- **Apache** — `-d .` ServerRoot fix; PHP via `proxy:fcgi` + `ProxyFCGISetEnvIf` on Windows (no more `127.0.0.1:9000p` proxy errors)
- **Apache** — `httpd.conf` paths relative to install root (not `bin/apache/etc/...`)
- **Installer** — no longer launches DevTent via `ExecWait --quit` when the app is not running
- **Profiles** — active profile preserved across portable reinstall when marker exists
- **Procfile** — merge mode keeps existing services on update; Apache command auto-repaired on start
- **Migration** — install/setup cannot copy Laragon `www` projects without explicit Settings import

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

[1.1.0]: https://github.com/DubStepMad/devtent/releases/tag/v1.1.0
[1.0.2]: https://github.com/DubStepMad/devtent/releases/tag/v1.0.2
[1.0.1]: https://github.com/DubStepMad/devtent/releases/tag/v1.0.1
[1.0.0]: https://github.com/DubStepMad/devtent/releases/tag/v1.0.0
