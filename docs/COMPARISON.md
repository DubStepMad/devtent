# DevTent vs Laravel Herd vs Yerd vs Lerd

Feature comparison as of DevTent 2.0 (building on 1.5.x). DevTent ships desktop + CLI on **Windows, macOS (Apple Silicon + Intel), and Linux (x64 + arm64)** — portable folder layout; Unix uses PHP-FPM, Windows uses php-cgi.

| Feature | [Laravel Herd](https://herd.laravel.com/) | [Lerd](https://lerd.dev/) | [Yerd](https://yerd.app/) | **DevTent** |
| --- | :---: | :---: | :---: | :---: |
| **Free** | ✓ (Pro is paid) | ✓ | ✓ | ✓ |
| **Open source** | ✗ | ✓ | ✓ | ✓ ([DTCL v1.0](../LICENSE)) |
| **Linux support** | ✗ | ✓ | ✓ | **✓** (x64 + arm64) |
| **macOS support** | ✓ | ✓ | ✓ | **✓** (arm64 + Intel) |
| **Windows support** | ✓ | ✗ | ✗* | **✓** |
| **Automatic `*.test` domains** | ✓ | ✓ | ✓ | ✓ (`*.localhost` default — no admin; `.test` optional) |
| **HTTPS with a trusted local CA** | ✓ | ✓ | ✓ | ✓ (mkcert, auto-trust on SSL enable) |
| **Multiple PHP versions** | ✓ | ✓ | ✓ | ✓ |
| **PHP version per site** | ✓ | ✓ | ✓ | ✓ |
| **First-class CLI** | ✓ | ✓ | ✓ | ✓ |
| **Menu-bar / tray GUI** | ✓ | ✓ | ✓ | ✓ |
| **Database & cache services** | ✓ (Pro) | ✓ | ✓ | ✓ (MySQL, **MariaDB**, PostgreSQL, Redis, Memcached, **Meilisearch**, **MinIO**) |
| **Local mail capture** | ✓ (Pro) | ✓ | ✓ | ✓ (Mailpit) |
| **Laravel dump / query inspector** | ✓ (Pro) | ✓ | ✓ | ✓ (dumps + jobs/views/requests/logs/cache/HTTP) |
| **Share a site publicly (tunnel)** | ✓ | ✓ | ✓ | ✓ (quick + named cloudflared tunnels) |
| **Local DNS for custom TLDs** | ✓ | ✓ | ✓ | ✓ (built-in DNS + OS resolver on macOS/Linux/Windows) |
| **Runs rootless day-to-day** | ✓ | ✓† | ✓ | ✓‡ |
| **No Docker / Podman / containers** | ✓ | ✗ | ✓ | ✓ |
| **Lightweight (no VM, no container images)** | ✓ | ✗ | ✓ | ✓ |
| **Built-in health checks (`doctor`)** | ✗ | ✗ | ✓ | ✓ |
| **Park / link external projects** | ◐ | ◐ | ✓ | ✓ |
| **Managed dev tooling** | ◐ | ◐ | ✓ | ✓ |
| **Portable stack folder** | ◐ | ◐ | ◐ | ✓ |
| **Import from existing local stack** | ✗ | ◐ | ◐ | ✓ |
| **Automatic DB backups** | ✗ | ◐ | ◐ | ✓ (MySQL, MariaDB, PostgreSQL) |

**Legend:** ✓ supported · ✗ not supported · ◐ partial · † rootless containers · ‡ one-time admin for `.test` hosts / DNS resolver · \* Yerd targets macOS/Linux first

## DevTent-only strengths

- **Open source on Windows, macOS, and Linux** — no Pro paywall
- **Portable stack folder** — `c:\devtent` on Windows, `~/devtent` on Unix (system nginx/redis copied into the tree)
- **Local DNS for custom TLDs** — port 15353; macOS `/etc/resolver`, Linux systemd-resolved, Windows portproxy + NRPT
- **Command palette** — `Ctrl/Cmd+K` to jump views and run common actions
- **Per-site PHP** via dedicated FastCGI ports — php-cgi on Windows, php-fpm on Unix
- **Laragon / environment import** (Windows)
- **Free OSS signing path** — SignPath Foundation (optional); see [SIGNING.md](SIGNING.md)

## Using new features

| Feature | How |
| --- | --- |
| **PHP per site** | Projects → **Details** drawer → PHP dropdown (or `devtent sites php <site> <version>`) |
| **PHP.ini / extensions** | Developer → **PHP** — pick a version, toggle extensions, edit raw `php.ini` |
| **Database admin** | Developer → **Database** — list/create DBs; backup/restore via `devtent db …` |
| **Dumps** | **Dumps** tab — search + site filter; install Laravel telemetry from the toolbar |
| **Share** | **Share** page — quick or named Cloudflare tunnels |
| **Local DNS / CA** | **Doctor** — trust mkcert CA; start DNS; **Install resolver** on macOS/Linux/Windows |
| **Command palette** | `Ctrl/Cmd+K` — jump to views, open sites, run actions |
| **MariaDB** | Quick Add → MariaDB 11.4, or profile database → MariaDB |
| **Memcached** | Quick Add → Memcached; enable on the profile |
| **WordPress** | Quick App → WordPress (or `devtent quick-app wordpress myblog`) |
| **Tooling** | **Tooling** tab — Composer, Node, Bun, Laravel installer |

## Platform note

DevTent runs on **Windows 10/11**, **macOS 12+ (Apple Silicon and Intel)**, and **Linux (x64 and arm64)**. Day-to-day use stays rootless via `*.localhost`; optional `*.test` hosts updates and DNS resolver install use an elevated helper (UAC / osascript / pkexec).
