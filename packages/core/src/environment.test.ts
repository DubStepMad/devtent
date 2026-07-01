import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { hasExistingEnvironment, isDevTentEnvironment } from "./environment.js";

describe("hasExistingEnvironment", () => {
  it("detects devtent.toml", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "env-dt-"));
    try {
      await writeFile(path.join(root, "devtent.toml"), "version = 1\n", "utf-8");
      assert.equal(await hasExistingEnvironment(root), true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("detects www projects without config", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "env-www-"));
    try {
      await mkdir(path.join(root, "www", "myapp"), { recursive: true });
      assert.equal(await hasExistingEnvironment(root), true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("detects active Procfile without DevTent header", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "env-procfile-"));
    try {
      await writeFile(
        path.join(root, "Procfile"),
        "nginx: bin/nginx/nginx.exe -p . -c etc/nginx/nginx.conf\n",
        "utf-8"
      );
      assert.equal(await isDevTentEnvironment(root), true);
      assert.equal(await hasExistingEnvironment(root), true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("detects installed runtimes without config", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "env-bin-"));
    try {
      await mkdir(path.join(root, "bin", "nginx"), { recursive: true });
      assert.equal(await hasExistingEnvironment(root), true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("returns false for empty folder", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "env-empty-"));
    try {
      assert.equal(await hasExistingEnvironment(root), false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("isDevTentEnvironment", () => {
  it("detects devtent.toml and nginx.conf markers", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "env-dt-markers-"));
    try {
      await writeFile(path.join(root, "devtent.toml"), "version = 1\n", "utf-8");
      assert.equal(await isDevTentEnvironment(root), true);

      const layout = await mkdtemp(path.join(os.tmpdir(), "env-dt-layout-"));
      await mkdir(path.join(layout, "etc", "nginx"), { recursive: true });
      await writeFile(
        path.join(layout, "etc", "nginx", "nginx.conf"),
        "# DevTent — auto-generated nginx config\n",
        "utf-8"
      );
      assert.equal(await isDevTentEnvironment(layout), true);
      await rm(layout, { recursive: true, force: true });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
