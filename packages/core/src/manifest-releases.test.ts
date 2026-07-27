import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  clearManifestReleasesCache,
  supportsAutoLatest,
  nodeMajorFromManifestName,
  resolveLatestNodeBuild,
  resolveLatestComposerBuild,
  resolveManifestToLatest,
} from "./manifest-releases.js";
import { compareVersionStrings } from "./runtime-record.js";
import type { QuickAddManifest } from "./types.js";

describe("manifest releases", () => {
  beforeEach(() => {
    clearManifestReleasesCache();
  });

  it("flags supported auto-latest manifests", () => {
    assert.equal(supportsAutoLatest("php-8.4"), true);
    assert.equal(supportsAutoLatest("node-22"), true);
    assert.equal(supportsAutoLatest("composer"), true);
    assert.equal(supportsAutoLatest("bun"), true);
    assert.equal(supportsAutoLatest("mailpit"), true);
    assert.equal(supportsAutoLatest("nginx"), false);
    assert.equal(nodeMajorFromManifestName("node-20"), "20");
  });

  it("compares version strings across formats", () => {
    assert.ok(compareVersionStrings("22.23.1", "22.14.0") > 0);
    assert.ok(compareVersionStrings("2026.7.3", "2024.12.2") > 0);
    assert.ok(compareVersionStrings("2025-10-15", "2025-09-07") > 0);
    assert.equal(compareVersionStrings("1.30.5", "1.30.5"), 0);
  });

  it("resolves Node latest from index.json", async () => {
    const fetcher = (async (input: RequestInfo | URL) => {
      const url = String(input);
      assert.match(url, /nodejs\.org\/dist\/index\.json/);
      return new Response(
        JSON.stringify([
          { version: "v22.23.1", files: ["win-x64-zip", "linux-x64", "osx-arm64-tar"] },
          { version: "v22.14.0", files: ["win-x64-zip", "linux-x64", "osx-arm64-tar"] },
          { version: "v20.20.2", files: ["win-x64-zip"] },
        ]),
        { status: 200 }
      );
    }) as typeof fetch;

    const latest = await resolveLatestNodeBuild("22", {
      platform: "win32",
      arch: "x64",
      fetcher,
    });
    assert.equal(latest.version, "22.23.1");
    assert.match(latest.url, /node-v22\.23\.1-win-x64\.zip$/);
    assert.equal(latest.archiveSubdir, "node-v22.23.1-win-x64");
  });

  it("resolves Composer stable from versions API", async () => {
    const fetcher = (async () =>
      new Response(JSON.stringify({ stable: [{ version: "2.10.2" }] }), {
        status: 200,
      })) as typeof fetch;

    const latest = await resolveLatestComposerBuild({ fetcher });
    assert.equal(latest.version, "2.10.2");
    assert.equal(latest.url, "https://getcomposer.org/download/2.10.2/composer.phar");
  });

  it("resolves GitHub tool assets for mailpit", async () => {
    const fetcher = (async (input: RequestInfo | URL) => {
      const url = String(input);
      assert.match(url, /api\.github\.com\/repos\/axllent\/mailpit\/releases\/latest/);
      return new Response(
        JSON.stringify({
          tag_name: "v1.30.5",
          assets: [
            {
              name: "mailpit-windows-amd64.zip",
              browser_download_url:
                "https://github.com/axllent/mailpit/releases/download/v1.30.5/mailpit-windows-amd64.zip",
            },
          ],
        }),
        { status: 200 }
      );
    }) as typeof fetch;

    const manifest: QuickAddManifest = {
      name: "mailpit",
      version: "1.27.8",
      url: "https://example.test/old.zip",
      installPath: "bin/mailpit",
    };
    const resolved = await resolveManifestToLatest(manifest, {
      platform: "win32",
      arch: "x64",
      fetcher,
    });
    assert.equal(resolved.resolvedFromLatest, true);
    assert.equal(resolved.version, "1.30.5");
    assert.match(resolved.url, /mailpit-windows-amd64\.zip$/);
  });

  it("falls back when GitHub lookup fails", async () => {
    const manifest: QuickAddManifest = {
      name: "bun",
      version: "1.2.19",
      url: "https://example.test/bun.zip",
      installPath: "bin/bun",
    };
    const fetcher = (async () => {
      throw new Error("offline");
    }) as typeof fetch;

    let fallback = false;
    const resolved = await resolveManifestToLatest(manifest, {
      platform: "win32",
      arch: "x64",
      fetcher,
      onFallback: () => {
        fallback = true;
      },
    });
    assert.equal(fallback, true);
    assert.equal(resolved.resolvedFromLatest, false);
    assert.equal(resolved.version, "1.2.19");
  });
});
