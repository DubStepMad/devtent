#!/usr/bin/env node
import { createRequire } from "node:module";
import { Command } from "commander";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  initDevTent,
  getDefaultInstallRoot,
  loadConfig,
  listProfiles,
  switchProfile,
  createProfile,
  updateProfile,
  deleteProfile,
  startAll,
  stopAll,
  getServiceStatuses,
  generateVirtualHosts,
  listManifests,
  loadManifest,
  installFromManifest,
  listTemplates,
  createFromTemplate,
  writePlainPhpProject,
  enableSsl,
  installMkcertCa,
  writePathScript,
  getState,
  getShellCommand,
  migrateFromLaragon,
  installRecommendedStack,
  backupMysql,
  listMysqlBackups,
  restoreMysql,
  exportEnvironment,
  importEnvironmentBundle,
  getEnvironmentHealth,
  listNodeVersions,
  installNodeVersion,
  applyNodeVersionToActiveProfile,
} from "@devtent/core";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../..");
const MANIFESTS_DIR = path.join(REPO_ROOT, "manifests");
const TEMPLATES_DIR = path.join(REPO_ROOT, "templates");

function resolveRoot(provided?: string): string {
  if (provided) return path.resolve(provided);
  if (process.env.DEVTENT_ROOT) return process.env.DEVTENT_ROOT;
  return getDefaultInstallRoot();
}

function log(msg: string): void {
  console.log(msg);
}

function parseProfileServices(opts: { redis?: boolean; mailpit?: boolean }) {
  if (opts.redis === undefined && opts.mailpit === undefined) return undefined;
  const services: ("redis" | "mailpit")[] = [];
  if (opts.redis) services.push("redis");
  if (opts.mailpit) services.push("mailpit");
  return services;
}

function openDesktopApp(root: string, view?: string): void {
  const candidates = [
    path.join(root, "DevTent.exe"),
    path.join(path.dirname(root), "DevTent.exe"),
    process.env.LOCALAPPDATA
      ? path.join(process.env.LOCALAPPDATA, "Programs", "DevTent", "DevTent.exe")
      : "",
  ].filter(Boolean);
  const exe = candidates.find((p) => existsSync(p));
  const args = view ? [`--open=${view}`] : [];
  if (exe) {
    spawn(exe, args, { detached: true, stdio: "ignore" }).unref();
    log(`✓ Opened DevTent${view ? ` (${view})` : ""}`);
    return;
  }
  log("DevTent.exe not found near your root folder.");
  log("Install the desktop app, or run: npm start");
}

const require = createRequire(import.meta.url);
const { version: CLI_VERSION } = require("../package.json") as { version: string };

const program = new Command();

program
  .name("devtent")
  .description("DevTent — free, open-source local dev environment")
  .version(CLI_VERSION);

program
  .command("init [path]")
  .description("Initialize a new portable DevTent instance")
  .action(async (initPath?: string) => {
    const root = path.resolve(initPath ?? getDefaultInstallRoot());
    log(`⛺ Initializing DevTent at ${root}`);
    await initDevTent(root);
    log("");
    log("✓ DevTent initialized!");
    log("");
    log("Next steps:");
    log(`  1. devtent quick-add php-8.3 --root ${root}`);
    log(`  2. devtent quick-add nginx --root ${root}`);
    log(`  3. Edit Procfile and uncomment services`);
    log(`  4. devtent start --root ${root}`);
    log("");
    log("Set DEVTENT_ROOT to avoid --root flag:");
    log(`  set DEVTENT_ROOT=${root}`);
  });

program
  .command("start [services...]")
  .description("Start all or specific services from Procfile")
  .option("-r, --root <path>", "DevTent root directory")
  .action(async (services: string[], opts: { root?: string }) => {
    const root = resolveRoot(opts.root);
    log(`Starting services in ${root}...`);
    const results = await startAll(root, services.length ? services : undefined);
    if (results.length === 0) {
      log("No services in Procfile. Uncomment services or add entries.");
      return;
    }
    for (const s of results) {
      log(`  ✓ ${s.name} (pid ${s.pid})`);
    }
  });

program
  .command("stop [services...]")
  .description("Stop running services")
  .option("-r, --root <path>", "DevTent root directory")
  .action(async (services: string[], opts: { root?: string }) => {
    const root = resolveRoot(opts.root);
    const results = await stopAll(root, services.length ? services : undefined);
    for (const s of results) {
      log(`  ${s.running ? "?" : "✓"} ${s.name} stopped`);
    }
  });

program
  .command("status")
  .description("Show running services and virtual hosts")
  .option("-r, --root <path>", "DevTent root directory")
  .action(async (opts: { root?: string }) => {
    const root = resolveRoot(opts.root);
    const config = await loadConfig(root);
    const services = getServiceStatuses();

    log(`⛺ DevTent — ${root}`);
    log(`Profile: ${config.activeProfile}`);
    log("");

    log("Services:");
    if (services.length === 0) {
      log("  (none running)");
    } else {
      for (const s of services) {
        log(`  ● ${s.name} — pid ${s.pid}`);
      }
    }

    log("");
    log("Virtual hosts:");
    const { vhosts, hosts } = await generateVirtualHosts(root);
    for (const v of vhosts) {
      log(`  http://${v.domain} → ${v.root}`);
    }
    if (hosts.updated) {
      log("");
      log("✓ Hosts file updated.");
    } else if (hosts.elevationLaunchFailed) {
      log("✗ Could not open the Administrator prompt.");
      if (hosts.message) log(`  ${hosts.message}`);
    } else if (hosts.elevationRequested) {
      log("");
      log("⚠ Approve the Administrator prompt to update your hosts file (check the taskbar if hidden).");
      if (hosts.message) log(`  ${hosts.message}`);
    } else if (hosts.requiresAdmin && !hosts.updated) {
      log("");
      log("⚠ Hosts file was not updated.");
      if (hosts.message) log(hosts.message);
    }
  });

const profileCmd = program.command("profile").description("Manage stack profiles");

profileCmd
  .command("list")
  .description("List available profiles")
  .option("-r, --root <path>", "DevTent root directory")
  .action(async (opts: { root?: string }) => {
    const root = resolveRoot(opts.root);
    const config = await loadConfig(root);
    const profiles = await listProfiles(root);
    for (const p of profiles) {
      const active = p.name === config.activeProfile ? " (active)" : "";
      const stack = [p.phpVersion, p.webServer, p.database].filter(Boolean).join(" · ");
      log(`  ${p.name}${active} — ${p.description ?? ""}${stack ? ` [${stack}]` : ""}`);
    }
  });

profileCmd
  .command("create <name>")
  .description("Create a profile")
  .option("-r, --root <path>", "DevTent root directory")
  .option("--php <version>", "PHP manifest id (e.g. php-8.4)", "php-8.3")
  .option("--web-server <server>", "nginx or apache", "nginx")
  .option("--database <db>", "mysql, postgresql, or none", "mysql")
  .option("--redis", "Include Redis in profile services")
  .option("--mailpit", "Include Mailpit in profile services")
  .option("-d, --description <text>", "Profile description")
  .action(
    async (
      name: string,
      opts: {
        root?: string;
        php?: string;
        webServer?: "nginx" | "apache";
        database?: "mysql" | "postgresql" | "none";
        description?: string;
        redis?: boolean;
        mailpit?: boolean;
      }
    ) => {
      const root = resolveRoot(opts.root);
      const profile = await createProfile(root, {
        name,
        description: opts.description,
        phpVersion: opts.php,
        webServer: opts.webServer,
        database: opts.database,
        services: parseProfileServices(opts) ?? [],
      });
      log(`✓ Created profile: ${profile.name}`);
    }
  );

profileCmd
  .command("update <name>")
  .description("Update a profile")
  .option("-r, --root <path>", "DevTent root directory")
  .option("--php <version>", "PHP manifest id (e.g. php-8.4)")
  .option("--web-server <server>", "nginx or apache")
  .option("--database <db>", "mysql, postgresql, or none")
  .option("--redis", "Include Redis in profile services")
  .option("--mailpit", "Include Mailpit in profile services")
  .option("-d, --description <text>", "Profile description")
  .action(
    async (
      name: string,
      opts: {
        root?: string;
        php?: string;
        webServer?: "nginx" | "apache";
        database?: "mysql" | "postgresql" | "none";
        description?: string;
        redis?: boolean;
        mailpit?: boolean;
      }
    ) => {
      const root = resolveRoot(opts.root);
      const patch = {
        description: opts.description,
        phpVersion: opts.php,
        webServer: opts.webServer,
        database: opts.database,
      };
      const services = parseProfileServices(opts);
      if (services !== undefined) {
        Object.assign(patch, { services });
      }
      const profile = await updateProfile(root, name, patch);
      log(`✓ Updated profile: ${profile.name}`);
    }
  );

profileCmd
  .command("delete <name>")
  .description("Delete a profile")
  .option("-r, --root <path>", "DevTent root directory")
  .action(async (name: string, opts: { root?: string }) => {
    const root = resolveRoot(opts.root);
    await deleteProfile(root, name);
    log(`✓ Deleted profile: ${name}`);
  });

profileCmd
  .command("use <name>")
  .description("Switch to a profile")
  .option("-r, --root <path>", "DevTent root directory")
  .action(async (name: string, opts: { root?: string }) => {
    const root = resolveRoot(opts.root);
    const { profile } = await switchProfile(root, name);
    log(`✓ Switched to profile: ${profile.name}`);
  });

const vhostCmd = program.command("vhost").description("Virtual host management");

vhostCmd
  .command("sync")
  .description("Regenerate virtual hosts from www/ projects")
  .option("-r, --root <path>", "DevTent root directory")
  .action(async (opts: { root?: string }) => {
    const root = resolveRoot(opts.root);
    const { vhosts, hosts } = await generateVirtualHosts(root);
    log(`✓ Synced ${vhosts.length} virtual host(s)`);
    for (const v of vhosts) {
      log(`  http://${v.domain}`);
    }
    if (hosts.updated) {
      log("");
      log("✓ Hosts file updated.");
    } else if (hosts.elevationLaunchFailed) {
      log("✗ Could not open the Administrator prompt.");
      if (hosts.message) log(`  ${hosts.message}`);
    } else if (hosts.elevationRequested) {
      log("");
      log("⚠ Approve the Administrator prompt to update your hosts file (check the taskbar if hidden).");
      if (hosts.message) log(`  ${hosts.message}`);
    } else if (hosts.requiresAdmin) {
      log("");
      log("⚠ Hosts file was not updated.");
      if (hosts.message) log(hosts.message);
    }
  });

const quickAddCmd = program.command("quick-add").description("Install runtimes from manifests");

quickAddCmd
  .command("list")
  .description("List available Quick-add manifests")
  .action(async () => {
    const manifests = await listManifests(MANIFESTS_DIR);
    for (const m of manifests) {
      log(`  ${m.name} v${m.version} — ${m.description ?? ""}`);
    }
  });

quickAddCmd
  .command("<name>")
  .description("Install a runtime from manifests/")
  .option("-r, --root <path>", "DevTent root directory")
  .action(async (name: string, opts: { root?: string }) => {
    const root = resolveRoot(opts.root);
    const manifest = await loadManifest(MANIFESTS_DIR, name);
    await installFromManifest(root, manifest, log);
  });

const quickAppCmd = program.command("quick-app").description("Scaffold projects from templates");

quickAppCmd
  .command("list")
  .description("List available templates")
  .action(async () => {
    const templates = await listTemplates(TEMPLATES_DIR);
    for (const t of templates) {
      log(`  ${t.name} — ${t.description}`);
    }
  });

quickAppCmd
  .command("<template> <name>")
  .description("Create a project from a template")
  .option("-r, --root <path>", "DevTent root directory")
  .action(async (template: string, name: string, opts: { root?: string }) => {
    const root = resolveRoot(opts.root);
    if (template === "php") {
      await writePlainPhpProject(root, name);
      log(`✓ Created plain PHP project: www/${name}`);
      log(`  Run: devtent vhost sync`);
      return;
    }
    await createFromTemplate(root, template, name, TEMPLATES_DIR, log);
  });

const sslCmd = program.command("ssl").description("SSL certificate management");

sslCmd
  .command("enable <domain>")
  .description("Generate SSL certificate with mkcert")
  .option("-r, --root <path>", "DevTent root directory")
  .action(async (domain: string, opts: { root?: string }) => {
    const root = resolveRoot(opts.root);
    const result = await enableSsl(root, domain);
    log(result.success ? `✓ ${result.message}` : `✗ ${result.message}`);
  });

sslCmd
  .command("install-ca")
  .description("Install mkcert local CA (trust in browser)")
  .option("-r, --root <path>", "DevTent root directory")
  .action(async (opts: { root?: string }) => {
    const root = resolveRoot(opts.root);
    const msg = await installMkcertCa(root);
    log(`✓ ${msg}`);
  });

program
  .command("path add")
  .description("Generate path script for DevTent binaries")
  .option("-r, --root <path>", "DevTent root directory")
  .action(async (opts: { root?: string }) => {
    const root = resolveRoot(opts.root);
    const scriptPath = await writePathScript(root);
    log(`✓ Path script written: ${scriptPath}`);
    log(`  Run it before using php/composer/node from DevTent.`);
  });

program
  .command("shell")
  .description("Open a shell with DevTent paths configured")
  .option("-r, --root <path>", "DevTent root directory")
  .action(async (opts: { root?: string }) => {
    const root = resolveRoot(opts.root);
    const cmd = await getShellCommand(root);
    log(`Run: ${cmd}`);
  });

program
  .command("open [view]")
  .description("Open the DevTent desktop app (optional view: services, settings, projects, …)")
  .option("-r, --root <path>", "DevTent root directory")
  .action((view: string | undefined, opts: { root?: string }) => {
    openDesktopApp(resolveRoot(opts.root), view);
  });

program
  .command("health")
  .description("Show environment health summary")
  .option("-r, --root <path>", "DevTent root directory")
  .action(async (opts: { root?: string }) => {
    const root = resolveRoot(opts.root);
    const items = await getEnvironmentHealth(root);
    for (const item of items) {
      const prefix = item.severity === "ok" ? "✓" : item.severity === "warn" ? "!" : "✕";
      log(`${prefix} ${item.title}${item.detail ? ` — ${item.detail}` : ""}`);
    }
  });

program
  .command("export <dest>")
  .description("Export environment bundle (www, profiles, data, configs)")
  .option("-r, --root <path>", "DevTent root directory")
  .option("--include-bin", "Include bin/ runtimes (large)")
  .action(async (dest: string, opts: { root?: string; includeBin?: boolean }) => {
    const root = resolveRoot(opts.root);
    const result = await exportEnvironment(root, path.resolve(dest), {
      includeBin: opts.includeBin,
    });
    log(`✓ Exported to ${result.destPath}`);
    log(`  Included: ${result.included.join(", ")}`);
  });

program
  .command("import-bundle <bundle>")
  .description("Import a DevTent export bundle")
  .option("-r, --root <path>", "DevTent root directory")
  .action(async (bundle: string, opts: { root?: string }) => {
    const root = resolveRoot(opts.root);
    const result = await importEnvironmentBundle(root, path.resolve(bundle));
    log(`✓ Imported: ${result.imported.join(", ")}`);
  });

program
  .command("dashboard")
  .description("Open the DevTent desktop dashboard")
  .option("-r, --root <path>", "DevTent root directory")
  .action((opts: { root?: string }) => {
    openDesktopApp(resolveRoot(opts.root));
  });

const stackCmd = program.command("stack").description("Stack presets");

const nodeCmd = program.command("node").description("Node.js version management");

nodeCmd
  .command("list")
  .description("List installable Node versions")
  .option("-r, --root <path>", "DevTent root directory")
  .action(async (opts: { root?: string }) => {
    const root = resolveRoot(opts.root);
    const versions = await listNodeVersions(root, MANIFESTS_DIR);
    for (const v of versions) {
      const flags = [v.installed ? "installed" : "not installed", v.active ? "active" : ""]
        .filter(Boolean)
        .join(", ");
      log(`  ${v.label.padEnd(16)} ${flags}`);
    }
  });

nodeCmd
  .command("install <version>")
  .description("Install a Node version (e.g. node-22)")
  .option("-r, --root <path>", "DevTent root directory")
  .action(async (version: string, opts: { root?: string }) => {
    const root = resolveRoot(opts.root);
    const installPath = await installNodeVersion(root, MANIFESTS_DIR, version, log);
    log(`✓ Installed ${version} → ${installPath}`);
  });

nodeCmd
  .command("use <version>")
  .description("Set active Node version for the current profile")
  .option("-r, --root <path>", "DevTent root directory")
  .action(async (version: string, opts: { root?: string }) => {
    const root = resolveRoot(opts.root);
    const profile = await applyNodeVersionToActiveProfile(root, version);
    log(`✓ Active profile "${profile.name}" now uses ${version}`);
  });

stackCmd
  .command("install")
  .description("Install PHP 8.3, Nginx, MySQL, mkcert and enable core services")
  .option("-r, --root <path>", "DevTent root directory")
  .action(async (opts: { root?: string }) => {
    const root = resolveRoot(opts.root);
    const configPath = path.join(root, "devtent.toml");
    const { pathExists } = await import("@devtent/core");
    if (!(await pathExists(configPath))) {
      await initDevTent(root);
    }
    const result = await installRecommendedStack(root, MANIFESTS_DIR, log);
    log("");
    log(`✓ Installed: ${result.installed.join(", ") || "(none — already present)"}`);
    if (result.skipped.length) log(`  Skipped: ${result.skipped.join(", ")}`);
    log(`✓ Services enabled: ${result.servicesEnabled.join(", ")}`);
  });

const mysqlCmd = program.command("mysql").description("MySQL utilities");

mysqlCmd
  .command("backup")
  .description("Back up all databases (MySQL must be running)")
  .option("-r, --root <path>", "DevTent root directory")
  .action(async (opts: { root?: string }) => {
    const root = resolveRoot(opts.root);
    const backup = await backupMysql(root, "manual", log);
    if (!backup) {
      log("No backup created — install MySQL and start the service first.");
      process.exitCode = 1;
      return;
    }
    log(`✓ Backup: ${backup.path}`);
  });

mysqlCmd
  .command("restore <backupId>")
  .description("Restore MySQL from a backup (MySQL must be running)")
  .option("-r, --root <path>", "DevTent root directory")
  .action(async (backupId: string, opts: { root?: string }) => {
    const root = resolveRoot(opts.root);
    const result = await restoreMysql(root, backupId, log);
    if (!result.success) {
      log(result.message);
      process.exitCode = 1;
      return;
    }
    log(`✓ ${result.message}`);
  });

mysqlCmd
  .command("list-backups")
  .description("List saved MySQL backups")
  .option("-r, --root <path>", "DevTent root directory")
  .action(async (opts: { root?: string }) => {
    const root = resolveRoot(opts.root);
    const backups = await listMysqlBackups(root);
    if (!backups.length) {
      log("No backups found.");
      return;
    }
    for (const b of backups) {
      log(`  ${b.createdAt}  ${b.reason}  ${Math.round(b.sizeBytes / 1024)} KB  ${b.id}`);
    }
  });

async function runMigrateImport(opts: {
  from: string;
  root?: string;
  projects?: string;
}): Promise<void> {
  const root = resolveRoot(opts.root);
  const configPath = path.join(root, "devtent.toml");
  const { pathExists } = await import("@devtent/core");
  if (!(await pathExists(configPath))) {
    await initDevTent(root);
  }
  const projects = opts.projects
    ?.split(",")
    .map((name) => name.trim())
    .filter(Boolean);
  const result = await migrateFromLaragon(path.resolve(opts.from), root, log, {
    explicitImport: true,
    projects,
  });
  log("");
  log(`✓ Copied ${result.projectsCopied.length} project(s)`);
  if (result.projectsSkipped.length) {
    log(`  Skipped ${result.projectsSkipped.length} (already in www/)`);
  }
  log(`✓ Handled ${result.phpIniCopied.length} php.ini file(s)`);
  log("  Source folder was NOT modified.");
  log(`  Report: ${path.join(root, "etc", "laragon-migration")}`);
}

const migrateCmd = program.command("migrate").description("Import from other local environments");

migrateCmd
  .command("import")
  .description("Import projects and config from an existing local environment folder")
  .requiredOption("--from <path>", "Environment root folder (needs www/ and bin/php)")
  .option("-r, --root <path>", "DevTent root directory")
  .option(
    "--projects <names>",
    "Comma-separated www/ folder names to import (default: all)"
  )
  .action(runMigrateImport);

migrateCmd
  .command("laragon")
  .description("Alias for migrate import (legacy)")
  .requiredOption("--from <path>", "Environment root folder")
  .option("-r, --root <path>", "DevTent root directory")
  .option(
    "--projects <names>",
    "Comma-separated www/ folder names to import (default: all)"
  )
  .action(runMigrateImport);

program.parse();
