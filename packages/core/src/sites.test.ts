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
  listWwwProjectNames,
  diffNameLists,
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
    assert.deepEqual(await listWwwProjectNames(tmp), ["app-a"]);
  });

  it("diffs www project names and prunes stale auto-generated site confs", async () => {
    assert.deepEqual(diffNameLists(["keep", "gone"], ["keep", "new"]), {
      added: ["new"],
      removed: ["gone"],
    });

    const tmp = await mkdtemp(path.join(os.tmpdir(), "devtent-sites-prune-"));
    await initDevTent(tmp, () => {});
    const www = path.join(tmp, "www", "keep-me");
    await mkdir(www, { recursive: true });
    await writeFile(path.join(www, "index.php"), "<?php", "utf-8");

    const staleNginx = path.join(tmp, "etc", "nginx", "sites", "gone.conf");
    const staleApache = path.join(tmp, "etc", "apache", "sites", "gone.conf");
    await mkdir(path.dirname(staleNginx), { recursive: true });
    await mkdir(path.dirname(staleApache), { recursive: true });
    await writeFile(staleNginx, "# DevTent auto-generated — gone.localhost\n", "utf-8");
    await writeFile(staleApache, "# DevTent auto-generated — gone.localhost\n", "utf-8");

    await generateVirtualHosts(tmp, { skipHostsSync: true });
    const { pathExists } = await import("./config.js");
    assert.equal(await pathExists(staleNginx), false);
    assert.equal(await pathExists(staleApache), false);
    assert.equal(await pathExists(path.join(tmp, "etc", "nginx", "sites", "keep-me.conf")), true);
  });
});
