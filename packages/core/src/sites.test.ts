import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { initDevTent } from "./config.js";
import {
  addParkedPath,
  linkSite,
  discoverAllVirtualHosts,
  listParkedPaths,
  listLinkedSites,
} from "./sites.js";
import { generateVirtualHosts } from "./vhosts.js";

describe("sites", () => {
  it("discovers www, parked, and linked projects", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "devtent-sites-"));
    await initDevTent(tmp, () => {});

    const www = path.join(tmp, "www", "app-a");
    await mkdir(www, { recursive: true });
    await writeFile(path.join(www, "index.php"), "<?php", "utf-8");

    const parkRoot = await mkdtemp(path.join(os.tmpdir(), "devtent-park-"));
    const parked = path.join(parkRoot, "client-b");
    await mkdir(parked, { recursive: true });
    await writeFile(path.join(parked, "index.php"), "<?php", "utf-8");

    const linkRoot = await mkdtemp(path.join(os.tmpdir(), "devtent-link-"));
    await mkdir(path.join(linkRoot, "public"), { recursive: true });
    await writeFile(path.join(linkRoot, "public", "index.php"), "<?php", "utf-8");

    await addParkedPath(tmp, parkRoot);
    await linkSite(tmp, linkRoot, "legacy");

    const vhosts = await discoverAllVirtualHosts(tmp);
    const names = vhosts.map((v) => v.name).sort();
    assert.deepEqual(names, ["app-a", "client-b", "legacy"]);

    const legacy = vhosts.find((v) => v.name === "legacy");
    assert.equal(legacy?.source, "linked");
    assert.match(legacy?.root ?? "", /public$/);

    const client = vhosts.find((v) => v.name === "client-b");
    assert.equal(client?.source, "parked");

    await generateVirtualHosts(tmp, { skipHostsSync: true });
    assert.equal((await listParkedPaths(tmp)).length, 1);
    assert.equal((await listLinkedSites(tmp)).length, 1);
  });
});
