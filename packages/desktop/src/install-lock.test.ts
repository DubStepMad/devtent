import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm, utimes } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { shouldExitForInstallInProgress, isInstallInProgressSync, INSTALL_LOCK_FILENAME } from "./install-lock.js";

describe("shouldExitForInstallInProgress", () => {
  it("ignores missing lock file", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "install-lock-"));
    try {
      assert.equal(await shouldExitForInstallInProgress(root), false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("removes stale lock files", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "install-lock-stale-"));
    const lock = path.join(root, INSTALL_LOCK_FILENAME);
    try {
      await writeFile(lock, "1", "utf-8");
      const old = new Date(Date.now() - 60 * 60 * 1000);
      await utimes(lock, old, old);
      assert.equal(await shouldExitForInstallInProgress(root), false);
      assert.equal(isInstallInProgressSync(root), false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("blocks while a fresh lock file exists", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "install-lock-fresh-"));
    const lock = path.join(root, INSTALL_LOCK_FILENAME);
    try {
      await writeFile(lock, "1", "utf-8");
      assert.equal(isInstallInProgressSync(root), true);
      assert.equal(await shouldExitForInstallInProgress(root), true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
