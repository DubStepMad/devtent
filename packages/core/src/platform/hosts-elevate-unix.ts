import { spawn } from "node:child_process";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { resolvePath } from "../config.js";
import { isHostsElevationDisabled } from "../hosts-elevate.js";
import { isUnix } from "./binary.js";

const UNIX_HOSTS_PATH = "/etc/hosts";

export interface UnixHostsSyncLaunch {
  launched: boolean;
  scriptFile: string;
}

/**
 * Write a shell script that copies the staged hosts content with sudo,
 * then launch it (macOS: osascript admin prompt; Linux: pkexec or sudo).
 */
export async function requestElevatedHostsSyncUnix(
  root: string,
  newContent: string
): Promise<UnixHostsSyncLaunch> {
  if (!isUnix()) {
    return { launched: false, scriptFile: "" };
  }
  if (isHostsElevationDisabled()) {
    return { launched: false, scriptFile: "" };
  }

  const tmpDir = resolvePath(root, "tmp");
  await mkdir(tmpDir, { recursive: true });

  const hostsNew = path.join(tmpDir, "devtent-hosts-new");
  const scriptFile = path.join(tmpDir, "devtent-sync-hosts.sh");
  const hostsPath = UNIX_HOSTS_PATH;

  await writeFile(hostsNew, newContent, "utf-8");

  const script = [
    "#!/bin/sh",
    "set -e",
    `cp "${hostsNew}" "${hostsPath}"`,
    `echo "DevTent: hosts file updated at ${hostsPath}"`,
    "",
  ].join("\n");

  await writeFile(scriptFile, script, "utf-8");
  await chmod(scriptFile, 0o755);

  const launched = await launchUnixElevated(scriptFile);
  return { launched, scriptFile };
}

export async function launchUnixElevated(scriptFile: string): Promise<boolean> {
  if (process.platform === "darwin") {
    return new Promise((resolve) => {
      const escaped = scriptFile.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
      const appleScript = `do shell script "sh \\"${escaped}\\"" with administrator privileges`;
      const child = spawn("osascript", ["-e", appleScript], {
        stdio: "ignore",
        detached: true,
      });
      child.unref();
      child.once("error", () => resolve(false));
      child.once("spawn", () => resolve(true));
    });
  }

  // Linux: prefer pkexec (GUI), fall back to sudo in a terminal-friendly way
  return new Promise((resolve) => {
    const tryPkexec = spawn("pkexec", ["sh", scriptFile], {
      stdio: "ignore",
      detached: true,
    });
    tryPkexec.unref();
    tryPkexec.once("error", () => {
      const sudo = spawn("sudo", ["sh", scriptFile], {
        stdio: "ignore",
        detached: true,
      });
      sudo.unref();
      sudo.once("error", () => resolve(false));
      sudo.once("spawn", () => resolve(true));
    });
    tryPkexec.once("spawn", () => resolve(true));
  });
}

export function getUnixHostsSyncInstructions(scriptFile?: string): string {
  if (scriptFile) {
    return (
      "Approve the administrator prompt to update /etc/hosts. " +
      `If it did not appear, run: sudo sh "${scriptFile}"`
    );
  }
  return "Approve the administrator prompt to update /etc/hosts. DevTent does not need to run as root day-to-day.";
}
