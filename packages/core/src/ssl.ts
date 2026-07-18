import { spawn } from "node:child_process";
import { mkdir, unlink } from "node:fs/promises";
import path from "node:path";
import { loadConfig, resolvePath, pathExists } from "./config.js";

/** Hostname-style domains only — blocks shell metacharacters in mkcert args. */
export function validateSslDomain(domain: string): void {
  if (domain.length > 253) {
    throw new Error("Domain name is too long");
  }
  if (
    !/^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/.test(
      domain
    )
  ) {
    throw new Error(`Invalid domain name: ${domain}`);
  }
}

export interface SslResult {
  domain: string;
  certPath: string;
  keyPath: string;
  success: boolean;
  message: string;
}

export function sslCertPaths(root: string, domain: string): { certPath: string; keyPath: string } {
  const sslDir = resolvePath(root, "etc/ssl");
  return {
    certPath: path.join(sslDir, `${domain}.pem`),
    keyPath: path.join(sslDir, `${domain}-key.pem`),
  };
}

export async function hasSslCertificate(root: string, domain: string): Promise<boolean> {
  const { certPath, keyPath } = sslCertPaths(root, domain);
  return (await pathExists(certPath)) && (await pathExists(keyPath));
}

export async function enableSsl(root: string, domain: string): Promise<SslResult> {
  validateSslDomain(domain);
  const config = await loadConfig(root);
  const sslDir = resolvePath(root, "etc/ssl");
  await mkdir(sslDir, { recursive: true });

  const mkcertPath = resolvePath(root, config.ssl.mkcertPath);
  const { certPath, keyPath } = sslCertPaths(root, domain);

  if (!(await pathExists(mkcertPath))) {
    return {
      domain,
      certPath,
      keyPath,
      success: false,
      message: `mkcert not found at ${config.ssl.mkcertPath}. Install via: devtent quick-add mkcert`,
    };
  }

  try {
    await installMkcertCa(root);
  } catch {
    // CA may already be trusted — continue with cert generation
  }

  await runMkcert(mkcertPath, sslDir, domain);

  if (!config.ssl.domains) config.ssl.domains = [];
  if (!config.ssl.domains.includes(domain)) {
    config.ssl.domains.push(domain);
  }
  config.ssl.enabled = true;
  const { saveConfig } = await import("./config.js");
  await saveConfig(root, config);

  const { generateVirtualHosts } = await import("./vhosts.js");
  await generateVirtualHosts(root, { skipHostsSync: true });

  const { restartService, isServiceRunning } = await import("./services.js");
  if (isServiceRunning("nginx")) {
    await restartService(root, "nginx");
  } else if (isServiceRunning("apache")) {
    await restartService(root, "apache");
  }

  return {
    domain,
    certPath,
    keyPath,
    success: true,
    message: `SSL enabled for ${domain}. Open https://${domain}/ in your browser.`,
  };
}

/** Remove local cert/key for a domain and regenerate vhosts (HTTP-only). */
export async function disableSsl(root: string, domain: string): Promise<SslResult> {
  validateSslDomain(domain);
  const config = await loadConfig(root);
  const { certPath, keyPath } = sslCertPaths(root, domain);

  for (const file of [certPath, keyPath]) {
    if (await pathExists(file)) {
      await unlink(file);
    }
  }

  if (config.ssl.domains?.length) {
    config.ssl.domains = config.ssl.domains.filter((d) => d !== domain);
  }
  if (!config.ssl.domains?.length) {
    config.ssl.enabled = false;
  }
  const { saveConfig } = await import("./config.js");
  await saveConfig(root, config);

  const { generateVirtualHosts } = await import("./vhosts.js");
  await generateVirtualHosts(root, { skipHostsSync: true });

  const { restartService, isServiceRunning } = await import("./services.js");
  if (isServiceRunning("nginx")) {
    await restartService(root, "nginx");
  } else if (isServiceRunning("apache")) {
    await restartService(root, "apache");
  }

  return {
    domain,
    certPath,
    keyPath,
    success: true,
    message: `SSL disabled for ${domain}. Open http://${domain}/ in your browser.`,
  };
}

function runMkcert(mkcertPath: string, sslDir: string, domain: string): Promise<void> {
  validateSslDomain(domain);
  const certFile = path.join(sslDir, `${domain}.pem`);
  const keyFile = path.join(sslDir, `${domain}-key.pem`);

  return new Promise((resolve, reject) => {
    const proc = spawn(
      mkcertPath,
      ["-cert-file", certFile, "-key-file", keyFile, domain],
      { stdio: "inherit" }
    );
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`mkcert failed with code ${code}`));
    });
    proc.on("error", reject);
  });
}

export interface MkcertCaStatus {
  mkcertInstalled: boolean;
  mkcertPath: string;
  caRoot?: string;
  caExists: boolean;
  message: string;
}

export async function getMkcertCaStatus(root: string): Promise<MkcertCaStatus> {
  const config = await loadConfig(root);
  const mkcertPath = resolvePath(root, config.ssl.mkcertPath);
  const mkcertInstalled = await pathExists(mkcertPath);
  if (!mkcertInstalled) {
    return {
      mkcertInstalled: false,
      mkcertPath,
      caExists: false,
      message: "mkcert not installed — install via Quick Add, then trust the local CA",
    };
  }

  const caRoot = await new Promise<string>((resolve) => {
    const proc = spawn(mkcertPath, ["-CAROOT"], { windowsHide: true });
    let out = "";
    proc.stdout?.on("data", (c) => {
      out += String(c);
    });
    proc.on("close", () => resolve(out.trim()));
    proc.on("error", () => resolve(""));
  });

  const rootPem = caRoot ? path.join(caRoot, "rootCA.pem") : "";
  const caExists = Boolean(rootPem && (await pathExists(rootPem)));
  return {
    mkcertInstalled: true,
    mkcertPath,
    caRoot: caRoot || undefined,
    caExists,
    message: caExists
      ? `Local CA ready at ${caRoot}`
      : "mkcert is installed but the local CA is not trusted yet — run Trust local CA",
  };
}

export async function installMkcertCa(root: string): Promise<string> {
  const config = await loadConfig(root);
  const mkcertPath = resolvePath(root, config.ssl.mkcertPath);

  if (!(await pathExists(mkcertPath))) {
    throw new Error("mkcert not installed. Run: devtent quick-add mkcert");
  }

  return new Promise((resolve, reject) => {
    const proc = spawn(mkcertPath, ["-install"], { stdio: "inherit" });
    proc.on("close", (code) => {
      if (code === 0) resolve("mkcert CA installed — browsers will trust local certificates");
      else reject(new Error(`mkcert -install failed with code ${code}`));
    });
    proc.on("error", reject);
  });
}
