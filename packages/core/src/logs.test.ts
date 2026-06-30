import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { initDevTent } from "./config.js";
import { listLogFiles, readLogTail, readLogContent } from "./logs.js";

describe("logs", () => {
  it("lists log files in logs/", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "logs-list-"));
    try {
      await initDevTent(root);
      await writeFile(path.join(root, "logs", "nginx.log"), "line\n", "utf-8");
      await writeFile(path.join(root, "logs", "myapp-error.log"), "err\n", "utf-8");
      const files = await listLogFiles(root);
      assert.equal(files.length, 2);
      assert.ok(files.some((f) => f.name === "nginx.log"));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("reads tail of log file", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "logs-tail-"));
    try {
      await initDevTent(root);
      const lines = Array.from({ length: 100 }, (_, i) => `line ${i + 1}`).join("\n");
      await writeFile(path.join(root, "logs", "php-fpm.log"), lines, "utf-8");
      const tail = await readLogTail(root, "php-fpm.log", 5);
      assert.match(tail, /line 96/);
      assert.match(tail, /line 100/);
      assert.doesNotMatch(tail, /line 1\n/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects path traversal", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "logs-sec-"));
    try {
      await initDevTent(root);
      await assert.rejects(() => readLogTail(root, "../devtent.toml"));
      await assert.rejects(() => readLogTail(root, "sub/nested.log"));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("readLogContent returns full small files", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "logs-read-"));
    try {
      await initDevTent(root);
      await writeFile(path.join(root, "logs", "mysql.log"), "started\n", "utf-8");
      assert.equal(await readLogContent(root, "mysql.log"), "started\n");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
