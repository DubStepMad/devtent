/** @typedef {import('../../preload').DevTentApi} DevTentApi */

/** @type {DevTentApi | undefined} */
const api = window.devtent;

const GITHUB_REPO_URL = "https://github.com/DubStepMad/devtent";

const TITLES = {
  dashboard: "Dashboard",
  services: "Services",
  logs: "Logs",
  projects: "Projects",
  "quick-add": "Quick Add",
  "quick-app": "Quick App",
  profiles: "Profiles",
  settings: "Settings",
};

let toastTimer = null;
let setupActive = false;
let lastSetupPercent = 0;
let pendingUpdate = null;
let updateInstalling = false;
let logFollowTimer = null;
let selectedLogFile = "";

/** Lowercase Windows paths for display (e.g. c:\devtent\www). */
function formatPath(p) {
  if (!p) return "";
  return p.replace(/\//g, "\\").toLowerCase();
}

function showToast(msg, type = "", durationMs = 4000) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.className = "toast" + (type ? ` ${type}` : "");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add("hidden"), durationMs);
}

function formatUpdateNotes(notes) {
  if (!notes) return "No release notes provided.";
  return notes
    .replace(/\r\n/g, "\n")
    .replace(/^###?\s+/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .trim();
}

function setUpdateStatusLine(result) {
  const el = document.getElementById("update-status-line");
  if (!el) return;
  el.classList.remove("available");
  if (!result) {
    el.textContent = "";
    return;
  }
  if (result.status === "dev") {
    el.textContent = result.message;
    return;
  }
  if (result.status === "error") {
    el.textContent = result.message;
    return;
  }
  if (result.status === "up-to-date") {
    el.textContent = `You're on the latest version (v${result.currentVersion}).`;
    return;
  }
  if (result.status === "available") {
    el.textContent = `DevTent v${result.update.latestVersion} is available.`;
    el.classList.add("available");
  }
}

function showUpdateDialog(update) {
  pendingUpdate = update;
  const overlay = document.getElementById("update-overlay");
  const title = document.getElementById("update-title");
  const versionLine = document.getElementById("update-version-line");
  const notes = document.getElementById("update-notes");
  const progress = document.getElementById("update-progress");
  const actions = document.getElementById("update-actions");

  title.textContent = "Update available";
  versionLine.textContent = `v${update.currentVersion} → v${update.latestVersion}`;
  notes.textContent = formatUpdateNotes(update.releaseNotes);
  progress.classList.add("hidden");
  actions.classList.remove("hidden");
  document.getElementById("update-progress-bar").style.width = "0%";
  document.getElementById("update-progress-text").textContent = "";
  overlay.classList.remove("hidden");
}

function hideUpdateDialog() {
  document.getElementById("update-overlay")?.classList.add("hidden");
  if (!updateInstalling) pendingUpdate = null;
}

function setUpdateProgress(percent, message) {
  const progress = document.getElementById("update-progress");
  const bar = document.getElementById("update-progress-bar");
  const text = document.getElementById("update-progress-text");
  progress?.classList.remove("hidden");
  document.getElementById("update-actions")?.classList.add("hidden");
  if (bar) bar.style.width = `${Math.max(0, Math.min(100, percent))}%`;
  if (text) text.textContent = message;
}

async function refreshAboutVersion() {
  const el = document.getElementById("about-version");
  if (!el || !api?.getAppVersion) return;
  const version = await api.getAppVersion();
  el.innerHTML = `DevTent <strong>v${version}</strong> — free, open-source local dev environment.<br>Licensed under DTCL v1.0. Free forever. Not for sale.`;
}

async function runUpdateCheck({ showDialogOnAvailable = false, respectSkip = false } = {}) {
  const result = await api.checkForUpdates({ respectSkip });
  setUpdateStatusLine(result);
  if (result.status === "available") {
    pendingUpdate = result.update;
    if (showDialogOnAvailable) showUpdateDialog(result.update);
  }
  return result;
}

function setStatus(msg) {
  document.getElementById("statusbar-msg").textContent = msg;
}

async function withLoading(fn, msg = "Working…") {
  setStatus(msg);
  try {
    return await fn();
  } catch (err) {
    showToast(err.message || String(err), "error");
    throw err;
  } finally {
    setStatus("Ready");
  }
}

function handleHostsSyncResult(result) {
  const hosts = result?.hosts;
  if (hosts?.updated) {
    showToast("Virtual hosts synced — hosts file updated", "success");
    return;
  }
  if (hosts?.elevationLaunchFailed) {
    showToast(hosts.message || "Could not open the Administrator prompt.", "error");
    return;
  }
  if (hosts?.elevationRequested) {
    showToast(
      hosts.message ||
        "Look for the Windows Administrator (UAC) prompt — it may be behind other windows. Click Yes to update your hosts file.",
      "success"
    );
    return;
  }
  if (hosts?.requiresAdmin) {
    showToast(hosts.message || "Could not update the hosts file.", "error");
    return;
  }
  showToast("Virtual hosts synced", "success");
}

function showView(name) {
  document.querySelectorAll(".view-panel").forEach((p) => p.classList.add("hidden"));
  document.getElementById(`view-${name}`)?.classList.remove("hidden");
  document.getElementById("page-title").textContent = TITLES[name] || name;
  document.querySelectorAll(".nav-item").forEach((n) => {
    n.classList.toggle("active", n.dataset.view === name);
  });
}

function showSetup(show) {
  document.getElementById("view-setup").classList.toggle("hidden", !show);
  document.getElementById("app-shell").classList.toggle("hidden", show);
}

function showSetupProgress(show) {
  document.getElementById("setup-progress").classList.toggle("hidden", !show);
  document.getElementById("setup-body").classList.toggle("hidden", show);
}

function setSetupProgress(percent, message) {
  const pct = Math.max(0, Math.min(100, Math.round(percent ?? lastSetupPercent)));
  lastSetupPercent = pct;
  const bar = document.getElementById("setup-progress-bar");
  const text = document.getElementById("setup-progress-text");
  const track = bar?.parentElement;
  if (bar) bar.style.width = `${pct}%`;
  if (text && message) text.textContent = message;
  if (track) track.setAttribute("aria-valuenow", String(pct));
}

function handleProgress(payload) {
  const message = typeof payload === "string" ? payload : payload.message;
  const percent =
    typeof payload === "object" && payload.percent !== undefined ? payload.percent : undefined;
  if (setupActive) {
    setSetupProgress(percent ?? lastSetupPercent, message);
  } else {
    setStatus(message);
  }
}

async function refreshDashboard(state) {
  document.getElementById("stat-services").textContent = String(state.services?.length ?? 0);
  document.getElementById("stat-projects").textContent = String(state.virtualHosts?.length ?? 0);
  document.getElementById("stat-profile").textContent = state.activeProfile ?? "default";
  document.getElementById("stat-status").textContent =
    (state.services?.length ?? 0) > 0 ? "Running" : "Idle";

  const list = document.getElementById("dashboard-projects");
  list.innerHTML = "";
  if (!state.virtualHosts?.length) {
    list.innerHTML = '<li class="empty-hint">No projects yet</li>';
    return;
  }
  state.virtualHosts.slice(0, 5).forEach((v) => {
    const li = document.createElement("li");
    li.innerHTML = `<button class="link-btn" data-url="http://${v.domain}">${v.domain}</button>`;
    li.querySelector("button").onclick = () => api.openExternal(`http://${v.domain}`);
    list.appendChild(li);
  });
}

async function refreshLogs(fileName = selectedLogFile) {
  const select = document.getElementById("log-file-select");
  const viewer = document.getElementById("log-viewer");
  if (!select || !viewer || !api?.listLogs) return;

  const files = await api.listLogs();
  const current = select.value;
  select.innerHTML =
    '<option value="">Select a log file…</option>' +
    files
      .map(
        (f) =>
          `<option value="${escapeHtml(f.name)}">${escapeHtml(f.label ?? f.name)} (${Math.max(1, Math.round(f.sizeBytes / 1024))} KB)</option>`
      )
      .join("");

  const target = fileName || current;
  if (target && files.some((f) => f.name === target)) {
    select.value = target;
    selectedLogFile = target;
    const content = await api.readLogTail(target, 500);
    viewer.textContent = content || "(empty)";
    viewer.scrollTop = viewer.scrollHeight;
  } else if (!files.length) {
    viewer.textContent = "No log files yet — start a service to generate logs.";
  }
}

function stopLogFollow() {
  if (logFollowTimer) {
    clearInterval(logFollowTimer);
    logFollowTimer = null;
  }
}

function startLogFollow() {
  stopLogFollow();
  if (!document.getElementById("log-follow")?.checked || !selectedLogFile) return;
  logFollowTimer = setInterval(() => {
    void refreshLogs(selectedLogFile);
  }, 2000);
}

async function refreshServices() {
  if (api.syncCoreServices) {
    const { enabled } = await api.syncCoreServices();
    if (enabled) showToast("Core services enabled — NGINX, MySQL, and PHP", "success");
  }

  const toggles = await api.getProcfileToggles();
  const running = await api.getServices();
  const runningMap = new Map(running.map((s) => [s.name, s]));
  const list = document.getElementById("services-list");
  const empty = document.getElementById("services-empty");
  list.innerHTML = "";

  if (!toggles.length) {
    empty.classList.remove("hidden");
    return;
  }
  empty.classList.add("hidden");

  toggles.forEach((svc) => {
    const li = document.createElement("li");
    const isRunning = runningMap.get(svc.id)?.running;
    const dotClass = isRunning ? "running" : "stopped";
    const statusText = isRunning
      ? `Running · pid ${runningMap.get(svc.id)?.pid ?? "?"}`
      : svc.enabled
        ? "Configured · not running"
        : "Disabled";
    const runtimeLabel = svc.runtimeInstalled
      ? ""
      : '<span class="service-badge missing">runtime not installed</span>';

    li.innerHTML = `
      <div class="service-info">
        <div class="service-name">
          <span class="status-dot ${dotClass}"></span>${svc.name}${runtimeLabel}
        </div>
        <div class="service-cmd">${svc.command}</div>
        <div class="service-cmd">${statusText}</div>
      </div>
      <div class="service-actions">
        <button type="button" class="service-toggle ${svc.enabled ? "on" : ""}" title="${svc.enabled ? "Disable in Procfile" : "Enable in Procfile"}"></button>
        <button class="btn sm success btn-start-svc" ${svc.enabled ? "" : "disabled"}>Start</button>
        <button class="btn sm secondary btn-stop-svc" ${svc.enabled ? "" : "disabled"}>Stop</button>
      </div>`;

    li.querySelector(".service-toggle").onclick = async () => {
      if (!svc.runtimeInstalled && !svc.enabled) {
        showToast(`Install ${svc.name} via Quick Add first`, "error");
        return;
      }
      await api.setProcfileToggle(svc.id, !svc.enabled);
      await refreshServices();
      await refreshAll();
    };

    li.querySelector(".btn-start-svc").onclick = async () => {
      if (!svc.enabled) return;
      const result = await withLoading(() => api.startService(svc.id), `Starting ${svc.name}…`);
      if (!result?.running) {
        showToast(result?.error || `${svc.name} exited during startup — check logs/${svc.id}.log`, "error");
      } else {
        showToast(`${svc.name} started`, "success");
      }
      await refreshAll();
      await refreshServices();
    };

    li.querySelector(".btn-stop-svc").onclick = async () => {
      if (!svc.enabled) return;
      await withLoading(() => api.stopService(svc.id), `Stopping ${svc.name}…`);
      showToast(`${svc.name} stopped`, "success");
      await refreshAll();
      await refreshServices();
    };

    list.appendChild(li);
  });
}

async function refreshProjects() {
  const state = await api.getState();
  const list = document.getElementById("projects-list");
  const empty = document.getElementById("projects-empty");
  list.innerHTML = "";

  if (!state.virtualHosts?.length) {
    empty.classList.remove("hidden");
    return;
  }
  empty.classList.add("hidden");

  state.virtualHosts.forEach((v) => {
    const li = document.createElement("li");
    li.innerHTML = `
      <div class="project-info">
        <div class="project-name">${v.name}</div>
        <div class="project-url">${v.domain}</div>
      </div>
      <div class="project-actions">
        <button class="btn sm primary btn-open">Open</button>
        <button class="btn sm secondary btn-ssl">SSL</button>
        <button class="btn sm secondary btn-folder">Folder</button>
      </div>`;
    li.querySelector(".btn-open").onclick = () => api.openExternal(`http://${v.domain}`);
    li.querySelector(".btn-ssl").onclick = async () => {
      const result = await withLoading(() => api.enableSsl(v.domain), "Generating certificate…");
      showToast(result.message, result.success ? "success" : "error");
    };
    li.querySelector(".btn-folder").onclick = () => api.openPath(`www/${v.name}`);
    list.appendChild(li);
  });
}

async function refreshManifests() {
  const manifests = await api.listManifests();
  const grid = document.getElementById("manifests-grid");
  grid.innerHTML = "";

  manifests.forEach((m) => {
    const card = document.createElement("div");
    card.className = `manifest-card${m.installed ? " installed" : ""}`;
    const btnLabel = m.installed ? "Installed" : "Install";
    card.innerHTML = `
      <h4>${m.name}</h4>
      <span class="version">v${m.version}</span>
      <p>${m.description || ""}</p>
      <button class="btn primary btn-install" ${m.installed ? "disabled" : ""}>${btnLabel}</button>`;
    const btn = card.querySelector(".btn-install");
    if (!m.installed) {
      btn.onclick = async () => {
        btn.disabled = true;
        btn.textContent = "Installing…";
        try {
          await withLoading(() => api.installManifest(m.name), `Installing ${m.name}…`);
          showToast(`${m.name} installed`, "success");
          await refreshManifests();
          await refreshServices();
          await refreshProfiles();
          await refreshAll();
        } catch {
          btn.disabled = false;
          btn.textContent = "Install";
        }
      };
    }
    grid.appendChild(card);
  });
}

let profileEditorMode = null;

function formatProfileStack(profile) {
  const parts = [];
  if (profile.phpVersion) parts.push(profile.phpVersion.replace(/^php-/, "PHP "));
  if (profile.webServer) parts.push(profile.webServer);
  if (profile.database && profile.database !== "none") parts.push(profile.database);
  return parts.join(" · ") || "Stack not configured";
}

async function populatePhpVersionSelect(selected) {
  const select = document.getElementById("profile-php-version");
  if (!select) return;
  const manifests = await api.listManifests();
  const phpManifests = manifests.filter((m) => m.name.startsWith("php-"));
  const versions = phpManifests.length
    ? phpManifests
    : [
        { name: "php-8.2", installed: false },
        { name: "php-8.3", installed: false },
        { name: "php-8.4", installed: false },
      ];
  select.innerHTML = versions
    .map((m) => {
      const label =
        m.name.replace(/^php-/, "PHP ") +
        (m.installed === false ? " (not installed)" : m.installed ? "" : "");
      const isSelected = m.name === selected;
      return `<option value="${m.name}" ${isSelected ? "selected" : ""}>${label}</option>`;
    })
    .join("");
}

function hideProfileEditor() {
  profileEditorMode = null;
  document.getElementById("profile-editor")?.classList.add("hidden");
}

async function showProfileEditor(mode, profile) {
  const editor = document.getElementById("profile-editor");
  const nameInput = document.getElementById("profile-name");
  editor.classList.remove("hidden");

  if (mode === "create") {
    profileEditorMode = "create";
    document.getElementById("profile-editor-title").textContent = "New profile";
    nameInput.value = "";
    nameInput.disabled = false;
    document.getElementById("profile-description").value = "";
    document.getElementById("profile-web-server").value = "nginx";
    document.getElementById("profile-database").value = "mysql";
    await populatePhpVersionSelect("php-8.3");
    return;
  }

  if (!profile) return;
  profileEditorMode = profile.name;
  document.getElementById("profile-editor-title").textContent = `Edit profile: ${profile.name}`;
  nameInput.value = profile.name;
  nameInput.disabled = true;
  document.getElementById("profile-description").value = profile.description || "";
  document.getElementById("profile-web-server").value = profile.webServer || "nginx";
  document.getElementById("profile-database").value = profile.database || "mysql";
  await populatePhpVersionSelect(profile.phpVersion || "php-8.3");
}

async function saveProfileEditor() {
  const payload = {
    description: document.getElementById("profile-description").value.trim(),
    phpVersion: document.getElementById("profile-php-version").value,
    webServer: document.getElementById("profile-web-server").value,
    database: document.getElementById("profile-database").value,
  };

  if (profileEditorMode === "create") {
    const name = document.getElementById("profile-name").value.trim();
    if (!name) return showToast("Profile name is required", "error");
    await withLoading(() => api.createProfile({ name, ...payload }), "Creating profile…");
    showToast(`Profile "${name}" created`, "success");
  } else if (profileEditorMode) {
    await withLoading(
      () => api.updateProfile(profileEditorMode, payload),
      "Saving profile…"
    );
    showToast(`Profile "${profileEditorMode}" updated`, "success");
  }

  hideProfileEditor();
  await refreshProfiles();
  await refreshServices();
  await refreshAll();
}

async function refreshTemplates() {
  const templates = await api.listTemplates();
  const select = document.getElementById("template-select");
  select.innerHTML = "";
  templates.forEach((t) => {
    const opt = document.createElement("option");
    opt.value = t.name;
    opt.textContent = `${t.name} — ${t.description}`;
    select.appendChild(opt);
  });
}

async function refreshProfiles() {
  const { active, profiles } = await api.listProfiles();
  const list = document.getElementById("profiles-list");
  list.innerHTML = "";

  profiles.forEach((p) => {
    const li = document.createElement("li");
    if (p.name === active) li.classList.add("active-profile");
    li.innerHTML = `
      <div>
        <div class="service-name">${p.name}${p.name === active ? " (active)" : ""}</div>
        <div class="service-cmd">${p.description || "No description"}</div>
        <div class="service-cmd">${formatProfileStack(p)}</div>
      </div>
      <div class="profile-actions">
        <button type="button" class="btn sm secondary btn-edit-profile">Edit</button>
        <button type="button" class="btn sm secondary btn-delete-profile" ${
          p.name === active ? "disabled" : ""
        }>Delete</button>
        <button type="button" class="btn sm primary btn-use-profile" ${
          p.name === active ? "disabled" : ""
        }>Use</button>
      </div>`;

    li.querySelector(".btn-use-profile").onclick = async () => {
      await withLoading(() => api.switchProfile(p.name), "Switching profile…");
      showToast(`Active profile: ${p.name}`, "success");
      await refreshProfiles();
      await refreshServices();
      await refreshAll();
    };

    li.querySelector(".btn-edit-profile").onclick = () => {
      void showProfileEditor(p.name, p);
    };

    li.querySelector(".btn-delete-profile").onclick = async () => {
      if (!confirm(`Delete profile "${p.name}"?`)) return;
      try {
        await api.deleteProfile(p.name);
        showToast(`Profile "${p.name}" deleted`, "success");
        await refreshProfiles();
      } catch (err) {
        showToast(err.message || String(err), "error");
      }
    };

    list.appendChild(li);
  });
}

async function refreshSettings(root) {
  document.getElementById("settings-root").textContent = formatPath(root);
  document.getElementById("statusbar-root").textContent = formatPath(root);
  await refreshMysqlBackups();
  await refreshAppRollback();
  await refreshAboutVersion();
}

async function refreshAppRollback() {
  const status = document.getElementById("rollback-status");
  const btn = document.getElementById("btn-rollback-app");
  if (!status || !btn || !api?.listAppBackups) return;

  const backups = await api.listAppBackups();
  if (!backups.length) {
    status.textContent =
      "No rollback backup yet. DevTent saves one automatically before each in-app update.";
    btn.disabled = true;
    return;
  }

  const latest = backups[0];
  const when = new Date(latest.createdAt).toLocaleString();
  status.textContent = `Latest backup: v${latest.version} from ${when}. Restoring will restart DevTent.`;
  btn.disabled = false;
}

async function refreshMysqlBackups() {
  const list = document.getElementById("mysql-backups-list");
  if (!list || !api?.listMysqlBackups) return;
  const backups = await api.listMysqlBackups();
  if (!backups.length) {
    list.innerHTML = "<li>No backups yet.</li>";
    return;
  }
  list.innerHTML = backups
    .slice(0, 8)
    .map((b) => {
      const when = new Date(b.createdAt).toLocaleString();
      const sizeKb = Math.max(1, Math.round(b.sizeBytes / 1024));
      return `<li>${when} · ${b.reason} · ${sizeKb} KB</li>`;
    })
    .join("");
}

async function refreshAll() {
  const status = await api.getRoot();
  if (!status.initialized) {
    if (!isFreshInstall(status)) {
      await api.setRoot(await api.getDefaultRoot());
      await api.init(status.root);
    } else {
      showSetup(true);
      await api.setWindowMode("setup");
      return;
    }
  }
  await api.setWindowMode("dashboard");
  showSetup(false);
  const state = await api.getState();
  await refreshDashboard(state);
  await refreshSettings(state.root);
}

async function updateLaragonPreview(
  laragonPath,
  previewElId,
  projectListId = null,
  projectPickerId = null,
  showProjectList = true
) {
  const el = document.getElementById(previewElId);
  if (!api || !laragonPath) {
    if (el) el.textContent = "";
    renderProjectPicker(projectListId, projectPickerId, []);
    return;
  }
  const preview = await api.previewLaragonMigration(laragonPath);
  if (!preview.valid) {
    el.textContent = "Not a recognized environment folder (needs www/ and bin/php or similar layout)";
    renderProjectPicker(projectListId, projectPickerId, []);
    return;
  }
  el.textContent = `Found ${preview.projects.length} project(s), ${preview.phpVersions.length} PHP version(s), ${formatDatabasePreview(preview.databases)}`;
  renderProjectPicker(
    projectListId,
    projectPickerId,
    showProjectList ? preview.projects : []
  );
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/"/g, "&quot;");
}

function renderProjectPicker(projectListId, projectPickerId, projects) {
  if (!projectListId || !projectPickerId) return;
  const picker = document.getElementById(projectPickerId);
  const list = document.getElementById(projectListId);
  if (!picker || !list) return;

  if (!projects?.length) {
    picker.classList.add("hidden");
    list.innerHTML = "";
    return;
  }

  picker.classList.remove("hidden");
  list.innerHTML = projects
    .map(
      (name) => `
    <label class="migrate-check">
      <input type="checkbox" class="migrate-project-cb" value="${escapeHtml(name)}" checked>
      ${escapeHtml(name)}
    </label>`
    )
    .join("");
}

function getSelectedProjects(projectListId) {
  const list = document.getElementById(projectListId);
  if (!list) return [];
  return [...list.querySelectorAll(".migrate-project-cb:checked")].map((cb) => cb.value);
}

function formatDatabasePreview(databases) {
  if (!databases?.length) return "no database data";
  const primary = databases[0];
  const names = primary.databases?.length
    ? primary.databases.slice(0, 5).join(", ") + (primary.databases.length > 5 ? "…" : "")
    : "system files only";
  return `${primary.databases?.length ?? 0} database(s) in data/${primary.dataDirName}/ (${names})`;
}

async function autoDetectLaragon(
  inputId,
  previewElId,
  projectListId = null,
  projectPickerId = null,
  showProjectList = true
) {
  if (!api) return;
  const installs = await api.detectLaragon();
  if (installs.length > 0) {
    document.getElementById(inputId).value = formatPath(installs[0].path);
    await updateLaragonPreview(
      installs[0].path,
      previewElId,
      projectListId,
      projectPickerId,
      showProjectList
    );
  }
}

function setupShowsProjectList() {
  return document.getElementById("setup-migrate-laragon")?.checked ?? false;
}

function isFreshInstall(status) {
  return !status?.hasExistingData && !status?.setupCompleted;
}

function configureSetupForExistingInstall(status) {
  if (isFreshInstall(status)) return;

  document.getElementById("setup-import-section")?.classList.add("hidden");
  document.getElementById("setup-migrate-laragon").checked = false;

  const stackCheck = document.getElementById("setup-install-stack");
  const startCheck = document.getElementById("setup-start-services");
  if (stackCheck) stackCheck.checked = false;
  if (startCheck) startCheck.checked = false;

  const subtitle = document.querySelector("#view-setup .subtitle");
  if (subtitle) {
    subtitle.textContent =
      "Your projects and data are already in this folder — click Get Started to finish config only (no import).";
  }
}

async function runLaragonMigration(laragonPath, projects) {
  const result = await api.migrateFromLaragon(laragonPath, projects);
  const dbCount = result.databaseDataCopied?.[0]?.databases?.length ?? 0;
  const runtimeCount = result.binariesCopied?.filter((b) => !b.note?.includes("skipped")).length ?? 0;
  const msg = [
    `Copied ${result.projectsCopied.length} project(s)`,
    result.projectsSkipped.length ? `${result.projectsSkipped.length} skipped (already existed)` : null,
    dbCount ? `${dbCount} database(s)` : null,
    `${result.phpIniCopied.length} php.ini file(s)`,
    runtimeCount ? `${runtimeCount} runtime(s) imported` : null,
    "Source folder was not modified.",
  ]
    .filter(Boolean)
    .join(" · ");
  showToast(msg, "success");
  return result;
}

async function boot() {
  if (!api) {
    showToast("DevTent bridge failed to load. Restart the app.", "error");
    return;
  }

  api.onProgress((payload) => handleProgress(payload));
  api.onRefresh(() => refreshAll().catch(console.error));
  api.onUpdateAvailable((result) => {
    if (result.status !== "available" || !result.update) return;
    pendingUpdate = result.update;
    setUpdateStatusLine(result);
    const setupVisible = !document.getElementById("view-setup")?.classList.contains("hidden");
    if (setupVisible) {
      showToast(`DevTent v${result.update.latestVersion} is available — check Settings when setup finishes`, "success", 8000);
      return;
    }
    showToast(`DevTent v${result.update.latestVersion} is available`, "success", 6000);
    showUpdateDialog(result.update);
  });
  api.onUpdateDownloadProgress(({ percent, message }) => setUpdateProgress(percent, message));
  api.onNavigate?.((view) => {
    showView(view);
    document.querySelectorAll(".nav-item").forEach((n) => {
      n.classList.toggle("active", n.dataset.view === view);
    });
    document.getElementById("page-title").textContent = TITLES[view] || view;
    if (view === "logs") void refreshLogs().then(startLogFollow);
    else stopLogFollow();
  });

  const defaultRoot = await api.getDefaultRoot();
  const rootStatus = await api.getRoot();

  document.getElementById("setup-root-path").textContent = formatPath(defaultRoot);
  document.getElementById("setup-www-path").textContent = formatPath(`${defaultRoot}\\www`);
  configureSetupForExistingInstall(rootStatus);

  const migrateCheck = document.getElementById("setup-migrate-laragon");
  const stackCheck = document.getElementById("setup-install-stack");
  const startCheck = document.getElementById("setup-start-services");
  migrateCheck.onchange = async () => {
    if (migrateCheck.checked) {
      stackCheck.checked = false;
      stackCheck.disabled = true;
      startCheck.checked = true;
      const laragonPath = document.getElementById("setup-laragon").value.trim();
      if (laragonPath) {
        await updateLaragonPreview(
          laragonPath,
          "setup-laragon-preview",
          "setup-laragon-project-list",
          "setup-laragon-projects",
          true
        );
      }
    } else {
      stackCheck.disabled = false;
      if (!rootStatus.hasExistingData && !rootStatus.setupCompleted) {
        stackCheck.checked = true;
      }
      document.getElementById("setup-laragon-projects")?.classList.add("hidden");
      document.getElementById("setup-laragon-project-list").innerHTML = "";
    }
  };
  stackCheck.onchange = () => {
    if (!stackCheck.checked) startCheck.checked = false;
    else if (!migrateCheck.checked) startCheck.checked = true;
  };

  if (!rootStatus.initialized) {
    if (!isFreshInstall(rootStatus)) {
      await withLoading(async () => {
        const root = await api.getDefaultRoot();
        await api.setRoot(root);
        await api.init(root);
      }, "Finishing setup…");
      await api.setWindowMode("dashboard");
      showSetup(false);
      await refreshAll();
      await refreshServices();
      await refreshProjects();
      await refreshManifests();
      await refreshTemplates();
      await refreshProfiles();
    } else {
      showSetup(true);
      await api.setWindowMode("setup");
    }
  } else {
    await api.setWindowMode("dashboard");
    showSetup(false);
    await refreshAll();
    await refreshServices();
    await refreshProjects();
    await refreshManifests();
    await refreshTemplates();
    await refreshProfiles();
  }

  document.getElementById("setup-laragon-browse").onclick = async () => {
    const picked = await api.pickLaragonRoot();
    if (picked) {
      document.getElementById("setup-laragon").value = formatPath(picked);
      await updateLaragonPreview(
        picked,
        "setup-laragon-preview",
        "setup-laragon-project-list",
        "setup-laragon-projects",
        setupShowsProjectList()
      );
    }
  };

  document.getElementById("setup-laragon-detect")?.addEventListener("click", async () => {
    await autoDetectLaragon(
      "setup-laragon",
      "setup-laragon-preview",
      "setup-laragon-project-list",
      "setup-laragon-projects",
      setupShowsProjectList()
    );
  });

  document.querySelectorAll(".migrate-project-actions button").forEach((btn) => {
    btn.onclick = () => {
      const list = document.getElementById(btn.dataset.target);
      if (!list) return;
      const checked = btn.dataset.action === "all";
      list.querySelectorAll(".migrate-project-cb").forEach((cb) => {
        cb.checked = checked;
      });
    };
  });

  document.getElementById("setup-init").onclick = async () => {
    const root = await api.getDefaultRoot();
    const { initialized: alreadyInitialized } = await api.getRoot();
    if (alreadyInitialized) {
      showToast("DevTent is already set up — opening dashboard", "success");
      await api.setWindowMode("dashboard");
      showSetup(false);
      await refreshAll();
      return;
    }

    const migrate =
      isFreshInstall(rootStatus) &&
      document.getElementById("setup-migrate-laragon").checked;
    const laragonPath = document.getElementById("setup-laragon").value.trim();
    const installStack =
      isFreshInstall(rootStatus) && document.getElementById("setup-install-stack").checked;
    const startServices = document.getElementById("setup-start-services").checked;
    const initBtn = document.getElementById("setup-init");

    setupActive = true;
    lastSetupPercent = 0;
    showSetupProgress(true);
    initBtn.disabled = true;

    try {
      setSetupProgress(3, "Preparing…");
      await api.setRoot(root);
      await api.init(root);
      if (migrate && laragonPath) {
        const list = document.getElementById("setup-laragon-project-list");
        const hasPicker = list?.querySelector(".migrate-project-cb");
        const projects = hasPicker ? getSelectedProjects("setup-laragon-project-list") : undefined;
        await api.migrateFromLaragon(laragonPath, projects);
      }
      if (installStack) {
        await api.installRecommendedStack();
      }
      if (startServices) {
        setSetupProgress(92, "Starting services…");
        await api.startAll();
        handleHostsSyncResult(await api.syncVhosts());
      }
      if (!migrate && !installStack) {
        setSetupProgress(100, "Environment ready");
      }
      await new Promise((r) => setTimeout(r, 400));

      const doneMsg =
        migrate && laragonPath
          ? "DevTent ready — environment imported!"
          : installStack && startServices
            ? "DevTent ready — stack installed and running!"
            : installStack
              ? "DevTent ready — recommended stack installed!"
              : "DevTent initialized!";
      showToast(doneMsg, "success");
      await api.setWindowMode("dashboard");
      showSetupProgress(false);
      showSetup(false);
      await refreshAll();
      await refreshServices();
      await refreshManifests();
      await refreshTemplates();
      await refreshProfiles();
      await refreshProjects();
    } catch (err) {
      showSetupProgress(false);
      showToast(err.message || String(err), "error");
    } finally {
      setupActive = false;
      initBtn.disabled = false;
    }
  };

  document.querySelectorAll(".nav-item").forEach((btn) => {
    btn.onclick = async () => {
      const view = btn.dataset.view;
      showView(view);
      if (view === "services") await refreshServices();
      if (view === "logs") {
        await refreshLogs();
        startLogFollow();
      } else {
        stopLogFollow();
      }
      if (view === "projects") await refreshProjects();
      if (view === "quick-add") await refreshManifests();
      if (view === "quick-app") await refreshTemplates();
      if (view === "profiles") {
        await refreshProfiles();
        hideProfileEditor();
      }
      if (view === "settings") {
        const { root } = await api.getRoot();
        await refreshSettings(root);
      }
    };
  });

  document.getElementById("btn-enable-core-services")?.addEventListener("click", async () => {
    const toggles = await api.getProcfileToggles();
    const coreIds = ["nginx", "mysql", "php-fpm"];
    for (const id of coreIds) {
      const svc = toggles.find((t) => t.id === id);
      if (svc?.runtimeInstalled && !svc.enabled) {
        await api.setProcfileToggle(id, true);
      }
    }
    showToast("Core services enabled", "success");
    await refreshServices();
    await refreshAll();
  });

  document.getElementById("btn-start-all").onclick = async () => {
    const results = await withLoading(() => api.startAll(), "Starting services…");
    const failed = (results ?? []).filter((r) => !r.running);
    if (failed.length) {
      const names = failed.map((r) => r.name).join(", ");
      const detail = failed[0]?.error ? ` ${failed[0].error}` : "";
      showToast(`Could not start: ${names}.${detail} Check Dashboard → Logs.`, "error");
    } else {
      showToast("All services started", "success");
    }
    await refreshAll();
    await refreshServices();
  };

  document.getElementById("btn-stop-all").onclick = async () => {
    await withLoading(() => api.stopAll(), "Stopping services…");
    showToast("All services stopped", "success");
    await refreshAll();
    await refreshServices();
  };

  document.getElementById("btn-sync-vhosts").onclick = async () => {
    const result = await withLoading(() => api.syncVhosts(), "Syncing virtual hosts…");
    handleHostsSyncResult(result);
    showHostsHelperHint(result?.hosts);
    await refreshProjects();
    await refreshAll();
  };

  document.getElementById("btn-update-hosts").onclick = async () => {
    const result = await withLoading(() => api.elevateHostsSync(), "Requesting Administrator approval…");
    handleHostsSyncResult({ hosts: result });
    showHostsHelperHint(result);
    if (result?.hostsHelperPath) {
      await api.openPath("tmp/devtent-sync-hosts.cmd");
    }
  };

  function showHostsHelperHint(hosts) {
    const el = document.getElementById("hosts-helper-hint");
    if (!el) return;
    if (hosts?.hostsHelperPath && (hosts.elevationRequested || hosts.elevationLaunchFailed)) {
      el.classList.remove("hidden");
      el.textContent = hosts.elevationLaunchFailed
        ? `Manual fallback: right-click ${formatPath(hosts.hostsHelperPath)} and choose Run as administrator.`
        : `If no UAC prompt appeared, right-click ${formatPath(hosts.hostsHelperPath)} and choose Run as administrator.`;
    } else {
      el.classList.add("hidden");
      el.textContent = "";
    }
  }

  document.getElementById("btn-open-www").onclick = () => api.openPath("www");

  document.getElementById("btn-create-project").onclick = async () => {
    const template = document.getElementById("template-select").value;
    const name = document.getElementById("project-name").value.trim();
    if (!name) return showToast("Enter a project name", "error");
    await withLoading(() => api.createProject(template, name), "Creating project…");
    showToast(`Project ${name} created`, "success");
    document.getElementById("project-name").value = "";
    await refreshProjects();
    await refreshAll();
  };

  document.getElementById("btn-create-php").onclick = async () => {
    const name = document.getElementById("php-project-name").value.trim();
    if (!name) return showToast("Enter a project name", "error");
    await withLoading(() => api.createProject("php", name), "Creating PHP project…");
    showToast(`Project ${name} created`, "success");
    document.getElementById("php-project-name").value = "";
    await refreshProjects();
    await refreshAll();
  };

  document.getElementById("btn-open-root").onclick = () => api.openPath(".");
  document.getElementById("btn-open-www-settings").onclick = () => api.openPath("www");
  document.getElementById("btn-open-logs").onclick = () => {
    showView("logs");
    document.querySelectorAll(".nav-item").forEach((n) => {
      n.classList.toggle("active", n.dataset.view === "logs");
    });
    document.getElementById("page-title").textContent = TITLES.logs;
    void refreshLogs().then(startLogFollow);
  };

  document.getElementById("log-file-select")?.addEventListener("change", async (e) => {
    selectedLogFile = e.target.value;
    await refreshLogs(selectedLogFile);
    startLogFollow();
  });

  document.getElementById("btn-log-refresh")?.addEventListener("click", () => refreshLogs());

  document.getElementById("log-follow")?.addEventListener("change", () => {
    if (document.getElementById("log-follow").checked) startLogFollow();
    else stopLogFollow();
  });

  document.getElementById("btn-open-logs-folder")?.addEventListener("click", () => api.openPath("logs"));

  document.getElementById("btn-open-bin").onclick = () => api.openPath("bin");
  document.getElementById("btn-open-terminal").onclick = () => api.openTerminal();
  document.getElementById("btn-github").onclick = () => api.openExternal(GITHUB_REPO_URL);

  document.getElementById("btn-check-updates")?.addEventListener("click", async () => {
    const btn = document.getElementById("btn-check-updates");
    btn.disabled = true;
    try {
      const result = await withLoading(() => runUpdateCheck({ showDialogOnAvailable: true }), "Checking for updates…");
      if (result.status === "up-to-date") {
        showToast(`You're on the latest version (v${result.currentVersion})`, "success");
      } else if (result.status === "dev") {
        showToast(result.message, "error");
      } else if (result.status === "error") {
        showToast(result.message, "error");
      }
    } finally {
      btn.disabled = false;
    }
  });

  document.getElementById("btn-rollback-app")?.addEventListener("click", async () => {
    const btn = document.getElementById("btn-rollback-app");
    if (!confirm("Restore the previous DevTent version? The app will restart.")) return;
    btn.disabled = true;
    try {
      await api.rollbackApp();
    } catch (err) {
      btn.disabled = false;
      showToast(err?.message || String(err), "error");
    }
  });

  document.getElementById("btn-update-install")?.addEventListener("click", async () => {
    if (!pendingUpdate || updateInstalling) return;
    updateInstalling = true;
    const installBtn = document.getElementById("btn-update-install");
    installBtn.disabled = true;
    try {
      setUpdateProgress(0, "Preparing download…");
      await api.downloadAndInstallUpdate(pendingUpdate);
    } catch (err) {
      updateInstalling = false;
      installBtn.disabled = false;
      document.getElementById("update-actions")?.classList.remove("hidden");
      showToast(err.message || String(err), "error");
    }
  });

  document.getElementById("btn-update-release-notes")?.addEventListener("click", () => {
    if (pendingUpdate?.releaseUrl) api.openExternal(pendingUpdate.releaseUrl);
  });

  document.getElementById("btn-update-later")?.addEventListener("click", () => hideUpdateDialog());

  document.getElementById("btn-update-skip")?.addEventListener("click", async () => {
    if (pendingUpdate?.latestVersion) {
      await api.skipUpdateVersion(pendingUpdate.latestVersion);
      showToast(`Skipped v${pendingUpdate.latestVersion}`, "success");
    }
    hideUpdateDialog();
  });

  document.getElementById("update-overlay")?.addEventListener("click", (e) => {
    if (e.target.id === "update-overlay" && !updateInstalling) hideUpdateDialog();
  });

  document.getElementById("btn-install-recommended-stack")?.addEventListener("click", async () => {
    await withLoading(() => api.installRecommendedStack(), "Installing recommended stack…");
    showToast("Recommended stack installed", "success");
    await refreshAll();
    await refreshServices();
    await refreshManifests();
  });

  document.getElementById("btn-backup-mysql")?.addEventListener("click", async () => {
    const backup = await withLoading(() => api.backupMysql(), "Backing up MySQL…");
    if (backup) {
      showToast(`Backup saved (${Math.round(backup.sizeBytes / 1024)} KB)`, "success");
    } else {
      showToast("MySQL is not running — start it first to back up", "error");
    }
    await refreshMysqlBackups();
  });

  document.getElementById("btn-new-profile")?.addEventListener("click", () => {
    void showProfileEditor("create");
  });
  document.getElementById("btn-save-profile")?.addEventListener("click", () => {
    void saveProfileEditor();
  });
  document.getElementById("btn-cancel-profile")?.addEventListener("click", hideProfileEditor);

  document.getElementById("btn-migrate-laragon-browse").onclick = async () => {
    const picked = await api.pickLaragonRoot();
    if (picked) {
      document.getElementById("migrate-laragon-path").value = formatPath(picked);
      await updateLaragonPreview(
        picked,
        "migrate-laragon-preview",
        "migrate-laragon-project-list",
        "migrate-laragon-projects"
      );
    }
  };

  document.getElementById("btn-migrate-laragon-detect")?.addEventListener("click", async () => {
    await autoDetectLaragon(
      "migrate-laragon-path",
      "migrate-laragon-preview",
      "migrate-laragon-project-list",
      "migrate-laragon-projects"
    );
  });

  document.getElementById("btn-migrate-laragon").onclick = async () => {
    const laragonPath = document.getElementById("migrate-laragon-path").value.trim();
    if (!laragonPath) return showToast("Select your environment folder first", "error");
    const projects = getSelectedProjects("migrate-laragon-project-list");
    const resultEl = document.getElementById("migrate-laragon-result");
    try {
      const result = await withLoading(
        () => runLaragonMigration(laragonPath, projects),
        "Importing environment…"
      );
      resultEl.textContent = `Done: ${result.projectsCopied.length} projects, ${result.databaseDataCopied?.[0]?.databases?.length ?? 0} databases, ${result.binariesCopied?.filter((b) => !b.note?.includes("skipped")).length ?? 0} runtimes. Report: etc/laragon-migration/`;
      await refreshProjects();
      await refreshAll();
    } catch (err) {
      resultEl.textContent = err.message || String(err);
    }
  };

  document.getElementById("btn-change-root").onclick = async () => {
    const picked = await api.pickRoot();
    if (!picked) return;
    const { initialized } = await api.setRoot(picked);
    if (!initialized) {
      showSetup(true);
      await api.setWindowMode("setup");
    } else {
      await refreshAll();
      showToast("Root changed", "success");
    }
  };
}

boot().catch((err) => {
  showToast(err.message || "Failed to start", "error");
  console.error(err);
});
