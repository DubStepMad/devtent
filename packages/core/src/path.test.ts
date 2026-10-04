import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { initDevTent } from "./config.js";
import { generatePathScript, getDevTentProcessEnv, getPathEntries } from "./path.js";

describe("DevTent PATH script", () => {
  it("emits a valid Windows batch script without hash comments", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "devtent-path-"));
    try {
      await initDevTent(tmp, () => {});
      const script = await generatePathScript(tmp);
      if (process.platform === "win32") {
        assert.equal(script.startsWith("@echo off"), true);
        assert.match(script, /^REM devtent-path-start$/m);
        assert.doesNotMatch(script, /^#/m);
        assert.ok(script.includes(`set "DEVTENT_ROOT=${tmp}"`));
        assert.ok(script.includes("set \"PHPRC="));
        assert.ok(script.includes("set \"COMPOSER_HOME="));
      } else {
        assert.match(script, /^# devtent-path-start$/m);
        assert.ok(script.includes(`export DEVTENT_ROOT="${tmp}"`));
        assert.ok(script.includes("export PHPRC="));
        assert.ok(script.includes("export COMPOSER_HOME="));
      }
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("prepends the requested PHP version and sets PHPRC", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "devtent-pathphp-"));
    try {
      await initDevTent(tmp, () => {});
      await mkdir(path.join(tmp, "bin", "php", "php-8.4"), { recursive: true });
      const composerDir = path.join(tmp, "bin", "composer");
      await mkdir(composerDir, { recursive: true });
      await writeFile(path.join(composerDir, "composer.phar"), "x", "utf-8");

      const entries = await getPathEntries(tmp, { phpVersion: "php-8.4" });
      assert.ok(entries.some((e) => e.includes(path.join("bin", "php", "php-8.4"))));

      const env = await getDevTentProcessEnv(tmp, { phpVersion: "php-8.4" });
      assert.equal(env.DEVTENT_ROOT, tmp);
      assert.ok(env.PHPRC?.includes(path.join("bin", "php", "php-8.4")));
      assert.ok(env.PATH?.startsWith(entries[0]!));
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});
