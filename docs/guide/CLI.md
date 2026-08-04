# CLI

Install the CLI via the desktop app, or from source with `npm run devtent -- <command>`.

## Everyday commands

```bash
devtent status                 # Running services & URLs
devtent start                  # Start profile services
devtent stop                   # Stop (backs up managed DB first)
devtent open [view]            # Open dashboard (optional view name)

devtent vhost sync             # Regenerate virtual hosts
devtent quick-app laravel blog # Scaffold a site
devtent sites php blog php-8.4 # Per-site PHP
devtent sites workers blog     # Queue / Vite / schedule

devtent doctor                 # Health check
devtent doctor --fix          # Safe repairs

devtent db backup
devtent db list-backups
devtent dumps list
devtent share myapp
```

## Profiles & stack

```bash
devtent profile list
devtent profile use laravel
devtent profile create api --redis --mailpit
devtent quick-add list
devtent quick-add php-8.4
devtent stack install          # Recommended stack
```

## Domains & SSL

```bash
devtent ssl enable myapp.localhost
devtent ssl ca                 # CA status / trust hints
devtent dns start
devtent dns install-resolver
```

Full list: see the [README CLI reference](https://github.com/DubStepMad/devtent#cli-reference).

Next: **[MCP / AI agents](MCP.md)**
