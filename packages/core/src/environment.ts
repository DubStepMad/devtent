import { readdir } from "node:fs/promises";
import path from "node:path";
import { pathExists } from "./config.js";

const CONFIG_FILENAME = "devtent.toml";

export async function hasExistingEnvironment(root: string): Promise<boolean> {
  if (await pathExists(path.join(root, CONFIG_FILENAME))) return true;
  if (await pathExists(path.join(root, "profiles", "default.toml"))) return true;
  if (await pathExists(path.join(root, "bin", "php"))) return true;
  if (await pathExists(path.join(root, "data", "mysql"))) return true;

  const wwwDir = path.join(root, "www");
  if (await pathExists(wwwDir)) {
    const entries = await readdir(wwwDir, { withFileTypes: true }).catch(() => []);
    if (entries.some((e) => e.isDirectory())) return true;
  }

  return false;
}
