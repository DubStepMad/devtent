import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { resolvePath, pathExists } from "./config.js";
import { binaryName } from "./platform/binary.js";

export async function writeMariaDbIni(root: string): Promise<void> {
  const iniDir = path.join(root, "etc", "mariadb");
  await mkdir(iniDir, { recursive: true });

  const content = `[mysqld]
port=3307
datadir=data/mariadb
basedir=bin/mariadb
console
max_allowed_packet=512M
`;
  await writeFile(path.join(iniDir, "my.ini"), content, "utf-8");
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

export async function initializeMariaDb(
  root: string,
  onProgress?: (msg: string) => void
): Promise<void> {
  const log = onProgress ?? (() => {});
  if (await isMariaDbDataInitialized(root)) {
    log("MariaDB data directory already initialized");
    return;
  }

  const mysqld = await findMariaDbBinary(root, "mysqld");
  if (!mysqld) {
    throw new Error(`${binaryName("mysqld")} not found — install MariaDB via Quick Add first`);
  }

  await mkdir(resolvePath(root, "data/mariadb"), { recursive: true });
  await writeMariaDbIni(root);
  log("Initializing MariaDB data directory…");

  const { spawn } = await import("node:child_process");
  await new Promise<void>((resolve, reject) => {
    const proc = spawn(
      mysqld,
      ["--initialize-insecure", `--datadir=${path.join(root, "data", "mariadb")}`],
      { cwd: root, shell: false, windowsHide: true }
    );
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`MariaDB initialize failed (${code})`));
    });
    proc.on("error", reject);
  });
  log("MariaDB data directory ready");
}
