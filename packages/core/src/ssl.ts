import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { loadConfig, resolvePath, pathExists } from "./config.js";

export interface SslResult {
  domain: string;
  certPath: string;
  keyPath: string;
  success: boolean;
  message: string;
}

export async function enableSsl(root: string, domain: string): Promise<SslResult> {
  const config = await loadConfig(root);
  const sslDir = resolvePath(root, "etc/ssl");
  await mkdir(sslDir, { recursive: true });

  const mkcertPath = resolvePath(root, config.ssl.mkcertPath);
  const certPath = path.join(sslDir, `${domain}.pem`);
  const keyPath = path.join(sslDir, `${domain}-key.pem`);

  if (!(await pathExists(mkcertPath))) {
    return {
      domain,
      certPath,
      keyPath,
      success: false,
      message: `mkcert not found at ${config.ssl.mkcertPath}. Install via: devtent quick-add mkcert`,
    };
  }

  await runMkcert(mkcertPath, sslDir, domain);

  config.ssl.enabled = true;
  const { saveConfig } = await import("./config.js");
  await saveConfig(root, config);

  return {
    domain,
    certPath,
    keyPath,
    success: true,
    message: `SSL enabled for ${domain}. Certificate: ${certPath}`,
  };
}

function runMkcert(mkcertPath: string, sslDir: string, domain: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(
      mkcertPath,
      ["-cert-file", path.join(sslDir, `${domain}.pem`), "-key-file", path.join(sslDir, `${domain}-key.pem`), domain],
      { shell: true, stdio: "inherit" }
    );
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`mkcert failed with code ${code}`));
    });
    proc.on("error", reject);
  });
}

export async function installMkcertCa(root: string): Promise<string> {
  const config = await loadConfig(root);
  const mkcertPath = resolvePath(root, config.ssl.mkcertPath);

  if (!(await pathExists(mkcertPath))) {
    throw new Error("mkcert not installed. Run: devtent quick-add mkcert");
  }

  return new Promise((resolve, reject) => {
    const proc = spawn(mkcertPath, ["-install"], { shell: true, stdio: "inherit" });
    proc.on("close", (code) => {
      if (code === 0) resolve("mkcert CA installed — browsers will trust local certificates");
      else reject(new Error(`mkcert -install failed with code ${code}`));
    });
    proc.on("error", reject);
  });
}
