import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { resolvePath, pathExists } from "./config.js";

const VERSION_MARKER = ".devtent-runtime.json";

export interface RuntimeRecord {
  version: string;
  source: string;
  installedAt: string;
}

export function runtimeMarkerPath(root: string, installPath: string): string {
  return resolvePath(root, path.join(installPath, VERSION_MARKER));
}

export async function readRuntimeRecord(
  root: string,
  installPath: string
): Promise<RuntimeRecord | null> {
  const marker = runtimeMarkerPath(root, installPath);
  if (!(await pathExists(marker))) return null;
  try {
    const raw = await readFile(marker, "utf-8");
    const parsed = JSON.parse(raw) as RuntimeRecord;
    if (!parsed?.version) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function writeRuntimeRecord(
  root: string,
  installPath: string,
  record: RuntimeRecord
): Promise<void> {
  const dir = resolvePath(root, installPath);
  await mkdir(dir, { recursive: true });
  await writeFile(runtimeMarkerPath(root, installPath), JSON.stringify(record, null, 2), "utf-8");
}

/** Compare dotted / dated version strings (semver-ish, calendar, YYYY-MM-DD). */
export function compareVersionStrings(a: string, b: string): number {
  const normalize = (v: string) =>
    v
      .replace(/^bun-v/i, "")
      .replace(/^v/i, "")
      .replace(/^RELEASE\./i, "")
      .split(/[.\-T]/)
      .map((p) => {
        const n = Number.parseInt(p, 10);
        return Number.isFinite(n) ? n : 0;
      });
  const pa = normalize(a);
  const pb = normalize(b);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** Wipe install dir; optionally restore listed relative files after. */
export async function wipeInstallPreserving(
  root: string,
  installPathRel: string,
  preserveRelPaths: string[] = []
): Promise<Map<string, string>> {
  const installPath = resolvePath(root, installPathRel);
  const preserved = new Map<string, string>();
  if (!(await pathExists(installPath))) {
    await mkdir(installPath, { recursive: true });
    return preserved;
  }

  for (const rel of preserveRelPaths) {
    const full = path.join(installPath, rel);
    if (await pathExists(full)) {
      preserved.set(rel, await readFile(full, "utf-8"));
    }
  }

  await rm(installPath, { recursive: true, force: true });
  await mkdir(installPath, { recursive: true });

  for (const [rel, content] of preserved) {
    const dest = path.join(installPath, rel);
    await mkdir(path.dirname(dest), { recursive: true });
    await writeFile(dest, content, "utf-8");
  }
  return preserved;
}
