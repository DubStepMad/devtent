import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";
import toIco from "to-ico";
import { renderDevTentIcon } from "../dist/icon-render.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const assetsDir = path.join(__dirname, "..", "assets");

function rgbaToPngBuffer(size, rgba) {
  const png = new PNG({ width: size, height: size });
  rgba.copy(png.data);
  return PNG.sync.write(png);
}

async function main() {
  fs.mkdirSync(assetsDir, { recursive: true });

  const sizes = [16, 32, 48, 64, 128, 256];
  const pngBuffers = [];

  for (const size of sizes) {
    const rgba = renderDevTentIcon(size, 0);
    const pngBuf = rgbaToPngBuffer(size, rgba);
    pngBuffers.push(pngBuf);
    fs.writeFileSync(path.join(assetsDir, `icon-${size}.png`), pngBuf);
  }

  // Primary PNG for electron-builder
  fs.copyFileSync(path.join(assetsDir, "icon-256.png"), path.join(assetsDir, "icon.png"));

  const ico = await toIco(pngBuffers);
  fs.writeFileSync(path.join(assetsDir, "icon.ico"), ico);

  console.log(`Generated icons in ${assetsDir}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
