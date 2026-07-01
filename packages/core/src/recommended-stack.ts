import path from "node:path";
import { loadManifest, installFromManifest } from "./quick-add.js";
import { syncProfileProcfileFromProfile } from "./profile-procfile.js";
import { initializeMysql } from "./mysql.js";
import { installMkcertCa } from "./ssl.js";
import { isManifestInstalled } from "./profile-runtime.js";
import type { QuickAddManifest } from "./types.js";

export const RECOMMENDED_STACK_MANIFESTS = [
  "php-8.3",
  "nginx",
  "mysql-8.4",
  "composer",
  "mkcert",
] as const;

export const RECOMMENDED_STACK_SERVICES = ["nginx", "mysql", "php-fpm"] as const;

export interface RecommendedStackResult {
  installed: string[];
  skipped: string[];
  servicesEnabled: string[];
}

export async function installRecommendedStack(
  root: string,
  manifestsDir: string,
  onProgress?: (msg: string, percent?: number) => void
): Promise<RecommendedStackResult> {
  const log = onProgress ?? (() => {});
  const installed: string[] = [];
  const skipped: string[] = [];
  const total = RECOMMENDED_STACK_MANIFESTS.length + 3;
  let step = 0;

  const bump = (msg: string) => {
    step++;
    const percent = Math.round((step / total) * 100);
    log(msg, percent);
  };

  bump("Installing recommended stack…");

  for (const name of RECOMMENDED_STACK_MANIFESTS) {
    const manifest = await loadManifest(manifestsDir, name);
    if (await isManifestInstalled(root, manifest)) {
      skipped.push(name);
      bump(`${manifest.name} already installed`);
      continue;
    }

    bump(`Downloading ${manifest.name}…`);
    await installFromManifest(root, manifest, (msg) => log(msg));
    installed.push(name);
    bump(`Installed ${manifest.name}`);
  }

  if (installed.includes("mysql-8.4") || skipped.includes("mysql-8.4")) {
    try {
      await initializeMysql(root, (msg) => log(msg));
      bump("MySQL data directory ready");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log(`MySQL init: ${msg}`);
    }
  }

  const { parseProcfile } = await import("./services.js");
  const existing = await parseProcfile(root);
  if (existing.length === 0) {
    await syncProfileProcfileFromProfile(root, { mode: "merge" });
  }
  const servicesEnabled = (await parseProcfile(root)).map((e) => e.name);
  bump(`Enabled ${servicesEnabled.join(", ") || "services"}`);

  try {
    await installMkcertCa(root);
    bump("mkcert CA installed");
  } catch {
    bump("mkcert CA install skipped (may need admin)");
  }

  log("Recommended stack ready", 100);
  return { installed, skipped, servicesEnabled };
}
