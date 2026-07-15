import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";
import toIco from "to-ico";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const assetsDir = path.join(__dirname, "..", "assets");
const sourcePath = path.join(assetsDir, "logo-source.png");

/** Bilinear resize of an RGBA PNG buffer to a square size. */
function resizeRgba(src, srcW, srcH, size) {
  const out = Buffer.alloc(size * size * 4);
  const xRatio = (srcW - 1) / Math.max(1, size - 1);
  const yRatio = (srcH - 1) / Math.max(1, size - 1);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const sx = x * xRatio;
      const sy = y * yRatio;
      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      const x1 = Math.min(x0 + 1, srcW - 1);
      const y1 = Math.min(y0 + 1, srcH - 1);
      const dx = sx - x0;
      const dy = sy - y0;

      const i00 = (y0 * srcW + x0) * 4;
      const i10 = (y0 * srcW + x1) * 4;
      const i01 = (y1 * srcW + x0) * 4;
      const i11 = (y1 * srcW + x1) * 4;

      const oi = (y * size + x) * 4;
      for (let c = 0; c < 4; c++) {
        const v =
          src[i00 + c] * (1 - dx) * (1 - dy) +
          src[i10 + c] * dx * (1 - dy) +
          src[i01 + c] * (1 - dx) * dy +
          src[i11 + c] * dx * dy;
        out[oi + c] = Math.round(v);
      }
    }
  }
  return out;
}

function rgbaToPngBuffer(size, rgba) {
  const png = new PNG({ width: size, height: size });
  rgba.copy(png.data);
  return PNG.sync.write(png);
}

/** Knock out near-navy backdrop for UI icons that sit on dark panels. */
function punchNavyBackground(rgba, size) {
  const out = Buffer.from(rgba);
  const navy = [21, 31, 58];
  for (let i = 0; i < size * size; i++) {
    const o = i * 4;
    const dr = out[o] - navy[0];
    const dg = out[o + 1] - navy[1];
    const db = out[o + 2] - navy[2];
    const dist = Math.sqrt(dr * dr + dg * dg + db * db);
    if (dist < 28) {
      out[o + 3] = 0;
    } else if (dist < 48) {
      out[o + 3] = Math.round(out[o + 3] * ((dist - 28) / 20));
    }
  }
  return out;
}

async function main() {
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Missing logo source: ${sourcePath}`);
  }

  fs.mkdirSync(assetsDir, { recursive: true });

  const sourcePng = PNG.sync.read(fs.readFileSync(sourcePath));
  const srcRgba = sourcePng.data;
  const srcW = sourcePng.width;
  const srcH = sourcePng.height;

  const sizes = [16, 32, 48, 64, 128, 256];
  const pngBuffers = [];

  for (const size of sizes) {
    const rgba = resizeRgba(srcRgba, srcW, srcH, size);
    const pngBuf = rgbaToPngBuffer(size, rgba);
    pngBuffers.push(pngBuf);
    fs.writeFileSync(path.join(assetsDir, `icon-${size}.png`), pngBuf);
  }

  // Primary PNG for electron-builder (opaque — OS taskbar / .exe)
  fs.copyFileSync(path.join(assetsDir, "icon-256.png"), path.join(assetsDir, "icon.png"));

  // Transparent mark for dashboard / tray popup (no navy square)
  const uiRgba = punchNavyBackground(resizeRgba(srcRgba, srcW, srcH, 256), 256);
  fs.writeFileSync(path.join(assetsDir, "icon-ui.png"), rgbaToPngBuffer(256, uiRgba));

  const ico = await toIco(pngBuffers);
  fs.writeFileSync(path.join(assetsDir, "icon.ico"), ico);

  console.log(`Generated icons from logo-source.png in ${assetsDir}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
