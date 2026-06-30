import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { resolvePath } from "./config.js";

export interface ElevatedHostsSyncLaunch {
  launched: boolean;
  batchFile: string;
}

function escapePowerShellSingleQuoted(value: string): string {
  return value.replace(/'/g, "''");
}

export async function requestElevatedHostsSync(
  root: string,
  newContent: string
): Promise<ElevatedHostsSyncLaunch> {
  if (process.platform !== "win32") {
    return { launched: false, batchFile: "" };
  }

  const tmpDir = resolvePath(root, "tmp");
  await mkdir(tmpDir, { recursive: true });

  const hostsNew = path.join(tmpDir, "devtent-hosts-new");
  const batchFile = path.join(tmpDir, "devtent-sync-hosts.cmd");

  await writeFile(hostsNew, newContent, "utf-8");

  const batch = [
    "@echo off",
    "title DevTent - Update hosts file",
    "echo.",
    "echo   DevTent needs to update your Windows hosts file for local *.test sites.",
    "echo   If you already approved the Administrator prompt, this window will close shortly.",
    "echo.",
    `copy /Y "${hostsNew}" "%SystemRoot%\\System32\\drivers\\etc\\hosts" >nul`,
    "if %errorlevel% equ 0 (",
    "  echo.",
    "  echo   Hosts file updated successfully.",
    ") else (",
    "  echo.",
    "  echo   Could not update the hosts file.",
    "  echo   Close DevTent, right-click this file, and choose Run as administrator:",
    `  echo   ${batchFile}`,
    ")",
    "echo.",
    "pause",
    "",
  ].join("\r\n");

  await writeFile(batchFile, batch, "utf-8");

  const batchArg = escapePowerShellSingleQuoted(batchFile);
  const psScript = [
    `Start-Process -FilePath $env:ComSpec -ArgumentList '/c','${batchArg}' -Verb RunAs -WindowStyle Normal`,
  ].join("; ");
  const encoded = Buffer.from(psScript, "utf16le").toString("base64");

  return new Promise((resolve) => {
    const child = spawn(
      process.env.SystemRoot
        ? path.join(process.env.SystemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
        : "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded],
      { detached: true, stdio: "ignore", windowsHide: true }
    );

    child.once("error", () => resolve({ launched: false, batchFile }));
    child.once("spawn", () => {
      child.unref();
      resolve({ launched: true, batchFile });
    });
  });
}

export function getElevatedHostsSyncMessage(batchFile?: string): string {
  if (batchFile) {
    return (
      "Look for the Windows Administrator (UAC) prompt — it may be behind other windows or on the taskbar. " +
      "Click Yes to update your hosts file. DevTent does not need to run as admin."
    );
  }
  return "Approve the Administrator prompt to update your hosts file. DevTent does not need to run as admin.";
}

export function getElevatedHostsSyncFailureMessage(batchFile: string): string {
  return (
    "Could not open the Administrator prompt. In File Explorer, right-click " +
    `${batchFile} and choose Run as administrator.`
  );
}
