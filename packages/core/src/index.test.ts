import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  initDevTent,
  loadConfig,
  listProfiles,
  switchProfile,
  parseProcfile,
  saveProcfileEntry,
  discoverProjects,
  generateVirtualHosts,
  buildHostsContent,
  normalizeInstallRoot,
} from "./index.js";

describe("DevTent config", () => {
  if (process.platform === "win32") {
    it("maps a bare drive root to devtent folder", () => {
      assert.equal(normalizeInstallRoot("P:\\"), path.join("P:\\", "devtent"));
    });
  }

  it("initializes a portable instance", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "devtent-test-"));
    try {
      const config = await initDevTent(tmp);
      assert.equal(config.version, 1);
      assert.equal(config.activeProfile, "default");

      const loaded = await loadConfig(tmp);
      assert.equal(loaded.root, tmp);

      const profiles = await listProfiles(tmp);
      assert.equal(profiles.length, 1);
      assert.equal(profiles[0].name, "default");
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("switches profiles", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "devtent-test-"));
    try {
      await initDevTent(tmp);
      const { saveProfile } = await import("./config.js");
      await saveProfile(tmp, {
        name: "php82",
        description: "PHP 8.2 stack",
        php: "bin/php/php-8.2/php.exe",
        webServer: "nginx",
      });

      const { profile } = await switchProfile(tmp, "php82");
      assert.equal(profile.name, "php82");

      const config = await loadConfig(tmp);
      assert.equal(config.activeProfile, "php82");
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});

describe("Procfile", () => {
  it("parses and saves entries", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "devtent-test-"));
    try {
      await initDevTent(tmp);
      await saveProcfileEntry(tmp, { name: "nginx", command: "nginx.exe -p ." });
      const entries = await parseProcfile(tmp);
      assert.equal(entries.length, 1);
      assert.equal(entries[0].name, "nginx");
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});

describe("Virtual hosts", () => {
  it("generates nginx configs for www projects", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "devtent-test-"));
    try {
      await initDevTent(tmp);
      const { mkdir } = await import("node:fs/promises");
      await mkdir(path.join(tmp, "www", "myapp"), { recursive: true });

      const projects = await discoverProjects(path.join(tmp, "www"));
      assert.deepEqual(projects, ["myapp"]);

      const { vhosts } = await generateVirtualHosts(tmp, { skipHostsSync: true });
      assert.equal(vhosts.length, 1);
      assert.equal(vhosts[0].domain, "myapp.localhost");

      const nginxConf = await readFile(path.join(tmp, "etc/nginx/sites/myapp.conf"), "utf-8");
      assert.match(nginxConf, /server_name myapp\.localhost/);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("uses public/ as document root for Laravel-style projects", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "devtent-test-"));
    try {
      await initDevTent(tmp);
      const { mkdir, writeFile } = await import("node:fs/promises");
      await mkdir(path.join(tmp, "www", "myapp", "public"), { recursive: true });
      await writeFile(path.join(tmp, "www", "myapp", "artisan"), "", "utf-8");
      await writeFile(path.join(tmp, "www", "myapp", "public", "index.php"), "<?php", "utf-8");

      const { vhosts } = await generateVirtualHosts(tmp, { skipHostsSync: true });
      assert.match(vhosts[0].root.replace(/\\/g, "/"), /\/www\/myapp\/public$/);

      const apacheConf = await readFile(path.join(tmp, "etc/apache/sites/myapp.conf"), "utf-8");
      assert.match(apacheConf, /DocumentRoot ".*\/public"/);
      assert.match(apacheConf, /proxy:fcgi:\/\/127\.0\.0\.1:9083\//);
      assert.match(apacheConf, /ProxyFCGISetEnvIf/);

      const nginxConf = await readFile(path.join(tmp, "etc/nginx/sites/myapp.conf"), "utf-8");
      assert.match(nginxConf, /root ".*\/public"/);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("buildHostsContent is stable when reapplied", () => {
    const vhosts = [{ name: "myapp", domain: "myapp.test", root: "C:/devtent/www/myapp", ssl: false }];
    const first = buildHostsContent("127.0.0.1 localhost\n", vhosts);
    const second = buildHostsContent(first, vhosts);
    assert.equal(first.replace(/\r\n/g, "\n").trimEnd(), second.replace(/\r\n/g, "\n").trimEnd());
  });

  it("merges devtent hosts block", () => {
    const merged = buildHostsContent("127.0.0.1 localhost\n", [
      { name: "myapp", domain: "myapp.test", root: "C:\\devtent\\www\\myapp", ssl: false },
    ]);
    assert.match(merged, /# devtent-start/);
    assert.match(merged, /127\.0\.0\.1 myapp\.test/);
    assert.match(merged, /# devtent-end/);
  });
});
