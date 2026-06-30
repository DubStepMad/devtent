"use strict";

const fs = require("node:fs");
const path = require("node:path");

/**
 * Embed the DevTent tent icon into the .exe.
 * Required when signAndEditExecutable is false (avoids winCodeSign symlink issues).
 */
exports.default = async function afterPack(context) {
  if (process.platform !== "win32" && process.platform !== "darwin") {
    return;
  }

  const { executeAppBuilder } = require("builder-util");
  const productName = context.packager.appInfo.productFilename;
  const exe = path.join(context.appOutDir, `${productName}.exe`);
  const icon = path.join(context.packager.info.projectDir, "assets", "icon.ico");

  if (!fs.existsSync(exe)) {
    console.warn(`afterPack: executable not found at ${exe}`);
    return;
  }
  if (!fs.existsSync(icon)) {
    console.warn(`afterPack: icon not found at ${icon} — run npm run generate-icons`);
    return;
  }

  const args = [exe, "--set-icon", icon];
  await executeAppBuilder(["rcedit", "--args", JSON.stringify(args)], undefined, {}, 3);
  console.log(`Embedded tent icon into ${path.basename(exe)}`);
};
