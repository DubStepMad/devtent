#!/usr/bin/env node
/**
 * Publish .wiki-build/ to the GitHub wiki remote.
 * Prerequisite: create the first wiki page once in the GitHub UI
 * (https://github.com/DubStepMad/devtent/wiki) so the .wiki.git repo exists.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const wikiDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.wiki-build");

function run(cmd, args) {
  const r = spawnSync(cmd, args, { cwd: wikiDir, stdio: "inherit", shell: true });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

run("git", ["remote", "get-url", "origin"]);
run("git", ["push", "-u", "origin", "HEAD:master"]);
console.log("Wiki published: https://github.com/DubStepMad/devtent/wiki");
