# MCP / AI agents

DevTent ships a **stdio MCP server** so Cursor, Claude Code, and other agents can manage sites, PHP, services, SSL, doctor, dumps, and databases.

## Cursor example

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

Or run the bundled binary:

```bash
devtent mcp
```

## What agents can do

Typical tools include listing/opening sites, switching PHP, starting services, SSL secure/unsecure, doctor, Laravel `.env` hints, dumps, and database helpers.

Full tool list and prompts: **[docs/MCP.md](https://github.com/DubStepMad/devtent/blob/main/docs/MCP.md)** in the repository.

Back to **[Home](README.md)**
