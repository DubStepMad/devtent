import { cp, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathExists, resolvePath } from "./config.js";

export interface ExportEnvironmentOptions {
  /** Include bin/ runtimes (large). Default false. */
  includeBin?: boolean;
  includeData?: boolean;
}

export interface ExportEnvironmentResult {
  destPath: string;
  included: string[];
  manifestPath: string;
}

export interface ImportEnvironmentResult {
  imported: string[];
  manifestPath: string;
}

const EXPORT_DIRS = ["www", "profiles", "etc", "logs"] as const;
const EXPORT_FILES = ["devtent.toml", "Procfile"] as const;

async function copyTree(src: string, dest: string): Promise<void> {
  await mkdir(dest, { recursive: true });
  const entries = await readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyTree(from, to);
    } else if (entry.isFile()) {
      await cp(from, to);
    }
  }
}

export async function exportEnvironment(
  root: string,
  destPath: string,
  options?: ExportEnvironmentOptions
): Promise<ExportEnvironmentResult> {
  const includeBin = options?.includeBin ?? false;
  const includeData = options?.includeData ?? true;
  const included: string[] = [];

  await mkdir(destPath, { recursive: true });

  for (const dir of EXPORT_DIRS) {
    const src = resolvePath(root, dir);
    if (!(await pathExists(src))) continue;
    await copyTree(src, path.join(destPath, dir));
    included.push(dir);
  }

  for (const file of EXPORT_FILES) {
    const src = resolvePath(root, file);
    if (!(await pathExists(src))) continue;
    await cp(src, path.join(destPath, file));
    included.push(file);
  }

  if (includeData) {
    const dataRoot = resolvePath(root, "data");
    if (await pathExists(dataRoot)) {
      await copyTree(dataRoot, path.join(destPath, "data"));
      included.push("data");
    }
  }

  if (includeBin) {
    const binRoot = resolvePath(root, "bin");
    if (await pathExists(binRoot)) {
      await copyTree(binRoot, path.join(destPath, "bin"));
      included.push("bin");
    }
  }

  const manifest = {
    exportedAt: new Date().toISOString(),
    sourceRoot: root,
    included,
    includeBin,
    includeData,
    version: 1,
  };
  const manifestPath = path.join(destPath, "devtent-export.json");
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf-8");

  return { destPath, included, manifestPath };
}

export async function importEnvironmentBundle(
  root: string,
  bundlePath: string
): Promise<ImportEnvironmentResult> {
  const manifestPath = path.join(bundlePath, "devtent-export.json");
  if (!(await pathExists(manifestPath))) {
    throw new Error("Not a DevTent export bundle (missing devtent-export.json)");
  }

  const manifest = JSON.parse(await readFile(manifestPath, "utf-8")) as {
    included?: string[];
  };
  const included = manifest.included ?? [];
  const imported: string[] = [];

  for (const item of included) {
    const src = path.join(bundlePath, item);
    if (!(await pathExists(src))) continue;
    const dest = resolvePath(root, item);
    const st = await stat(src);
    if (st.isDirectory()) {
      await copyTree(src, dest);
    } else {
      await mkdir(path.dirname(dest), { recursive: true });
      await cp(src, dest);
    }
    imported.push(item);
  }

  return { imported, manifestPath };
}
