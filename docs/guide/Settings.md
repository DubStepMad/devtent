# Settings

**System → Settings** is split into sections:

## General

- **Start DevTent when you log in** — tray only on boot
- **Auto-start services** when the app opens
- **Domain suffix** — `.localhost` (no admin) or `.test` (hosts file)
- **Stop services and backup MySQL before quitting**

## Folders

Shows the DevTent root path, with shortcuts to open `www/`, `logs/`, `bin/`, terminal, or change location.

## Backups

Explains automatic database backup policy. Manage and restore backups on the **[Database](Database.md)** page. You can also open the backups folder on disk.

## Transfer

- **Export / import bundle** — move projects, profiles, configs, and DB data between machines (binaries optional)
- **Import environment** — copy from Laragon or another local stack (`www/`, php.ini, databases, runtimes). Source folder is never modified.

## Updates

Check for updates, open GitHub, and **restore previous version** if an in-app update causes problems.

## Sidebar map

| Group | Pages |
| --- | --- |
| Overview | Dashboard |
| Sites | Projects, Quick App |
| Stack | Services, Database, Mail |
| Debug | Logs, Dumps |
| More | Tooling, PHP, Quick Add, Share |
| System | Doctor, Profiles, Settings |

Next: **[CLI](CLI.md)**
