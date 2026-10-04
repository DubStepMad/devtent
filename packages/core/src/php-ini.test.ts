import assert from "node:assert/strict";
import { mkdir, writeFile, rm, mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { setPhpExtension, readPhpIni, XDEBUG_IDE_HINT } from "./php-ini.js";

describe("php-ini xdebug", () => {
  it("enables xdebug as zend_extension with IDE defaults", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "devtent-phpini-"));
    try {
      const phpRc = path.join(tmp, "bin", "php", "php-8.3");
      const extDir = path.join(phpRc, "ext");
      await mkdir(extDir, { recursive: true });
      await writeFile(path.join(extDir, "php_xdebug.dll"), "", "utf-8");
      await writeFile(
        path.join(phpRc, "php.ini"),
        "; DevTent php.ini\nextension=curl\n   \n",
        "utf-8"
      );

      const enabled = await setPhpExtension(tmp, "php-8.3", "xdebug", true);
      assert.ok(enabled.content.includes("zend_extension=xdebug"));
      assert.ok(enabled.content.includes("xdebug.client_port=9003"));
      assert.ok(enabled.content.includes("xdebug.idekey=DEVTENT"));
      assert.ok(!enabled.content.endsWith("   \n\n; DevTent Xdebug"));
      assert.equal(enabled.xdebugIdeHint, XDEBUG_IDE_HINT);
      const xdebug = enabled.extensions.find((e) => e.name === "xdebug");
      assert.equal(xdebug?.enabled, true);
      assert.equal(xdebug?.zend, true);

      const disabled = await setPhpExtension(tmp, "php-8.3", "xdebug", false);
      assert.match(disabled.content, /;zend_extension=xdebug/);
      assert.ok(!disabled.content.includes("xdebug.client_port=9003"));
      assert.equal(disabled.xdebugIdeHint, undefined);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("still toggles regular extensions with extension=", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "devtent-phpini-"));
    try {
      const phpRc = path.join(tmp, "bin", "php", "php-8.3");
      await mkdir(path.join(phpRc, "ext"), { recursive: true });
      await writeFile(path.join(phpRc, "ext", "php_curl.dll"), "", "utf-8");
      await writeFile(path.join(phpRc, "php.ini"), ";extension=curl\n", "utf-8");
      const summary = await setPhpExtension(tmp, "php-8.3", "curl", true);
      assert.ok(summary.content.includes("extension=curl"));
      assert.ok(!summary.content.includes("zend_extension=curl"));
      const again = await readPhpIni(tmp, "php-8.3");
      assert.equal(again.extensions.find((e) => e.name === "curl")?.enabled, true);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("treats opcache as zend_extension", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "devtent-phpini-"));
    try {
      const phpRc = path.join(tmp, "bin", "php", "php-8.3");
      await mkdir(path.join(phpRc, "ext"), { recursive: true });
      await writeFile(path.join(phpRc, "ext", "php_opcache.dll"), "", "utf-8");
      await writeFile(path.join(phpRc, "php.ini"), "extension=opcache\n", "utf-8");
      const summary = await setPhpExtension(tmp, "php-8.3", "opcache", true);
      assert.match(summary.content, /^zend_extension=opcache$/m);
      assert.doesNotMatch(summary.content, /^extension=opcache$/m);
      const opcache = summary.extensions.find((e) => e.name === "opcache");
      assert.equal(opcache?.zend, true);
      assert.equal(opcache?.enabled, true);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("seeds php.ini with an absolute extension_dir", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "devtent-phpini-"));
    try {
      const phpRc = path.join(tmp, "bin", "php", "php-8.3");
      const extDir = path.join(phpRc, "ext");
      await mkdir(extDir, { recursive: true });
      await writeFile(path.join(extDir, "php_curl.dll"), "", "utf-8");
      await writeFile(
        path.join(phpRc, "php.ini-development"),
        ';extension_dir = "ext"\nextension=curl\nextension=opcache\n',
        "utf-8"
      );

      const { ensurePhpRuntimeIni } = await import("./php-ini.js");
      const result = await ensurePhpRuntimeIni(tmp, "php-8.3");
      assert.equal(result.changed, true);
      const content = await readFile(path.join(phpRc, "php.ini"), "utf-8");
      const expectedDir = extDir.replace(/\\/g, "/");
      assert.ok(content.includes(`extension_dir="${expectedDir}"`));
      assert.match(content, /^zend_extension=opcache$/m);
      assert.doesNotMatch(content, /^extension=opcache$/m);
      assert.ok(content.includes('include="devtent.ini"'));
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});
