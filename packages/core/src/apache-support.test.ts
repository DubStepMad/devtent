import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { readFile } from "node:fs/promises";
import { ensureApacheConfig, APACHE_PROCFILE_COMMAND } from "./apache-support.js";
import { initDevTent } from "./config.js";

describe("apache support", () => {
  it("writes v4 config without broken global SetHandler", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "devtent-apache-"));
    await initDevTent(tmp, () => {});

    await ensureApacheConfig(tmp);

    const conf = await readFile(path.join(tmp, "etc", "apache", "httpd.conf"), "utf-8");
    assert.match(conf, /DevTent apache config v4/);
    assert.match(conf, /ServerRoot "\."/);
    assert.match(conf, /Define APACHE_ROOT "bin\/apache"/);
    assert.match(conf, /LoadModule ssl_module/);
    assert.match(conf, /Listen 443/);
    assert.doesNotMatch(conf, /SetHandler "proxy:fcgi/);
    assert.doesNotMatch(conf, /Define SRVROOT/);
  });

  it("upgrades legacy apache httpd.conf", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "devtent-apache-legacy-"));
    await mkdir(path.join(tmp, "etc", "apache", "sites"), { recursive: true });
    await writeFile(
      path.join(tmp, "etc", "apache", "httpd.conf"),
      'Define SRVROOT "bin/apache"\nServerRoot "${SRVROOT}"\n',
      "utf-8"
    );

    await ensureApacheConfig(tmp);
    const conf = await readFile(path.join(tmp, "etc", "apache", "httpd.conf"), "utf-8");
    assert.match(conf, /DevTent apache config v4/);
    assert.match(conf, /ServerRoot "\."/);
  });

  it("upgrades v3 config to v4 with mod_ssl", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "devtent-apache-v3-"));
    await mkdir(path.join(tmp, "etc", "apache", "sites"), { recursive: true });
    await writeFile(
      path.join(tmp, "etc", "apache", "httpd.conf"),
      "# DevTent apache config v3\nListen 80\n",
      "utf-8"
    );

    await ensureApacheConfig(tmp);
    const conf = await readFile(path.join(tmp, "etc", "apache", "httpd.conf"), "utf-8");
    assert.match(conf, /DevTent apache config v4/);
    assert.match(conf, /LoadModule ssl_module/);
  });

  it("builds Windows php handler block for php-cgi", async () => {
    const { apachePhpHandlerBlock } = await import("./apache-support.js");
    const block = apachePhpHandlerBlock();
    assert.match(block, /proxy:fcgi:\/\/127\.0\.0\.1:9000\//);
    assert.match(block, /ProxyFCGIBackendType GENERIC/);
    assert.match(block, /SCRIPT_FILENAME "%\{reqenv:DOCUMENT_ROOT\}%\{reqenv:SCRIPT_NAME\}"/);
  });

  it("procfile preset uses install root as ServerRoot on Windows", () => {
    assert.equal(
      APACHE_PROCFILE_COMMAND,
      "bin/apache/bin/httpd.exe -d . -f etc/apache/httpd.conf"
    );
    assert.doesNotMatch(APACHE_PROCFILE_COMMAND, /-d bin\/apache/);
  });

  it("detects procfile commands that need repair", async () => {
    const { needsApacheProcfileRepair } = await import("./apache-support.js");
    assert.equal(
      needsApacheProcfileRepair("bin/apache/bin/httpd.exe -f etc/apache/httpd.conf"),
      true
    );
    assert.equal(
      needsApacheProcfileRepair("bin/apache/bin/httpd.exe -d bin/apache -f etc/apache/httpd.conf"),
      true
    );
    assert.equal(needsApacheProcfileRepair(APACHE_PROCFILE_COMMAND), false);
  });
});
