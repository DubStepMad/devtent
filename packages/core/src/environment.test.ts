import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { hasExistingEnvironment } from "./environment.js";

describe("hasExistingEnvironment", () => {
  it("detects devtent.toml", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "env-dt-"));
    try {
      await writeFile(path.join(root, "devtent.toml"), "version = 1\n", "utf-8");
      assert.equal(await hasExistingEnvironment(root), true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("detects www projects without config", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "env-www-"));
    try {
      await mkdir(path.join(root, "www", "myapp"), { recursive: true });
      assert.equal(await hasExistingEnvironment(root), true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("returns false for empty folder", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "env-empty-"));
    try {
      assert.equal(await hasExistingEnvironment(root), false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
