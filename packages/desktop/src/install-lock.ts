import { stat, rm } from "node:fs/promises";
import { existsSync, statSync, rmSync } from "node:fs";
import path from "node:path";
import { pathExists } from "@devtent/core";

export const INSTALL_LOCK_FILENAME = ".devtent-install-in-progress";
const STALE_LOCK_MS = 30 * 60 * 1000;

function lockPath(root: string): string {
  return path.join(root, INSTALL_LOCK_FILENAME);
}

function isFreshLockMtime(mtimeMs: number): boolean {
  return Date.now() - mtimeMs <= STALE_LOCK_MS;
}

/**
 * True while the NSIS installer holds the lock file (fresh, non-stale).
 */
export async function isInstallInProgress(root: string): Promise<boolean> {
  const file = lockPath(root);
  if (!(await pathExists(file))) return false;

  try {
    const info = await stat(file);
    if (!isFreshLockMtime(info.mtimeMs)) {
      await rm(file, { force: true });
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

/** Sync check for startup — exit before Electron finishes booting. */
export function isInstallInProgressSync(root: string): boolean {
  const file = lockPath(root);
  if (!existsSync(file)) return false;

  try {
    const info = statSync(file);
    if (!isFreshLockMtime(info.mtimeMs)) {
      rmSync(file, { force: true });
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * While the NSIS installer is copying files, DevTent must not start setup or import.
 * Returns true when the app should exit immediately.
 */
export async function shouldExitForInstallInProgress(root: string): Promise<boolean> {
  return isInstallInProgress(root);
}

export async function assertInstallNotInProgress(root: string): Promise<void> {
  if (await isInstallInProgress(root)) {
    throw new Error("Cannot run while DevTent Setup is installing — wait for the installer to finish.");
  }
}

export function installLockExistsSync(root: string): boolean {
  return existsSync(lockPath(root));
}
