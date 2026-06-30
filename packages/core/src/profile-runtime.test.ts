import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeProfile,
  phpVersionFromLegacyPath,
  resolvePhpPaths,
} from "./profile-runtime.js";

describe("profile runtime", () => {
  it("resolves PHP paths from manifest id", () => {
    const paths = resolvePhpPaths("php-8.4");
    assert.equal(paths.cli, "bin/php/php-8.4/php.exe");
    assert.equal(paths.cgi, "bin/php/php-8.4/php-cgi.exe");
    assert.match(paths.procfileCommand, /php-cgi\.exe -b 127\.0\.0\.1:9000/);
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
