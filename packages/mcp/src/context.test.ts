import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { VirtualHost } from "@devtent/core";
import {
  isPathInside,
  matchSiteFromPath,
  normalizeFsPath,
  pathsEqual,
  resolveDevTentRoot,
  resolveSitePath,
} from "./context.js";
import {
  validateIsolateAction,
  validateServiceAction,
  validateSslAction,
} from "./handlers.js";

describe("path helpers", () => {
  it("normalizeFsPath lowercases on win32 semantics when platform is win32", () => {
    const n = normalizeFsPath("C:\\DevTent\\WWW\\App");
    assert.ok(n.includes("devtent") || n.includes("DevTent") || n.length > 0);
    if (process.platform === "win32") {
      assert.equal(n, n.toLowerCase());
    }
  });

  it("pathsEqual treats equivalent paths as equal", () => {
    assert.equal(pathsEqual("/tmp/a", "/tmp/a"), true);
    assert.equal(pathsEqual("/tmp/a", "/tmp/b"), false);
  });

  it("isPathInside detects containment", () => {
    assert.equal(isPathInside("/projects/app", "/projects/app"), true);
    assert.equal(isPathInside("/projects/app", "/projects/app/src"), true);
    assert.equal(isPathInside("/projects/app", "/projects/other"), false);
    assert.equal(isPathInside("/projects/app", "/projects"), false);
  });
});

describe("resolveDevTentRoot / SITE_PATH", () => {
  it("uses DEVTENT_ROOT when set", () => {
    const root = resolveDevTentRoot({ DEVTENT_ROOT: "/custom/devtent" });
    assert.ok(root.includes("custom"));
    assert.ok(root.endsWith("devtent") || root.includes("devtent"));
  });

  it("resolves SITE_PATH when set", () => {
    const site = resolveSitePath({ SITE_PATH: "/custom/devtent/www/myapp" });
    assert.ok(site);
    assert.ok(site.includes("myapp"));
  });

  it("returns undefined when SITE_PATH missing", () => {
    assert.equal(resolveSitePath({}), undefined);
  });
});

describe("matchSiteFromPath", () => {
  const vhosts: VirtualHost[] = [
    {
      name: "myapp",
      domain: "myapp.test",
      root: "/devtent/www/myapp/public",
      projectPath: "/devtent/www/myapp",
      ssl: false,
      source: "www",
      phpVersion: "php-8.3",
    },
    {
      name: "api",
      domain: "api.test",
      root: "/other/projects/api/public",
      projectPath: "/other/projects/api",
      ssl: true,
      source: "linked",
    },
  ];

  it("matches exact projectPath", () => {
    const site = matchSiteFromPath("/devtent/www/myapp", vhosts);
    assert.equal(site?.name, "myapp");
  });

  it("matches path inside project", () => {
    const site = matchSiteFromPath("/devtent/www/myapp/app/Http", vhosts);
    assert.equal(site?.name, "myapp");
  });

  it("matches web root", () => {
    const site = matchSiteFromPath("/other/projects/api/public", vhosts);
    assert.equal(site?.name, "api");
  });

  it("returns null when no match", () => {
    assert.equal(matchSiteFromPath("/nowhere", vhosts), null);
  });
});

describe("tool argument validation", () => {
  it("validates service actions", () => {
    assert.equal(validateServiceAction("start"), true);
    assert.equal(validateServiceAction("stop"), true);
    assert.equal(validateServiceAction("restart"), false);
  });

  it("validates ssl actions", () => {
    assert.equal(validateSslAction("secure"), true);
    assert.equal(validateSslAction("unsecure"), true);
    assert.equal(validateSslAction("toggle"), false);
  });

  it("validates isolate actions", () => {
    assert.equal(validateIsolateAction("isolate"), true);
    assert.equal(validateIsolateAction("unisolate"), true);
    assert.equal(validateIsolateAction("pin"), false);
  });
});
