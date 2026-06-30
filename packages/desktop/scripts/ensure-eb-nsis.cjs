"use strict";

/**
 * Remove DevTent patches from electron-builder NSIS templates (leftover from earlier experiments).
 * Safe to run every build — no-op when templates are already pristine.
 */
const fs = require("node:fs");
const path = require("node:path");

const EXTRACT_NSH = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "node_modules",
  "app-builder-lib",
  "templates",
  "nsis",
  "include",
  "extractAppPackage.nsh"
);

const MARKER = "DevTent: kill before extract retry";

function main() {
  if (!fs.existsSync(EXTRACT_NSH)) {
    return;
  }

  let content = fs.readFileSync(EXTRACT_NSH, "utf8");
  if (!content.includes(MARKER)) {
    return;
  }

  content = content.replace(
    `    ; ${MARKER}\n    !insertmacro _dtForceQuitAll\n    !insertmacro _dtPrepareInPlaceUpdate\n    Sleep 1500\n\n    `,
    "    "
  );
  content = content.replace(
    `  RetryExtract7za:\n    !insertmacro _dtForceQuitAll\n    !insertmacro _dtPrepareInPlaceUpdate\n    Sleep 2000\n    Goto LoopExtract7za`,
    `  RetryExtract7za:\n    Sleep 1000\n    Goto LoopExtract7za`
  );

  fs.writeFileSync(EXTRACT_NSH, content, "utf8");
  console.log("Restored pristine electron-builder extractAppPackage.nsh");
}

main();
