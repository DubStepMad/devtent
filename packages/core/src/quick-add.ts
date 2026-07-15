import { readFile, writeFile, mkdir, copyFile, readdir, rename, rm } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { parse as parseYaml } from "yaml";
import { resolvePath, pathExists } from "./config.js";
import { isManifestInstalled } from "./profile-runtime.js";
import type { QuickAddManifest } from "./types.js";

export type ManifestWithStatus = QuickAddManifest & { installed: boolean };

export function validateManifestPlatform(manifest: QuickAddManifest): void {
  const platform = manifest.platform ?? "all";
  if (platform !== "all" && platform !== process.platform) {
    throw new Error(
      `Manifest "${manifest.name}" is for ${platform}, not ${process.platform}`
    );
  }

  const arch = manifest.arch ?? "all";
  if (arch !== "all" && arch !== process.arch) {
    throw new Error(`Manifest "${manifest.name}" is for ${arch}, not ${process.arch}`);
  }
}

/** Prefer name.platform-arch.yaml → name.platform.yaml → name.yaml */
export async function resolveManifestPath(
  manifestsDir: string,
  name: string,
  platform = process.platform,
  arch = process.arch
): Promise<string> {
  const candidates = [
    path.join(manifestsDir, `${name}.${platform}-${arch}.yaml`),
    path.join(manifestsDir, `${name}.${platform}.yaml`),
    path.join(manifestsDir, `${name}.yaml`),
    path.join(manifestsDir, `${name}.${platform}-${arch}.yml`),
    path.join(manifestsDir, `${name}.${platform}.yml`),
    path.join(manifestsDir, `${name}.yml`),
  ];
  for (const candidate of candidates) {
    if (await pathExists(candidate)) return candidate;
  }
  throw new Error(`Manifest "${name}" not found in ${manifestsDir}`);
}

function manifestBaseName(file: string): string {
  const base = file.replace(/\.(ya?ml)$/i, "");
  return base.replace(/\.(win32|linux|darwin)(-[a-z0-9]+)?$/i, "");
}

export async function loadManifest(manifestsDir: string, name: string): Promise<QuickAddManifest> {
  const manifestPath = await resolveManifestPath(manifestsDir, name);
  const raw = await readFile(manifestPath, "utf-8");
  const manifest = parseYaml(raw) as QuickAddManifest;
  validateManifestPlatform(manifest);
  return manifest;
}

export async function listManifests(manifestsDir: string): Promise<QuickAddManifest[]> {
  if (!(await pathExists(manifestsDir))) return [];

  const files = await readdir(manifestsDir);
  const yamlFiles = files.filter((file) => file.endsWith(".yaml") || file.endsWith(".yml"));
  const byName = new Map<string, QuickAddManifest>();

  for (const file of yamlFiles) {
    const raw = await readFile(path.join(manifestsDir, file), "utf-8");
    const manifest = parseYaml(raw) as QuickAddManifest;
    if (manifest.platform !== "all" && manifest.platform !== process.platform) continue;
    if (manifest.arch && manifest.arch !== "all" && manifest.arch !== process.arch) continue;

    const key = manifest.name || manifestBaseName(file);
    const existing = byName.get(key);
    if (!existing) {
      byName.set(key, { ...manifest, name: key });
      continue;
    }
    // Prefer more specific platform/arch matches over "all"
    const score = (m: QuickAddManifest) =>
      (m.platform === process.platform ? 2 : 0) + (m.arch === process.arch ? 1 : 0);
    if (score(manifest) >= score(existing)) {
      byName.set(key, { ...manifest, name: key });
    }
  }

  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export async function listManifestsWithStatus(
  root: string,
  manifestsDir: string
): Promise<ManifestWithStatus[]> {
  const manifests = await listManifests(manifestsDir);
  return Promise.all(
    manifests.map(async (manifest) => ({
      ...manifest,
      installed: await isManifestInstalled(root, manifest),
    }))
  );
}

export async function installFromManifest(
  root: string,
  manifest: QuickAddManifest,
  onProgress?: (msg: string) => void
): Promise<string> {
  const log = onProgress ?? (() => {});
  validateManifestPlatform(manifest);

  const installPath = resolvePath(root, manifest.installPath);
  await mkdir(installPath, { recursive: true });

  const downloadType =
    manifest.downloadType ??
    (manifest.url.toLowerCase().endsWith(".exe")
      ? "exe"
      : manifest.url.toLowerCase().endsWith(".tar.xz")
        ? "tar.xz"
        : manifest.url.toLowerCase().match(/\.tar\.gz$|\.tgz$/i)
          ? "tar.gz"
          : "zip");

  log(`Downloading ${manifest.name} v${manifest.version}...`);

  if (downloadType === "system") {
    await installSystemBinary(installPath, manifest, log);
    await verifyManifestInstall(root, manifest, installPath);
    await runPostInstall(root, installPath, manifest, log);
    log(`✓ ${manifest.name} linked from system into ${manifest.installPath}`);
    return installPath;
  }

  if (downloadType === "exe" || downloadType === "binary") {
    const binaryName = manifest.binary ?? path.basename(new URL(manifest.url).pathname);
    const destPath = path.join(installPath, binaryName);
    await downloadFile(manifest.url, destPath, log);
    await validateDownloadedFile(destPath, "binary");
    await chmodIfUnixExecutable(destPath);
    await verifyManifestInstall(root, manifest, installPath);
    await runPostInstall(root, installPath, manifest, log);
    log(`✓ ${manifest.name} installed to ${destPath}`);
    return installPath;
  }

  const ext =
    downloadType === "tar.xz" ? "tar.xz" : downloadType === "tar.gz" ? "tar.gz" : "zip";
  const archivePath = path.join(root, "tmp", `${manifest.name}.${ext}`);
  await mkdir(path.dirname(archivePath), { recursive: true });

  await downloadFile(manifest.url, archivePath, log);
  await validateDownloadedFile(archivePath, downloadType === "zip" ? "zip" : "tar");
  log(`Extracting to ${manifest.installPath}...`);
  if (downloadType === "zip") {
    await extractZip(archivePath, installPath, log);
  } else {
    await extractTar(archivePath, installPath, downloadType, log);
  }
  await normalizeExtractedArchive(installPath, manifest.archiveSubdir);
  await chmodBinariesUnder(installPath);
  await verifyManifestInstall(root, manifest, installPath);
  await runPostInstall(root, installPath, manifest, log);

  log(`✓ ${manifest.name} installed to ${manifest.installPath}`);
  return installPath;
}

async function normalizeExtractedArchive(
  installPath: string,
  archiveSubdir?: string
): Promise<void> {
  if (archiveSubdir) {
    const nested = path.join(installPath, archiveSubdir);
    if (await pathExists(nested)) {
      await hoistDirectory(nested, installPath);
      return;
    }
  }

  await flattenSingleRootDir(installPath);
}

async function hoistDirectory(from: string, to: string): Promise<void> {
  for (const entry of await readdir(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dest = path.join(to, entry.name);
    if (await pathExists(dest)) {
      await rm(dest, { recursive: true, force: true });
    }
    await rename(src, dest);
  }
  await rm(from, { recursive: true, force: true });
}

async function flattenSingleRootDir(dir: string): Promise<void> {
  let changed = true;
  while (changed) {
    changed = false;
    const entries = await readdir(dir, { withFileTypes: true });
    const dirs = entries.filter((e) => e.isDirectory());
    const files = entries.filter((e) => e.isFile());
    if (dirs.length === 1 && files.length === 0) {
      await hoistDirectory(path.join(dir, dirs[0]!.name), dir);
      changed = true;
    }
  }
}

async function runPostInstall(
  root: string,
  installPath: string,
  manifest: QuickAddManifest,
  log: (msg: string) => void
): Promise<void> {
  if (manifest.name.startsWith("postgresql")) {
    await ensurePostgresDataDir(root, installPath, log);
  }

  if (manifest.name === "composer") {
    await ensureComposerWrapper(installPath, log);
  }

  if (manifest.name.startsWith("php-") && process.platform !== "win32") {
    await ensureStaticPhpUnixLayout(installPath, manifest, log);
    const { ensurePhpFpmPoolConfig } = await import("./profile-runtime.js");
    const conf = await ensurePhpFpmPoolConfig(root, manifest.name);
    if (conf) log(`Wrote php-fpm pool config ${conf}`);
  }

  if (manifest.name === "nginx") {
    const { ensureNginxSupportFiles } = await import("./nginx-support.js");
    await ensureNginxSupportFiles(root);
    log("Synced nginx mime.types and fastcgi_params to etc/nginx/");
  }

  if (!manifest.postInstall) return;

  for (const step of manifest.postInstall) {
    if ("copy" in step) {
      const [src, dest] = step.copy.split("→").map((s) => s.trim());
      const srcPath = path.join(installPath, src);
      const destPath = path.join(installPath, dest);
      if (await pathExists(srcPath)) {
        await copyFile(srcPath, destPath);
        log(`Copied ${src} → ${dest}`);
      }
    } else if ("run" in step) {
      await runShellCommand(root, step.run, log);
    }
  }
}

async function installSystemBinary(
  installPath: string,
  manifest: QuickAddManifest,
  log: (msg: string) => void
): Promise<void> {
  const bin = manifest.binary ?? manifest.name;
  const baseName = path.basename(bin);
  const whichCmd = process.platform === "win32" ? "where.exe" : "which";
  const found = await new Promise<string | null>((resolve) => {
    const proc = spawn(whichCmd, process.platform === "win32" ? [baseName] : [baseName], {
      shell: false,
    });
    let out = "";
    proc.stdout?.on("data", (c) => {
      out += String(c);
    });
    proc.on("close", (code) => {
      if (code !== 0) return resolve(null);
      const first = out
        .split(/\r?\n/)
        .map((l) => l.trim())
        .find(Boolean);
      resolve(first ?? null);
    });
    proc.on("error", () => resolve(null));
  });

  if (!found) {
    throw new Error(
      `${baseName} not found on PATH. Install it with your package manager (e.g. brew install nginx / apt install nginx), then retry Quick Add.`
    );
  }

  const dest = path.join(installPath, baseName);
  await mkdir(installPath, { recursive: true });
  // Prefer symlink; fall back to copy
  try {
    const { symlink, unlink } = await import("node:fs/promises");
    await unlink(dest).catch(() => undefined);
    await symlink(found, dest);
    log(`Symlinked ${baseName} → ${found}`);
  } catch {
    await copyFile(found, dest);
    await chmodIfUnixExecutable(dest);
    log(`Copied ${baseName} from ${found}`);
  }
}

async function ensureComposerWrapper(installPath: string, log: (msg: string) => void): Promise<void> {
  if (process.platform === "win32") {
    const batPath = path.join(installPath, "composer.bat");
    const content = `@echo off
php "%~dp0composer.phar" %*
`;
    await writeFile(batPath, content, "utf-8");
    log("Created composer.bat");
    return;
  }

  const shPath = path.join(installPath, "composer");
  const content = `#!/bin/sh
DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
exec php "$DIR/composer.phar" "$@"
`;
  await writeFile(shPath, content, "utf-8");
  await chmodIfUnixExecutable(shPath);
  log("Created composer launcher");
}

/**
 * static-php.dev ships single-SAPI tarballs. Arrange:
 *   php (CLI, fetched as sibling -cli- URL)
 *   sbin/php-fpm (from this manifest's -fpm- archive)
 */
async function ensureStaticPhpUnixLayout(
  installPath: string,
  manifest: QuickAddManifest,
  log: (msg: string) => void
): Promise<void> {
  const { mkdir, rename, readdir } = await import("node:fs/promises");
  const sbin = path.join(installPath, "sbin");
  await mkdir(sbin, { recursive: true });

  const entries = await readdir(installPath);
  for (const name of entries) {
    if (name === "sbin" || name === "etc") continue;
    const full = path.join(installPath, name);
    if (/php-fpm/i.test(name) || name === "php-fpm") {
      const dest = path.join(sbin, "php-fpm");
      if (full !== dest) await rename(full, dest).catch(async () => {
        await copyFile(full, dest);
      });
      await chmodIfUnixExecutable(dest);
    }
  }

  const fpmPath = path.join(sbin, "php-fpm");
  if (!(await pathExists(fpmPath))) {
    // Archive may have extracted a nested folder with the binary
    const nested = path.join(installPath, "php-fpm");
    if (await pathExists(nested)) {
      await rename(nested, fpmPath);
      await chmodIfUnixExecutable(fpmPath);
    }
  }

  const cliPath = path.join(installPath, "php");
  if (!(await pathExists(cliPath)) && manifest.url.includes("-fpm-")) {
    const cliUrl = manifest.url.replace("-fpm-", "-cli-");
    log("Downloading matching PHP CLI binary…");
    const tmpCli = path.join(installPath, "_cli.tar.gz");
    await downloadFile(cliUrl, tmpCli, log);
    const tmpDir = path.join(installPath, "_cli_extract");
    await mkdir(tmpDir, { recursive: true });
    await extractTar(tmpCli, tmpDir, "tar.gz", log);
    await flattenSingleRootDir(tmpDir);
    const cliEntries = await readdir(tmpDir);
    const cliBin = cliEntries.find((e) => e === "php" || /php/i.test(e));
    if (cliBin) {
      await rename(path.join(tmpDir, cliBin), cliPath);
      await chmodIfUnixExecutable(cliPath);
    }
    await rm(tmpDir, { recursive: true, force: true });
    await rm(tmpCli, { force: true });
  }

  if (!(await pathExists(fpmPath))) {
    throw new Error("php-fpm binary missing after static-php layout");
  }
  log("Arranged PHP CLI + sbin/php-fpm layout");
}

async function ensurePostgresDataDir(
  root: string,
  installPath: string,
  log: (msg: string) => void
): Promise<void> {
  const dataDir = path.join(root, "data", "postgresql");
  const versionFile = path.join(dataDir, "PG_VERSION");
  if (await pathExists(versionFile)) {
    log("PostgreSQL data directory already initialized");
    return;
  }

  const initdb = path.join(installPath, "bin", "initdb.exe");
  if (!(await pathExists(initdb))) {
    log("initdb.exe not found — initialize data/postgresql manually after install");
    return;
  }

  await mkdir(dataDir, { recursive: true });
  log("Initializing PostgreSQL data directory…");
  log(`  $ ${initdb} -U postgres -A trust -E UTF8 -D ${dataDir}`);
  await new Promise<void>((resolve, reject) => {
    const proc = spawn(
      initdb,
      ["-U", "postgres", "-A", "trust", "-E", "UTF8", "-D", dataDir],
      { cwd: root, shell: false, windowsHide: true, stdio: "inherit" }
    );
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`initdb failed (${code})`));
    });
    proc.on("error", reject);
  });
}

async function runShellCommand(
  cwd: string,
  command: string,
  log: (msg: string) => void
): Promise<void> {
  log(`  $ ${command}`);
  const { parseProcfileCommand } = await import("./services.js");
  const { executable, args } = parseProcfileCommand(command);
  await new Promise<void>((resolve, reject) => {
    const proc = spawn(executable, args, {
      cwd,
      shell: false,
      windowsHide: true,
      stdio: "inherit",
    });
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Command failed (${code}): ${command}`));
    });
    proc.on("error", reject);
  });
}

async function downloadFile(url: string, dest: string, log: (msg: string) => void): Promise<void> {
  const response = await fetch(url, {
    headers: { "User-Agent": "DevTent/1.0 (+https://github.com/DubStepMad/devtent)" },
    redirect: "follow",
  });
  if (!response.ok) {
    throw new Error(`Download failed: ${response.status} ${response.statusText} — ${url}`);
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (/text\/html/i.test(contentType)) {
    throw new Error(
      `Download returned HTML instead of a binary archive — the URL may be outdated: ${url}`
    );
  }

  if (!response.body) {
    throw new Error("Empty response body");
  }

  const total = Number(response.headers.get("content-length") ?? 0);
  let downloaded = 0;
  const writer = createWriteStream(dest);

  const reader = response.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      writer.write(value);
      downloaded += value.length;
      if (total > 0) {
        const pct = Math.round((downloaded / total) * 100);
        log(`  ${pct}% (${formatBytes(downloaded)} / ${formatBytes(total)})`);
      }
    }
  } finally {
    writer.end();
  }

  await new Promise<void>((resolve, reject) => {
    writer.on("finish", resolve);
    writer.on("error", reject);
  });
}

async function validateDownloadedFile(
  dest: string,
  downloadType: "zip" | "exe" | "binary" | "tar"
): Promise<void> {
  const { readFile } = await import("node:fs/promises");
  const head = await readFile(dest);
  if (head.length < 4) {
    throw new Error("Downloaded file is empty or truncated.");
  }

  const prefix = head.subarray(0, Math.min(head.length, 256)).toString("utf-8").trimStart();
  if (prefix.startsWith("<!DOCTYPE") || prefix.startsWith("<html") || prefix.startsWith("<HTML")) {
    throw new Error("Downloaded file is an HTML page, not an archive — check the manifest URL.");
  }

  if (downloadType === "zip") {
    const magic = head.readUInt32LE(0);
    if (magic !== 0x04034b50 && magic !== 0x06054b50) {
      throw new Error("Downloaded file is not a valid ZIP archive.");
    }
  }

  if (downloadType === "tar") {
    // gzip magic or xz magic (fd 37 7a 58 5a 00) — loose check
    const isGzip = head[0] === 0x1f && head[1] === 0x8b;
    const isXz = head[0] === 0xfd && head[1] === 0x37 && head[2] === 0x7a;
    const isUstar = head.length > 262 && head.subarray(257, 262).toString("ascii") === "ustar";
    if (!isGzip && !isXz && !isUstar) {
      throw new Error("Downloaded file is not a recognized tar.gz / tar.xz archive.");
    }
  }
}

async function chmodIfUnixExecutable(filePath: string): Promise<void> {
  if (process.platform === "win32") return;
  const { chmod } = await import("node:fs/promises");
  await chmod(filePath, 0o755).catch(() => undefined);
}

async function chmodBinariesUnder(dir: string): Promise<void> {
  if (process.platform === "win32") return;
  const { readdir, stat } = await import("node:fs/promises");
  const walk = async (current: string): Promise<void> => {
    const entries = await readdir(current, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
        continue;
      }
      if (!entry.isFile()) continue;
      const st = await stat(full).catch(() => null);
      if (!st) continue;
      // Mark common binary locations / extensionless files as executable
      const base = entry.name;
      if (
        !base.includes(".") ||
        base.endsWith(".sh") ||
        /^(php|php-fpm|php-cgi|nginx|mysqld|mysql|redis-server|postgres|mailpit|mkcert|cloudflared|node|bun)$/i.test(
          base
        )
      ) {
        await chmodIfUnixExecutable(full);
      }
    }
  };
  await walk(dir);
}

async function extractTar(
  archivePath: string,
  dest: string,
  downloadType: "tar.gz" | "tar.xz",
  log: (msg: string) => void
): Promise<void> {
  const flags = downloadType === "tar.xz" ? "xJf" : "xzf";
  await new Promise<void>((resolve, reject) => {
    const proc = spawn("tar", [flags, archivePath, "-C", dest], { shell: false });
    proc.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`tar extract failed: ${code}`))
    );
    proc.on("error", reject);
  });
  log(`  Extracted to ${dest}`);
}

async function verifyManifestInstall(
  root: string,
  manifest: QuickAddManifest,
  installPath: string
): Promise<void> {
  if (!(await isManifestInstalled(root, manifest))) {
    throw new Error(
      `${manifest.name} extraction finished but ${manifest.binary ?? "expected files"} was not found under ${manifest.installPath}/`
    );
  }

  const { readdir } = await import("node:fs/promises");
  const entries = await readdir(installPath).catch(() => []);
  if (entries.length === 0) {
    throw new Error(`${manifest.name} install folder is empty after extraction.`);
  }
}

async function extractZip(zipPath: string, dest: string, log: (msg: string) => void): Promise<void> {
  if (process.platform === "win32") {
    await new Promise<void>((resolve, reject) => {
      const proc = spawn(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          "Expand-Archive",
          "-LiteralPath",
          zipPath,
          "-DestinationPath",
          dest,
          "-Force",
        ],
        { shell: false }
      );
      proc.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`Extract failed: ${code}`))));
      proc.on("error", reject);
    });
  } else {
    await new Promise<void>((resolve, reject) => {
      const proc = spawn("unzip", ["-o", zipPath, "-d", dest]);
      proc.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`Extract failed: ${code}`))));
      proc.on("error", reject);
    });
  }
  log(`  Extracted to ${dest}`);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

