/** @typedef {import('../../preload').DevTentApi} DevTentApi */

/** @type {DevTentApi | undefined} */
const api = window.devtent;

const GITHUB_REPO_URL = "https://github.com/DubStepMad/devtent";

const TITLES = {
  dashboard: "Dashboard",
  services: "Services",
  logs: "Logs",
  dumps: "Dumps",
  tooling: "Tooling",
  projects: "Projects",
  "quick-add": "Quick Add",
  "quick-app": "Quick App",
  profiles: "Profiles",
  settings: "Settings",
};

const SUBTITLES = {
  dashboard: "Stack health and quick actions",
  services: "Start, stop, and monitor your stack",
  logs: "Service output and search",
  dumps: "Live PHP dumps and Laravel queries",
  tooling: "Composer, Node, Bun, and PATH",
  projects: "Sites, SSL, park, and link",
  "quick-add": "Install stack components",
  "quick-app": "Scaffold a new project",
  profiles: "Named stacks and presets",
  settings: "Paths, updates, and preferences",
};

const TOOL_ICONS = {
  composer: "C",
  node: "N",
  bun: "B",
  laravel: "L",
};

let currentDumpFilter = "all";
let currentView = "dashboard";
let lastLogContentSignature = "";
let lastDumpsSignature = "";
let refreshInFlight = null;

const QUICK_ADD_HIDDEN = new Set(["composer", "bun", "cloudflared"]);

const QUICK_ADD_GROUPS = [
  { label: "PHP runtimes", match: (name) => name.startsWith("php-") },
  { label: "Web servers", match: (name) => name === "nginx" || name.startsWith("apache") },
  {
    label: "Databases",
    match: (name) =>
      name.startsWith("mysql") || name.startsWith("mariadb") || name.startsWith("postgresql"),
  },
  { label: "Cache, mail & SSL", match: (name) => ["redis", "mailpit", "mkcert"].includes(name) },
  { label: "Other tools", match: () => true },
];

function listQuickAddManifests(manifests) {
  return manifests.filter(
    (m) => !QUICK_ADD_HIDDEN.has(m.name) && !m.name.startsWith("node-")
  );
}

function groupQuickAddManifests(manifests) {
  const filtered = listQuickAddManifests(manifests);
  const used = new Set();
  const groups = [];
  for (const group of QUICK_ADD_GROUPS) {
    const items = filtered.filter((m) => !used.has(m.name) && group.match(m.name));
    items.forEach((m) => used.add(m.name));
    if (items.length) groups.push({ label: group.label, items });
  }
  return groups;
}

async function updateDomainHints(rootStatus) {
  const tld = rootStatus?.tld || "localhost";
  const zeroAdmin = rootStatus?.zeroAdminDomains === true;
  const domainHint = document.getElementById("projects-domain-hint");
  if (domainHint) domainHint.textContent = `*.${tld}`;
  document.querySelectorAll(".parked-tld-hint").forEach((el) => {
    el.textContent = tld;
  });
  const hostsBtn = document.getElementById("btn-update-hosts");
  if (hostsBtn) hostsBtn.classList.toggle("hidden", zeroAdmin);
  const hostsHint = document.getElementById("hosts-helper-hint");
  if (hostsHint && zeroAdmin) {
    hostsHint.textContent =
      "Using .localhost domains — browsers resolve these without editing the hosts file.";
    hostsHint.classList.remove("hidden");
  }
}

function attachManifestInstallButton(card, m) {
  const btn = card.querySelector(".btn-install");
  if (!btn || m.installed) return;
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

function renderManifestCard(m) {
  const card = document.createElement("div");
  card.className = `manifest-card${m.installed ? " installed" : ""}`;
  const btnLabel = m.installed ? "Installed" : "Install";
  card.innerHTML = `
    <h4>${escapeHtml(m.name)}</h4>
    <span class="version">v${escapeHtml(m.version)}</span>
    <p>${escapeHtml(m.description || "")}</p>
    <button class="btn primary btn-install" ${m.installed ? "disabled" : ""}>${btnLabel}</button>`;
  attachManifestInstallButton(card, m);
  return card;
}

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
  currentView = name;
  document.querySelectorAll(".view-panel").forEach((p) => p.classList.add("hidden"));
  document.getElementById(`view-${name}`)?.classList.remove("hidden");
  document.getElementById("page-title").textContent = TITLES[name] || name;
  const subtitle = document.getElementById("page-subtitle");
  if (subtitle) subtitle.textContent = SUBTITLES[name] || "";
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
    const contentSig = `${target}:${content.length}:${content.slice(-120)}:${searchQuery}`;
    if (contentSig === lastLogContentSignature && !listChanged) return;
    lastLogContentSignature = contentSig;
    renderLogViewerContent(viewer, content, searchQuery);
    if (document.getElementById("log-follow")?.checked) {
      viewer.scrollTop = viewer.scrollHeight;
    }
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
  // Single poller covers list + follow; avoid dual 2s timers.
  stopLogListRefresh();
  stopLogFollow();
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
  // Prefer the shared list refresh timer when follow is on.
  startLogListRefresh();
}

let dumpsFollowTimer = null;

function renderDumpsEmptyState(title, desc) {
  return `<div class="empty-state">
    <div class="empty-state-icon">◇</div>
    <p class="empty-state-title">${escapeHtml(title)}</p>
    <p class="empty-state-desc">${desc}</p>
  </div>`;
}

function dumpTypeBadge(type) {
  return `<span class="dump-type-badge dump-type-${escapeHtml(type)}">${escapeHtml(type)}</span>`;
}

async function refreshDumps() {
  const viewer = document.getElementById("dumps-viewer");
  if (!viewer || !api?.listDumps) return;
  const events = await api.listDumps(300);
  const filtered =
    currentDumpFilter === "all"
      ? events
      : events.filter((ev) => ev.type === currentDumpFilter);

  const sig = `${currentDumpFilter}:${events.length}:${events[events.length - 1]?.ts ?? 0}:${events[events.length - 1]?.message?.slice(0, 40) ?? ""}`;
  if (sig === lastDumpsSignature && viewer.querySelector(".dump-entry, .empty-state")) {
    return;
  }
  lastDumpsSignature = sig;

  if (!events.length) {
    viewer.innerHTML = renderDumpsEmptyState(
      "No dumps yet",
      "Visit a site and call <code>dump($var)</code> in PHP — output appears here instantly."
    );
    return;
  }
  if (!filtered.length) {
    viewer.innerHTML = renderDumpsEmptyState(
      "No matching dumps",
      `Nothing with type <code>${escapeHtml(currentDumpFilter)}</code> in the latest batch. Try another filter or refresh.`
    );
    return;
  }

  viewer.innerHTML = filtered
    .map((ev) => {
      const when = new Date((ev.ts ?? 0) * 1000).toLocaleTimeString();
      const loc = ev.file
        ? ` <button type="button" class="link-btn dump-open-ide" data-file="${escapeHtml(ev.file)}" data-line="${ev.line ?? ""}">${escapeHtml(ev.file)}:${ev.line ?? ""}</button>`
        : "";
      const ctx = ev.context ? `\n${escapeHtml(ev.context)}` : "";
      return `<div class="dump-entry dump-${escapeHtml(ev.type)}">
        <div class="dump-entry-head">
          <span class="dump-meta">${escapeHtml(when)}</span>
          ${dumpTypeBadge(ev.type)}
          ${loc}
        </div>
        <pre class="dump-body">${escapeHtml(ev.message)}${ctx}</pre>
      </div>`;
    })
    .join("");

  viewer.querySelectorAll(".dump-open-ide").forEach((btn) => {
    btn.onclick = async () => {
      const line = Number(btn.dataset.line);
      const result = await api.openLogInEditor(btn.dataset.file, Number.isFinite(line) ? line : undefined);
      if (!result.opened) showToast(result.message || "Could not open file", "error");
    };
  });

  if (document.getElementById("dumps-follow")?.checked) {
    viewer.scrollTop = viewer.scrollHeight;
  }
}

function startDumpsFollow() {
  stopDumpsFollow();
  if (!document.getElementById("dumps-follow")?.checked) return;
  dumpsFollowTimer = setInterval(() => void refreshDumps(), 1500);
}

function stopDumpsFollow() {
  if (dumpsFollowTimer) {
    clearInterval(dumpsFollowTimer);
    dumpsFollowTimer = null;
  }
}

async function refreshNodeVersions(nodeVersions, externalNode) {
  const tbody = document.getElementById("node-versions-list");
  const empty = document.getElementById("node-empty");
  if (!tbody) return;

  const versions = nodeVersions ?? (await api.listNodeVersions());
  const overview = externalNode !== undefined ? { externalNode } : await api.listTooling();
  const external = overview.externalNode;

  tbody.innerHTML = "";
  if (!versions.length && !external?.available) {
    empty?.classList.remove("hidden");
    return;
  }
  empty?.classList.add("hidden");

  if (external?.available) {
    const tr = document.createElement("tr");
    if (external.active) tr.classList.add("row-active");
    tr.innerHTML = `
      <td>
        <div class="node-version-label">${escapeHtml(external.label)}</div>
        <div class="tooling-managed-by-you">${escapeHtml(external.manager)}</div>
      </td>
      <td><span class="status-pill status-pill-external">External</span></td>
      <td>${external.active ? '<span class="active-badge">Active</span>' : '<span class="tooling-muted">—</span>'}</td>
      <td class="tooling-actions-cell"></td>`;
    const actionCell = tr.querySelector(".tooling-actions-cell");
    if (external.active) {
      const span = document.createElement("span");
      span.className = "tooling-muted";
      span.textContent = "In use";
      actionCell.appendChild(span);
    } else {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn sm primary";
      btn.textContent = "Use external";
      btn.onclick = async () => {
        await withLoading(() => api.setActiveNodeVersion("external"), "Switching to external Node…");
        showToast(`Using ${external.label}`, "success");
        await refreshTooling();
      };
      actionCell.appendChild(btn);
    }
    tbody.appendChild(tr);
  }

  versions.forEach((v) => {
    const tr = document.createElement("tr");
    if (v.active) tr.classList.add("row-active");
    const statusClass = v.installed ? "status-pill-installed" : "status-pill-missing";
    const statusLabel = v.installed ? "Installed" : "Not installed";
    tr.innerHTML = `
      <td><div class="node-version-label">${escapeHtml(v.label)}</div></td>
      <td><span class="status-pill ${statusClass}">${statusLabel}</span></td>
      <td>${v.active ? '<span class="active-badge">Active</span>' : v.installed ? '<span class="tooling-muted">—</span>' : '<span class="tooling-muted">—</span>'}</td>
      <td class="tooling-actions-cell"></td>`;
    const actionCell = tr.querySelector(".tooling-actions-cell");
    if (v.installed) {
      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "btn sm danger secondary";
      removeBtn.textContent = "Remove";
      removeBtn.onclick = async () => {
        if (!confirm(`Remove ${v.label} from DevTent?`)) return;
        try {
          await withLoading(
            () => api.removeTool("node", { nodeVersion: v.id }),
            `Removing ${v.label}…`
          );
          showToast(`${v.label} removed`, "success");
          await refreshTooling();
        } catch (err) {
          showToast(err.message || String(err), "error");
        }
      };
      actionCell.appendChild(removeBtn);
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
          await refreshTooling();
        } catch (err) {
          btn.disabled = false;
          btn.textContent = "Install";
          showToast(err.message || String(err), "error");
        }
      };
      actionCell.appendChild(btn);
    }
    if (v.installed && !v.active) {
      const useBtn = document.createElement("button");
      useBtn.type = "button";
      useBtn.className = "btn sm secondary";
      useBtn.textContent = "Use";
      useBtn.onclick = async () => {
        await withLoading(() => api.setActiveNodeVersion(v.id), `Switching to ${v.label}…`);
        showToast(`Active Node: ${v.label}`, "success");
        await refreshTooling();
      };
      actionCell.prepend(useBtn);
    }
    tbody.appendChild(tr);
  });
}

function toolingStatusClass(source) {
  if (source === "managed") return "tooling-status-managed";
  if (source === "external") return "tooling-status-external";
  return "tooling-status-missing";
}

function renderToolingActions(tool, cell) {
  cell.innerHTML = "";
  if (tool.source === "external") {
    const wrap = document.createElement("div");
    wrap.className = "tooling-action-group";
    if (tool.isExternalActive) {
      const span = document.createElement("span");
      span.className = "tooling-managed-by-you";
      span.textContent = "Active — your Node manager";
      wrap.appendChild(span);
    } else if (tool.canUseExternal) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn sm primary";
      btn.textContent = "Use external";
      btn.onclick = async () => {
        await withLoading(() => api.setActiveNodeVersion("external"), "Using external Node…");
        showToast("External Node selected for this profile", "success");
        await refreshTooling();
      };
      wrap.appendChild(btn);
    } else {
      const span = document.createElement("span");
      span.className = "tooling-managed-by-you";
      span.textContent = "Managed by you";
      wrap.appendChild(span);
    }
    cell.appendChild(wrap);
    return;
  }

  const wrap = document.createElement("div");
  wrap.className = "tooling-action-group";

  if (tool.canInstall) {
    const installBtn = document.createElement("button");
    installBtn.type = "button";
    installBtn.className = "btn sm primary";
    installBtn.textContent = tool.id === "node" ? "Install latest" : "Install";
    installBtn.onclick = async () => {
      installBtn.disabled = true;
      installBtn.textContent = "Installing…";
      try {
        await withLoading(() => api.installTool(tool.id), `Installing ${tool.name}…`);
        showToast(`${tool.name} installed`, "success");
        await refreshTooling();
      } catch (err) {
        installBtn.disabled = false;
        installBtn.textContent = tool.id === "node" ? "Install latest" : "Install";
        showToast(err.message || String(err), "error");
      }
    };
    wrap.appendChild(installBtn);
  }

  if (tool.canUpdate) {
    const updateBtn = document.createElement("button");
    updateBtn.type = "button";
    updateBtn.className = "btn sm secondary";
    updateBtn.textContent = "Update";
    updateBtn.onclick = async () => {
      updateBtn.disabled = true;
      try {
        await withLoading(() => api.updateTool(tool.id), `Updating ${tool.name}…`);
        showToast(`${tool.name} updated`, "success");
        await refreshTooling();
      } catch (err) {
        showToast(err.message || String(err), "error");
      } finally {
        updateBtn.disabled = false;
      }
    };
    wrap.appendChild(updateBtn);
  }

  if (tool.canRemove) {
    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "btn sm danger secondary";
    removeBtn.textContent = "Remove";
    removeBtn.onclick = async () => {
      if (!confirm(`Remove ${tool.name} from DevTent?`)) return;
      try {
        await withLoading(() => api.removeTool(tool.id), `Removing ${tool.name}…`);
        showToast(`${tool.name} removed`, "success");
        await refreshTooling();
      } catch (err) {
        showToast(err.message || String(err), "error");
      }
    };
    wrap.appendChild(removeBtn);
  }

  if (!wrap.children.length) {
    const span = document.createElement("span");
    span.className = "tooling-muted";
    span.textContent = "—";
    wrap.appendChild(span);
  }

  cell.appendChild(wrap);
}

async function refreshTooling() {
  if (!api?.listTooling) return;
  const overview = await api.listTooling();
  const cards = document.getElementById("tooling-cards");
  const pathList = document.getElementById("tooling-path-list");
  if (!cards) return;

  cards.innerHTML = "";
  overview.tools.forEach((tool) => {
    const card = document.createElement("article");
    card.className = `tool-card${tool.source === "managed" ? " tool-card-ready" : ""}`;
    const binaries = tool.binaries.map((b) => `<code>${escapeHtml(b)}</code>`).join(", ");
    const icon = TOOL_ICONS[tool.id] || tool.name.charAt(0).toUpperCase();

    card.innerHTML = `
      <div class="tool-card-head">
        <span class="tool-card-icon" aria-hidden="true">${escapeHtml(icon)}</span>
        <div class="tool-card-titles">
          <h4 class="tool-card-name">${escapeHtml(tool.name)}</h4>
          <p class="tool-card-desc">${escapeHtml(tool.description)}</p>
        </div>
        <span class="tooling-status ${toolingStatusClass(tool.source)}">${escapeHtml(tool.statusLabel)}</span>
      </div>
      <div class="tool-card-binaries">${binaries}</div>
      <div class="tool-card-actions"></div>`;

    renderToolingActions(tool, card.querySelector(".tool-card-actions"));
    cards.appendChild(card);
  });

  if (pathList) {
    pathList.innerHTML = "";
    overview.pathEntries.forEach((entry) => {
      const li = document.createElement("li");
      li.className = "mono";
      li.textContent = formatPath(entry);
      pathList.appendChild(li);
    });
    if (!overview.pathEntries.length) {
      const li = document.createElement("li");
      li.className = "empty-hint";
      li.textContent = "Install PHP and tooling to populate PATH entries.";
      pathList.appendChild(li);
    }
  }

  await refreshNodeVersions(overview.nodeVersions, overview.externalNode);
}

async function refreshNode() {
  await refreshTooling();
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

function sourceLabel(source) {
  if (source === "parked") return "parked";
  if (source === "linked") return "linked";
  return "www";
}

async function refreshSitesConfig() {
  if (!api?.listSitesConfig) return;
  const { parked, linked } = await api.listSitesConfig();
  const parkedList = document.getElementById("parked-list");
  const linkedList = document.getElementById("linked-list");
  if (parkedList) {
    parkedList.innerHTML = parked.length
      ? parked
          .map(
            (p) =>
              `<li><span class="mono">${escapeHtml(formatPath(p))}</span><button type="button" class="link-btn btn-unpark" data-path="${escapeHtml(p)}">Remove</button></li>`
          )
          .join("")
      : "<li class='empty-hint'>No parked folders</li>";
    parkedList.querySelectorAll(".btn-unpark").forEach((btn) => {
      btn.onclick = async () => {
        await withLoading(() => api.unparkFolder(btn.dataset.path), "Updating sites…");
        showToast("Parked folder removed", "success");
        await refreshProjects();
      };
    });
  }
  if (linkedList) {
    linkedList.innerHTML = linked.length
      ? linked
          .map(
            (s) =>
              `<li><span><strong>${escapeHtml(s.name)}</strong> <span class="mono">${escapeHtml(formatPath(s.path))}</span></span><button type="button" class="link-btn btn-unlink" data-name="${escapeHtml(s.name)}">Unlink</button></li>`
          )
          .join("")
      : "<li class='empty-hint'>No linked projects</li>";
    linkedList.querySelectorAll(".btn-unlink").forEach((btn) => {
      btn.onclick = async () => {
        await withLoading(() => api.unlinkProject(btn.dataset.name), "Updating sites…");
        showToast("Project unlinked", "success");
        await refreshProjects();
      };
    });
  }
}

async function refreshProjects() {
  const state = await api.getState();
  const rootStatus = await api.getRoot();
  await updateDomainHints(rootStatus);
  const shares = api.listShares ? await api.listShares().catch(() => []) : [];
  const shareMap = new Map(shares.map((s) => [s.siteName, s]));
  const list = document.getElementById("projects-list");
  const empty = document.getElementById("projects-empty");
  list.innerHTML = "";

  if (!state.virtualHosts?.length) {
    empty.classList.remove("hidden");
    await refreshSitesConfig();
    return;
  }
  empty.classList.add("hidden");

  const phpVersions = (await api.listManifests())
    .filter((m) => m.name.startsWith("php-"))
    .map((m) => m.name);

  for (const v of state.virtualHosts) {
    const li = document.createElement("li");
    li.className = "project-card";
    const url = projectUrl(v);
    const activeShare = shareMap.get(v.name);
    const phpOptions = phpVersions
      .map(
        (id) =>
          `<option value="${escapeHtml(id)}" ${v.phpVersion === id ? "selected" : ""}>${escapeHtml(id.replace(/^php-/, "PHP "))}</option>`
      )
      .join("");
    li.innerHTML = `
      <div class="project-info">
        <div class="project-name-row">
          <span class="site-source-badge">${sourceLabel(v.source)}</span>
          <span class="project-name">${escapeHtml(v.name)}</span>
          ${v.ssl ? '<span class="ssl-badge" title="HTTPS enabled">🔒</span>' : ""}
          ${activeShare ? '<span class="share-active-badge">Shared</span>' : ""}
        </div>
        <a href="#" class="project-url project-url-link">${escapeHtml(url)}</a>
        ${
          activeShare
            ? `<div class="project-share-url"><button type="button" class="link-btn btn-copy-share">${escapeHtml(activeShare.publicUrl)}</button></div>`
            : ""
        }
        <label class="project-php-label">PHP version
          <select class="text-input project-php-select" aria-label="PHP version for ${escapeHtml(v.name)}">
            ${phpOptions}
          </select>
        </label>
      </div>
      <div class="project-actions">
        <div class="project-actions-primary">
          <button class="btn sm primary btn-open">Open site</button>
          <button class="btn sm secondary btn-folder">Folder</button>
        </div>
        <div class="project-actions-secondary">
          <button class="btn sm ${activeShare ? "danger" : "secondary"} btn-share">${activeShare ? "Stop share" : "Share public URL"}</button>
          <button class="btn sm secondary btn-laravel-env">Laravel .env</button>
          <button class="btn sm secondary btn-ssl">${v.ssl ? "Renew SSL" : "Enable SSL"}</button>
        </div>
      </div>`;
    li.querySelector(".btn-open").onclick = () => api.openExternal(url);
    li.querySelector(".project-url-link")?.addEventListener("click", (e) => {
      e.preventDefault();
      api.openExternal(url);
    });
    li.querySelector(".btn-share").onclick = async () => {
      try {
        if (activeShare) {
          await withLoading(() => api.stopShare(v.name), `Stopping share for ${v.name}…`);
          showToast(`Stopped public share for ${v.name}`, "success");
          await refreshProjects();
          return;
        }
        const session = await withLoading(() => api.startShare(v.name), `Sharing ${v.name}…`);
        showToast(`Public URL copied — ${session.publicUrl}`, "success", 10000);
        try {
          await navigator.clipboard.writeText(session.publicUrl);
        } catch {
          // ignore
        }
        await refreshProjects();
      } catch (err) {
        showToast(err.message || String(err), "error");
      }
    };
    li.querySelector(".btn-copy-share")?.addEventListener("click", async (e) => {
      e.preventDefault();
      if (!activeShare?.publicUrl) return;
      try {
        await navigator.clipboard.writeText(activeShare.publicUrl);
        showToast("Public URL copied", "success");
      } catch {
        showToast(activeShare.publicUrl, "success", 8000);
      }
      api.openExternal(activeShare.publicUrl);
    });
    li.querySelector(".project-php-select")?.addEventListener("change", async (e) => {
      const version = e.target.value;
      await withLoading(() => api.setSitePhpVersion(v.name, version), `Setting PHP for ${v.name}…`);
      showToast(`${v.name} → ${version}`, "success");
      await refreshProjects();
      await refreshServices();
    });
    li.querySelector(".btn-laravel-env").onclick = async () => {
      try {
        const snippet = await api.getLaravelEnv(v.name);
        await navigator.clipboard.writeText(snippet.envBlock);
        showToast(`Copied Laravel .env snippet for ${snippet.domain}`, "success");
      } catch (err) {
        showToast(err.message || String(err), "error");
      }
    };
    li.querySelector(".btn-ssl").onclick = async () => {
      const result = await withLoading(() => api.enableSsl(v.domain), "Generating certificate…");
      showToast(result.message, result.success ? "success" : "error");
      if (result.success) {
        await refreshProjects();
        await refreshAll();
      }
    };
    li.querySelector(".btn-folder").onclick = () => {
      if (v.projectPath && v.source !== "www") {
        api.openProjectPath(v.projectPath);
      } else {
        api.openPath(`www/${v.name}`);
      }
    };
    list.appendChild(li);
  }
  await refreshSitesConfig();
}

async function refreshManifests() {
  const manifests = await api.listManifests();
  const grid = document.getElementById("manifests-grid");
  grid.innerHTML = "";

  for (const group of groupQuickAddManifests(manifests)) {
    const section = document.createElement("section");
    section.className = "quick-add-group panel";
    section.innerHTML = `<h3 class="panel-title">${escapeHtml(group.label)}</h3>`;
    const cards = document.createElement("div");
    cards.className = "card-grid";
    group.items.forEach((m) => cards.appendChild(renderManifestCard(m)));
    section.appendChild(cards);
    grid.appendChild(section);
  }
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

  const tldSelect = document.getElementById("settings-tld");
  const tldHint = document.getElementById("settings-tld-hint");
  if (tldSelect) {
    const tld = rootStatus.tld || "localhost";
    tldSelect.value = tld === "test" ? "test" : "localhost";
    if (tldHint) {
      tldHint.textContent =
        rootStatus.zeroAdminDomains === true
          ? "Sites use *.localhost — no hosts file changes needed."
          : "Sites use *.test — click Update hosts (Admin) on Projects after adding sites.";
    }
  }
  await updateDomainHints(rootStatus);

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

async function refreshAll(options = {}) {
  const { includeSettings = false } = options;
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
  if (includeSettings || currentView === "settings") {
    await refreshSettings(state.root);
  }
}

async function handleScopedRefresh(scope = "all") {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    try {
      if (scope === "services") {
        await refreshServices();
        if (currentView === "dashboard") {
          const state = await api.getState();
          await refreshDashboard(state);
        }
        return;
      }
      if (scope === "sites") {
        if (currentView === "projects" || currentView === "dashboard") {
          await refreshProjects();
        }
        if (currentView === "dashboard") {
          const state = await api.getState();
          await refreshDashboard(state);
        }
        return;
      }
      if (scope === "profiles") {
        await refreshProfiles();
        if (currentView === "services") await refreshServices();
        return;
      }
      if (scope === "tooling") {
        if (currentView === "tooling") await refreshTooling();
        return;
      }
      if (scope === "settings") {
        if (currentView === "settings") {
          const root = await api.getRoot();
          await refreshSettings(root.root);
        }
        return;
      }
      await refreshAll({ includeSettings: currentView === "settings" });
      if (currentView === "services") await refreshServices();
      if (currentView === "projects") await refreshProjects();
      if (currentView === "tooling") await refreshTooling();
      if (currentView === "profiles") await refreshProfiles();
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
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
  api.onRefresh((scope) => handleScopedRefresh(scope).catch(console.error));
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
    if (view === "tooling") void refreshTooling();
    else if (view === "dumps") void refreshDumps().then(startDumpsFollow);
    else if (view === "logs") void refreshLogs().then(startLogFollow);
    else {
      stopDumpsFollow();
      stopLogFollow();
    }
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
    await refreshAll({ includeSettings: false });
    // Load the active view first; defer secondary lists until needed.
    await Promise.all([refreshServices(), refreshProjects(), refreshProfiles()]);
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
      if (view === "tooling") await refreshTooling();
      if (view === "dumps") {
        await refreshDumps();
        startDumpsFollow();
      } else {
        stopDumpsFollow();
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
  document.getElementById("btn-tooling-terminal")?.addEventListener("click", () => api.openTerminal());
  document.getElementById("btn-dumps-refresh")?.addEventListener("click", () => refreshDumps());
  document.getElementById("btn-dumps-clear")?.addEventListener("click", async () => {
    await api.clearDumps();
    await refreshDumps();
  });
  document.querySelectorAll("[data-dump-filter]").forEach((chip) => {
    chip.addEventListener("click", () => {
      currentDumpFilter = chip.dataset.dumpFilter || "all";
      document.querySelectorAll("[data-dump-filter]").forEach((c) => {
        c.classList.toggle("active", c.dataset.dumpFilter === currentDumpFilter);
      });
      void refreshDumps();
    });
  });
  document.getElementById("dumps-follow")?.addEventListener("change", () => {
    if (document.getElementById("dumps-follow")?.checked) startDumpsFollow();
    else stopDumpsFollow();
  });
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

  document.getElementById("btn-park-folder")?.addEventListener("click", async () => {
    const folder = await api.pickLaragonRoot();
    if (!folder) return;
    await withLoading(() => api.parkFolder(folder), "Parking folder…");
    handleHostsSyncResult(await api.syncVhosts());
    showToast("Folder parked — subprojects are now live", "success");
    await refreshProjects();
  });

  document.getElementById("btn-link-project")?.addEventListener("click", async () => {
    const projectPath = await api.pickLaragonRoot();
    if (!projectPath) return;
    const defaultName = projectPath.split(/[/\\]/).filter(Boolean).pop() ?? "site";
    const name = prompt("Site name (used for name.test):", defaultName);
    if (!name) return;
    await withLoading(() => api.linkProject(projectPath, name), "Linking project…");
    handleHostsSyncResult(await api.syncVhosts());
    showToast(`Linked ${name}.test`, "success");
    await refreshProjects();
  });

  document.getElementById("btn-run-doctor")?.addEventListener("click", async () => {
    const fix = confirm("Run DevTent doctor with automatic repairs?\n\nThis syncs Procfile, regenerates vhosts, and verifies configs.");
    const report = await withLoading(
      () => api.runDoctor({ repair: fix, startServices: false }),
      "Running doctor…"
    );
    const el = document.getElementById("doctor-result");
    if (el) {
      const lines = [];
      if (report.repaired?.length) lines.push(`Fixed: ${report.repaired.join("; ")}`);
      const issues = (report.findings ?? []).filter((f) => f.severity === "warn" || f.severity === "error");
      if (issues.length) lines.push(`${issues.length} issue(s) remaining`);
      else lines.push("No issues found");
      el.textContent = lines.join(" · ");
      el.classList.remove("hidden");
    }
    showToast("Doctor finished", "success");
    await refreshHealth();
    await refreshAll();
  });

  document.querySelectorAll("[data-external]").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.preventDefault();
      api.openExternal(el.dataset.external);
    });
  });

  document.getElementById("settings-tld")?.addEventListener("change", async (e) => {
    const tld = e.target.value;
    try {
      const result = await withLoading(() => api.setTld(tld), `Switching to .${tld}…`);
      showToast(
        result.zeroAdminDomains
          ? `Sites now use .${result.tld} — no hosts file admin needed`
          : `Sites now use .${result.tld} — sync virtual hosts and update hosts`,
        "success",
        8000
      );
      await refreshAll();
      await refreshProjects();
    } catch (err) {
      showToast(err.message || String(err), "error");
    }
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
