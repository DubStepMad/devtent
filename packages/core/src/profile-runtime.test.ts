import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  normalizeProfile,
  phpVersionFromLegacyPath,
  resolvePhpPaths,
  isManifestInstalled,
} from "./profile-runtime.js";
import type { QuickAddManifest } from "./types.js";

describe("profile runtime", () => {
  it("resolves PHP paths from manifest id", () => {
    const paths = resolvePhpPaths("php-8.4");
    assert.equal(paths.cli, "bin/php/php-8.4/php.exe");
    assert.equal(paths.cgi, "bin/php/php-8.4/php-cgi.exe");
    assert.match(paths.procfileCommand, /php-cgi\.exe -b 127\.0\.0\.1:9084/);
  });

  it("infers phpVersion from legacy profile paths", () => {
    assert.equal(phpVersionFromLegacyPath("bin/php/php-8.4/php.exe"), "php-8.4");
    const profile = normalizeProfile({
      name: "legacy",
      php: "bin/php/php-8.2/php.exe",
    });
    assert.equal(profile.phpVersion, "php-8.2");
    assert.equal(profile.env?.PHPRC, "bin/php/php-8.2");
  });

  it("normalizes profile env and php paths", () => {
    const profile = normalizeProfile({
      name: "modern",
      phpVersion: "php-8.3",
      webServer: "nginx",
    });
    assert.equal(profile.php, "bin/php/php-8.3/php.exe");
    assert.equal(profile.env?.PHPRC, "bin/php/php-8.3");
  });
});

describe("isManifestInstalled", () => {
  it("does not treat an empty install folder as installed when binary is required", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "manifest-empty-"));
    try {
      await mkdir(path.join(root, "bin", "apache"), { recursive: true });
      const manifest: QuickAddManifest = {
        name: "apache-2.4",
        version: "2.4.68",
        platform: "win32",
        url: "https://example.com/httpd.zip",
        installPath: "bin/apache",
        binary: "bin/httpd.exe",
      };
      assert.equal(await isManifestInstalled(root, manifest), false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("detects installed binary under installPath", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "manifest-bin-"));
    try {
      const httpd = path.join(root, "bin", "apache", "bin", "httpd.exe");
      await mkdir(path.dirname(httpd), { recursive: true });
      await writeFile(httpd, "", "utf-8");
      const manifest: QuickAddManifest = {
        name: "apache-2.4",
        version: "2.4.68",
        platform: "win32",
        url: "https://example.com/httpd.zip",
        installPath: "bin/apache",
        binary: "bin/httpd.exe",
      };
      assert.equal(await isManifestInstalled(root, manifest), true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
