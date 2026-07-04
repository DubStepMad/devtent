/** @typedef {import('../../preload').DevTentApi} DevTentApi */

/** @type {DevTentApi | undefined} */
const api = window.devtent;

const GITHUB_REPO_URL = "https://github.com/DubStepMad/devtent";

const TITLES = {
  dashboard: "Dashboard",
  services: "Services",
  logs: "Logs",
  node: "Node",
  projects: "Projects",
  "quick-add": "Quick Add",
  "quick-app": "Quick App",
  profiles: "Profiles",
  settings: "Settings",
};

function projectUrl(vhost) {
  return `${vhost.ssl ? "https" : "http"}://${vhost.domain}`;
}

function markOnboardingStep(step, state) {
  const el = document.getElementById(`onboarding-step-${step}`);
  if (!el) return;
  el.classList.remove("done", "active", "failed");
  if (state) el.classList.add(state);
}

function showOnboarding(show) {
  document.getElementById("onboarding-overlay")?.classList.toggle("hidden", !show);
}

async function runOnboarding() {
  const btn = document.getElementById("btn-onboarding-run");
  btn.disabled = true;
  try {
    markOnboardingStep(1, "active");
    await withLoading(() => api.createProject("php", "demo"), "Creating demo project…");
    markOnboardingStep(1, "done");

    markOnboardingStep(2, "active");
    handleHostsSyncResult(await api.syncVhosts());
    markOnboardingStep(2, "done");

    markOnboardingStep(3, "active");
    handleHostsSyncResult(await api.elevateHostsSync());
    markOnboardingStep(3, "done");

    markOnboardingStep(4, "active");
    const state = await api.getState();
    const demo = state.virtualHosts?.find((v) => v.name === "demo");
    if (demo) await api.openExternal(projectUrl(demo));
    markOnboardingStep(4, "done");
    showToast("Demo site ready at demo.test", "success");
    showOnboarding(false);
    localStorage.setItem("devtent-onboarding-done", "1");
    await refreshAll();
  } catch (err) {
    showToast(err.message || String(err), "error");
  } finally {
    btn.disabled = false;
  }
}

function maybeShowOnboarding(state) {
  if (localStorage.getItem("devtent-onboarding-done")) return;
  if (!state?.virtualHosts?.length) {
    showOnboarding(true);
  }
}
let toastTimer = null;
let setupActive = false;
let lastSetupPercent = 0;
let pendingUpdate = null;
let updateInstalling = false;
let logFollowTimer = null;
let logListRefreshTimer = null;
let logSearchTimer = null;
let selectedLogFile = "";
let lastLogFileSignature = "";

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
  if (hosts?.hostsCurrent) {
    showToast("Virtual hosts synced — hosts file already up to date", "success");
    return;
  }
  if (hosts?.elevationPending) {
    showToast(
      "Virtual host configs synced. Click Update hosts file (Admin) to add *.test domains.",
      "info"
    );
    return;
  }
  if (hosts?.elevationLaunchFailed) {
    showToast(hosts.message || "Could not open the Administrator prompt.", "error");
    return;
  }
  if (hosts?.elevationRequested) {
    showToast(
      hosts.message ||
        "Click Yes on the Windows security prompt to update your hosts file.",
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
  } else {
    state.virtualHosts.slice(0, 5).forEach((v) => {
      const li = document.createElement("li");
      const url = projectUrl(v);
      li.innerHTML = `<button class="link-btn" data-url="${url}">${url}${v.ssl ? " 🔒" : ""}</button>`;
      li.querySelector("button").onclick = () => api.openExternal(url);
      list.appendChild(li);
    });
  }

  await refreshHealth();
}

async function refreshHealth() {
  const list = document.getElementById("health-list");
  if (!list || !api?.getEnvironmentHealth) return;
  const items = await api.getEnvironmentHealth();
  if (!items.length) {
    list.innerHTML = "<li>No health data yet.</li>";
    return;
  }
  list.innerHTML = items
    .map((item) => {
      const icon = item.severity === "ok" ? "✓" : item.severity === "warn" ? "!" : "✕";
      const detail = item.detail ? `<span class="health-detail">${escapeHtml(item.detail)}</span>` : "";
      const action = item.action
        ? ` <button type="button" class="link-btn health-action" data-view="${item.action}">Fix</button>`
        : "";
      return `<li class="health-item health-${item.severity}"><span class="health-icon">${icon}</span><span class="health-title">${escapeHtml(item.title)}</span>${detail}${action}</li>`;
    })
    .join("");
  list.querySelectorAll(".health-action").forEach((btn) => {
    btn.onclick = () => {
      showView(btn.dataset.view);
      if (btn.dataset.view === "services") void refreshServices();
      if (btn.dataset.view === "settings") void api.getRoot().then((r) => refreshSettings(r.root));
    };
  });
}

function renderLogViewerContent(viewer, content, searchQuery = "") {
  if (!viewer) return;
  const q = searchQuery.trim().toLowerCase();
  const lines = (content || "(empty)").split(/\r?\n/);
  viewer.innerHTML = lines
    .map((line, index) => {
      const lineNum = index + 1;
      let html = escapeHtml(line);
      if (q && line.toLowerCase().includes(q)) {
        const re = new RegExp(`(${escapeRegex(q)})`, "ig");
        html = html.replace(re, '<mark class="log-highlight">$1</mark>');
      }
      const locMatch = line.match(
        /([A-Za-z]:\\[^\s:(]+\.(?:php|js|ts|tsx|jsx|vue)|\/[^\s:(]+\.(?:php|js|ts|tsx|jsx|vue))(?:[:(](\d+)|\s+on\s+line\s+(\d+))/i
      );
      let openBtn = "";
      if (locMatch) {
        const filePath = locMatch[1];
        const lineNo = Number(locMatch[2] || locMatch[3] || 1);
        openBtn = `<button type="button" class="link-btn log-open-ide" data-file="${escapeHtml(filePath)}" data-line="${lineNo}">Open in editor</button>`;
      }
      return `<div class="log-line" data-line="${lineNum}"><span class="log-line-no">${lineNum}</span><span class="log-line-text">${html}</span>${openBtn}</div>`;
    })
    .join("");
  viewer.querySelectorAll(".log-open-ide").forEach((btn) => {
    btn.onclick = async (e) => {
      e.stopPropagation();
      const result = await api.openLogInEditor(btn.dataset.file, Number(btn.dataset.line));
      showToast(result.message, result.opened ? "success" : "error");
    };
  });
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function runLogSearch() {
  const query = document.getElementById("log-search-input")?.value?.trim() ?? "";
  const resultsEl = document.getElementById("log-search-results");
  if (!resultsEl || !api?.searchLogs) return;

  if (!query) {
    resultsEl.classList.add("hidden");
    resultsEl.innerHTML = "";
    const viewer = document.getElementById("log-viewer");
    if (viewer && selectedLogFile) {
      const content = await api.readLogTail(selectedLogFile, 500);
      renderLogViewerContent(viewer, content);
    }
    return;
  }

  const matches = await api.searchLogs(query, selectedLogFile || undefined);
  if (!matches.length) {
    resultsEl.classList.remove("hidden");
    resultsEl.innerHTML = "<li class='empty-hint'>No matches found.</li>";
    return;
  }

  resultsEl.classList.remove("hidden");
  resultsEl.innerHTML = matches
    .slice(0, 50)
    .map(
      (m) =>
        `<li><button type="button" class="log-search-hit" data-file="${escapeHtml(m.fileName)}" data-line="${m.lineNumber}"><strong>${escapeHtml(m.fileName)}:${m.lineNumber}</strong> ${escapeHtml(m.line.slice(0, 120))}</button></li>`
    )
    .join("");

  resultsEl.querySelectorAll(".log-search-hit").forEach((btn) => {
    btn.onclick = async () => {
      selectedLogFile = btn.dataset.file;
      document.getElementById("log-file-select").value = selectedLogFile;
      await refreshLogs(selectedLogFile);
      const lineEl = document.querySelector(`.log-line[data-line="${btn.dataset.line}"]`);
      lineEl?.scrollIntoView({ block: "center" });
      lineEl?.classList.add("log-line-focus");
      setTimeout(() => lineEl?.classList.remove("log-line-focus"), 2000);
    };
  });
}

function logFilesSignature(files) {
  return files.map((f) => `${f.name}:${f.sizeBytes}:${f.modifiedAt}`).join("|");
}

async function refreshLogs(fileName = selectedLogFile) {
  const select = document.getElementById("log-file-select");
  const viewer = document.getElementById("log-viewer");
  if (!select || !viewer || !api?.listLogs) return;

  const files = await api.listLogs();
  const signature = logFilesSignature(files);
  const listChanged = signature !== lastLogFileSignature;
  lastLogFileSignature = signature;

  const current = select.value;
  if (listChanged) {
    select.innerHTML =
      '<option value="">Select a log file…</option>' +
      files
        .map(
          (f) =>
            `<option value="${escapeHtml(f.name)}">${escapeHtml(f.label ?? f.name)} (${Math.max(1, Math.round(f.sizeBytes / 1024))} KB)</option>`
        )
        .join("");
  }

  const target = fileName || current;
  const searchQuery = document.getElementById("log-search-input")?.value ?? "";
  if (target && files.some((f) => f.name === target)) {
    select.value = target;
    selectedLogFile = target;
    const content = await api.readLogTail(target, 500);
    renderLogViewerContent(viewer, content, searchQuery);
    viewer.scrollTop = viewer.scrollHeight;
  } else if (!files.length) {
    viewer.textContent = "No log files yet — start a service to generate logs.";
  }
}

function stopLogListRefresh() {
  if (logListRefreshTimer) {
    clearInterval(logListRefreshTimer);
    logListRefreshTimer = null;
  }
}

function startLogListRefresh() {
  stopLogListRefresh();
  logListRefreshTimer = setInterval(() => {
    void refreshLogs(selectedLogFile);
  }, 2000);
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

async function refreshNode() {
  const tbody = document.getElementById("node-versions-list");
  const empty = document.getElementById("node-empty");
  if (!tbody || !api?.listNodeVersions) return;

  const versions = await api.listNodeVersions();
  tbody.innerHTML = "";
  if (!versions.length) {
    empty?.classList.remove("hidden");
    return;
  }
  empty?.classList.add("hidden");

  versions.forEach((v) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(v.label)}</td>
      <td>${v.installed ? "Yes" : "—"}</td>
      <td><input type="radio" name="active-node" value="${escapeHtml(v.id)}" ${v.active ? "checked" : ""} ${!v.installed ? "disabled" : ""}></td>
      <td></td>`;
    const actionCell = tr.querySelector("td:last-child");
    if (v.installed) {
      actionCell.textContent = "Installed";
    } else {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn sm primary";
      btn.textContent = "Install";
      btn.onclick = async () => {
        btn.disabled = true;
        btn.textContent = "Installing…";
        try {
          await withLoading(() => api.installNodeVersion(v.id), `Installing ${v.label}…`);
          showToast(`${v.label} installed`, "success");
          await refreshNode();
          await refreshManifests();
        } catch (err) {
          btn.disabled = false;
          btn.textContent = "Install";
          showToast(err.message || String(err), "error");
        }
      };
      actionCell.appendChild(btn);
    }
    tr.querySelector('input[type="radio"]')?.addEventListener("change", async (e) => {
      if (!e.target.checked) return;
      await withLoading(() => api.setActiveNodeVersion(v.id), `Switching to ${v.label}…`);
      showToast(`Active Node: ${v.label}`, "success");
      await refreshNode();
    });
    tbody.appendChild(tr);
  });
}

async function confirmAndSwitchProfile(targetName) {
  const { active } = await api.listProfiles();
  if (targetName === active) return false;

  const preview = await api.previewProfileSwitch(targetName);
  let message = `Switch to profile "${targetName}"?`;
  if (preview.runningToStop.length) {
    message += `\n\nThese running services are not in that profile and will be stopped:\n${preview.runningToStop.join(", ")}`;
  }
  if (!confirm(message)) return false;

  const result = await withLoading(() => api.switchProfile(targetName), "Switching profile…");
  if (result.stoppedServices?.length) {
    showToast(`Stopped: ${result.stoppedServices.join(", ")}`, "info");
  }
  showToast(`Active profile: ${targetName}`, "success");
  return true;
}

let servicesProfileSelectBound = false;

async function refreshServicesProfileSelect() {
  const select = document.getElementById("services-profile-select");
  if (!select) return;

  const { active, profiles } = await api.listProfiles();
  select.innerHTML = "";
  profiles.forEach((p) => {
    const opt = document.createElement("option");
    opt.value = p.name;
    opt.textContent = p.description ? `${p.name} — ${p.description}` : p.name;
    if (p.name === active) opt.selected = true;
    select.appendChild(opt);
  });

  if (!servicesProfileSelectBound) {
    servicesProfileSelectBound = true;
    select.addEventListener("change", async () => {
      const target = select.value;
      const switched = await confirmAndSwitchProfile(target);
      if (!switched) {
        const { active: current } = await api.listProfiles();
        select.value = current;
        return;
      }
      await refreshServices();
      await refreshAll();
    });
  } else {
    select.value = active;
  }
}

async function refreshServices() {
  await refreshServicesProfileSelect();

  const { active } = await api.listProfiles();
  const services = await api.getProfileServices(active);
  const running = await api.getServices();
  const runningMap = new Map(running.map((s) => [s.name, s]));
  const list = document.getElementById("services-list");
  const empty = document.getElementById("services-empty");
  list.innerHTML = "";

  if (!services.length) {
    empty.classList.remove("hidden");
    return;
  }
  empty.classList.add("hidden");

  services.forEach((svc) => {
    const li = document.createElement("li");
    const isRunning = runningMap.get(svc.id)?.running;
    const dotClass = isRunning ? "running" : "stopped";
    const statusText = isRunning
      ? `Running · pid ${runningMap.get(svc.id)?.pid ?? "?"}`
      : svc.runtimeInstalled
        ? "Not running"
        : "Runtime not installed";
    const runtimeLabel = svc.runtimeInstalled
      ? ""
      : '<span class="service-badge missing">runtime not installed</span>';
    const controlsDisabled = !svc.runtimeInstalled ? "disabled" : "";

    li.innerHTML = `
      <div class="service-info">
        <div class="service-name">
          <span class="status-dot ${dotClass}"></span>${svc.name}${runtimeLabel}
        </div>
        <div class="service-cmd">${svc.command}</div>
        <div class="service-cmd">${statusText}</div>
      </div>
      <div class="service-actions">
        <button class="btn sm success btn-start-svc" ${controlsDisabled}>Start</button>
        <button class="btn sm secondary btn-stop-svc" ${controlsDisabled}>Stop</button>
        <button class="btn sm secondary btn-restart-svc" ${controlsDisabled}>Restart</button>
      </div>`;

    li.querySelector(".btn-start-svc").onclick = async () => {
      if (!svc.runtimeInstalled) {
        showToast(`Install ${svc.name} via Quick Add first`, "error");
        return;
      }
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
      if (!svc.runtimeInstalled) return;
      await withLoading(() => api.stopService(svc.id), `Stopping ${svc.name}…`);
      showToast(`${svc.name} stopped`, "success");
      await refreshAll();
      await refreshServices();
    };

    li.querySelector(".btn-restart-svc").onclick = async () => {
      if (!svc.runtimeInstalled) {
        showToast(`Install ${svc.name} via Quick Add first`, "error");
        return;
      }
      const result = await withLoading(
        () => api.restartService(svc.id),
        `Restarting ${svc.name}…`
      );
      if (!result?.running) {
        showToast(result?.error || `${svc.name} failed to restart — check logs/${svc.id}.log`, "error");
      } else {
        showToast(`${svc.name} restarted`, "success");
      }
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
    const url = projectUrl(v);
    li.innerHTML = `
      <div class="project-info">
        <div class="project-name">${v.name}${v.ssl ? " 🔒" : ""}</div>
        <div class="project-url">${url}</div>
      </div>
      <div class="project-actions">
        <button class="btn sm primary btn-open">Open</button>
        <button class="btn sm secondary btn-ssl">${v.ssl ? "Renew SSL" : "SSL"}</button>
        <button class="btn sm secondary btn-folder">Folder</button>
      </div>`;
    li.querySelector(".btn-open").onclick = () => api.openExternal(url);
    li.querySelector(".btn-ssl").onclick = async () => {
      const result = await withLoading(() => api.enableSsl(v.domain), "Generating certificate…");
      showToast(result.message, result.success ? "success" : "error");
      if (result.success) {
        await refreshProjects();
        await refreshAll();
      }
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
  for (const id of profile.services ?? []) {
    parts.push(id);
  }
  return parts.join(" · ") || "Stack not configured";
}

function syncProfileDatabaseToggle() {
  const enabled = document.getElementById("profile-service-database")?.checked ?? true;
  const typeSelect = document.getElementById("profile-database-type");
  if (typeSelect) typeSelect.disabled = !enabled;
}

function readProfileServicesFromEditor() {
  const databaseEnabled = document.getElementById("profile-service-database")?.checked ?? true;
  const database = databaseEnabled
    ? document.getElementById("profile-database-type")?.value || "mysql"
    : "none";
  const services = [];
  if (document.getElementById("profile-service-redis")?.checked) services.push("redis");
  if (document.getElementById("profile-service-mailpit")?.checked) services.push("mailpit");
  return { database, services };
}

function applyProfileServicesToEditor(profile) {
  const hasDatabase = !profile.database || profile.database !== "none";
  const databaseToggle = document.getElementById("profile-service-database");
  const databaseType = document.getElementById("profile-database-type");
  if (databaseToggle) databaseToggle.checked = hasDatabase;
  if (databaseType) databaseType.value = hasDatabase ? profile.database || "mysql" : "mysql";
  const redisToggle = document.getElementById("profile-service-redis");
  const mailpitToggle = document.getElementById("profile-service-mailpit");
  if (redisToggle) redisToggle.checked = profile.services?.includes("redis") ?? false;
  if (mailpitToggle) mailpitToggle.checked = profile.services?.includes("mailpit") ?? false;
  syncProfileDatabaseToggle();
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
    applyProfileServicesToEditor({ database: "mysql", services: [] });
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
  applyProfileServicesToEditor(profile);
  await populatePhpVersionSelect(profile.phpVersion || "php-8.3");
}

async function saveProfileEditor() {
  const { database, services } = readProfileServicesFromEditor();
  const payload = {
    description: document.getElementById("profile-description").value.trim(),
    phpVersion: document.getElementById("profile-php-version").value,
    webServer: document.getElementById("profile-web-server").value,
    database,
    services,
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
      const switched = await confirmAndSwitchProfile(p.name);
      if (!switched) return;
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
  const rootStatus = await api.getRoot();
  const stopOnQuit = document.getElementById("settings-stop-on-quit");
  if (stopOnQuit) stopOnQuit.checked = rootStatus.stopServicesOnQuit !== false;

  const launchAtLogin = document.getElementById("settings-launch-at-login");
  const launchWrap = document.getElementById("settings-launch-at-login-wrap");
  const launchHint = document.getElementById("settings-launch-at-login-hint");
  if (launchAtLogin) {
    launchAtLogin.checked = rootStatus.launchAtLogin === true;
    const available = rootStatus.launchAtLoginAvailable === true;
    launchAtLogin.disabled = !available;
    launchWrap?.classList.toggle("disabled", !available);
    if (launchHint) {
      launchHint.textContent = available
        ? "Opens to the system tray only — no dashboard window on boot."
        : "Available in the installed DevTent app (not when running from source with npm start).";
    }
  }

  const autoStart = document.getElementById("settings-auto-start-services");
  if (autoStart) autoStart.checked = rootStatus.autoStartServices === true;

  await refreshMysqlBackups();
  await refreshAppRollback();
  await refreshAboutVersion();
}

function showSettingsSection(section) {
  document.querySelectorAll(".settings-nav-item").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.settingsSection === section);
  });
  document.querySelectorAll(".settings-section").forEach((el) => {
    const match = el.dataset.settingsSection === section;
    el.classList.toggle("hidden", !match);
    el.classList.toggle("active", match);
  });
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
      return `<li class="backup-row">${when} · ${b.reason} · ${sizeKb} KB <button type="button" class="link-btn btn-restore-mysql" data-id="${escapeHtml(b.id)}">Restore</button></li>`;
    })
    .join("");
  list.querySelectorAll(".btn-restore-mysql").forEach((btn) => {
    btn.onclick = async () => {
      if (!confirm(`Restore MySQL from backup ${btn.dataset.id}? This overwrites current database data.`)) return;
      const result = await withLoading(
        () => api.restoreMysql(btn.dataset.id),
        "Restoring MySQL…"
      );
      showToast(result.message, result.success ? "success" : "error");
    };
  });
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

function isFreshInstall(status) {
  return !status?.hasExistingData && !status?.setupCompletedForRoot;
}

function configureSetupForExistingInstall(status) {
  if (isFreshInstall(status)) return;

  const stackCheck = document.getElementById("setup-install-stack");
  const startCheck = document.getElementById("setup-start-services");
  if (stackCheck) stackCheck.checked = false;
  if (startCheck) startCheck.checked = false;

  const subtitle = document.querySelector("#view-setup .subtitle");
  if (subtitle) {
    subtitle.textContent =
      "Your projects and data are already in this folder — click Get Started to finish config only.";
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

  const stackCheck = document.getElementById("setup-install-stack");
  const startCheck = document.getElementById("setup-start-services");
  stackCheck.onchange = () => {
    if (!stackCheck.checked) startCheck.checked = false;
    else startCheck.checked = true;
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

    const latestStatus = await api.getRoot();
    const freshInstall = isFreshInstall(latestStatus);
    const installStack =
      freshInstall && document.getElementById("setup-install-stack").checked;
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
      if (installStack) {
        await api.installRecommendedStack();
      }
      if (startServices) {
        setSetupProgress(92, "Starting services…");
        await api.startAll();
        handleHostsSyncResult(await api.syncVhosts());
      }
      if (!installStack) {
        setSetupProgress(100, "Environment ready");
      }
      await new Promise((r) => setTimeout(r, 400));

      const doneMsg =
        installStack && startServices
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
      maybeShowOnboarding(await api.getState());
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
        startLogListRefresh();
      } else {
        stopLogFollow();
        stopLogListRefresh();
      }
      if (view === "node") await refreshNode();
      if (view === "projects") await refreshProjects();
      if (view === "quick-add") await refreshManifests();
      if (view === "quick-app") await refreshTemplates();
      if (view === "profiles") {
        await refreshProfiles();
        hideProfileEditor();
      }
      if (view === "settings") {
        const { root } = await api.getRoot();
        showSettingsSection("general");
        await refreshSettings(root);
      }
    };
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
    if (hosts?.hostsHelperPath && (hosts.elevationPending || hosts.elevationRequested || hosts.elevationLaunchFailed)) {
      el.classList.remove("hidden");
      el.textContent = hosts.elevationPending
        ? "Hosts file still needs admin approval — click Update hosts file (Admin) above."
        : hosts.elevationLaunchFailed
        ? `Manual fallback: right-click ${formatPath(hosts.hostsHelperPath)} and choose Run as administrator.`
        : `If no UAC prompt appeared after clicking Continue, right-click ${formatPath(hosts.hostsHelperPath)} and choose Run as administrator.`;
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
    void runLogSearch();
  });

  document.getElementById("btn-log-refresh")?.addEventListener("click", () => refreshLogs());

  document.getElementById("log-search-input")?.addEventListener("input", () => {
    if (logSearchTimer) clearTimeout(logSearchTimer);
    logSearchTimer = setTimeout(() => {
      void runLogSearch();
    }, 250);
  });

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

  document.getElementById("btn-open-mysql-backups")?.addEventListener("click", () => {
    api.openPath("data/backups/mysql");
  });

  document.querySelectorAll(".settings-nav-item").forEach((btn) => {
    btn.addEventListener("click", () => {
      showSettingsSection(btn.dataset.settingsSection);
    });
  });

  document.getElementById("settings-stop-on-quit")?.addEventListener("change", async (e) => {
    await api.setStopServicesOnQuit(e.target.checked);
    showToast(e.target.checked ? "Services will stop on quit" : "Fast quit enabled", "success");
  });

  document.getElementById("settings-launch-at-login")?.addEventListener("change", async (e) => {
    try {
      await api.setLaunchAtLogin(e.target.checked);
      showToast(
        e.target.checked ? "DevTent will start with Windows" : "Start with Windows disabled",
        "success"
      );
    } catch (err) {
      e.target.checked = !e.target.checked;
      showToast(err.message || String(err), "error");
    }
  });

  document.getElementById("settings-auto-start-services")?.addEventListener("change", async (e) => {
    await api.setAutoStartServices(e.target.checked);
    showToast(
      e.target.checked ? "Services will auto-start when DevTent opens" : "Auto-start disabled",
      "success"
    );
  });

  document.getElementById("btn-export-environment")?.addEventListener("click", async () => {
    const dest = await api.pickExportFolder();
    if (!dest) return;
    const includeBin = confirm("Include bin/ runtimes? (Large — usually reinstall via Quick Add instead)");
    const result = await withLoading(
      () => api.exportEnvironment(dest, { includeBin }),
      "Exporting environment…"
    );
    document.getElementById("portability-result").textContent = `Exported to ${formatPath(result.destPath)}: ${result.included.join(", ")}`;
    showToast("Environment exported", "success");
  });

  document.getElementById("btn-import-environment")?.addEventListener("click", async () => {
    const bundle = await api.pickImportBundle();
    if (!bundle) return;
    if (!confirm("Import will merge bundle contents into your DevTent folder. Continue?")) return;
    const result = await withLoading(
      () => api.importEnvironmentBundle(bundle),
      "Importing bundle…"
    );
    document.getElementById("portability-result").textContent = `Imported: ${result.imported.join(", ")}`;
    showToast("Environment imported", "success");
    await refreshAll();
  });

  document.getElementById("btn-onboarding-run")?.addEventListener("click", () => {
    void runOnboarding();
  });
  document.getElementById("btn-onboarding-skip")?.addEventListener("click", () => {
    localStorage.setItem("devtent-onboarding-done", "1");
    showOnboarding(false);
  });

  document.getElementById("btn-new-profile")?.addEventListener("click", () => {
    void showProfileEditor("create");
  });
  document.getElementById("btn-save-profile")?.addEventListener("click", () => {
    void saveProfileEditor();
  });
  document.getElementById("btn-cancel-profile")?.addEventListener("click", hideProfileEditor);
  document.getElementById("profile-service-database")?.addEventListener("change", syncProfileDatabaseToggle);

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
