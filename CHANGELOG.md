# Changelog

All notable changes to DevTent are documented in this file.

## [Unreleased]

## [1.3.0] - 2026-07-15

Feature release: multi-platform desktop, richer Database/PHP tooling, external databases, and a refreshed brand.

### Security

- **Laravel `.env` CLI** — `devtent laravel env` redacts passwords by default (`--secrets` to print them)
- **Database name sanitizer** — linear-time scrubbing (avoids polynomial ReDoS on underscore runs)

### Added

- **External profile databases** — point a profile at a NAS or remote MySQL/MariaDB/PostgreSQL (host/port/user/password); Database page lists/creates DBs without a managed local service; Laravel `.env` snippets use the remote connection
- **Database page** — list/create databases for the active engine; manual backups for managed MySQL, MariaDB, and PostgreSQL
- **PHP.ini page** — per-version extension toggles and raw `php.ini` editor
- **Site details drawer** — open/folder/PHP/SSL/share/Laravel .env/telemetry/queue & Vite workers/create matching DB from Projects
- **Dumps filters** — search, site filter, clear-by-type, install Laravel telemetry toolbar; long bodies collapse
- **Tray quick links** — Mail, Dumps, Doctor, Database; Doctor badge when health has warnings/errors
- **Broader Laravel dumps** — capture jobs, views, requests, logs, cache, and outbound HTTP via AppServiceProvider listeners (plus existing dump/query/error hooks); new Dumps filter chips
- **Named Cloudflare tunnels** — login, create, configure hostname ↔ site, start/stop (`devtent share named …` and Share page)
- **Local CA status + DNS** — Doctor shows mkcert CA trust; optional built-in DNS on port 15353 for custom TLDs (`devtent dns`); macOS `/etc/resolver` installer
- **Command palette** — `Ctrl/Cmd+K` (or `/`) with navigation, sites, and actions; topbar shortcut button; number keys `1`–`9` jump views; `R` refresh, `S` start all, `D` doctor
- **Desktop watch mode** — `npm run start` / `npm run dev` rebuilds on change (UI reload; main process restart)
- **macOS & Linux desktop** — Electron DMG/zip (arm64) and AppImage/deb (x64) via the release matrix
- **Platform adapters** — binary path helpers (`.exe` only on Windows); Unix hosts elevation (`osascript` / `pkexec` / `sudo`)
- **PHP-FPM on Unix** — per-version pools on the same FastCGI ports as Windows php-cgi; static-php.dev Quick Add manifests for darwin-arm64 / linux-x64
- **Multi-platform Quick Add** — platform-specific manifests (`name.platform-arch.yaml`); tar.gz/tar.xz extract; `downloadType: system` to link nginx/redis from PATH
- **Cross-platform updater** — picks Windows `.exe`, macOS `.dmg`/`.zip`, or Linux AppImage/`.deb` from GitHub Releases

### Changed

- **New DevTent logo** — hollow tent + `</>` mark; transparent UI badge; packaged icons from `logo-source.png`
- **Desktop UX (Yerd-inspired)** — sidebar groups for Integrations + System; first-class **Doctor**, **Mail**, **Share**, **Database**, and **PHP** pages; Overview site chips; onboarding uses `.localhost` (no hosts elevation step); clearer profiles/startup copy
- Project cards simplified to summary + Details drawer
- Comparison docs and README list DevTent as supporting Windows, macOS, and Linux
- Composer manifest is `platform: all` (phar + bat/shell wrapper)

## [1.2.2] - 2026-07-12

Quiet update indicator so you do not have to check Settings manually.

### Added

- **Update badge** — small dot on Settings / Updates, plus a topbar “Update vX” chip when a release is available
- **Tray tooltip** — mentions the available version when an update is waiting

### Changed

- Background update checks no longer open a modal; a short toast + persistent badge is enough until you choose to install

## [1.2.1] - 2026-07-12

Performance and security patch for a snappier desktop experience.

### Security

- **Shell command injection** — run tooling, MySQL, Node detection, Quick Add, and Quick App via `execFile`/`spawn` with argv arrays instead of interpolated shell strings (CodeQL `js/shell-command-constructed-from-input`)
- **PHP version ids** — reject unsafe values before building runtime paths

### Changed

- **Faster startup** — lazy-load `@devtent/core`, defer auto-start and MySQL backup, build tray animation frames on demand
- **Faster Start all** — parallel service waves and shorter startup verify instead of a fixed 600ms wait per service
- **Smarter UI refresh** — scoped `devtent:refresh` events; skip full dashboard/settings reloads on every service change
- **Hot-path caching** — mtime caches for config, profiles, and Procfile; PATH lookup cache; parallel site discovery and manifest listing
- **Logs & dumps** — single poller, skip unchanged DOM rebuilds, tail-read large dump/log files
- **Quit / stop all** — skip MySQL dump on bulk stop (daily backup still runs)
- **Installer size** — ship `en-US` Electron locales only; trim asar maps, screenshots, and duplicate assets
- **Task Manager name** — show **DevTent** instead of the long package description

## [1.2.0] - 2026-07-07

Feature release closing Yerd/Herd comparison gaps, with a redesigned desktop UI and zero-admin local domains.

### Added

- **`.localhost` domains (default)** — browsers resolve `*.localhost` without hosts-file admin; `.test` remains optional in Settings
- **Park & link sites** — serve `www/`, parked folders, or external projects (`devtent sites park|link`)
- **Per-site PHP** — separate `php-cgi` pools and per-project PHP dropdown
- **MariaDB** — Quick Add manifest and profile database option
- **Public share** — Cloudflare quick tunnel (`devtent share`, Share button in Projects)
- **Laravel live dumps** — Dumps tab; auto `dump()`/`dd()` capture; **automatic SQL query capture** for Laravel Quick App and `doctor --fix`
- **`devtent doctor --fix`** — environment health checks with safe repairs
- **Developer Tooling tab** — Composer, Node, Bun, Laravel installer; external Node manager support (nvm/fnm/Volta)
- **Laravel .env helper** — per-site snippet for DB, mail, and Redis
- **Symfony Quick App template**
- **Comparison doc** — [docs/COMPARISON.md](docs/COMPARISON.md) vs Herd, Yerd, and Lerd
- **README screenshots** — fictional demo data; `npm run screenshots -w @devtent/desktop` to regenerate
- **Quick Add grouping** — PHP, web servers, databases, cache/mail/SSL sections
- **CLI parity** — `sites`, `share`, `dumps`, `doctor`, `node use external`

### Changed

- **Desktop UI overhaul** — grouped sidebar (Overview / Sites / Developer / Config), page subtitles, project cards, tooling cards, dumps filters, share status on project cards
- **HTTPS** — auto `mkcert -install` when enabling SSL
- **Installer & SmartScreen** — clearer unsigned/open-source guidance ([docs/SIGNING.md](docs/SIGNING.md))
- **Dumps** — click file:line to open in editor (linked projects supported)

### Fixed

- Screenshot capture serves app icon correctly for README assets

## [1.1.2] - 2026-07-04

### Added

- **Start with Windows** — Settings → General checkbox to launch DevTent at login (tray only, no dashboard window on boot)
- **Auto-start services** — Settings → General checkbox to start the active profile stack when DevTent opens

### Changed

- **Settings page** — reorganized into General, Folders, Backups, Transfer, and Updates sections with side navigation

## [1.1.1] - 2026-07-04

Security patch addressing GitHub CodeQL findings.

### Security

- **Log viewer** — replace ambiguous path regexes and cap parse line length to mitigate ReDoS (CodeQL `js/polynomial-redos`)
- **SSL / mkcert** — validate domain names before spawning mkcert; run without shell interpolation (CodeQL `js/shell-command-constructed-from-input`)
- **Quick Add** — extract ZIP archives via PowerShell argument list instead of interpolated command strings
- **CI workflow** — add explicit `permissions: contents: read` (CodeQL `actions/missing-workflow-permissions`)

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
- Linux/macOS desktop builds ship via the release matrix (DMG / AppImage / deb)

[1.2.0]: https://github.com/DubStepMad/devtent/releases/tag/v1.2.0
[1.1.2]: https://github.com/DubStepMad/devtent/releases/tag/v1.1.2
[1.1.1]: https://github.com/DubStepMad/devtent/releases/tag/v1.1.1
[1.1.0]: https://github.com/DubStepMad/devtent/releases/tag/v1.1.0
[1.0.2]: https://github.com/DubStepMad/devtent/releases/tag/v1.0.2
[1.0.1]: https://github.com/DubStepMad/devtent/releases/tag/v1.0.1
[1.0.0]: https://github.com/DubStepMad/devtent/releases/tag/v1.0.0
