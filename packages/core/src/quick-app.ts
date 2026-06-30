import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { parse as parseYaml } from "yaml";
import { resolvePath, pathExists } from "./config.js";
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

export async function createFromTemplate(
  root: string,
  templateName: string,
  projectName: string,
  templatesDir: string,
  onProgress?: (msg: string) => void
): Promise<string> {
  const log = onProgress ?? (() => {});
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
    await runCommand(resolved, projectPath);
  }

  if (template.postCreate) {
    for (const step of template.postCreate) {
      const resolved = step.replace(/\{name\}/g, projectName).replace(/\{path\}/g, projectPath);
      log(`  post: ${resolved}`);
      await runCommand(resolved, projectPath);
    }
  }

  log(`✓ Project created at www/${projectName}`);
  log(`  Run: devtent vhost sync`);
  log(`  URL: http://${projectName}.test`);

  return projectPath;
}

function runCommand(command: string, cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, { cwd, shell: true, stdio: "inherit", env: process.env });
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Command failed (${code}): ${command}`));
    });
    proc.on("error", reject);
  });
}

export async function writePlainPhpProject(root: string, name: string): Promise<void> {
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
