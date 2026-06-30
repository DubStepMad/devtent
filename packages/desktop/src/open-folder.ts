import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import { shell } from "electron";

export async function openFolderInShell(fullPath: string): Promise<string> {
  if (process.platform === "win32") {
    const st = await stat(fullPath);
    if (!st.isDirectory()) {
      spawn("explorer.exe", ["/select,", fullPath], { detached: true, shell: false });
    } else {
      spawn("explorer.exe", [fullPath], { detached: true, shell: false });
    }
    return "";
  }

  return shell.openPath(fullPath);
}
