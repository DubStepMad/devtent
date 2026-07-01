import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { pathExists } from "./config.js";

const CONFIG_FILENAME = "devtent.toml";

export async function hasExistingEnvironment(root: string): Promise<boolean> {
  if (await isDevTentEnvironment(root)) return true;

  if (await pathExists(path.join(root, "bin", "php"))) return true;
  if (await pathExists(path.join(root, "bin", "nginx"))) return true;
  if (await pathExists(path.join(root, "bin", "mysql"))) return true;
  if (await pathExists(path.join(root, "bin", "mariadb"))) return true;
  if (await pathExists(path.join(root, "data", "mysql"))) return true;
  if (await pathExists(path.join(root, "etc", "laragon-migration"))) return true;

  const wwwDir = path.join(root, "www");
  if (await pathExists(wwwDir)) {
    const entries = await readdir(wwwDir, { withFileTypes: true }).catch(() => []);
    if (entries.some((e) => e.isDirectory())) return true;
  }

  return false;
}

/** True when a folder looks like DevTent (even if devtent.toml was lost during an update). */
export async function isDevTentEnvironment(dir: string): Promise<boolean> {
  if (!(await pathExists(dir))) return false;
  if (await pathExists(path.join(dir, CONFIG_FILENAME))) return true;

  const profilesDir = path.join(dir, "profiles");
  if (await pathExists(profilesDir)) {
    const profiles = await readdir(profilesDir).catch(() => []);
    if (profiles.some((name) => name.endsWith(".toml"))) return true;
  }

  const procfilePath = path.join(dir, "Procfile");
  if (await pathExists(procfilePath)) {
    const content = await readFile(procfilePath, "utf-8").catch(() => "");
    if (/devtent/i.test(content)) return true;
    if (/^\s*[^#\s][^:]*:\s*.+/m.test(content)) return true;
  }

  const nginxConf = path.join(dir, "etc", "nginx", "nginx.conf");
  if (await pathExists(nginxConf)) {
    const content = await readFile(nginxConf, "utf-8").catch(() => "");
    if (content.includes("DevTent")) return true;
  }

  const apacheConf = path.join(dir, "etc", "apache", "httpd.conf");
  if (await pathExists(apacheConf)) {
    const content = await readFile(apacheConf, "utf-8").catch(() => "");
    if (content.includes("DevTent")) return true;
  }

  return false;
}
