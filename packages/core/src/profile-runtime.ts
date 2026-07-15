import path from "node:path";
import { pathExists, resolvePath } from "./config.js";
import type { Profile, QuickAddManifest } from "./types.js";
import { nodeVersionFromLegacyPath, resolveNodePaths } from "./node-runtime.js";
import {
  phpBackendKind,
  phpFastcgiBinaryRel,
  resolvePhpCgiPort,
  type PhpBackendKind,
} from "./php-ports.js";
import { binaryName, isUnix } from "./platform/binary.js";

export const DEFAULT_PHP_VERSION = "php-8.3";

export interface PhpRuntimePaths {
  phpVersion: string;
  cli: string;
  /** Windows php-cgi path (empty string on Unix). */
  cgi: string;
  /** Unix php-fpm path (empty string on Windows). */
  fpm: string;
  backend: PhpBackendKind;
  phpRc: string;
  cgiPort: number;
  procfileCommand: string;
}

export function phpVersionFromLegacyPath(phpPath?: string): string | undefined {
  if (!phpPath) return undefined;
  const normalized = phpPath.replace(/\\/g, "/");
  const match = normalized.match(/bin\/php\/(php-[\d.]+)/i);
  return match?.[1];
}

export function resolvePhpPaths(
  phpVersion: string,
  platform = process.platform
): PhpRuntimePaths {
  if (!/^php-\d+(?:\.\d+)*$/i.test(phpVersion)) {
    throw new Error(`Invalid PHP version id: ${phpVersion}`);
  }
  const base = `bin/php/${phpVersion}`;
  const cgiPort = resolvePhpCgiPort(phpVersion);
  const backend = phpBackendKind(platform);
  const cli = `${base}/${binaryName("php", platform)}`;

  if (isUnix(platform)) {
    const fpm = phpFastcgiBinaryRel(phpVersion, platform);
    const conf = `${base}/etc/php-fpm.conf`;
    return {
      phpVersion,
      cli,
      cgi: "",
      fpm,
      backend,
      phpRc: base,
      cgiPort,
      // Listen address is set in the pool config; -y points at the conf we generate on install.
      procfileCommand: `${fpm} --nodaemonize --fpm-config ${conf}`,
    };
  }

  const cgi = phpFastcgiBinaryRel(phpVersion, platform);
  return {
    phpVersion,
    cli,
    cgi,
    fpm: "",
    backend,
    phpRc: base,
    cgiPort,
    procfileCommand: `${cgi} -b 127.0.0.1:${cgiPort}`,
  };
}

export function normalizeProfile(profile: Profile): Profile {
  const phpVersion =
    profile.phpVersion ?? phpVersionFromLegacyPath(profile.php) ?? DEFAULT_PHP_VERSION;
  const paths = resolvePhpPaths(phpVersion);

  const database = profile.database ?? "mysql";
  const databaseConnection =
    database === "external" ? normalizeDatabaseConnection(profile.databaseConnection) : undefined;

  const base: Profile = {
    ...profile,
    database,
    databaseConnection,
    phpVersion,
    php: paths.cli,
  };

  if (profile.useExternalNode && !profile.nodeVersion) {
    return {
      ...base,
      nodeVersion: undefined,
      node: undefined,
      env: {
        ...profile.env,
        PHPRC: paths.phpRc,
      },
    };
  }

  const resolvedNodeVersion =
    profile.nodeVersion ?? nodeVersionFromLegacyPath(profile.node);
  const nodePaths = resolvedNodeVersion ? resolveNodePaths(resolvedNodeVersion) : null;

  return {
    ...base,
    nodeVersion: resolvedNodeVersion,
    node: nodePaths?.cli ?? profile.node,
    env: {
      ...profile.env,
      PHPRC: paths.phpRc,
    },
  };
}

function normalizeDatabaseConnection(
  conn: Profile["databaseConnection"] | undefined
): NonNullable<Profile["databaseConnection"]> {
  const engine = conn?.engine ?? "mariadb";
  const defaultPort = engine === "postgresql" ? 5432 : 3306;
  const host = (conn?.host ?? "").trim() || "127.0.0.1";
  const port =
    typeof conn?.port === "number" && Number.isFinite(conn.port) && conn.port > 0
      ? Math.floor(conn.port)
      : defaultPort;
  const user =
    (conn?.user ?? "").trim() || (engine === "postgresql" ? "postgres" : "root");
  const password = conn?.password ?? "";
  return { engine, host, port, user, password };
}

export async function isManifestInstalled(
  root: string,
  manifest: QuickAddManifest
): Promise<boolean> {
  if (manifest.binary) {
    const binaryPath = resolvePath(root, path.join(manifest.installPath, manifest.binary));
    return pathExists(binaryPath);
  }

  const installPath = resolvePath(root, manifest.installPath);
  if (!(await pathExists(installPath))) return false;

  const { readdir } = await import("node:fs/promises");
  const entries = await readdir(installPath).catch(() => []);
  return entries.length > 0;
}

export async function isPhpVersionInstalled(root: string, phpVersion: string): Promise<boolean> {
  const paths = resolvePhpPaths(phpVersion);
  if (paths.backend === "fpm") {
    if (await pathExists(resolvePath(root, paths.fpm))) return true;
  } else if (await pathExists(resolvePath(root, paths.cgi))) {
    return true;
  }
  return pathExists(resolvePath(root, paths.cli));
}

export function getPhpDisplayName(phpVersion?: string): string {
  if (!phpVersion) return "PHP";
  return `PHP ${phpVersion.replace(/^php-/, "")}`;
}

/** Ensure Unix php-fpm pool listens on the deterministic FastCGI port. */
export async function ensurePhpFpmPoolConfig(
  root: string,
  phpVersion: string
): Promise<string | null> {
  if (!isUnix()) return null;
  const paths = resolvePhpPaths(phpVersion);
  const confRel = `${paths.phpRc}/etc/php-fpm.conf`;
  const confAbs = resolvePath(root, confRel);
  const { mkdir, writeFile } = await import("node:fs/promises");
  await mkdir(path.dirname(confAbs), { recursive: true });
  const content = `[global]
error_log = logs/php-fpm-${phpVersion}.log
daemonize = no

[www]
listen = 127.0.0.1:${paths.cgiPort}
listen.allowed_clients = 127.0.0.1
user = nobody
group = nobody
pm = dynamic
pm.max_children = 10
pm.start_servers = 2
pm.min_spare_servers = 1
pm.max_spare_servers = 3
clear_env = no
`;
  await writeFile(confAbs, content, "utf-8");
  return confRel;
}
