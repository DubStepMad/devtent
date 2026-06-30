import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(__dirname, "..", "dist");
const js = path.join(dist, "preload.js");
const cjs = path.join(dist, "preload.cjs");

if (fs.existsSync(js)) {
  fs.renameSync(js, cjs);
  const map = path.join(dist, "preload.js.map");
  if (fs.existsSync(map)) {
    fs.renameSync(map, path.join(dist, "preload.cjs.map"));
    const mapContent = fs.readFileSync(path.join(dist, "preload.cjs.map"), "utf-8");
    fs.writeFileSync(
      path.join(dist, "preload.cjs.map"),
      mapContent.replace('"file":"preload.js"', '"file":"preload.cjs"')
    );
  }
  console.log("Built preload.cjs");
}
