import { mkdir, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { resolvePath, pathExists } from "./config.js";
import { binaryName } from "./platform/binary.js";
import { quoteIniValue, toIniFilePath } from "./ini-file.js";

export function mariadbIniContent(root: string): string {
  const dataDir = quoteIniValue(toIniFilePath(resolvePath(root, "data/mariadb")));
  const baseDir = quoteIniValue(toIniFilePath(resolvePath(root, "bin/mariadb")));
  return `[mysqld]
port=3307
datadir=${dataDir}
basedir=${baseDir}
console
max_allowed_packet=512M
`;
}

export async function writeMariaDbIni(root: string): Promise<void> {
  const iniDir = path.join(root, "etc", "mariadb");
  await mkdir(iniDir, { recursive: true });
  await writeFile(path.join(iniDir, "my.ini"), mariadbIniContent(root), "utf-8");
}

export async function isMariaDbDataInitialized(root: string): Promise<boolean> {
  const dataDir = resolvePath(root, "data/mariadb");
  if (!(await pathExists(dataDir))) return false;
  if (await pathExists(path.join(dataDir, "ibdata1"))) return true;
  if (await pathExists(path.join(dataDir, "mysql"))) return true;
  return false;
}

async function findMariaDbBinary(root: string, name: string): Promise<string | null> {
  const file = binaryName(name);
  const candidates = [
    resolvePath(root, `bin/mariadb/bin/${file}`),
    resolvePath(root, `bin/mariadb/${file}`),
  ];
  for (const candidate of candidates) {
    if (await pathExists(candidate)) return candidate;
  }
  return null;
}

function runCommand(cwd: string, file: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(file, args, { cwd, shell: false, windowsHide: true, stdio: "pipe" });
    let stderr = "";
    proc.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `Command failed (${code}): ${file} ${args.join(" ")}`));
    });
    proc.on("error", reject);
  });
}

export async function initializeMariaDb(
  root: string,
  onProgress?: (msg: string) => void
): Promise<void> {
  const log = onProgress ?? (() => {});
  if (await isMariaDbDataInitialized(root)) {
    log("MariaDB data directory already initialized");
    return;
  }

  const mysqld =
    (await findMariaDbBinary(root, "mysqld")) ?? (await findMariaDbBinary(root, "mariadbd"));
  const installDb =
    (await findMariaDbBinary(root, "mariadb-install-db")) ??
    (await findMariaDbBinary(root, "mysql_install_db"));
  if (!mysqld && !installDb) {
    throw new Error(
      `${binaryName("mysqld")} not found — install MariaDB via Quick Add first`
    );
  }

  const dataDir = resolvePath(root, "data/mariadb");
  const baseDir = resolvePath(root, "bin/mariadb");
  const defaultsFile = path.join(root, "etc", "mariadb", "my.ini");
  await mkdir(dataDir, { recursive: true });
  await writeMariaDbIni(root);
  log("Initializing MariaDB data directory…");

  const attempts: Array<{ bin: string; args: string[] }> = [];
  if (mysqld) {
    attempts.push({
      bin: mysqld,
      args: [
        `--defaults-file=${defaultsFile}`,
        "--initialize-insecure",
        `--datadir=${dataDir}`,
        `--basedir=${baseDir}`,
      ],
    });
  }
  if (installDb) {
    attempts.push({
      bin: installDb,
      args: [`--datadir=${dataDir}`, `--basedir=${baseDir}`],
    });
  }

  let lastError: Error | null = null;
  for (const attempt of attempts) {
    try {
      await runCommand(root, attempt.bin, attempt.args);
      lastError = null;
      break;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
    }
  }
  if (lastError) {
    throw lastError;
  }
  log("MariaDB data directory ready");
}
