import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
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
