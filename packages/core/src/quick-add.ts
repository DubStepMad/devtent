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

export async function loadManifest(manifestsDir: string, name: string): Promise<QuickAddManifest> {
  const manifestPath = path.join(manifestsDir, `${name}.yaml`);
  if (!(await pathExists(manifestPath))) {
    throw new Error(`Manifest "${name}" not found in ${manifestsDir}`);
  }
  const raw = await readFile(manifestPath, "utf-8");
  const manifest = parseYaml(raw) as QuickAddManifest;
  validateManifestPlatform(manifest);
  return manifest;
}

export async function listManifests(manifestsDir: string): Promise<QuickAddManifest[]> {
  if (!(await pathExists(manifestsDir))) return [];

  const files = await readdir(manifestsDir);
  const manifests: QuickAddManifest[] = [];

  for (const file of files) {
    if (!file.endsWith(".yaml") && !file.endsWith(".yml")) continue;
    const raw = await readFile(path.join(manifestsDir, file), "utf-8");
    const manifest = parseYaml(raw) as QuickAddManifest;
    if (manifest.platform === "all" || manifest.platform === process.platform) {
      manifests.push(manifest);
    }
  }

  return manifests.sort((a, b) => a.name.localeCompare(b.name));
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
    manifest.downloadType ?? (manifest.url.toLowerCase().endsWith(".exe") ? "exe" : "zip");

  log(`Downloading ${manifest.name} v${manifest.version}...`);

  if (downloadType === "exe") {
    const binaryName = manifest.binary ?? path.basename(new URL(manifest.url).pathname);
    const destPath = path.join(installPath, binaryName);
    await downloadFile(manifest.url, destPath, log);
    await validateDownloadedFile(destPath, "exe");
    await verifyManifestInstall(root, manifest, installPath);
    await runPostInstall(root, installPath, manifest, log);
    log(`✓ ${manifest.name} installed to ${destPath}`);
    return installPath;
  }

  const zipPath = path.join(root, "tmp", `${manifest.name}.zip`);
  await mkdir(path.dirname(zipPath), { recursive: true });

  await downloadFile(manifest.url, zipPath, log);
  await validateDownloadedFile(zipPath, "zip");
  log(`Extracting to ${manifest.installPath}...`);
  await extractZip(zipPath, installPath, log);
  await normalizeExtractedArchive(installPath, manifest.archiveSubdir);
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
    await ensureComposerBat(installPath, log);
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

async function ensureComposerBat(installPath: string, log: (msg: string) => void): Promise<void> {
  const batPath = path.join(installPath, "composer.bat");
  const content = `@echo off
php "%~dp0composer.phar" %*
`;
  await writeFile(batPath, content, "utf-8");
  log("Created composer.bat");
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
  await runShellCommand(
    root,
    `"${initdb}" -U postgres -A trust -E UTF8 -D "${dataDir}"`,
    log
  );
}

async function runShellCommand(
  cwd: string,
  command: string,
  log: (msg: string) => void
): Promise<void> {
  log(`  $ ${command}`);
  await new Promise<void>((resolve, reject) => {
    const proc = spawn(command, [], { cwd, shell: true, stdio: "inherit" });
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
  downloadType: "zip" | "exe"
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
