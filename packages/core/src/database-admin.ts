import { spawn } from "node:child_process";
import { loadConfig, loadProfile, resolvePath, pathExists } from "./config.js";
import { isServiceRunning } from "./services.js";
import { binaryName } from "./platform/binary.js";
import type { DatabaseConnection, ExternalDatabaseEngine, Profile } from "./types.js";

export type DatabaseEngine = ExternalDatabaseEngine | "none";

export type DatabaseTargetMode = "none" | "managed" | "external";

export interface DatabaseTarget {
  mode: DatabaseTargetMode;
  /** Dialect for clients / Laravel; `"none"` only when mode is none. */
  engine: DatabaseEngine;
  host: string;
  port: number;
  user: string;
  password: string;
}

export interface DatabaseInfo {
  name: string;
}

export interface DatabaseAdminStatus {
  engine: DatabaseEngine;
  running: boolean;
  port: number | null;
  message: string;
  host?: string;
  user?: string;
  external?: boolean;
}

function managedDefaults(engine: ExternalDatabaseEngine): Omit<DatabaseTarget, "mode" | "engine"> {
  if (engine === "postgresql") {
    return { host: "127.0.0.1", port: 5432, user: "postgres", password: "" };
  }
  if (engine === "mariadb") {
    return { host: "127.0.0.1", port: 3307, user: "root", password: "" };
  }
  return { host: "127.0.0.1", port: 3306, user: "root", password: "" };
}

/** Standard ports for remote/NAS servers (MariaDB usually listens on 3306). */
function externalDefaults(engine: ExternalDatabaseEngine): Omit<DatabaseTarget, "mode" | "engine"> {
  if (engine === "postgresql") {
    return { host: "127.0.0.1", port: 5432, user: "postgres", password: "" };
  }
  return { host: "127.0.0.1", port: 3306, user: "root", password: "" };
}

export function resolveDatabaseTargetFromProfile(profile: Profile): DatabaseTarget {
  const database = profile.database ?? "none";
  if (database === "none") {
    return {
      mode: "none",
      engine: "none",
      host: "127.0.0.1",
      port: 0,
      user: "",
      password: "",
    };
  }
  if (database === "external") {
    const conn = profile.databaseConnection as DatabaseConnection | undefined;
    const engine = conn?.engine ?? "mariadb";
    const defaults = externalDefaults(engine);
    return {
      mode: "external",
      engine,
      host: (conn?.host ?? "").trim() || defaults.host,
      port:
        typeof conn?.port === "number" && Number.isFinite(conn.port) && conn.port > 0
          ? Math.floor(conn.port)
          : defaults.port,
      user: (conn?.user ?? "").trim() || defaults.user,
      password: conn?.password ?? "",
    };
  }
  const defaults = managedDefaults(database);
  return {
    mode: "managed",
    engine: database,
    ...defaults,
  };
}

export async function resolveDatabaseTarget(root: string): Promise<DatabaseTarget> {
  const config = await loadConfig(root);
  const profile = await loadProfile(root, config.activeProfile);
  return resolveDatabaseTargetFromProfile(profile);
}

function runCapture(
  file: string,
  args: string[],
  cwd: string,
  env?: NodeJS.ProcessEnv
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(file, args, {
      cwd,
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: env ? { ...process.env, ...env } : process.env,
    });
    let stdout = "";
    let stderr = "";
    proc.stdout?.on("data", (c) => {
      stdout += String(c);
    });
    proc.stderr?.on("data", (c) => {
      stderr += String(c);
    });
    proc.on("error", reject);
    proc.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

async function findMysqlFamilyBinary(
  root: string,
  engine: "mysql" | "mariadb",
  name: string
): Promise<string | null> {
  const file = binaryName(name);
  const base = engine === "mysql" ? "bin/mysql" : "bin/mariadb";
  for (const candidate of [resolvePath(root, `${base}/bin/${file}`), resolvePath(root, `${base}/${file}`)]) {
    if (await pathExists(candidate)) return candidate;
  }
  return null;
}

/** Prefer dialect-matched client; fall back to the other MySQL-family client for external hosts. */
async function findMysqlFamilyClient(
  root: string,
  engine: "mysql" | "mariadb"
): Promise<string | null> {
  const primary = await findMysqlFamilyBinary(root, engine, "mysql");
  if (primary) return primary;
  const other = engine === "mysql" ? "mariadb" : "mysql";
  return findMysqlFamilyBinary(root, other, "mysql");
}

async function findPostgresBinary(root: string, name: string): Promise<string | null> {
  const file = binaryName(name);
  for (const candidate of [
    resolvePath(root, `bin/postgresql/bin/${file}`),
    resolvePath(root, `bin/postgresql/${file}`),
  ]) {
    if (await pathExists(candidate)) return candidate;
  }
  return null;
}

function sanitizeDbName(name: string): string {
  const cleaned = name.trim().toLowerCase().replace(/[^a-z0-9_]/g, "_").replace(/^_+|_+$/g, "");
  if (!cleaned || cleaned.length > 63) {
    throw new Error("Invalid database name (use letters, numbers, underscore)");
  }
  if (!/^[a-z]/.test(cleaned)) {
    throw new Error("Database name must start with a letter");
  }
  return cleaned;
}

function mysqlAuthArgs(target: DatabaseTarget): string[] {
  const args = [`-u${target.user}`, `-P${target.port}`, `-h${target.host}`];
  if (target.password) {
    args.push(`-p${target.password}`);
  }
  return args;
}

function postgresEnv(target: DatabaseTarget): NodeJS.ProcessEnv {
  return {
    PGUSER: target.user,
    PGPASSWORD: target.password,
  };
}

async function pingDatabase(root: string, target: DatabaseTarget): Promise<{ ok: boolean; detail: string }> {
  if (target.engine === "none") {
    return { ok: false, detail: "No database engine" };
  }
  if (target.engine === "mysql" || target.engine === "mariadb") {
    const mysql = await findMysqlFamilyClient(root, target.engine);
    if (!mysql) {
      return {
        ok: false,
        detail: "MySQL/MariaDB client not found — install MySQL or MariaDB via Quick Add",
      };
    }
    const result = await runCapture(
      mysql,
      [...mysqlAuthArgs(target), "-N", "-e", "SELECT 1"],
      root
    );
    if (result.code !== 0) {
      return { ok: false, detail: result.stderr.trim() || "Connection failed" };
    }
    return { ok: true, detail: "" };
  }
  const psql = await findPostgresBinary(root, "psql");
  if (!psql) {
    return { ok: false, detail: "psql not found — install PostgreSQL via Quick Add" };
  }
  const result = await runCapture(
    psql,
    ["-U", target.user, "-h", target.host, "-p", String(target.port), "-At", "-c", "SELECT 1"],
    root,
    postgresEnv(target)
  );
  if (result.code !== 0) {
    return { ok: false, detail: result.stderr.trim() || "Connection failed" };
  }
  return { ok: true, detail: "" };
}

/** Dialect for the active profile (`external` resolves to connection.engine). */
export async function getActiveDatabaseEngine(root: string): Promise<DatabaseEngine> {
  const target = await resolveDatabaseTarget(root);
  return target.engine;
}

export async function getDatabaseAdminStatus(root: string): Promise<DatabaseAdminStatus> {
  const target = await resolveDatabaseTarget(root);
  if (target.mode === "none") {
    return {
      engine: "none",
      running: false,
      port: null,
      message:
        "No database in the active profile — pick MySQL, MariaDB, PostgreSQL, or External in Profiles",
    };
  }

  if (target.mode === "managed") {
    const serviceId = target.engine;
    const running = isServiceRunning(serviceId);
    return {
      engine: target.engine,
      running,
      port: target.port,
      host: target.host,
      user: target.user,
      external: false,
      message: running
        ? `${target.engine} is running on port ${target.port}`
        : `${target.engine} is not running — start it from Services`,
    };
  }

  const ping = await pingDatabase(root, target);
  const label = `${target.engine} at ${target.host}:${target.port}`;
  return {
    engine: target.engine,
    running: ping.ok,
    port: target.port,
    host: target.host,
    user: target.user,
    external: true,
    message: ping.ok
      ? `${label} (connected as ${target.user})`
      : `Cannot reach ${label} — ${ping.detail}`,
  };
}

export async function listDatabases(root: string): Promise<{ engine: DatabaseEngine; databases: DatabaseInfo[] }> {
  const target = await resolveDatabaseTarget(root);
  if (target.engine === "none") return { engine: "none", databases: [] };

  const status = await getDatabaseAdminStatus(root);
  if (!status.running) {
    throw new Error(status.message);
  }

  if (target.engine === "mysql" || target.engine === "mariadb") {
    const mysql = await findMysqlFamilyClient(root, target.engine);
    if (!mysql) throw new Error("MySQL/MariaDB client not found — install MySQL or MariaDB via Quick Add");
    const result = await runCapture(
      mysql,
      [...mysqlAuthArgs(target), "-N", "-e", "SHOW DATABASES"],
      root
    );
    if (result.code !== 0) {
      throw new Error(result.stderr.trim() || `Failed to list ${target.engine} databases`);
    }
    const skip = new Set(["information_schema", "performance_schema", "mysql", "sys"]);
    const databases = result.stdout
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((n) => n && !skip.has(n))
      .map((name) => ({ name }));
    return { engine: target.engine, databases };
  }

  const psql = await findPostgresBinary(root, "psql");
  if (!psql) throw new Error("psql not found — install PostgreSQL via Quick Add");
  const result = await runCapture(
    psql,
    [
      "-U",
      target.user,
      "-h",
      target.host,
      "-p",
      String(target.port),
      "-At",
      "-c",
      "SELECT datname FROM pg_database WHERE datistemplate = false",
    ],
    root,
    postgresEnv(target)
  );
  if (result.code !== 0) {
    throw new Error(result.stderr.trim() || "Failed to list PostgreSQL databases");
  }
  const databases = result.stdout
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((n) => n && n !== "postgres")
    .map((name) => ({ name }));
  return { engine: "postgresql", databases };
}

export async function createDatabase(
  root: string,
  name: string
): Promise<{ engine: DatabaseEngine; name: string; message: string }> {
  const dbName = sanitizeDbName(name);
  const target = await resolveDatabaseTarget(root);
  if (target.engine === "none") throw new Error("No database engine in active profile");

  const status = await getDatabaseAdminStatus(root);
  if (!status.running) throw new Error(status.message);

  if (target.engine === "mysql" || target.engine === "mariadb") {
    const mysql = await findMysqlFamilyClient(root, target.engine);
    if (!mysql) throw new Error("MySQL/MariaDB client not found — install MySQL or MariaDB via Quick Add");
    const sql = `CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`;
    const result = await runCapture(mysql, [...mysqlAuthArgs(target), "-e", sql], root);
    if (result.code !== 0) {
      throw new Error(result.stderr.trim() || `Failed to create database ${dbName}`);
    }
    return {
      engine: target.engine,
      name: dbName,
      message: `Created database ${dbName} on ${target.engine} (${target.host}:${target.port})`,
    };
  }

  const psql = await findPostgresBinary(root, "psql");
  if (!psql) throw new Error("psql not found");
  const exists = await runCapture(
    psql,
    [
      "-U",
      target.user,
      "-h",
      target.host,
      "-p",
      String(target.port),
      "-At",
      "-c",
      `SELECT 1 FROM pg_database WHERE datname = '${dbName}'`,
    ],
    root,
    postgresEnv(target)
  );
  if (exists.stdout.trim() === "1") {
    return { engine: "postgresql", name: dbName, message: `Database ${dbName} already exists` };
  }
  const result = await runCapture(
    psql,
    [
      "-U",
      target.user,
      "-h",
      target.host,
      "-p",
      String(target.port),
      "-c",
      `CREATE DATABASE "${dbName}"`,
    ],
    root,
    postgresEnv(target)
  );
  if (result.code !== 0) {
    throw new Error(result.stderr.trim() || `Failed to create database ${dbName}`);
  }
  return {
    engine: "postgresql",
    name: dbName,
    message: `Created database ${dbName} on ${target.host}:${target.port}`,
  };
}

/** Drop is intentionally omitted from the UI for safety; CLI can add later if needed. */
export { findMysqlFamilyBinary, findPostgresBinary, sanitizeDbName };
