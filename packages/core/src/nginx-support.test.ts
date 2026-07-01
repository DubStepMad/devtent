import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { ensureNginxSupportFiles, ensureNginxTempDirs } from "./nginx-support.js";

describe("nginx support files", () => {
  it("writes mime.types and fastcgi_params into etc/nginx", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "devtent-nginx-support-"));
    try {
      await ensureNginxSupportFiles(root);
      const mime = await readFile(path.join(root, "etc", "nginx", "mime.types"), "utf-8");
      const fastcgi = await readFile(path.join(root, "etc", "nginx", "fastcgi_params"), "utf-8");
      assert.match(mime, /text\/html\s+html/);
      assert.match(fastcgi, /DOCUMENT_ROOT/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("creates nginx temp directories under the install prefix", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "devtent-nginx-temp-"));
    try {
      await ensureNginxTempDirs(root);
      const { access } = await import("node:fs/promises");
      await access(path.join(root, "temp", "client_body_temp"));
      await access(path.join(root, "tmp", "fastcgi_temp"));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
