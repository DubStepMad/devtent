import { cp, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathExists, resolvePath } from "../config.js";
import { isDevTentEnvironment } from "../environment.js";
import { generateVirtualHosts } from "../vhosts.js";

export interface LaragonInstallInfo {
  path: string;
  projectCount: number;
  phpVersions: string[];
}

export interface LaragonDatabaseInfo {
  dataDirName: string;
  engine: "mysql" | "mariadb";
  path: string;
  databases: string[];
  active: boolean;
}

export interface LaragonMigrationOptions {
  /** When set, only these www/ folder names are copied. Omit to import all projects. */
  projects?: string[];
  /** Must be true — blocks accidental import during install/setup. */
  explicitImport?: boolean;
}

export interface LaragonMigrationResult {
  laragonRoot: string;
  devtentRoot: string;
  projectsCopied: string[];
  projectsSkipped: string[];
  phpIniCopied: Array<{ version: string; from: string; to: string; note?: string }>;
  databaseDataCopied: Array<{
    from: string;
    to: string;
    databases: string[];
    note?: string;
  }>;
  binariesCopied: Array<{
    service: string;
    from: string;
    to: string;
    note?: string;
  }>;
  errors: string[];
}

const COMMON_LARAGON_PATHS = [
  "C:\\laragon",
  "D:\\laragon",
  "E:\\laragon",
  "P:\\laragon",
];

const MYSQL_SYSTEM_DBS = new Set([
  "mysql",
  "performance_schema",
  "sys",
  "#innodb_redo",
  "#innodb_temp",
]);

function expandUserPath(relative: string): string {
  const home = process.env.USERPROFILE ?? process.env.HOME ?? "";
  return path.join(home, relative);
}

function laragonCandidates(): string[] {
  const candidates = new Set<string>(COMMON_LARAGON_PATHS);

  if (process.env.LARAGON_ROOT) {
    candidates.add(process.env.LARAGON_ROOT);
  }

  candidates.add(expandUserPath("laragon"));

  if (process.platform === "win32") {
    for (const letter of "ABCDEFGHIJKLMNOPQRSTUVWXYZ") {
      candidates.add(`${letter}:\\laragon`);
    }
  }

  return [...candidates];
}

function isSystemDatabase(name: string): boolean {
  return MYSQL_SYSTEM_DBS.has(name.toLowerCase()) || name.startsWith("#");
}

function isDataDirName(name: string): boolean {
  return /^(mysql|mariadb)-/i.test(name);
}

export async function isLaragonRoot(dir: string): Promise<boolean> {
  if (!(await pathExists(dir))) return false;

  if (await isDevTentEnvironment(dir)) return false;

  const hasWww = await pathExists(path.join(dir, "www"));
  const hasLaragonExe = await pathExists(path.join(dir, "laragon.exe"));
  const hasPhpBin = await pathExists(path.join(dir, "bin", "php"));

  return hasWww && (hasLaragonExe || hasPhpBin);
}

export async function detectLaragonInstalls(excludeRoot?: string): Promise<LaragonInstallInfo[]> {
  const found: LaragonInstallInfo[] = [];
  const exclude = excludeRoot ? path.resolve(excludeRoot) : null;

  for (const candidate of laragonCandidates()) {
    if (exclude && path.resolve(candidate) === exclude) continue;
    if (!(await isLaragonRoot(candidate))) continue;

    const wwwDir = path.join(candidate, "www");
    const projects = await readdir(wwwDir, { withFileTypes: true }).catch(() => []);
    const projectCount = projects.filter((e) => e.isDirectory()).length;
    const phpVersions = await listLaragonPhpVersions(candidate);

    found.push({ path: candidate, projectCount, phpVersions });
  }

  return found;
}

async function listLaragonPhpVersions(laragonRoot: string): Promise<string[]> {
  const phpDir = path.join(laragonRoot, "bin", "php");
  if (!(await pathExists(phpDir))) return [];

  const entries = await readdir(phpDir, { withFileTypes: true });
  return entries.filter((e) => e.isDirectory()).map((e) => e.name);
}

async function listWwwProjects(laragonRoot: string): Promise<string[]> {
  const wwwDir = path.join(laragonRoot, "www");
  if (!(await pathExists(wwwDir))) return [];

  const entries = await readdir(wwwDir, { withFileTypes: true });
  return entries.filter((e) => e.isDirectory()).map((e) => e.name);
}

async function listUserDatabases(dataDir: string): Promise<string[]> {
  if (!(await pathExists(dataDir))) return [];

  const entries = await readdir(dataDir, { withFileTypes: true });
  return entries
    .filter((e) => e.isDirectory() && !isSystemDatabase(e.name))
    .map((e) => e.name)
    .sort();
}

async function detectActiveDataDirNames(laragonRoot: string): Promise<Set<string>> {
  const active = new Set<string>();
  const mysqlBin = path.join(laragonRoot, "bin", "mysql");

  if (!(await pathExists(mysqlBin))) return active;

  const folders = await readdir(mysqlBin, { withFileTypes: true });
  for (const folder of folders) {
    if (!folder.isDirectory()) continue;

    const iniPath = path.join(mysqlBin, folder.name, "my.ini");
    if (!(await pathExists(iniPath))) continue;

    const content = await readFile(iniPath, "utf-8");
    const match = content.match(/datadir\s*=\s*"?([^"\n]+)"?/i);
    if (!match?.[1]) continue;

    active.add(path.basename(match[1].replace(/\//g, path.sep)));
  }

  return active;
}

export async function listLaragonDatabaseDirs(laragonRoot: string): Promise<LaragonDatabaseInfo[]> {
  const dataRoot = path.join(laragonRoot, "data");
  if (!(await pathExists(dataRoot))) return [];

  const activeNames = await detectActiveDataDirNames(laragonRoot);
  const entries = await readdir(dataRoot, { withFileTypes: true });
  const result: LaragonDatabaseInfo[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory() || !isDataDirName(entry.name)) continue;

    const dirPath = path.join(dataRoot, entry.name);
    const databases = await listUserDatabases(dirPath);
    if (databases.length === 0 && !(await pathExists(path.join(dirPath, "mysql")))) {
      continue;
    }

    result.push({
      dataDirName: entry.name,
      engine: entry.name.toLowerCase().startsWith("mariadb") ? "mariadb" : "mysql",
      path: dirPath,
      databases,
      active: activeNames.has(entry.name),
    });
  }

  return result.sort((a, b) => {
    if (a.active !== b.active) return a.active ? -1 : 1;
    return b.databases.length - a.databases.length;
  });
}

/** Map Laragon folder e.g. php-8.3.16-Win32-... → devtent bin/php/php-8.3 */
function mapPhpFolderToDevTent(phpFolderName: string): string | null {
  const match = phpFolderName.match(/php-(\d+\.\d+)/i);
  return match ? `php-${match[1]}` : null;
}

async function findMysqlBinaryFolder(laragonRoot: string, dataDirName: string): Promise<string | null> {
  const mysqlBin = path.join(laragonRoot, "bin", "mysql");
  if (!(await pathExists(mysqlBin))) return null;

  const folders = await readdir(mysqlBin, { withFileTypes: true });
  const target = dataDirName.toLowerCase();

  for (const folder of folders) {
    if (!folder.isDirectory() || !folder.name.toLowerCase().startsWith("mysql-")) continue;

    const iniPath = path.join(mysqlBin, folder.name, "my.ini");
    if (!(await pathExists(iniPath))) continue;

    const content = await readFile(iniPath, "utf-8");
    const match = content.match(/datadir\s*=\s*"?([^"\n]+)"?/i);
    if (match?.[1] && match[1].toLowerCase().includes(target)) {
      return folder.name;
    }
  }

  const mysqlFolders = folders
    .filter((f) => f.isDirectory() && f.name.toLowerCase().startsWith("mysql-"))
    .map((f) => f.name)
    .sort()
    .reverse();

  return mysqlFolders[0] ?? null;
}

async function findMariaDbBinaryFolder(laragonRoot: string): Promise<string | null> {
  const mariaBin = path.join(laragonRoot, "bin", "mariadb");
  if (!(await pathExists(mariaBin))) return null;

  const folders = await readdir(mariaBin, { withFileTypes: true });
  const names = folders
    .filter((f) => f.isDirectory() && f.name.toLowerCase().startsWith("mariadb-"))
    .map((f) => f.name)
    .sort()
    .reverse();

  return names[0] ?? null;
}

async function findLatestNginxFolder(laragonRoot: string): Promise<string | null> {
  const nginxBin = path.join(laragonRoot, "bin", "nginx");
  if (!(await pathExists(nginxBin))) return null;

  const folders = await readdir(nginxBin, { withFileTypes: true });
  const names = folders
    .filter((f) => f.isDirectory() && f.name.toLowerCase().startsWith("nginx-"))
    .map((f) => f.name)
    .sort()
    .reverse();

  return names[0] ?? null;
}

async function devtentHasUserDatabases(devtentRoot: string): Promise<boolean> {
  const dataDir = path.join(devtentRoot, "data", "mysql");
  const databases = await listUserDatabases(dataDir);
  return databases.length > 0;
}

async function writeDevTentMysqlIni(devtentRoot: string): Promise<void> {
  const iniDir = path.join(devtentRoot, "etc", "mysql");
  await mkdir(iniDir, { recursive: true });

  const content = `[mysqld]
port=3306
datadir=data/mysql
basedir=bin/mysql
console
default_authentication_plugin=mysql_native_password
max_allowed_packet=512M
`;
  await writeFile(path.join(iniDir, "my.ini"), content, "utf-8");
}

async function copyPhpIni(
  laragonRoot: string,
  devtentRoot: string,
  phpFolderName: string,
  onProgress?: (msg: string) => void
): Promise<{ version: string; from: string; to: string; note?: string } | null> {
  const log = onProgress ?? (() => {});
  const srcIni = path.join(laragonRoot, "bin", "php", phpFolderName, "php.ini");

  if (!(await pathExists(srcIni))) {
    return null;
  }

  const archiveDir = path.join(devtentRoot, "etc", "php", "laragon-migrated", phpFolderName);
  await mkdir(archiveDir, { recursive: true });
  const archivePath = path.join(archiveDir, "php.ini");
  await cp(srcIni, archivePath);
  log(`  Archived php.ini → etc/php/laragon-migrated/${phpFolderName}/`);

  const mapped = mapPhpFolderToDevTent(phpFolderName);
  if (!mapped) {
    return {
      version: phpFolderName,
      from: srcIni,
      to: archivePath,
      note: "Archived only (could not map PHP version folder)",
    };
  }

  const targetPhpDir = path.join(devtentRoot, "bin", "php", mapped);
  if (!(await pathExists(targetPhpDir))) {
    return {
      version: phpFolderName,
      from: srcIni,
      to: archivePath,
      note: `Install ${mapped} via Quick Add, then copy from etc/php/laragon-migrated/`,
    };
  }

  const targetIni = path.join(targetPhpDir, "php.ini");
  const targetBackup = path.join(targetPhpDir, "php.ini.from-laragon");

  if (await pathExists(targetIni)) {
    await cp(srcIni, targetBackup);
    log(`  Saved php.ini.from-laragon in bin/php/${mapped}/ (existing php.ini kept)`);
    return {
      version: phpFolderName,
      from: srcIni,
      to: targetBackup,
      note: "Existing php.ini preserved; imported copy saved as php.ini.from-laragon",
    };
  }

  await cp(srcIni, targetIni);
  log(`  Copied php.ini → bin/php/${mapped}/php.ini`);
  return { version: phpFolderName, from: srcIni, to: targetIni };
}

async function importLaragonPhpRuntime(
  laragonRoot: string,
  devtentRoot: string,
  phpFolderName: string,
  onProgress?: (msg: string) => void
): Promise<{ service: string; from: string; to: string; note?: string } | null> {
  const log = onProgress ?? (() => {});
  const mapped = mapPhpFolderToDevTent(phpFolderName);
  if (!mapped) return null;

  const src = path.join(laragonRoot, "bin", "php", phpFolderName);
  const dest = path.join(devtentRoot, "bin", "php", mapped);

  if (!(await pathExists(src))) return null;
  if (await pathExists(path.join(dest, "php.exe"))) {
    return {
      service: mapped,
      from: src,
      to: dest,
      note: "Already installed — skipped",
    };
  }

  await mkdir(path.dirname(dest), { recursive: true });
  await cp(src, dest, { recursive: true });
  log(`  Imported PHP runtime → bin/php/${mapped}/`);
  return { service: mapped, from: src, to: dest };
}

async function importLaragonMysqlData(
  laragonRoot: string,
  devtentRoot: string,
  onProgress?: (msg: string) => void
): Promise<LaragonMigrationResult["databaseDataCopied"][0] | null> {
  const log = onProgress ?? (() => {});
  const dataDirs = await listLaragonDatabaseDirs(laragonRoot);
  if (dataDirs.length === 0) return null;

  const source = dataDirs[0]!;
  const dest = path.join(devtentRoot, "data", "mysql");

  if (await devtentHasUserDatabases(devtentRoot)) {
    return {
      from: source.path,
      to: dest,
      databases: source.databases,
      note: "DevTent data/mysql already has databases — skipped (delete data/mysql to re-import)",
    };
  }

  log(`  Copying ${source.engine} data (${source.dataDirName}) — ${source.databases.length} database(s)…`);
  await mkdir(dest, { recursive: true });

  const entries = await readdir(source.path, { withFileTypes: true });
  for (const entry of entries) {
    await cp(path.join(source.path, entry.name), path.join(dest, entry.name), { recursive: true });
    if (entry.isDirectory() && !isSystemDatabase(entry.name)) {
      log(`    • ${entry.name}`);
    }
  }

  await writeDevTentMysqlIni(devtentRoot);
  log(`  Wrote etc/mysql/my.ini (datadir=data/mysql)`);

  return {
    from: source.path,
    to: dest,
    databases: source.databases,
  };
}

async function importLaragonMysqlBinary(
  laragonRoot: string,
  devtentRoot: string,
  dataDirName: string,
  onProgress?: (msg: string) => void
): Promise<LaragonMigrationResult["binariesCopied"][0] | null> {
  const log = onProgress ?? (() => {});
  const dest = path.join(devtentRoot, "bin", "mysql");

  if (await pathExists(path.join(dest, "bin", "mysqld.exe"))) {
    return {
      service: "mysql",
      from: "",
      to: dest,
      note: "MySQL runtime already in DevTent — skipped",
    };
  }

  const folderName = await findMysqlBinaryFolder(laragonRoot, dataDirName);
  if (!folderName) return null;

  const src = path.join(laragonRoot, "bin", "mysql", folderName);
  await mkdir(path.dirname(dest), { recursive: true });
  await cp(src, dest, { recursive: true });
  log(`  Imported MySQL runtime (${folderName})`);

  return { service: "mysql", from: src, to: dest };
}

async function importLaragonMariaDbBinary(
  laragonRoot: string,
  devtentRoot: string,
  onProgress?: (msg: string) => void
): Promise<LaragonMigrationResult["binariesCopied"][0] | null> {
  const log = onProgress ?? (() => {});
  const dest = path.join(devtentRoot, "bin", "mysql");

  if (await pathExists(path.join(dest, "bin", "mysqld.exe"))) {
    return null;
  }

  const folderName = await findMariaDbBinaryFolder(laragonRoot);
  if (!folderName) return null;

  const src = path.join(laragonRoot, "bin", "mariadb", folderName);
  await mkdir(path.dirname(dest), { recursive: true });
  await cp(src, dest, { recursive: true });
  log(`  Imported MariaDB runtime (${folderName})`);

  return { service: "mariadb", from: src, to: dest };
}

async function importLaragonNginxBinary(
  laragonRoot: string,
  devtentRoot: string,
  onProgress?: (msg: string) => void
): Promise<LaragonMigrationResult["binariesCopied"][0] | null> {
  const log = onProgress ?? (() => {});
  const dest = path.join(devtentRoot, "bin", "nginx");

  if (await pathExists(path.join(dest, "nginx.exe"))) {
    return {
      service: "nginx",
      from: "",
      to: dest,
      note: "Nginx already in DevTent — skipped",
    };
  }

  const folderName = await findLatestNginxFolder(laragonRoot);
  if (!folderName) return null;

  const src = path.join(laragonRoot, "bin", "nginx", folderName);
  await mkdir(path.dirname(dest), { recursive: true });
  await cp(src, dest, { recursive: true });
  log(`  Imported Nginx runtime (${folderName})`);

  return { service: "nginx", from: src, to: dest };
}

export async function migrateFromLaragon(
  laragonRoot: string,
  devtentRoot: string,
  onProgress?: (msg: string, percent?: number) => void,
  options?: LaragonMigrationOptions
): Promise<LaragonMigrationResult> {
  if (!options?.explicitImport) {
    throw new Error(
      "Environment import was not started explicitly. In the app use Settings → Import environment; from the CLI use: devtent migrate import --from <path>"
    );
  }

  const report = (msg: string, percent?: number) => onProgress?.(msg, percent);
  const result: LaragonMigrationResult = {
    laragonRoot,
    devtentRoot,
    projectsCopied: [],
    projectsSkipped: [],
    phpIniCopied: [],
    databaseDataCopied: [],
    binariesCopied: [],
    errors: [],
  };

  if (!(await isLaragonRoot(laragonRoot))) {
    throw new Error(`Not a recognized environment folder: ${laragonRoot}`);
  }

  if (await isDevTentEnvironment(laragonRoot)) {
    throw new Error(
      "That folder is a DevTent install, not an import source. Reinstall into the same folder to keep your projects, or pick Laragon/XAMPP."
    );
  }

  const sourceRoot = path.resolve(laragonRoot);
  const targetRoot = path.resolve(devtentRoot);
  if (sourceRoot === targetRoot) {
    throw new Error(
      "Import source cannot be the same folder as DevTent — choose your Laragon (or other) environment folder, not your DevTent install."
    );
  }

  if (!(await pathExists(path.join(devtentRoot, "devtent.toml")))) {
    throw new Error("DevTent is not initialized at the target path. Run init first.");
  }

  const wwwDest = resolvePath(devtentRoot, "www");
  await mkdir(wwwDest, { recursive: true });

  const projects = await listWwwProjects(laragonRoot);
  const selectedProjects =
    options?.projects !== undefined ? new Set(options.projects) : null;
  const phpVersions = await listLaragonPhpVersions(laragonRoot);
  const databaseDirs = await listLaragonDatabaseDirs(laragonRoot);
  const totalSteps = Math.max(
    projects.length + phpVersions.length + databaseDirs.length + 6,
    1
  );
  let step = 0;
  const bump = (msg: string) => {
    step++;
    const pct = 45 + Math.round((step / totalSteps) * 54);
    report(msg, Math.min(pct, 99));
  };

  const importCount = selectedProjects
    ? projects.filter((name) => selectedProjects.has(name)).length
    : projects.length;
  bump(`Found ${projects.length} project(s) in www/ (${importCount} selected)`);

  for (const name of projects) {
    if (selectedProjects && !selectedProjects.has(name)) {
      bump(`Skipped project: ${name} (not selected)`);
      continue;
    }

    const src = path.join(laragonRoot, "www", name);
    const dest = path.join(wwwDest, name);

    try {
      if (await pathExists(dest)) {
        result.projectsSkipped.push(name);
        bump(`Skipped project: ${name} (already exists)`);
        continue;
      }

      await cp(src, dest, { recursive: true });
      result.projectsCopied.push(name);
      bump(`Copied project: ${name}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.errors.push(`Project ${name}: ${msg}`);
      bump(`Failed project: ${name}`);
    }
  }

  bump(`Found ${phpVersions.length} PHP version(s)`);

  for (const version of phpVersions) {
    try {
      const runtime = await importLaragonPhpRuntime(laragonRoot, devtentRoot, version, (msg) =>
        report(msg)
      );
      if (runtime) {
        result.binariesCopied.push(runtime);
        bump(`PHP runtime: ${version}`);
      }

      const copied = await copyPhpIni(laragonRoot, devtentRoot, version, (msg) => report(msg));
      if (copied) {
        result.phpIniCopied.push(copied);
        if (!runtime) bump(`PHP config: ${version}`);
      } else if (!runtime) {
        bump(`PHP config: ${version} (none found)`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.errors.push(`PHP ${version}: ${msg}`);
      bump(`PHP failed: ${version}`);
    }
  }

  if (databaseDirs.length > 0) {
    const primary = databaseDirs[0]!;
    bump(
      `Found ${primary.databases.length} database(s) in data/${primary.dataDirName}/`
    );

    try {
      report("Copying database files (stop MySQL in the source environment first)…");
      const dbCopy = await importLaragonMysqlData(laragonRoot, devtentRoot, (msg) => report(msg));
      if (dbCopy) {
        result.databaseDataCopied.push(dbCopy);
        bump(`Database data: ${dbCopy.databases.length} database(s)`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.errors.push(`Database data: ${msg}`);
      bump("Database data copy failed");
    }

    try {
      const engine = primary.engine;
      if (engine === "mariadb") {
        const maria = await importLaragonMariaDbBinary(laragonRoot, devtentRoot, (msg) =>
          report(msg)
        );
        if (maria) {
          result.binariesCopied.push(maria);
          bump("MariaDB runtime imported");
        }
      } else {
        const mysql = await importLaragonMysqlBinary(
          laragonRoot,
          devtentRoot,
          primary.dataDirName,
          (msg) => report(msg)
        );
        if (mysql) {
          result.binariesCopied.push(mysql);
          bump("MySQL runtime imported");
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.errors.push(`Database runtime: ${msg}`);
      bump("Database runtime import failed");
    }
  } else {
    bump("No MySQL/MariaDB data folders found");
  }

  try {
    const nginx = await importLaragonNginxBinary(laragonRoot, devtentRoot, (msg) => report(msg));
    if (nginx) {
      result.binariesCopied.push(nginx);
      bump("Nginx runtime imported");
    } else {
      bump("Nginx runtime not found in source environment");
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    result.errors.push(`Nginx: ${msg}`);
    bump("Nginx import failed");
  }

  const reportDir = path.join(devtentRoot, "etc", "laragon-migration");
  await mkdir(reportDir, { recursive: true });
  await writeFile(
    path.join(reportDir, "last-migration.json"),
    JSON.stringify({ ...result, migratedAt: new Date().toISOString() }, null, 2),
    "utf-8"
  );

  const dbSummary = result.databaseDataCopied
    .map((d) => `  - ${d.databases.join(", ") || "(system files)"} → data/mysql`)
    .join("\n");

  await writeFile(
    path.join(reportDir, "README.txt"),
    `DevTent Environment Import
==========================

Source folder:
  ${laragonRoot}
was NOT modified or deleted.

What was copied:
  - Projects from www/ → DevTent www/
  - php.ini files → etc/php/laragon-migrated/ (and matching bin/php/ if installed)
  - PHP/Nginx/MySQL runtimes from bin/ (when not already in DevTent)
  - Database files from data/ → DevTent data/mysql/

Projects copied: ${result.projectsCopied.length}
Projects skipped (already existed): ${result.projectsSkipped.length}
php.ini files handled: ${result.phpIniCopied.length}
Database folders copied: ${result.databaseDataCopied.length}
Runtimes imported: ${result.binariesCopied.filter((b) => !b.note?.includes("skipped")).length}

Databases:
${dbSummary || "  (none)"}

The source folder was left untouched. Remove it manually when you no longer need it.

Next steps:
  1. Open Services and enable nginx, mysql, and php in the Procfile
  2. Click Start All — your migrated databases should be available on port 3306
  3. Run "Sync Virtual Hosts" if project URLs need updating
`,
    "utf-8"
  );

  report("Syncing virtual hosts for migrated projects…", 98);
  await generateVirtualHosts(devtentRoot);

  report("Migration complete", 100);
  return result;
}

export async function previewLaragonMigration(laragonRoot: string): Promise<{
  valid: boolean;
  projects: string[];
  phpVersions: string[];
  databases: LaragonDatabaseInfo[];
}> {
  if (!(await isLaragonRoot(laragonRoot))) {
    return { valid: false, projects: [], phpVersions: [], databases: [] };
  }

  return {
    valid: true,
    projects: await listWwwProjects(laragonRoot),
    phpVersions: await listLaragonPhpVersions(laragonRoot),
    databases: await listLaragonDatabaseDirs(laragonRoot),
  };
}
