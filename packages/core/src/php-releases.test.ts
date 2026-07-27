import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  clearPhpReleasesCache,
  comparePhpVersions,
  isPhpManifestName,
  phpMinorFromManifestName,
  pickWindowsNtsX64Variant,
  pickLatestStaticPhpVersionFromListing,
  buildStaticPhpFpmUrl,
  staticPhpOsArch,
  resolvePhpManifestToLatest,
  resolveLatestPhpBuild,
  checkPhpUpdateStatus,
  writePhpRuntimeRecord,
  wipePhpInstallPreservingIni,
} from "./php-releases.js";
import type { QuickAddManifest } from "./types.js";

describe("php releases helpers", () => {
  beforeEach(() => {
    clearPhpReleasesCache();
  });

  it("detects php-* minor lines", () => {
    assert.equal(isPhpManifestName("php-8.4"), true);
    assert.equal(isPhpManifestName("php-8.4.3"), false);
    assert.equal(phpMinorFromManifestName("php-8.3"), "8.3");
    assert.equal(phpMinorFromManifestName("nginx"), null);
  });

  it("compares patch versions", () => {
    assert.ok(comparePhpVersions("8.4.23", "8.4.3") > 0);
    assert.equal(comparePhpVersions("8.3.20", "8.3.20"), 0);
    assert.ok(comparePhpVersions("8.2.1", "8.2.10") < 0);
  });

  it("picks Windows NTS x64 zip variants", () => {
    const picked = pickWindowsNtsX64Variant({
      version: "8.4.23",
      "nts-vs17-x64": {
        zip: { path: "php-8.4.23-nts-Win32-vs17-x64.zip", sha256: "abc" },
      },
      "ts-vs17-x64": {
        zip: { path: "php-8.4.23-Win32-vs17-x64.zip" },
      },
    });
    assert.equal(picked?.path, "php-8.4.23-nts-Win32-vs17-x64.zip");
    assert.equal(picked?.sha256, "abc");
  });

  it("parses static-php directory listings", () => {
    const html = `
      <a href="php-8.4.5-fpm-linux-x86_64.tar.gz">php-8.4.5-fpm-linux-x86_64.tar.gz</a>
      <a href="php-8.4.12-fpm-linux-x86_64.tar.gz">php-8.4.12-fpm-linux-x86_64.tar.gz</a>
      <a href="php-8.3.20-fpm-linux-x86_64.tar.gz">php-8.3.20-fpm-linux-x86_64.tar.gz</a>
    `;
    assert.equal(pickLatestStaticPhpVersionFromListing(html, "8.4", "linux-x86_64"), "8.4.12");
    assert.equal(buildStaticPhpFpmUrl("8.4.12", "linux-x86_64").includes("8.4.12"), true);
    assert.equal(staticPhpOsArch("linux", "x64"), "linux-x86_64");
  });

  it("resolves Windows latest from releases.json", async () => {
    const fetcher = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("releases.json")) {
        return new Response(
          JSON.stringify({
            "8.4": {
              version: "8.4.23",
              "nts-vs17-x64": {
                zip: { path: "php-8.4.23-nts-Win32-vs17-x64.zip", sha256: "deadbeef" },
              },
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      throw new Error(`unexpected fetch ${url}`);
    }) as typeof fetch;

    const latest = await resolveLatestPhpBuild("8.4", {
      platform: "win32",
      arch: "x64",
      fetcher,
    });
    assert.equal(latest.version, "8.4.23");
    assert.match(latest.url, /php-8\.4\.23-nts-Win32-vs17-x64\.zip$/);
    assert.equal(latest.source, "windows.php.net");
  });

  it("overlays php manifests with latest builds", async () => {
    const manifest: QuickAddManifest = {
      name: "php-8.4",
      version: "8.4.3",
      url: "https://example.test/php-8.4.3.zip",
      installPath: "bin/php/php-8.4",
      platform: "win32",
      arch: "x64",
    };
    const fetcher = (async () =>
      new Response(
        JSON.stringify({
          "8.4": {
            version: "8.4.23",
            "nts-vs17-x64": {
              zip: { path: "php-8.4.23-nts-Win32-vs17-x64.zip" },
            },
          },
        }),
        { status: 200 }
      )) as typeof fetch;

    const resolved = await resolvePhpManifestToLatest(manifest, {
      platform: "win32",
      arch: "x64",
      fetcher,
    });
    assert.equal(resolved.resolvedFromLatest, true);
    assert.equal(resolved.version, "8.4.23");
    assert.notEqual(resolved.url, manifest.url);
  });

  it("falls back to pinned manifest when lookup fails", async () => {
    const manifest: QuickAddManifest = {
      name: "php-8.4",
      version: "8.4.3",
      url: "https://example.test/pinned.zip",
      installPath: "bin/php/php-8.4",
    };
    const fetcher = (async () => {
      throw new Error("offline");
    }) as typeof fetch;

    let sawFallback = false;
    const resolved = await resolvePhpManifestToLatest(manifest, {
      platform: "win32",
      fetcher,
      onFallback: () => {
        sawFallback = true;
      },
    });
    assert.equal(sawFallback, true);
    assert.equal(resolved.resolvedFromLatest, false);
    assert.equal(resolved.version, "8.4.3");
    assert.equal(resolved.url, manifest.url);
  });

  it("detects updates from runtime marker vs latest", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "devtent-php-upd-"));
    const manifest: QuickAddManifest = {
      name: "php-8.4",
      version: "8.4.3",
      url: "https://example.test/php.zip",
      installPath: "bin/php/php-8.4",
    };
    await writePhpRuntimeRecord(tmp, manifest.installPath, {
      version: "8.4.3",
      source: "manifest",
      installedAt: new Date().toISOString(),
    });

    const fetcher = (async () =>
      new Response(
        JSON.stringify({
          "8.4": {
            version: "8.4.23",
            "nts-vs17-x64": {
              zip: { path: "php-8.4.23-nts-Win32-vs17-x64.zip" },
            },
          },
        }),
        { status: 200 }
      )) as typeof fetch;

    const status = await checkPhpUpdateStatus(tmp, manifest, {
      platform: "win32",
      arch: "x64",
      fetcher,
    });
    assert.equal(status.updateAvailable, true);
    assert.equal(status.installedVersion, "8.4.3");
    assert.equal(status.latestVersion, "8.4.23");
  });

  it("preserves php.ini across wipe", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "devtent-php-wipe-"));
    const installRel = "bin/php/php-8.4";
    const installAbs = path.join(tmp, installRel);
    await mkdir(installAbs, { recursive: true });
    await writeFile(path.join(installAbs, "php.ini"), "; custom\nxdebug.mode=debug\n", "utf-8");
    await writeFile(path.join(installAbs, "php.exe"), "old", "utf-8");

    const kept = await wipePhpInstallPreservingIni(tmp, installRel);
    assert.match(kept ?? "", /xdebug\.mode=debug/);
    const ini = await readFile(path.join(installAbs, "php.ini"), "utf-8");
    assert.match(ini, /xdebug\.mode=debug/);
    await assert.rejects(readFile(path.join(installAbs, "php.exe")));
  });
});
