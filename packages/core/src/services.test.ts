import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { initDevTent } from "./config.js";
import { parseProcfile, startService, parseProcfileCommand, resolveProcfileServiceNames } from "./services.js";
import { validateManifestPlatform } from "./quick-add.js";
import type { QuickAddManifest, ProcfileEntry } from "./types.js";

describe("Services", () => {
  it("throws when starting unknown service", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "devtent-svc-"));
    try {
      await initDevTent(tmp);
      await assert.rejects(() => startService(tmp, "missing"), /not found in Procfile/);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("maps logical php-fpm to versioned php-cgi Procfile names", () => {
    const entries: ProcfileEntry[] = [
      { name: "nginx", command: "bin/nginx/nginx.exe" },
      { name: "php-cgi-8.3", command: "bin/php/php-8.3/php-cgi.exe -b 127.0.0.1:9083" },
      { name: "php-cgi-8.4", command: "bin/php/php-8.4/php-cgi.exe -b 127.0.0.1:9084" },
    ];
    assert.deepEqual(resolveProcfileServiceNames(entries, "php-fpm"), [
      "php-cgi-8.3",
      "php-cgi-8.4",
    ]);
    assert.deepEqual(resolveProcfileServiceNames(entries, "nginx"), ["nginx"]);
    assert.deepEqual(resolveProcfileServiceNames(entries, "missing"), []);
  });

  it("treats logical php-fpm as running when any versioned PHP process is alive", async () => {
    const { isServiceRunning, listServicesWithStatus, startService, stopService } =
      await import("./services.js");
    const tmp = await mkdtemp(path.join(os.tmpdir(), "devtent-php-status-"));
    try {
      await initDevTent(tmp);
      const { writeProcfileRaw } = await import("./procfile.js");
      const hold = path.join(tmp, "hold.mjs");
      await writeFile(hold, "setInterval(() => {}, 60_000);\n", "utf-8");
      const nodePath = process.execPath.replace(/\\/g, "/");
      const holdPath = hold.replace(/\\/g, "/");
      await writeProcfileRaw(
        tmp,
        [
          "nginx: bin/nginx/nginx.exe",
          `php-cgi-8.4: ${nodePath} ${holdPath}`,
        ].join("\n") + "\n"
      );

      const before = await listServicesWithStatus(tmp);
      assert.ok(before.some((s) => s.name === "php-fpm"));
      assert.equal(before.find((s) => s.name === "php-fpm")?.running, false);
      assert.equal(isServiceRunning("php-fpm"), false);

      const started = await startService(tmp, "php-cgi-8.4");
      assert.equal(started.running, true);
      assert.equal(isServiceRunning("php-fpm"), true);
      assert.equal(isServiceRunning("php-cgi-8.4"), true);

      const after = await listServicesWithStatus(tmp);
      const phpFpm = after.find((s) => s.name === "php-fpm");
      assert.equal(phpFpm?.running, true);
      assert.ok(phpFpm?.pid);

      await stopService("php-cgi-8.4", tmp, { skipBackup: true });
      // Windows taskkill is async relative to our process map delete
      await new Promise((r) => setTimeout(r, 300));
      assert.equal(isServiceRunning("php-fpm"), false);
    } finally {
      try {
        const { stopService } = await import("./services.js");
        await stopService("php-cgi-8.4", tmp, { skipBackup: true });
      } catch {
        // ignore
      }
      await new Promise((r) => setTimeout(r, 200));
      await rm(tmp, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("parses procfile commands with quoted arguments", () => {
    const parsed = parseProcfileCommand('bin/foo.exe --datadir="data/mysql" --console');
    assert.equal(parsed.executable, "bin/foo.exe");
    assert.deepEqual(parsed.args, ["--datadir=data/mysql", "--console"]);
  });

  it("parses Procfile with comments and blank lines", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "devtent-svc-"));
    try {
      await initDevTent(tmp);
      const { writeProcfileRaw } = await import("./procfile.js");
      await writeProcfileRaw(
        tmp,
        "# comment\n\nnginx: bin/nginx/nginx.exe\n\n# mysql: off\n"
      );
      const entries = await parseProcfile(tmp);
      assert.equal(entries.length, 1);
      assert.equal(entries[0]?.name, "nginx");
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});

describe("Quick-add validation", () => {
  const base: QuickAddManifest = {
    name: "test",
    version: "1.0.0",
    platform: "win32",
    arch: "x64",
    url: "https://example.com/test.zip",
    installPath: "bin/test",
  };

  it("accepts matching platform and arch", () => {
    if (process.platform === "win32") {
      assert.doesNotThrow(() => validateManifestPlatform(base));
    }
  });

  it("rejects wrong platform", () => {
    assert.throws(
      () => validateManifestPlatform({ ...base, platform: "darwin" }),
      /is for darwin/
    );
  });

  it("rejects wrong arch when specified", () => {
    assert.throws(
      () => validateManifestPlatform({ ...base, arch: "arm64" }),
      /is for arm64/
    );
  });
});
