import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  compareVersions,
  findInstallerAsset,
  normalizeVersion,
  parseUpdateCheckFromRelease,
  validateReleaseDownloadUrl,
} from "./update-version.js";

describe("update-version", () => {
  it("compareVersions orders semver parts", () => {
    assert.ok(compareVersions("1.0.1", "1.0.0") > 0);
    assert.ok(compareVersions("1.0.0", "1.0.1") < 0);
    assert.equal(compareVersions("1.0.0", "1.0.0"), 0);
    assert.ok(compareVersions("v1.1.0", "1.0.9") > 0);
  });

  it("normalizeVersion strips v prefix", () => {
    assert.equal(normalizeVersion("v1.0.0"), "1.0.0");
  });

  it("validateReleaseDownloadUrl accepts GitHub release assets", () => {
    const url = validateReleaseDownloadUrl(
      "https://github.com/DubStepMad/devtent/releases/download/v1.0.1/DevTent%20Setup%201.0.1.exe"
    );
    assert.ok(url.startsWith("https://github.com/"));
  });

  it("validateReleaseDownloadUrl rejects other hosts", () => {
    assert.throws(() => validateReleaseDownloadUrl("https://evil.com/foo"));
  });

  it("findInstallerAsset picks DevTent Setup exe", () => {
    const asset = findInstallerAsset({
      tag_name: "v1.0.1",
      name: "DevTent 1.0.1",
      body: null,
      html_url: "https://github.com/DubStepMad/devtent/releases/tag/v1.0.1",
      published_at: "2026-01-01T00:00:00Z",
      assets: [
        {
          name: "DevTent Setup 1.0.1.exe",
          browser_download_url:
            "https://github.com/DubStepMad/devtent/releases/download/v1.0.1/DevTent%20Setup%201.0.1.exe",
        },
      ],
    });
    assert.ok(asset);
    assert.equal(asset.name, "DevTent Setup 1.0.1.exe");
  });

  it("findInstallerAsset accepts electron-builder dot-separated names", () => {
    const asset = findInstallerAsset({
      tag_name: "v1.0.1",
      name: "DevTent 1.0.1",
      body: null,
      html_url: "https://github.com/DubStepMad/devtent/releases/tag/v1.0.1",
      published_at: "2026-01-01T00:00:00Z",
      assets: [
        {
          name: "DevTent.Setup.1.0.1.exe",
          browser_download_url:
            "https://github.com/DubStepMad/devtent/releases/download/v1.0.1/DevTent.Setup.1.0.1.exe",
        },
      ],
    });
    assert.ok(asset);
    assert.equal(asset.name, "DevTent.Setup.1.0.1.exe");
  });

  it("parseUpdateCheckFromRelease detects available update", () => {
    const result = parseUpdateCheckFromRelease(
      {
        tag_name: "v1.0.1",
        name: "DevTent 1.0.1",
        body: "## Fixes",
        html_url: "https://github.com/DubStepMad/devtent/releases/tag/v1.0.1",
        published_at: "2026-01-01T00:00:00Z",
        assets: [
          {
            name: "DevTent Setup 1.0.1.exe",
            browser_download_url:
              "https://github.com/DubStepMad/devtent/releases/download/v1.0.1/DevTent%20Setup%201.0.1.exe",
          },
        ],
      },
      "1.0.0"
    );
    assert.equal(result.status, "available");
    assert.equal(result.update?.latestVersion, "1.0.1");
  });

  it("parseUpdateCheckFromRelease respects skip version", () => {
    const result = parseUpdateCheckFromRelease(
      {
        tag_name: "v1.0.1",
        name: "DevTent 1.0.1",
        body: null,
        html_url: "https://github.com/DubStepMad/devtent/releases/tag/v1.0.1",
        published_at: "2026-01-01T00:00:00Z",
        assets: [
          {
            name: "DevTent Setup 1.0.1.exe",
            browser_download_url:
              "https://github.com/DubStepMad/devtent/releases/download/v1.0.1/DevTent%20Setup%201.0.1.exe",
          },
        ],
      },
      "1.0.0",
      { respectSkip: true, skipVersion: "1.0.1" }
    );
    assert.equal(result.status, "up-to-date");
  });

  it("parseUpdateCheckFromRelease accepts dot-separated installer asset", () => {
    const result = parseUpdateCheckFromRelease(
      {
        tag_name: "v1.0.1",
        name: "DevTent 1.0.1",
        body: null,
        html_url: "https://github.com/DubStepMad/devtent/releases/tag/v1.0.1",
        published_at: "2026-01-01T00:00:00Z",
        assets: [
          {
            name: "DevTent.Setup.1.0.1.exe",
            browser_download_url:
              "https://github.com/DubStepMad/devtent/releases/download/v1.0.1/DevTent.Setup.1.0.1.exe",
          },
        ],
      },
      "1.0.0"
    );
    assert.equal(result.status, "available");
  });
});
