import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { shell } from "electron";
import { resolveRootSubpath } from "./security.js";

const EDITOR_COMMANDS = ["cursor", "code", "code-insiders"] as const;

function resolveEditorCommand(): string | null {
  for (const cmd of EDITOR_COMMANDS) {
    if (process.platform === "win32") {
      const localApp = process.env.LOCALAPPDATA ?? "";
      const candidates = [
        path.join(localApp, "Programs", "cursor", "Cursor.exe"),
        path.join(localApp, "Programs", "Microsoft VS Code", "Code.exe"),
      ];
      if (cmd === "cursor" && existsSync(candidates[0])) return `"${candidates[0]}"`;
      if (cmd === "code" && existsSync(candidates[1])) return `"${candidates[1]}"`;
    }
  }
  return "cursor";
}

export async function openFileInEditor(
  root: string,
  filePath: string,
  line?: number
): Promise<{ opened: boolean; message: string }> {
  let fullPath = filePath;
  if (!path.isAbsolute(filePath)) {
    try {
      fullPath = resolveRootSubpath(root, filePath);
    } catch {
      fullPath = path.join(root, filePath);
    }
  }

  if (!existsSync(fullPath)) {
    return { opened: false, message: `File not found: ${fullPath}` };
  }

  const normalizedRoot = path.resolve(root);
  const relative = path.relative(normalizedRoot, path.resolve(fullPath));
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return { opened: false, message: "Can only open files inside the DevTent folder" };
  }

  const editor = resolveEditorCommand();
  const target = line && line > 0 ? `${fullPath}:${line}` : fullPath;

  if (editor) {
    return new Promise((resolve) => {
      const args = line && line > 0 ? ["-g", target] : [fullPath];
      const proc = spawn(editor, args, { shell: true, detached: true, stdio: "ignore" });
      proc.unref();
      proc.on("error", async () => {
        await shell.openPath(fullPath);
        resolve({ opened: true, message: `Opened ${fullPath} with default app` });
      });
      proc.on("spawn", () => {
        resolve({ opened: true, message: `Opened ${target} in editor` });
      });
    });
  }

  await shell.openPath(fullPath);
  return { opened: true, message: `Opened ${fullPath}` };
}
