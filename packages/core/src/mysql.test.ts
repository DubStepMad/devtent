import assert from "node:assert/strict";
import { mkdir, writeFile, rm, mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { isMysqlDataInitialized } from "./mysql.js";

describe("MySQL backups", () => {
  it("detects uninitialized data directory", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "devtent-mysql-"));
    try {
      assert.equal(await isMysqlDataInitialized(tmp), false);
      await mkdir(path.join(tmp, "data", "mysql"), { recursive: true });
      assert.equal(await isMysqlDataInitialized(tmp), false);
      await writeFile(path.join(tmp, "data", "mysql", "ibdata1"), "x", "utf-8");
      assert.equal(await isMysqlDataInitialized(tmp), true);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});
