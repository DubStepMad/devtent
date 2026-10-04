import path from "node:path";
import { repairDevTentEnvironment, loadConfig, pathExists, resolvePath } from "./config.js";
import { getEnvironmentHealth, type HealthItem } from "./health.js";
import {
  generateVirtualHosts,
  buildHostsContent,
  getHostsFilePath,
  listVirtualHosts,
} from "./vhosts.js";
import { syncProfileProcfileFromProfile } from "./profile-procfile.js";
import { ensureApacheConfig } from "./apache-support.js";
import { ensureNginxSupportFiles } from "./nginx-support.js";
import { enableCoreServicesIfReady } from "./procfile.js";
import { syncPhpProcfileFromProfile } from "./procfile.js";
import { syncPhpCgiProcfile } from "./php-cgi-sync.js";
import { getProfileServices } from "./profile-services.js";
import { startAll } from "./services.js";
import { readFile } from "node:fs/promises";
import { isHostsElevationDisabled } from "./hosts-elevate.js";
import { tldRequiresHostsFile } from "./domain.js";
import { installLaravelQueryCaptureForSites } from "./laravel-query-capture.js";

export interface DoctorFinding {
  id: string;
  severity: "ok" | "warn" | "error" | "fixed";
  title: string;
  detail?: string;
  fixed?: boolean;
}

export interface DoctorReport {
  findings: DoctorFinding[];
  repaired: string[];
}

async function readHostsFile(): Promise<string | null> {
  try {
    return await readFile(getHostsFilePath(), "utf-8");
  } catch {
    return null;
  }
}

function mapHealthToFindings(items: HealthItem[]): DoctorFinding[] {
  return items.map((item) => ({
    id: item.id,
    severity: item.severity,
    title: item.title,
    detail: item.detail,
  }));
}

export async function runDoctor(
  root: string,
  options?: { repair?: boolean; startServices?: boolean }
): Promise<DoctorReport> {
  const repaired: string[] = [];
  const findings: DoctorFinding[] = [];

  const configFile = path.join(root, "devtent.toml");
  if (!(await pathExists(configFile))) {
    findings.push({
      id: "missing-config",
      severity: "error",
      title: "devtent.toml is missing",
      detail: "Environment repair can recreate it from existing data",
    });
    if (options?.repair) {
      await repairDevTentEnvironment(root);
      repaired.push("Recreated devtent.toml");
      findings.push({
        id: "missing-config",
        severity: "fixed",
        title: "Recreated devtent.toml",
        fixed: true,
      });
    }
  }

  if (options?.repair) {
    await syncProfileProcfileFromProfile(root, { mode: "merge" });
    repaired.push("Synced Procfile from active profile");

    await syncPhpCgiProcfile(root);
    repaired.push(
      process.platform === "win32"
        ? "Synced PHP-CGI processes for active and per-site versions"
        : "Synced PHP-FPM pools for active and per-site versions"
    );

    await enableCoreServicesIfReady(root);
    repaired.push("Enabled core services in config when runtimes are present");

    await ensureNginxSupportFiles(root);
    repaired.push("Verified nginx support files");

    const profileServices = await getProfileServices(root);
    if (profileServices.some((s) => s.id === "apache")) {
      await ensureApacheConfig(root);
      repaired.push("Verified Apache configuration");
    }

    await generateVirtualHosts(root, {
      skipHostsSync: isHostsElevationDisabled(),
    });
    repaired.push("Regenerated virtual host configs");

    const hostsContent = await readHostsFile();
    const config = await loadConfig(root);
    if (hostsContent && tldRequiresHostsFile(config.tld)) {
      const vhosts = await listVirtualHosts(root);
      const expected = buildHostsContent(hostsContent, vhosts);
      const normalized = hostsContent.replace(/\r\n/g, "\n").trimEnd();
      if (hostsContent.includes("# devtent-start") && expected.trimEnd() !== normalized) {
        findings.push({
          id: "hosts-outdated",
          severity: "warn",
          title: "Hosts file may be out of date",
          detail: "Use Sync Virtual Hosts or Update hosts file (Admin) in the app",
        });
      }
    }

    const laravelCaptureSites = await installLaravelQueryCaptureForSites(root);
    if (laravelCaptureSites.length) {
      repaired.push(
        `Enabled Laravel telemetry capture for: ${laravelCaptureSites.join(", ")}`
      );
    }

    try {
      const { getMkcertCaStatus, installMkcertCa } = await import("./ssl.js");
      const ca = await getMkcertCaStatus(root);
      if (ca.mkcertInstalled && !ca.caExists) {
        await installMkcertCa(root);
        repaired.push("Trusted local mkcert CA");
      }
    } catch {
      findings.push({
        id: "mkcert-ca-install",
        severity: "warn",
        title: "Could not trust local CA automatically",
        detail: "Use Doctor → Trust local CA or run mkcert -install",
      });
    }

    try {
      const { ensureLocalDnsFromState } = await import("./local-dns.js");
      await ensureLocalDnsFromState(root);
    } catch {
      // optional
    }

    const { writePathScript } = await import("./path.js");
    await writePathScript(root);
    repaired.push("Rewrote DevTent PATH script");

    const { writeMysqlIni, initializeMysql, isMysqlDataInitialized } = await import("./mysql.js");
    const { writeMariaDbIni, initializeMariaDb, isMariaDbDataInitialized } = await import(
      "./mariadb.js"
    );
    const { binaryName } = await import("./platform/binary.js");
    if (
      (await pathExists(resolvePath(root, "bin/mysql"))) ||
      (await pathExists(resolvePath(root, "data/mysql")))
    ) {
      await writeMysqlIni(root);
      repaired.push("Wrote MySQL my.ini with absolute data paths");
      const mysqld = resolvePath(root, path.join("bin", "mysql", "bin", binaryName("mysqld")));
      if ((await pathExists(mysqld)) && !(await isMysqlDataInitialized(root))) {
        try {
          await initializeMysql(root);
          repaired.push("Initialized MySQL data directory");
        } catch {
          findings.push({
            id: "mysql-init",
            severity: "warn",
            title: "Could not initialize MySQL data directory",
            detail: "Start MySQL from Services after installing the runtime, or check logs/mysql.log",
          });
        }
      }
    }
    if (
      (await pathExists(resolvePath(root, "bin/mariadb"))) ||
      (await pathExists(resolvePath(root, "data/mariadb")))
    ) {
      await writeMariaDbIni(root);
      repaired.push("Wrote MariaDB my.ini with absolute data paths");
      const mariadbd =
        (await pathExists(
          resolvePath(root, path.join("bin", "mariadb", "bin", binaryName("mysqld")))
        )) ||
        (await pathExists(
          resolvePath(root, path.join("bin", "mariadb", "bin", binaryName("mariadbd")))
        ));
      if (mariadbd && !(await isMariaDbDataInitialized(root))) {
        try {
          await initializeMariaDb(root);
          repaired.push("Initialized MariaDB data directory");
        } catch {
          findings.push({
            id: "mariadb-init",
            severity: "warn",
            title: "Could not initialize MariaDB data directory",
            detail:
              "Start MariaDB from Services after installing the runtime, or check logs/mariadb.log",
          });
        }
      }
    }

    const { listInstalledPhpVersions, ensurePhpRuntimeIni } = await import("./php-ini.js");
    const { ensurePhpCaptureForVersion } = await import("./dump-capture.js");
    for (const version of await listInstalledPhpVersions(root)) {
      await ensurePhpCaptureForVersion(root, version);
      const result = await ensurePhpRuntimeIni(root, version);
      if (result.changed) {
        repaired.push(`Repaired php.ini for ${version} (extension_dir / opcache)`);
      }
    }

    if (options.startServices) {
      await startAll(root);
      repaired.push("Started profile services");
    }
  }

  const config = await loadConfig(root);
  for (const parked of config.sites?.parked ?? []) {
    if (!(await pathExists(parked))) {
      findings.push({
        id: `parked-missing-${parked}`,
        severity: "warn",
        title: "Parked folder not found",
        detail: parked,
      });
    }
  }

  for (const link of config.sites?.linked ?? []) {
    if (!(await pathExists(link.path))) {
      findings.push({
        id: `linked-missing-${link.name}`,
        severity: "warn",
        title: `Linked site "${link.name}" path not found`,
        detail: link.path,
      });
    }
  }

  findings.push(...mapHealthToFindings(await getEnvironmentHealth(root)));

  try {
    const { loadProfile } = await import("./config.js");
    const {
      DEFAULT_PHP_VERSION,
      isPhpVersionInstalled,
      resolvePhpPaths,
    } = await import("./profile-runtime.js");
    const cfg = await loadConfig(root);
    const profile = await loadProfile(root, cfg.activeProfile);
    const phpVersion = profile.phpVersion ?? DEFAULT_PHP_VERSION;
    if (await isPhpVersionInstalled(root, phpVersion)) {
      const paths = resolvePhpPaths(phpVersion);
      findings.push({
        id: "php-backend",
        severity: "ok",
        title:
          paths.backend === "fpm"
            ? `PHP-FPM ready (${phpVersion})`
            : `PHP-CGI ready (${phpVersion})`,
        detail: paths.backend === "fpm" ? paths.fpm : paths.cgi,
      });
    }
  } catch {
    // Health items already cover missing PHP
  }

  return { findings, repaired };
}
