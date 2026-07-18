import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  getDefaultInstallRoot,
  listVirtualHosts,
  type VirtualHost,
} from "@devtent/core";

export function resolveDevTentRoot(env: NodeJS.ProcessEnv = process.env): string {
  const fromEnv = env.DEVTENT_ROOT?.trim();
  if (fromEnv) return path.resolve(fromEnv);
  return getDefaultInstallRoot();
}

export function resolveSitePath(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const sitePath = env.SITE_PATH?.trim();
  if (!sitePath) return undefined;
  return path.resolve(sitePath);
}

/** Resolve manifests/ next to the monorepo (or DEVTENT_MANIFESTS). */
export function resolveManifestsDir(env: NodeJS.ProcessEnv = process.env): string {
  const fromEnv = env.DEVTENT_MANIFESTS?.trim();
  if (fromEnv) return path.resolve(fromEnv);
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "../../../manifests");
}

export function normalizeFsPath(p: string): string {
  const resolved = path.resolve(p);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

export function pathsEqual(a: string, b: string): boolean {
  return normalizeFsPath(a) === normalizeFsPath(b);
}

/** True when `child` is `parent` or a path under it. */
export function isPathInside(parent: string, child: string): boolean {
  const p = normalizeFsPath(parent);
  const c = normalizeFsPath(child);
  if (c === p) return true;
  const prefix = p.endsWith(path.sep) ? p : p + path.sep;
  return c.startsWith(prefix);
}

/**
 * Match SITE_PATH to a DevTent virtual host (www / parked / linked).
 * Prefers exact projectPath, then web root, then containment.
 */
export function matchSiteFromPath(
  sitePath: string,
  vhosts: VirtualHost[]
): VirtualHost | null {
  const resolved = path.resolve(sitePath);
  const exactProject = vhosts.find(
    (v) => v.projectPath && pathsEqual(v.projectPath, resolved)
  );
  if (exactProject) return exactProject;

  const exactRoot = vhosts.find((v) => pathsEqual(v.root, resolved));
  if (exactRoot) return exactRoot;

  const contained = vhosts
    .filter((v) => {
      if (v.projectPath && isPathInside(v.projectPath, resolved)) return true;
      if (isPathInside(v.root, resolved)) return true;
      return false;
    })
    .sort((a, b) => {
      const aLen = (a.projectPath ?? a.root).length;
      const bLen = (b.projectPath ?? b.root).length;
      return bLen - aLen;
    });

  return contained[0] ?? null;
}

export async function resolveCurrentSite(
  root: string,
  sitePath?: string
): Promise<VirtualHost | null> {
  if (!sitePath) return null;
  const vhosts = await listVirtualHosts(root);
  return matchSiteFromPath(sitePath, vhosts);
}

export interface McpContext {
  root: string;
  sitePath?: string;
  manifestsDir: string;
}

export function createMcpContext(env: NodeJS.ProcessEnv = process.env): McpContext {
  return {
    root: resolveDevTentRoot(env),
    sitePath: resolveSitePath(env),
    manifestsDir: resolveManifestsDir(env),
  };
}
