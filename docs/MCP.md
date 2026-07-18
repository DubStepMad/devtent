# DevTent MCP server

Use DevTent from AI agents (Cursor, Claude Code, Windsurf, and other MCP clients) the same way [Laravel Herd exposes AI integrations](https://herd.laravel.com/docs/windows/advanced-usage/ai-integrations): a **stdio** MCP server with per-project `SITE_PATH`.

## Setup

Build (or install) DevTent so `devtent mcp` is available, then register the server in your client.

### Cursor

Add to MCP settings (`.cursor/mcp.json` or Cursor Settings → MCP):

```json
{
  "mcpServers": {
    "devtent": {
      "command": "npx",
      "args": ["-y", "devtent", "mcp"],
      "env": {
        "DEVTENT_ROOT": "C:/devtent",
        "SITE_PATH": "C:/devtent/www/myapp"
      }
    }
  }
}
```

From a local checkout after `npm run build`:

```json
{
  "mcpServers": {
    "devtent": {
      "command": "node",
      "args": ["P:/Projects/devtent/packages/cli/dist/index.js", "mcp"],
      "env": {
        "DEVTENT_ROOT": "C:/devtent",
        "SITE_PATH": "C:/devtent/www/myapp"
      }
    }
  }
}
```

Or use a globally installed `devtent` binary:

```json
{
  "mcpServers": {
    "devtent": {
      "command": "devtent",
      "args": ["mcp"],
      "env": {
        "DEVTENT_ROOT": "C:/devtent",
        "SITE_PATH": "C:/devtent/www/myapp"
      }
    }
  }
}
```

### Claude Code / other clients

Same pattern: spawn `devtent mcp` (or `node …/packages/mcp/dist/index.js`) with `DEVTENT_ROOT` and optional `SITE_PATH`.

## Environment

| Variable | Purpose |
| --- | --- |
| `DEVTENT_ROOT` | Install root (same as CLI `--root`). Defaults to `C:\devtent` / `~/devtent`. |
| `SITE_PATH` | Project path for site-scoped tools and the `site_information` resource. Matched against www / parked / linked sites. |
| `DEVTENT_MANIFESTS` | Optional override for the Quick Add manifests directory. |

Use a different MCP entry (or `SITE_PATH`) per project so the agent targets the right site.

## Tools

| Tool | Description |
| --- | --- |
| `find_available_services` | Manifests, running services, DB/Redis/Mailpit connection hints |
| `install_service` | Install from a Quick Add manifest |
| `start_or_stop_service` | Start or stop one service |
| `get_all_php_versions` | Installed + available PHP versions |
| `install_php_version` | Install `php-X.Y` |
| `get_all_sites` | Sites with URL, PHP, SSL |
| `secure_or_unsecure_site` | Enable/disable local SSL (mkcert) |
| `isolate_or_unisolate_site` | Pin or clear per-site PHP |
| `run_doctor` | Environment doctor (optional safe repairs) |
| `get_laravel_env_snippet` | Laravel `.env` block (passwords redacted unless `includeSecrets`) |

## Resource & prompt

- **Resource** `site_information` (`devtent://site_information`) — current `SITE_PATH` site: URL, PHP, SSL, redacted DB hints, profile.
- **Prompt** `debug_site` — steps for dumps, doctor, and services for the current site.

## Safety

- Installs, SSL changes, and service stops require explicit tool arguments.
- DB passwords are never returned in clear text unless `includeSecrets: true`.
- Long-running share tunnels are not exposed (they would hang the MCP session).

## CLI

```bash
devtent mcp
devtent mcp --root C:/devtent
```
