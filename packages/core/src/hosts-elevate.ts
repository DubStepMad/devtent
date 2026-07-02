import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { resolvePath } from "./config.js";

export interface HostsSyncHelperFiles {
  batchFile: string;
}

export interface ElevatedHostsSyncLaunch {
  launched: boolean;
  batchFile: string;
}

/** Skip UAC / wscript during unit tests and CI — avoids popup spam and missing temp VBS files. */
export function isHostsElevationDisabled(): boolean {
  if (process.env.DEVTENT_SKIP_HOSTS_ELEVATION === "1") return true;
  if (process.env.NODE_ENV === "test") return true;
  if (process.env.npm_lifecycle_event === "test") return true;
  if (process.argv.includes("--test")) return true;
  if (process.execArgv.some((arg) => arg === "--test" || arg.startsWith("--test-"))) return true;
  return false;
}

export async function prepareHostsSyncFiles(
  root: string,
  newContent: string
): Promise<HostsSyncHelperFiles> {
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
  return { batchFile };
}

/** Launch UAC via Shell.Application — more reliable from Electron than hidden PowerShell. */
export async function launchElevatedHostsSync(batchFile: string): Promise<boolean> {
  if (process.platform !== "win32") return false;
  if (isHostsElevationDisabled()) return false;

  const vbsPath = path.join(path.dirname(batchFile), "devtent-elevate-hosts.vbs");
  const escapedBatch = batchFile.replace(/"/g, '""');
  const vbs = `CreateObject("Shell.Application").ShellExecute "${escapedBatch}", "", "", "runas", 1\r\n`;
  await writeFile(vbsPath, vbs, "utf-8");

  const wscript = path.join(
    process.env.SystemRoot ?? "C:\\Windows",
    "System32",
    "wscript.exe"
  );

  return new Promise((resolve) => {
    const child = spawn(wscript, ["//Nologo", vbsPath], {
      windowsHide: false,
      stdio: "ignore",
    });

    child.once("error", () => resolve(false));
    child.once("spawn", () => resolve(true));
  });
}

export async function requestElevatedHostsSync(
  root: string,
  newContent: string
): Promise<ElevatedHostsSyncLaunch> {
  if (process.platform !== "win32") {
    return { launched: false, batchFile: "" };
  }

  const { batchFile } = await prepareHostsSyncFiles(root, newContent);
  const launched = await launchElevatedHostsSync(batchFile);
  return { launched, batchFile };
}

export function getElevatedHostsSyncMessage(batchFile?: string): string {
  if (batchFile) {
    return (
      "Click Yes on the Windows security prompt to update your hosts file. " +
      "DevTent does not need to run as admin."
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
