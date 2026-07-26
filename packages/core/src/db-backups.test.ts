import assert from "node:assert/strict";
import { mkdir, writeFile, rm, mkdtemp, utimes } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  listMariaDbBackups,
  listPostgresBackups,
  maybeDailyMariaDbBackup,
  maybeDailyPostgresBackup,
  MARIADB_BACKUP_DIR,
  POSTGRES_BACKUP_DIR,
} from "./db-backups.js";

describe("db backup scheduling gates", () => {
  it("skips MariaDB scheduled backup when a fresh backup exists", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "devtent-mariabackup-"));
    try {
      const dir = path.join(tmp, MARIADB_BACKUP_DIR, "fresh_scheduled");
      await mkdir(dir, { recursive: true });
      await writeFile(path.join(dir, "all-databases.sql"), "-- dump\n", "utf-8");
      const now = new Date();
      await utimes(path.join(dir, "all-databases.sql"), now, now);

      const listed = await listMariaDbBackups(tmp);
      assert.equal(listed.length, 1);
      assert.equal(listed[0]!.reason, "scheduled");

      const result = await maybeDailyMariaDbBackup(tmp);
      assert.equal(result, null);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("skips PostgreSQL scheduled backup when a fresh backup exists", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "devtent-pgbackup-"));
    try {
      const dir = path.join(tmp, POSTGRES_BACKUP_DIR, "fresh_scheduled");
      await mkdir(dir, { recursive: true });
      await writeFile(path.join(dir, "all-databases.sql"), "-- dump\n", "utf-8");
      const now = new Date();
      await utimes(path.join(dir, "all-databases.sql"), now, now);

      const listed = await listPostgresBackups(tmp);
      assert.equal(listed.length, 1);

      const result = await maybeDailyPostgresBackup(tmp);
      assert.equal(result, null);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});
