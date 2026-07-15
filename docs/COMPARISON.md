# DevTent vs Laravel Herd vs Yerd vs Lerd

Feature comparison as of DevTent 1.3.x. DevTent started **Windows-first** and now ships desktop + CLI on Windows, macOS, and Linux (portable folder layout; Unix uses PHP-FPM, Windows uses php-cgi).

| Feature | [Laravel Herd](https://herd.laravel.com/) | [Lerd](https://lerd.dev/) | [Yerd](https://yerd.app/) | **DevTent** |
| --- | :---: | :---: | :---: | :---: |
| **Free** | ✓ (Pro is paid) | ✓ | ✓ | ✓ |
| **Open source** | ✗ | ✓ | ✓ | ✓ ([DTCL v1.0](../LICENSE)) |
| **Linux support** | ✗ | ✓ | ✓ | **✓** |
| **macOS support** | ✓ | ✓ | ✓ | **✓** |
| **Windows support** | ✓ | ✗ | ✗* | **✓** |
| **Automatic `*.test` domains** | ✓ | ✓ | ✓ | ✓ (`*.localhost` default — no admin; `.test` optional) |
| **HTTPS with a trusted local CA** | ✓ | ✓ | ✓ | ✓ (mkcert, auto-trust on SSL enable) |
| **Multiple PHP versions** | ✓ | ✓ | ✓ | ✓ |
| **PHP version per site** | ✓ | ✓ | ✓ | ✓ |
| **First-class CLI** | ✓ | ✓ | ✓ | ✓ |
| **Menu-bar / tray GUI** | ✓ | ✓ | ✓ | ✓ |
| **Database & cache services** | ✓ (Pro) | ✓ | ✓ | ✓ (MySQL, **MariaDB**, PostgreSQL, Redis) |
| **Local mail capture** | ✓ (Pro) | ✓ | ✓ | ✓ (Mailpit) |
| **Laravel dump / query inspector** | ✓ (Pro) | ✓ | ✓ | ✓ (dumps + jobs/views/requests/logs/cache/HTTP) |
| **Share a site publicly (tunnel)** | ✓ | ✓ | ✓ | ✓ (quick + named cloudflared tunnels) |
| **Local DNS for custom TLDs** | ✓ | ✓ | ✓ | ✓ (built-in DNS + hosts; mkcert CA) |
| **Runs rootless day-to-day** | ✓ | ✓† | ✓ | ✓‡ |
| **No Docker / Podman / containers** | ✓ | ✗ | ✓ | ✓ |
| **Lightweight (no VM, no container images)** | ✓ | ✗ | ✓ | ✓ |
| **Built-in health checks (`doctor`)** | ✗ | ✗ | ✓ | ✓ |
| **Park / link external projects** | ◐ | ◐ | ✓ | ✓ |
| **Managed dev tooling** | ◐ | ◐ | ✓ | ✓ |
| **Portable stack folder** | ◐ | ◐ | ◐ | ✓ |
| **Import from existing local stack** | ✗ | ◐ | ◐ | ✓ |
| **Automatic MySQL backups** | ✗ | ◐ | ◐ | ✓ |

**Legend:** ✓ supported · ✗ not supported · ◐ partial · † rootless containers · ‡ one-time admin for `.test` hosts file · \* Yerd targets macOS/Linux first

## DevTent-only strengths

- **Open source on Windows, macOS, and Linux** — no Pro paywall
- **Portable stack folder** — `c:\devtent` on Windows, `~/devtent` on Unix
- **Local DNS for custom TLDs** — built-in DNS on port 15353 for `*.test` (etc.); macOS `/etc/resolver` helper; mkcert CA status in Doctor
- **Command palette** — `Ctrl/Cmd+K` to jump views and run common actions
- **Per-site PHP** via dedicated FastCGI ports (9082, 9083, 9084…) — php-cgi on Windows, php-fpm on Unix
- **Laragon / environment import** (Windows)

## Using new features

| Feature | How |
| --- | --- |
| **PHP per site** | Projects → **Details** drawer → PHP dropdown (or `devtent sites php <site> <version>`) |
| **PHP.ini / extensions** | Developer → **PHP** — pick a version, toggle extensions, edit raw `php.ini` |
| **Database admin** | Developer → **Database** — list/create DBs; backup MySQL, MariaDB, or PostgreSQL |
| **Dumps** | **Dumps** tab — search + site filter; `dump()`/`dd()` auto-captured; install Laravel telemetry from the toolbar or site drawer for queries/jobs/views/requests/logs/cache/HTTP |
| **Share** | **Share** page — quick `trycloudflare.com` tunnels, or named Cloudflare tunnels with a stable hostname |
| **Local DNS / CA** | **Doctor** — trust mkcert CA; start built-in DNS (port 15353) for custom TLDs; optional OS resolver |
| **Command palette** | `Ctrl/Cmd+K` (topbar button or `/`) — jump to views, open sites, run common actions |
| **MariaDB** | Quick Add → MariaDB 11.4, or profile database → MariaDB |
| **Tooling** | **Tooling** tab — Composer, Node, Bun, Laravel installer |

## Platform note

DevTent runs on **Windows 10/11**, **macOS (Apple Silicon)**, and **Linux (x64)**. Day-to-day use stays rootless via `*.localhost`; optional `*.test` hosts updates use an elevated helper (UAC / osascript / pkexec). Yerd remains a strong macOS/Linux-native alternative; Herd covers macOS + Windows with a Pro tier.
