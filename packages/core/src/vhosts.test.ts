import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { initDevTent, saveConfig, getDefaultConfig } from "./config.js";
import { listVirtualHosts, resolveProjectWebRoot } from "./vhosts.js";

describe("vhosts", () => {
  it("resolves Laravel public/ as web root", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "devtent-vhost-"));
    const project = path.join(tmp, "myapp");
    await mkdir(path.join(project, "public"), { recursive: true });
    await writeFile(path.join(project, "public", "index.php"), "<?php");
    const webRoot = await resolveProjectWebRoot(project);
    assert.ok(webRoot.replace(/\\/g, "/").endsWith("/myapp/public"));
  });

  it("marks ssl per domain when cert files exist", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "devtent-vhost-ssl-"));
    await initDevTent(tmp, () => {});
    await mkdir(path.join(tmp, "www", "secure"), { recursive: true });
    await mkdir(path.join(tmp, "www", "plain"), { recursive: true });
    await mkdir(path.join(tmp, "etc", "ssl"), { recursive: true });
    await writeFile(path.join(tmp, "etc/ssl/secure.test.pem"), "cert");
    await writeFile(path.join(tmp, "etc/ssl/secure.test-key.pem"), "key");

    const config = getDefaultConfig(tmp);
    config.tld = "test";
    await saveConfig(tmp, config);

    const vhosts = await listVirtualHosts(tmp);
    const secure = vhosts.find((v) => v.name === "secure");
    const plain = vhosts.find((v) => v.name === "plain");
    assert.equal(secure?.ssl, true);
    assert.equal(plain?.ssl, false);
  });
});
