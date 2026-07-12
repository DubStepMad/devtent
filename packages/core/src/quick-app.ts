import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { parse as parseYaml } from "yaml";
import { resolvePath, pathExists, loadConfig } from "./config.js";
import { formatSiteDomain } from "./domain.js";
import {
  installLaravelQueryCapture,
  isLaravelProject,
} from "./laravel-query-capture.js";
import { parseProcfileCommand } from "./services.js";
import type { QuickAppTemplate } from "./types.js";

export async function loadTemplate(templatesDir: string, name: string): Promise<QuickAppTemplate> {
  const templatePath = path.join(templatesDir, name, "template.yaml");
  if (!(await pathExists(templatePath))) {
    throw new Error(`Template "${name}" not found`);
  }
  const raw = await readFile(templatePath, "utf-8");
  return parseYaml(raw) as QuickAppTemplate;
}

export async function listTemplates(templatesDir: string): Promise<QuickAppTemplate[]> {
  if (!(await pathExists(templatesDir))) return [];

  const { readdir } = await import("node:fs/promises");
  const dirs = await readdir(templatesDir, { withFileTypes: true });
  const templates: QuickAppTemplate[] = [];

  for (const dir of dirs) {
    if (!dir.isDirectory()) continue;
    try {
      templates.push(await loadTemplate(templatesDir, dir.name));
    } catch {
      // skip invalid templates
    }
  }

  return templates;
}

function assertSafeProjectName(projectName: string): void {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(projectName)) {
    throw new Error(
      "Project name must start with a letter or number and contain only letters, numbers, _ or -"
    );
  }
}

export async function createFromTemplate(
  root: string,
  templateName: string,
  projectName: string,
  templatesDir: string,
  onProgress?: (msg: string) => void
): Promise<string> {
  const log = onProgress ?? (() => {});
  assertSafeProjectName(projectName);
  const template = await loadTemplate(templatesDir, templateName);
  const projectPath = resolvePath(root, `www/${projectName}`);

  if (await pathExists(projectPath)) {
    throw new Error(`Project "${projectName}" already exists at ${projectPath}`);
  }

  await mkdir(projectPath, { recursive: true });
  log(`Creating ${template.name} project: ${projectName}`);

  for (const cmd of template.commands) {
    const resolved = cmd
      .replace(/\{name\}/g, projectName)
      .replace(/\{path\}/g, projectPath)
      .replace(/\{root\}/g, root);

    log(`  $ ${resolved}`);
    await runCommand(resolved, root);
  }

  if (template.postCreate) {
    for (const step of template.postCreate) {
      const resolved = step.replace(/\{name\}/g, projectName).replace(/\{path\}/g, projectPath);
      log(`  post: ${resolved}`);
      await runCommand(resolved, projectPath);
    }
  }

  if (templateName === "laravel" && (await isLaravelProject(projectPath))) {
    const capture = await installLaravelQueryCapture(projectPath);
    if (capture.installed) {
      log(capture.alreadyInstalled ? "  Laravel query capture already enabled" : "  ✓ Laravel query capture enabled");
    }
  }

  const config = await loadConfig(root);
  const domain = formatSiteDomain(projectName, config.tld);
  log(`✓ Project created at www/${projectName}`);
  log(`  Run: devtent vhost sync`);
  log(`  URL: http://${domain}`);

  return projectPath;
}

function runCommand(command: string, cwd: string): Promise<void> {
  const { executable, args } = parseProcfileCommand(command);
  return new Promise((resolve, reject) => {
    const proc = spawn(executable, args, {
      cwd,
      shell: false,
      windowsHide: true,
      stdio: "inherit",
      env: process.env,
    });
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Command failed (${code}): ${command}`));
    });
    proc.on("error", reject);
  });
}

export async function writePlainPhpProject(root: string, name: string): Promise<void> {
  assertSafeProjectName(name);
  const projectPath = path.join(root, "www", name);
  await mkdir(projectPath, { recursive: true });

  await writeFile(
    path.join(projectPath, "index.php"),
    `<?php
// DevTent — ${name}
phpinfo();
`,
    "utf-8"
  );
}
