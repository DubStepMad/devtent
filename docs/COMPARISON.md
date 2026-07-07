# DevTent vs Laravel Herd vs Yerd vs Lerd

Feature comparison as of DevTent 1.2.x. DevTent is **Windows-first by design** (like Yerd is macOS/Linux-first) — not a missing feature, a platform choice.

| Feature | [Laravel Herd](https://herd.laravel.com/) | [Lerd](https://lerd.dev/) | [Yerd](https://yerd.app/) | **DevTent** |
| --- | :---: | :---: | :---: | :---: |
| **Free** | ✓ (Pro is paid) | ✓ | ✓ | ✓ |
| **Open source** | ✗ | ✓ | ✓ | ✓ ([DTCL v1.0](../LICENSE)) |
| **Linux support** | ✗ | ✓ | ✓ | ✗ (Windows focus) |
| **macOS support** | ✓ | ✓ | ✓ | ✗ (Windows focus) |
| **Windows support** | ✓ | ✗ | ✗* | **✓** |
| **Automatic `*.test` domains** | ✓ | ✓ | ✓ | ✓ (`*.localhost` default — no admin; `.test` optional) |
| **HTTPS with a trusted local CA** | ✓ | ✓ | ✓ | ✓ (mkcert, auto-trust on SSL enable) |
| **Multiple PHP versions** | ✓ | ✓ | ✓ | ✓ |
| **PHP version per site** | ✓ | ✓ | ✓ | ✓ |
| **First-class CLI** | ✓ | ✓ | ✓ | ✓ |
| **Menu-bar / tray GUI** | ✓ | ✓ | ✓ | ✓ |
| **Database & cache services** | ✓ (Pro) | ✓ | ✓ | ✓ (MySQL, **MariaDB**, PostgreSQL, Redis) |
| **Local mail capture** | ✓ (Pro) | ✓ | ✓ | ✓ (Mailpit) |
| **Laravel dump / query inspector** | ✓ (Pro) | ✓ | ✓ | ✓ (Dumps tab + `dump()` / queries) |
| **Share a site publicly (tunnel)** | ✓ | ✗ | ✓ | ✓ (cloudflared quick tunnel) |
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

- **Windows-native, open source, no Pro paywall**
- **Portable `c:\devtent` folder** — move, zip, restore
- **`devtent doctor --fix`** with safe repairs
- **Per-site PHP** via dedicated `php-cgi` ports (9082, 9083, 9084…)
- **Laragon / environment import**

## Using new features

| Feature | How |
| --- | --- |
| **PHP per site** | Projects tab → PHP dropdown per site (or `devtent sites php <site> <version>`) |
| **Dumps** | **Dumps** tab — `dump()` / `dd()` auto-captured; add query snippet from Laravel .env helper |
| **Share** | **Share** on any project → public `trycloudflare.com` URL (installs cloudflared on first use) |
| **MariaDB** | Quick Add → MariaDB 11.4, or profile database → MariaDB |
| **Tooling** | **Tooling** tab — Composer, Node, Bun, Laravel installer |

## Platform note

DevTent intentionally targets **Windows 10/11**. Yerd targets macOS/Linux. Herd covers macOS + Windows. Pick the tool that matches your OS; cross-platform parity is not the goal for v1.
