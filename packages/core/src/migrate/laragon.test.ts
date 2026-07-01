import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { initDevTent } from "../config.js";
import {
  isLaragonRoot,
  migrateFromLaragon,
  previewLaragonMigration,
  listLaragonDatabaseDirs,
} from "./laragon.js";

describe("Laragon migration", () => {
  it("detects Laragon folder structure", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "laragon-detect-"));
    try {
      await mkdir(path.join(tmp, "www", "myapp"), { recursive: true });
      await mkdir(path.join(tmp, "bin", "php", "php-8.3.16"), { recursive: true });
      await writeFile(path.join(tmp, "laragon.exe"), "", "utf-8");

      assert.equal(await isLaragonRoot(tmp), true);
      assert.equal(await isLaragonRoot(os.tmpdir()), false);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("does not treat an initialized DevTent folder as Laragon", async () => {
    const devtent = await mkdtemp(path.join(os.tmpdir(), "devtent-not-laragon-"));
    try {
      await mkdir(path.join(devtent, "www", "myapp"), { recursive: true });
      await mkdir(path.join(devtent, "bin", "php", "php-8.3"), { recursive: true });
      await writeFile(path.join(devtent, "devtent.toml"), 'version = 1\n', "utf-8");

      assert.equal(await isLaragonRoot(devtent), false);
    } finally {
      await rm(devtent, { recursive: true, force: true });
    }
  });

  it("does not treat DevTent layout without devtent.toml as Laragon", async () => {
    const devtent = await mkdtemp(path.join(os.tmpdir(), "devtent-layout-"));
    try {
      await mkdir(path.join(devtent, "www", "myapp"), { recursive: true });
      await mkdir(path.join(devtent, "bin", "php", "php-8.3"), { recursive: true });
      await mkdir(path.join(devtent, "etc", "nginx"), { recursive: true });
      await writeFile(
        path.join(devtent, "etc", "nginx", "nginx.conf"),
        "# DevTent — auto-generated nginx config\n",
        "utf-8"
      );
      assert.equal(await isLaragonRoot(devtent), false);
    } finally {
      await rm(devtent, { recursive: true, force: true });
    }
  });

  it("does not allow DevTent folder to be used as import source", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "devtent-same-root-"));
    try {
      await mkdir(path.join(root, "www"), { recursive: true });
      await mkdir(path.join(root, "bin", "php", "php-8.3"), { recursive: true });
      await writeFile(path.join(root, "laragon.exe"), "", "utf-8");
      await initDevTent(root);

      await assert.rejects(
        () => migrateFromLaragon(root, root, undefined, { explicitImport: true }),
        /Not a recognized environment folder/
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("requires explicitImport so install/setup cannot copy www projects", async () => {
    const laragon = await mkdtemp(path.join(os.tmpdir(), "laragon-guard-"));
    const devtent = await mkdtemp(path.join(os.tmpdir(), "devtent-guard-"));
    try {
      await mkdir(path.join(laragon, "www", "site"), { recursive: true });
      await writeFile(path.join(laragon, "laragon.exe"), "", "utf-8");
      await initDevTent(devtent);
      await assert.rejects(
        () => migrateFromLaragon(laragon, devtent),
        /not started explicitly/i
      );
    } finally {
      await rm(laragon, { recursive: true, force: true });
      await rm(devtent, { recursive: true, force: true });
    }
  });

  it("lists Laragon database directories", async () => {
    const laragon = await mkdtemp(path.join(os.tmpdir(), "laragon-db-"));
    try {
      await mkdir(path.join(laragon, "www"), { recursive: true });
      await writeFile(path.join(laragon, "laragon.exe"), "", "utf-8");
      await mkdir(path.join(laragon, "data", "mysql-8", "myshop"), { recursive: true });
      await mkdir(path.join(laragon, "data", "mysql-8", "mysql"), { recursive: true });
      await mkdir(path.join(laragon, "bin", "mysql", "mysql-8.0.30-winx64"), { recursive: true });
      await writeFile(
        path.join(laragon, "bin", "mysql", "mysql-8.0.30-winx64", "my.ini"),
        'datadir="C:/laragon/data/mysql-8"\n',
        "utf-8"
      );

      const dirs = await listLaragonDatabaseDirs(laragon);
      assert.equal(dirs.length, 1);
      assert.equal(dirs[0]?.dataDirName, "mysql-8");
      assert.deepEqual(dirs[0]?.databases, ["myshop"]);
      assert.equal(dirs[0]?.active, true);
    } finally {
      await rm(laragon, { recursive: true, force: true });
    }
  });

  it("copies www, php.ini, and database data without touching Laragon", async () => {
    const laragon = await mkdtemp(path.join(os.tmpdir(), "laragon-src-"));
    const devtent = await mkdtemp(path.join(os.tmpdir(), "devtent-dst-"));
    try {
      await mkdir(path.join(laragon, "www", "blog"), { recursive: true });
      await writeFile(path.join(laragon, "www", "blog", "index.php"), "<?php echo 1;", "utf-8");
      await mkdir(path.join(laragon, "bin", "php", "php-8.3.16"), { recursive: true });
      await writeFile(path.join(laragon, "bin", "php", "php-8.3.16", "php.exe"), "", "utf-8");
      await writeFile(
        path.join(laragon, "bin", "php", "php-8.3.16", "php.ini"),
        "extension=openssl\n",
        "utf-8"
      );
      await mkdir(path.join(laragon, "data", "mysql-8", "blogdb"), { recursive: true });
      await writeFile(path.join(laragon, "data", "mysql-8", "ibdata1"), "x", "utf-8");
      await mkdir(path.join(laragon, "bin", "mysql", "mysql-8.0.30-winx64", "bin"), {
        recursive: true,
      });
      await writeFile(
        path.join(laragon, "bin", "mysql", "mysql-8.0.30-winx64", "bin", "mysqld.exe"),
        "",
        "utf-8"
      );
      await writeFile(
        path.join(laragon, "bin", "mysql", "mysql-8.0.30-winx64", "my.ini"),
        'datadir="C:/laragon/data/mysql-8"\n',
        "utf-8"
      );
      await writeFile(path.join(laragon, "laragon.exe"), "", "utf-8");

      await initDevTent(devtent);

      const preview = await previewLaragonMigration(laragon);
      assert.equal(preview.valid, true);
      assert.deepEqual(preview.projects, ["blog"]);
      assert.equal(preview.databases.length, 1);

      const result = await migrateFromLaragon(laragon, devtent, undefined, {
        explicitImport: true,
        projects: ["blog"],
      });
      assert.deepEqual(result.projectsCopied, ["blog"]);
      assert.equal(result.phpIniCopied.length, 1);
      assert.equal(result.databaseDataCopied.length, 1);
      assert.deepEqual(result.databaseDataCopied[0]?.databases, ["blogdb"]);
      assert.ok(result.binariesCopied.some((b) => b.service === "mysql"));

      assert.equal(await isLaragonRoot(laragon), true);

      const { readFile, access } = await import("node:fs/promises");
      const copied = await readFile(path.join(devtent, "www", "blog", "index.php"), "utf-8");
      assert.match(copied, /echo 1/);
      await access(path.join(devtent, "data", "mysql", "blogdb"));
      await access(path.join(devtent, "bin", "mysql", "bin", "mysqld.exe"));
    } finally {
      await rm(laragon, { recursive: true, force: true });
      await rm(devtent, { recursive: true, force: true });
    }
  });

  it("imports only selected www projects", async () => {
    const laragon = await mkdtemp(path.join(os.tmpdir(), "laragon-pick-"));
    const devtent = await mkdtemp(path.join(os.tmpdir(), "devtent-pick-"));
    try {
      await mkdir(path.join(laragon, "www", "keep"), { recursive: true });
      await mkdir(path.join(laragon, "www", "skip"), { recursive: true });
      await writeFile(path.join(laragon, "www", "keep", "index.php"), "keep", "utf-8");
      await writeFile(path.join(laragon, "www", "skip", "index.php"), "skip", "utf-8");
      await mkdir(path.join(laragon, "bin", "php", "php-8.3.16"), { recursive: true });
      await writeFile(path.join(laragon, "laragon.exe"), "", "utf-8");

      await initDevTent(devtent);

      const result = await migrateFromLaragon(laragon, devtent, undefined, {
        explicitImport: true,
        projects: ["keep"],
      });
      assert.deepEqual(result.projectsCopied, ["keep"]);

      const { access } = await import("node:fs/promises");
      await access(path.join(devtent, "www", "keep", "index.php"));
      await assert.rejects(access(path.join(devtent, "www", "skip", "index.php")));
    } finally {
      await rm(laragon, { recursive: true, force: true });
      await rm(devtent, { recursive: true, force: true });
    }
  });
});
