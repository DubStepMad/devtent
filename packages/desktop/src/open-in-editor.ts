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

function isUnderRoot(fullPath: string, root: string): boolean {
  const normalizedRoot = path.resolve(root);
  const relative = path.relative(normalizedRoot, path.resolve(fullPath));
  return !relative.startsWith("..") && !path.isAbsolute(relative);
}

export function resolveEditorFilePath(
  root: string,
  filePath: string,
  extraRoots: string[] = []
): string {
  const roots = [path.resolve(root), ...extraRoots.map((r) => path.resolve(r))];

  if (path.isAbsolute(filePath) && existsSync(filePath)) {
    if (roots.some((r) => isUnderRoot(filePath, r))) {
      return path.resolve(filePath);
    }
  }

  for (const base of roots) {
    const direct = path.isAbsolute(filePath)
      ? path.resolve(filePath)
      : path.resolve(base, filePath);
    if (existsSync(direct) && isUnderRoot(direct, base)) {
      return direct;
    }

    const basename = path.basename(filePath);
    const shallow = path.resolve(base, basename);
    if (existsSync(shallow) && isUnderRoot(shallow, base)) {
      return shallow;
    }
  }

  try {
    return resolveRootSubpath(root, filePath);
  } catch {
    throw new Error(`File not found: ${filePath}`);
  }
}

export async function openFileInEditor(
  root: string,
  filePath: string,
  line?: number,
  extraRoots: string[] = []
): Promise<{ opened: boolean; message: string }> {
  let fullPath: string;
  try {
    fullPath = resolveEditorFilePath(root, filePath, extraRoots);
  } catch (err) {
    return { opened: false, message: err instanceof Error ? err.message : String(err) };
  }

  if (!existsSync(fullPath)) {
    return { opened: false, message: `File not found: ${fullPath}` };
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
