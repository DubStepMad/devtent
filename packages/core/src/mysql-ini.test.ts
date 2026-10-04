import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { initDevTent } from "./config.js";
import { mysqlIniContent, writeMysqlIni } from "./mysql.js";
import { mariadbIniContent, writeMariaDbIni } from "./mariadb.js";
import { toIniFilePath } from "./ini-file.js";

describe("MySQL / MariaDB portable ini", () => {
  it("writes absolute datadir and basedir", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "devtent-dbini-"));
    try {
      await initDevTent(tmp, () => {});
      await writeMysqlIni(tmp);
      await writeMariaDbIni(tmp);

      const mysqlIni = await readFile(path.join(tmp, "etc", "mysql", "my.ini"), "utf-8");
      const mariaIni = await readFile(path.join(tmp, "etc", "mariadb", "my.ini"), "utf-8");
      const mysqlData = toIniFilePath(path.join(tmp, "data", "mysql"));
      const mariaData = toIniFilePath(path.join(tmp, "data", "mariadb"));

      assert.ok(mysqlIni.includes(`datadir="${mysqlData}"`));
      assert.ok(mysqlIni.includes(`basedir="${toIniFilePath(path.join(tmp, "bin", "mysql"))}"`));
      assert.ok(mariaIni.includes(`datadir="${mariaData}"`));
      assert.ok(mariaIni.includes(`basedir="${toIniFilePath(path.join(tmp, "bin", "mariadb"))}"`));
      assert.equal(mysqlIniContent(tmp), mysqlIni);
      assert.equal(mariadbIniContent(tmp), mariaIni);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});
