# Database

**Stack → Database** lists databases on the active profile engine (managed MySQL / MariaDB / PostgreSQL, or an **external** NAS/remote connection configured on the profile).

## Create a database

1. Confirm the status line shows a reachable engine.
2. Enter a name and click **Create database**.
3. Or create a matching DB from a site’s **Details** drawer.

## Backups

Managed engines get:

- Automatic backup **before stop**
- **Daily** backups while DevTent is open
- **7-day** retention under `data/backups/`

On the Database page you can also run a manual backup for MySQL, MariaDB, or PostgreSQL and restore from the list.

> **Settings → Backups** explains auto-backup policy and links here — restore and engine-specific lists live on this page.

CLI:

```bash
devtent db backup
devtent db list-backups
devtent db restore <id>
# legacy aliases: mysql backup | list-backups | restore
```

Next: **[Share](Share.md)**
