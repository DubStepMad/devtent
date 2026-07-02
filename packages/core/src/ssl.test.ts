import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { hasSslCertificate, sslCertPaths } from "./ssl.js";

describe("ssl", () => {
  it("detects certificate files per domain", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "devtent-ssl-"));
    const sslDir = path.join(tmp, "etc", "ssl");
    await mkdir(sslDir, { recursive: true });
    const { certPath, keyPath } = sslCertPaths(tmp, "demo.test");
    assert.equal(certPath, path.join(sslDir, "demo.test.pem"));

    assert.equal(await hasSslCertificate(tmp, "demo.test"), false);
    await writeFile(certPath, "cert");
    assert.equal(await hasSslCertificate(tmp, "demo.test"), false);
    await writeFile(keyPath, "key");
    assert.equal(await hasSslCertificate(tmp, "demo.test"), true);
  });
});
