import path from "node:path";
import { loadConfig, pathExists, resolvePath } from "./config.js";
import { getProfileServices } from "./profile-services.js";
import { getServiceStatuses, isServiceRunning } from "./services.js";
import { listVirtualHosts } from "./vhosts.js";
import { listMysqlBackups, MYSQL_BACKUP_DIR } from "./mysql.js";
import { hasSslCertificate } from "./ssl.js";

export type HealthSeverity = "ok" | "warn" | "error";

export interface HealthItem {
  id: string;
  severity: HealthSeverity;
  title: string;
  detail?: string;
  action?: string;
}

export async function getEnvironmentHealth(root: string): Promise<HealthItem[]> {
  const items: HealthItem[] = [];
  const config = await loadConfig(root);
  const profileServices = await getProfileServices(root);
  const running = new Set(getServiceStatuses().filter((s) => s.running).map((s) => s.name));

  const missingRuntime = profileServices.filter((s) => !s.runtimeInstalled);
  if (missingRuntime.length) {
    items.push({
      id: "missing-runtimes",
      severity: "error",
      title: "Missing runtimes",
      detail: missingRuntime.map((s) => s.name).join(", "),
      action: "quick-add",
    });
  } else {
    items.push({
      id: "runtimes",
      severity: "ok",
      title: "Profile runtimes installed",
    });
  }

  const expectedRunning = profileServices.filter((s) => s.runtimeInstalled);
  const stopped = expectedRunning.filter((s) => !running.has(s.id));
  if (stopped.length) {
    items.push({
      id: "services-stopped",
      severity: "warn",
      title: "Services not running",
      detail: stopped.map((s) => s.name).join(", "),
      action: "services",
    });
  } else if (expectedRunning.length) {
    items.push({
      id: "services-running",
      severity: "ok",
      title: `${expectedRunning.length} profile service(s) running`,
    });
  }

  const vhosts = await listVirtualHosts(root);
  if (!vhosts.length) {
    items.push({
      id: "no-projects",
      severity: "warn",
      title: "No projects in www/",
      detail: "Create a project in Quick App or drop a folder into www/",
      action: "quick-app",
    });
  } else {
    items.push({
      id: "projects",
      severity: "ok",
      title: `${vhosts.length} project(s) discovered`,
      action: "projects",
    });
  }

  const sslSites = vhosts.filter((v) => v.ssl);
  if (sslSites.length) {
    items.push({
      id: "ssl-enabled",
      severity: "ok",
      title: `HTTPS enabled for ${sslSites.length} site(s)`,
      detail: sslSites.map((v) => v.domain).join(", "),
    });
  }

  const noSsl = vhosts.filter((v) => !v.ssl);
  if (noSsl.length && vhosts.length) {
    items.push({
      id: "ssl-available",
      severity: "warn",
      title: `${noSsl.length} site(s) without HTTPS`,
      detail: "Enable SSL per project from the Projects tab",
      action: "projects",
    });
  }

  if (config.activeProfile) {
    const dbInProfile = profileServices.some((s) => s.id === "mysql" || s.id === "postgresql");
    if (dbInProfile && isServiceRunning("mysql")) {
      const backups = await listMysqlBackups(root);
      const latest = backups[0];
      if (!latest) {
        items.push({
          id: "no-mysql-backup",
          severity: "warn",
          title: "No MySQL backups yet",
          detail: `Backups are stored in ${MYSQL_BACKUP_DIR}/`,
          action: "settings",
        });
      } else {
        const ageHours = (Date.now() - new Date(latest.createdAt).getTime()) / (60 * 60 * 1000);
        if (ageHours > 48) {
          items.push({
            id: "stale-mysql-backup",
            severity: "warn",
            title: "MySQL backup is older than 48 hours",
            detail: `Latest: ${new Date(latest.createdAt).toLocaleString()}`,
            action: "settings",
          });
        } else {
          items.push({
            id: "mysql-backup",
            severity: "ok",
            title: "Recent MySQL backup available",
            detail: new Date(latest.createdAt).toLocaleString(),
          });
        }
      }
    }
  }

  const mkcertPath = resolvePath(root, config.ssl.mkcertPath);
  if (!(await pathExists(mkcertPath))) {
    items.push({
      id: "mkcert-missing",
      severity: "warn",
      title: "mkcert not installed",
      detail: "Required for local HTTPS certificates",
      action: "quick-add",
    });
  }

  return items;
}
