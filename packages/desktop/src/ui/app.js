/** @typedef {import('../../preload').DevTentApi} DevTentApi */

/** @type {DevTentApi | undefined} */
const api = window.devtent;

const GITHUB_REPO_URL = "https://github.com/DubStepMad/devtent";

const TITLES = {
  dashboard: "Dashboard",
  services: "Services",
  logs: "Logs",
  dumps: "Dumps",
  database: "Database",
  "php-ini": "PHP",
  tooling: "Tooling",
  mail: "Mail",
  share: "Share",
  doctor: "Doctor",
  projects: "Projects",
  "quick-add": "Quick Add",
  "quick-app": "Quick App",
  profiles: "Profiles",
  settings: "Settings",
};

const SUBTITLES = {
  dashboard: "Your local environment at a glance",
  services: "Start, stop, and monitor your stack",
  logs: "Service output and search",
  dumps: "Live PHP dumps and Laravel telemetry",
  database: "Create databases and manage backups",
  "php-ini": "Extensions and php.ini for each version",
  tooling: "Composer, Node, Bun, and PATH",
  mail: "Catch outgoing mail with Mailpit",
  share: "Quick and named Cloudflare tunnels",
  doctor: "Diagnose issues, CA, and local DNS",
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
let currentDumpSearch = "";
let currentDumpSite = "";
let currentView = "dashboard";
let lastLogContentSignature = "";
let lastDumpsSignature = "";
let siteDrawerVhost = null;
let phpIniSelectedVersion = "";
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
    const state = await api.getState();
    const demo = state.virtualHosts?.find((v) => v.name === "demo");
    if (demo) await api.openExternal(projectUrl(demo));
    markOnboardingStep(3, "done");
    const domain = demo?.domain ?? "demo.localhost";
    showToast(`Demo site ready at ${domain}`, "success");
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
let updateBadgeVisible = false;
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

function setUpdateAvailableIndicator(update) {
  pendingUpdate = update || null;
  updateBadgeVisible = Boolean(update);
  const version = update?.latestVersion;

  document.getElementById("nav-update-dot")?.classList.toggle("hidden", !updateBadgeVisible);
  document.getElementById("settings-update-dot")?.classList.toggle("hidden", !updateBadgeVisible);

  const chip = document.getElementById("btn-update-available");
  if (chip) {
    chip.classList.toggle("hidden", !updateBadgeVisible);
    chip.textContent = version ? `Update v${version}` : "Update available";
    chip.title = version
      ? `DevTent v${version} is available — click to install`
      : "Update available — click to install";
  }

  const settingsBtn = document.querySelector('.nav-item[data-view="settings"]');
  if (settingsBtn) {
    settingsBtn.setAttribute(
      "aria-label",
      updateBadgeVisible ? `Settings, update available${version ? ` (v${version})` : ""}` : "Settings"
    );
  }
}

function clearUpdateAvailableIndicator() {
  setUpdateAvailableIndicator(null);
}

function openPendingUpdate() {
  if (!pendingUpdate) return;
  showView("settings");
  showSettingsSection("updates");
  showUpdateDialog(pendingUpdate);
}

function showUpdateDialog(update) {
  pendingUpdate = update;
  setUpdateAvailableIndicator(update);
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
  // Keep pendingUpdate so the quiet badge remains after "Remind me later".
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
    setUpdateAvailableIndicator(result.update);
    if (showDialogOnAvailable) showUpdateDialog(result.update);
  } else if (result.status === "up-to-date") {
    clearUpdateAvailableIndicator();
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

  const chips = document.getElementById("dashboard-site-chips");
  if (chips) {
    chips.innerHTML = "";
    chips.classList.toggle("empty-hint", !state.virtualHosts?.length);
    if (!state.virtualHosts?.length) {
      chips.textContent = "No sites yet — create one in Quick App or park a folder";
    } else {
      state.virtualHosts.slice(0, 12).forEach((v) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "site-chip";
        const url = projectUrl(v);
        btn.textContent = v.domain + (v.ssl ? " 🔒" : "");
        btn.title = url;
        btn.onclick = () => api.openExternal(url);
        chips.appendChild(btn);
      });
    }
  }

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

function renderDoctorFindings(findings, targetId) {
  const list = document.getElementById(targetId);
  if (!list) return;
  list.innerHTML = "";
  if (!findings?.length) {
    list.innerHTML = "";
    return;
  }
  findings.forEach((f) => {
    const li = document.createElement("li");
    li.className = `doctor-finding doctor-${f.severity || "ok"}`;
    const icon =
      f.severity === "ok" || f.severity === "fixed"
        ? "✓"
        : f.severity === "warn"
          ? "!"
          : "✕";
    li.innerHTML = `
      <span class="doctor-finding-icon">${icon}</span>
      <div class="doctor-finding-body">
        <strong>${escapeHtml(f.title)}</strong>
        ${f.detail ? `<p class="panel-desc">${escapeHtml(f.detail)}</p>` : ""}
      </div>`;
    list.appendChild(li);
  });
}

async function refreshDoctorPage(options = {}) {
  const allClear = document.getElementById("doctor-all-clear");
  const resultEl = document.getElementById("doctor-page-result");
  if (!api?.runDoctor) return;

  const report = await withLoading(
    () => api.runDoctor({ repair: !!options.repair, startServices: false }),
    options.repair ? "Applying safe fixes…" : "Running doctor…"
  );

  const findings = report?.findings ?? [];
  const problems = findings.filter((f) => f.severity === "error" || f.severity === "warn");
  renderDoctorFindings(findings, "doctor-findings");
  allClear?.classList.toggle("hidden", problems.length > 0);

  if (resultEl) {
    const repaired = report?.repaired?.length
      ? `Repaired: ${report.repaired.join("; ")}`
      : problems.length
        ? `${problems.length} issue(s) need attention`
        : "Environment looks healthy";
    resultEl.textContent = repaired;
    resultEl.classList.remove("hidden");
  }

  await refreshHealth();
  await refreshDoctorCaDns();
  return report;
}

async function refreshDoctorCaDns() {
  const caEl = document.getElementById("doctor-ca-status");
  const dnsEl = document.getElementById("doctor-dns-status");
  if (caEl && api?.getMkcertCaStatus) {
    try {
      const ca = await api.getMkcertCaStatus();
      caEl.textContent = ca.message;
    } catch (err) {
      caEl.textContent = err.message || String(err);
    }
  }
  if (dnsEl && api?.getLocalDnsStatus) {
    try {
      const dns = await api.getLocalDnsStatus();
      dnsEl.textContent = dns.running
        ? `DNS: listening on ${dns.bind}:${dns.port} for *.${dns.tld}`
        : `DNS: ${dns.message}`;
    } catch (err) {
      dnsEl.textContent = err.message || String(err);
    }
  }
}

async function refreshMailPage() {
  const status = document.getElementById("mail-status");
  if (!status || !api?.getServices) return;
  const services = await api.getServices().catch(() => []);
  const mailpit = services.find((s) => s.name === "mailpit");
  let installed = !!mailpit;
  if (api.getProfileServices) {
    try {
      const { active } = await api.listProfiles();
      const profileServices = await api.getProfileServices(active);
      const preset = profileServices.find((s) => s.id === "mailpit");
      installed = preset?.runtimeInstalled ?? installed;
    } catch {
      // keep installed from running services
    }
  }
  const running = !!mailpit?.running;

  if (!installed) {
    status.textContent =
      "Mailpit is not installed. Add it via Quick Add (mailpit) or enable it on your profile, then install.";
  } else if (running) {
    status.textContent = "Mailpit is running — open the UI to preview captured mail.";
  } else {
    status.textContent = "Mailpit is installed but not running. Start it to capture mail.";
  }

  const startBtn = document.getElementById("btn-mail-start");
  if (startBtn) startBtn.disabled = !installed || running;
  const openBtn = document.getElementById("btn-mail-open");
  if (openBtn) openBtn.disabled = !running;
}

async function refreshSharePage() {
  const activeList = document.getElementById("share-active-list");
  const sitesList = document.getElementById("share-sites-list");
  const empty = document.getElementById("share-sites-empty");
  if (!sitesList) return;

  const state = await api.getState().catch(() => null);
  const shares = api.listShares ? await api.listShares().catch(() => []) : [];
  const shareMap = new Map(shares.map((s) => [s.siteName, s]));

  if (activeList) {
    activeList.innerHTML = "";
    activeList.classList.toggle("empty-hint", shares.length === 0);
    if (!shares.length) {
      activeList.textContent = "No active public tunnels";
    } else {
      shares.forEach((s) => {
        const li = document.createElement("li");
        li.innerHTML = `<button type="button" class="link-btn">${escapeHtml(s.publicUrl)}</button>
          <span class="panel-desc"> · ${escapeHtml(s.siteName)}</span>
          <button type="button" class="btn sm danger btn-stop-share">Stop</button>`;
        li.querySelector(".link-btn").onclick = () => api.openExternal(s.publicUrl);
        li.querySelector(".btn-stop-share").onclick = async () => {
          await withLoading(() => api.stopShare(s.siteName), `Stopping share for ${s.siteName}…`);
          showToast(`Stopped public share for ${s.siteName}`, "success");
          await refreshSharePage();
        };
        activeList.appendChild(li);
      });
    }
  }

  const vhosts = state?.virtualHosts ?? [];
  sitesList.innerHTML = "";
  empty?.classList.toggle("hidden", vhosts.length > 0);
  vhosts.forEach((v) => {
    const active = shareMap.get(v.name);
    const li = document.createElement("li");
    li.className = "project-card";
    li.innerHTML = `
      <div class="project-info">
        <strong>${escapeHtml(v.domain)}</strong>
        ${active ? `<div class="project-share-url"><button type="button" class="link-btn btn-copy-share">${escapeHtml(active.publicUrl)}</button></div>` : ""}
      </div>
      <div class="project-actions">
        <button class="btn sm ${active ? "danger" : "secondary"} btn-share">${active ? "Stop share" : "Share publicly"}</button>
      </div>`;
    li.querySelector(".btn-share").onclick = async () => {
      try {
        if (active) {
          await withLoading(() => api.stopShare(v.name), `Stopping share for ${v.name}…`);
          showToast(`Stopped public share for ${v.name}`, "success");
        } else {
          const session = await withLoading(() => api.startShare(v.name), `Sharing ${v.name}…`);
          showToast(session?.publicUrl || `Sharing ${v.name}`, "success", 8000);
        }
        await refreshSharePage();
      } catch (err) {
        showToast(err.message || String(err), "error");
      }
    };
    li.querySelector(".btn-copy-share")?.addEventListener("click", async () => {
      if (!active?.publicUrl) return;
      try {
        await navigator.clipboard.writeText(active.publicUrl);
        showToast("Copied public URL", "success");
      } catch {
        showToast(active.publicUrl, "success", 8000);
      }
      api.openExternal(active.publicUrl);
    });
    sitesList.appendChild(li);
  });

  await refreshNamedTunnels(vhosts);
}

async function refreshNamedTunnels(vhosts = []) {
  const statusEl = document.getElementById("share-cf-status");
  const listEl = document.getElementById("share-named-list");
  if (!listEl || !api?.listNamedTunnels) return;

  let loggedIn = false;
  if (api.cloudflareLoginStatus) {
    try {
      const st = await api.cloudflareLoginStatus();
      loggedIn = !!st.loggedIn;
      if (statusEl) {
        statusEl.textContent = loggedIn
          ? "Cloudflare account linked — create a named tunnel for a stable hostname."
          : "Log in to Cloudflare to create persistent named tunnels.";
      }
    } catch {
      if (statusEl) statusEl.textContent = "Could not read Cloudflare login status.";
    }
  }

  const tunnels = await api.listNamedTunnels().catch(() => []);
  listEl.innerHTML = "";
  listEl.classList.toggle("empty-hint", tunnels.length === 0);
  if (!tunnels.length) {
    listEl.textContent = loggedIn
      ? "No named tunnels yet — create one above."
      : "No named tunnels yet";
    return;
  }

  tunnels.forEach((t) => {
    const li = document.createElement("li");
    li.className = "named-tunnel-row";
    const host = t.hostname ? escapeHtml(t.hostname) : "not configured";
    const site = t.siteName ? escapeHtml(t.siteName) : "—";
    li.innerHTML = `
      <div class="project-info">
        <strong>${escapeHtml(t.name)}</strong>
        <span class="panel-desc">${host} · site ${site}${t.running ? " · running" : ""}</span>
      </div>
      <div class="project-actions">
        <button type="button" class="btn sm secondary btn-named-configure">Configure</button>
        <button type="button" class="btn sm ${t.running ? "danger" : "primary"} btn-named-run">${t.running ? "Stop" : "Start"}</button>
        <button type="button" class="btn sm danger btn-named-delete">Delete</button>
      </div>`;
    li.querySelector(".btn-named-configure").onclick = async () => {
      const siteName = prompt("Local site name:", t.siteName || vhosts[0]?.name || "");
      if (!siteName) return;
      const hostname = prompt("Public hostname (must be on your Cloudflare zone):", t.hostname || "");
      if (!hostname) return;
      try {
        await withLoading(
          () => api.configureNamedTunnel(t.name, siteName, hostname),
          `Configuring ${t.name}…`
        );
        showToast(`Configured ${t.name} → ${hostname}`, "success");
        await refreshSharePage();
      } catch (err) {
        showToast(err.message || String(err), "error");
      }
    };
    li.querySelector(".btn-named-run").onclick = async () => {
      try {
        if (t.running) {
          await withLoading(() => api.stopNamedTunnel(t.name), `Stopping ${t.name}…`);
          showToast(`Stopped ${t.name}`, "success");
        } else {
          await withLoading(() => api.startNamedTunnel(t.name), `Starting ${t.name}…`);
          showToast(t.hostname ? `Running → https://${t.hostname}` : `Running ${t.name}`, "success");
        }
        await refreshSharePage();
      } catch (err) {
        showToast(err.message || String(err), "error");
      }
    };
    li.querySelector(".btn-named-delete").onclick = async () => {
      if (!confirm(`Delete named tunnel "${t.name}"?`)) return;
      try {
        await withLoading(() => api.deleteNamedTunnel(t.name), `Deleting ${t.name}…`);
        showToast(`Deleted ${t.name}`, "success");
        await refreshSharePage();
      } catch (err) {
        showToast(err.message || String(err), "error");
      }
    };
    listEl.appendChild(li);
  });
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

function dumpTypesForFilter(filter) {
  if (filter === "all") return null;
  if (filter === "error") return ["error", "exception"];
  if (filter === "dump") return ["dump", "dd"];
  return [filter];
}

function dumpSiteKey(ev) {
  return (ev.site || "").toLowerCase();
}

async function populateDumpsSiteSelects(events, virtualHosts) {
  const siteFilter = document.getElementById("dumps-site-filter");
  const telemetrySelect = document.getElementById("dumps-telemetry-site");
  const fromEvents = [...new Set(events.map(dumpSiteKey).filter(Boolean))];
  const fromHosts = (virtualHosts ?? []).map((v) => (v.domain || v.name || "").toLowerCase()).filter(Boolean);
  const sites = [...new Set([...fromHosts, ...fromEvents])].sort();

  if (siteFilter) {
    const prev = siteFilter.value;
    siteFilter.innerHTML =
      `<option value="">All sites</option>` +
      sites.map((s) => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join("");
    if (sites.includes(prev) || prev === "") siteFilter.value = prev;
    else {
      siteFilter.value = "";
      currentDumpSite = "";
    }
  }

  if (telemetrySelect) {
    const prev = telemetrySelect.value;
    const names = (virtualHosts ?? []).map((v) => v.name);
    telemetrySelect.innerHTML =
      `<option value="">Select a site…</option>` +
      names.map((n) => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join("");
    if (names.includes(prev)) telemetrySelect.value = prev;
  }
}

async function refreshDumps() {
  const viewer = document.getElementById("dumps-viewer");
  if (!viewer || !api?.listDumps) return;
  const events = await api.listDumps(300);

  const search = currentDumpSearch.trim().toLowerCase();
  const filtered = events.filter((ev) => {
    if (currentDumpFilter === "all") {
      // keep
    } else if (currentDumpFilter === "error") {
      if (ev.type !== "error" && ev.type !== "exception") return false;
    } else if (currentDumpFilter === "dump") {
      if (ev.type !== "dump" && ev.type !== "dd") return false;
    } else if (ev.type !== currentDumpFilter) {
      return false;
    }
    if (currentDumpSite) {
      const site = dumpSiteKey(ev);
      if (!site || !site.includes(currentDumpSite.toLowerCase())) return false;
    }
    if (search) {
      const hay = `${ev.message || ""} ${ev.context || ""} ${ev.file || ""} ${ev.site || ""} ${ev.type || ""}`.toLowerCase();
      if (!hay.includes(search)) return false;
    }
    return true;
  });

  const sig = `${currentDumpFilter}:${currentDumpSearch}:${currentDumpSite}:${events.length}:${events[events.length - 1]?.ts ?? 0}:${events[events.length - 1]?.message?.slice(0, 40) ?? ""}:${filtered.length}`;
  if (sig === lastDumpsSignature && viewer.querySelector(".dump-entry, .empty-state")) {
    return;
  }
  lastDumpsSignature = sig;

  const state = await api.getState().catch(() => ({ virtualHosts: [] }));
  await populateDumpsSiteSelects(events, state.virtualHosts);

  if (!events.length) {
    viewer.innerHTML = renderDumpsEmptyState(
      "No dumps yet",
      "Visit a site and call <code>dump($var)</code> in PHP — output appears here instantly. For Laravel queries and jobs, install telemetry from the toolbar above."
    );
    return;
  }
  if (!filtered.length) {
    viewer.innerHTML = renderDumpsEmptyState(
      "No matching dumps",
      `Nothing matches the current filters. Try another type, site, or search.`
    );
    return;
  }

  viewer.innerHTML = filtered
    .map((ev) => {
      const when = new Date((ev.ts ?? 0) * 1000).toLocaleTimeString();
      const loc = ev.file
        ? ` <button type="button" class="link-btn dump-open-ide" data-file="${escapeHtml(ev.file)}" data-line="${ev.line ?? ""}">${escapeHtml(ev.file)}:${ev.line ?? ""}</button>`
        : "";
      const siteBadge = ev.site
        ? `<span class="dump-site-badge" title="Site">${escapeHtml(ev.site)}</span>`
        : "";
      const bodyText = `${ev.message || ""}${ev.context ? `\n${ev.context}` : ""}`;
      const collapsed = bodyText.length > 800;
      const bodyClass = collapsed ? "dump-body collapsed" : "dump-body";
      const expandBtn = collapsed
        ? `<button type="button" class="link-btn dump-expand">Show more</button>`
        : "";
      return `<div class="dump-entry dump-${escapeHtml(ev.type)}">
        <div class="dump-entry-head">
          <span class="dump-meta">${escapeHtml(when)}</span>
          ${dumpTypeBadge(ev.type)}
          ${siteBadge}
          ${loc}
        </div>
        <pre class="${bodyClass}">${escapeHtml(bodyText)}</pre>
        ${expandBtn}
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

  viewer.querySelectorAll(".dump-expand").forEach((btn) => {
    btn.onclick = () => {
      const pre = btn.previousElementSibling;
      if (!pre) return;
      const collapsed = pre.classList.toggle("collapsed");
      btn.textContent = collapsed ? "Show more" : "Show less";
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

function closeSiteDrawer() {
  siteDrawerVhost = null;
  const drawer = document.getElementById("site-drawer");
  drawer?.classList.add("hidden");
  if (drawer) drawer.setAttribute("aria-hidden", "true");
}

async function openSiteDrawer(vhost) {
  if (!vhost) return;
  siteDrawerVhost = vhost;
  const drawer = document.getElementById("site-drawer");
  if (!drawer) return;
  drawer.classList.remove("hidden");
  drawer.setAttribute("aria-hidden", "false");

  const url = projectUrl(vhost);
  document.getElementById("site-drawer-title").textContent = vhost.name;
  const urlEl = document.getElementById("site-drawer-url");
  if (urlEl) urlEl.textContent = url;

  const phpSelect = document.getElementById("site-drawer-php");
  if (phpSelect) {
    const phpVersions = (await api.listManifests())
      .filter((m) => m.name.startsWith("php-"))
      .map((m) => m.name);
    phpSelect.innerHTML = phpVersions
      .map(
        (id) =>
          `<option value="${escapeHtml(id)}" ${vhost.phpVersion === id ? "selected" : ""}>${escapeHtml(id.replace(/^php-/, "PHP "))}</option>`
      )
      .join("");
  }

  const shares = api.listShares ? await api.listShares().catch(() => []) : [];
  const activeShare = shares.find((s) => s.siteName === vhost.name);
  const shareBtn = document.getElementById("site-drawer-share");
  if (shareBtn) shareBtn.textContent = activeShare ? "Stop share" : "Share public URL";

  const sslBtn = document.getElementById("site-drawer-ssl");
  if (sslBtn) sslBtn.textContent = vhost.ssl ? "Renew SSL" : "Enable SSL";

  let hasTelemetry = false;
  try {
    hasTelemetry = await api.hasLaravelQueryCapture(vhost.name);
  } catch {
    hasTelemetry = false;
  }
  const telemetryEl = document.getElementById("site-drawer-telemetry");
  if (telemetryEl) {
    telemetryEl.textContent = hasTelemetry
      ? "Telemetry: installed"
      : "Telemetry: not installed (Laravel AppServiceProvider)";
  }

  const workers = api.listSiteWorkers ? await api.listSiteWorkers().catch(() => []) : [];
  const queue = workers.find((w) => w.siteName === vhost.name && w.kind === "queue");
  const vite = workers.find((w) => w.siteName === vhost.name && w.kind === "vite");
  const queueCb = document.getElementById("site-drawer-queue");
  const viteCb = document.getElementById("site-drawer-vite");
  if (queueCb) queueCb.checked = Boolean(queue?.enabled);
  if (viteCb) viteCb.checked = Boolean(vite?.enabled);
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
    empty?.classList.remove("hidden");
    await refreshSitesConfig();
    return;
  }
  empty?.classList.add("hidden");

  for (const v of state.virtualHosts) {
    const li = document.createElement("li");
    li.className = "project-card project-card-summary";
    const url = projectUrl(v);
    const activeShare = shareMap.get(v.name);
    li.innerHTML = `
      <div class="project-info">
        <div class="project-name-row">
          <span class="site-source-badge">${sourceLabel(v.source)}</span>
          <span class="project-name">${escapeHtml(v.name)}</span>
          ${v.ssl ? '<span class="ssl-badge" title="HTTPS enabled">🔒</span>' : ""}
          ${activeShare ? '<span class="share-active-badge">Shared</span>' : ""}
          ${v.phpVersion ? `<span class="site-php-badge">${escapeHtml(v.phpVersion.replace(/^php-/, "PHP "))}</span>` : ""}
        </div>
        <a href="#" class="project-url project-url-link">${escapeHtml(url)}</a>
        ${
          activeShare
            ? `<div class="project-share-url"><button type="button" class="link-btn btn-copy-share">${escapeHtml(activeShare.publicUrl)}</button></div>`
            : ""
        }
      </div>
      <div class="project-actions">
        <div class="project-actions-primary">
          <button class="btn sm primary btn-open">Open site</button>
          <button class="btn sm secondary btn-details">Details</button>
        </div>
      </div>`;
    li.querySelector(".btn-open").onclick = () => api.openExternal(url);
    li.querySelector(".project-url-link")?.addEventListener("click", (e) => {
      e.preventDefault();
      api.openExternal(url);
    });
    li.querySelector(".btn-details").onclick = () => void openSiteDrawer(v);
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
    list.appendChild(li);
  }
  await refreshSitesConfig();
}

function formatBackupSize(bytes) {
  return `${Math.max(1, Math.round((bytes || 0) / 1024))} KB`;
}

function renderBackupList(el, backups) {
  if (!el) return;
  if (!backups?.length) {
    el.innerHTML = "<li class='empty-hint'>No backups yet</li>";
    return;
  }
  el.innerHTML = backups
    .slice(0, 8)
    .map(
      (b) =>
        `<li><span class="mono">${escapeHtml(b.id)}</span> · ${formatBackupSize(b.sizeBytes)} · ${escapeHtml(b.reason || "manual")}</li>`
    )
    .join("");
}

async function refreshDatabasePage() {
  const statusEl = document.getElementById("database-status");
  const listEl = document.getElementById("database-list");
  if (!statusEl || !api?.getDatabaseAdminStatus) return;

  try {
    const status = await api.getDatabaseAdminStatus();
    statusEl.textContent = status.message;
    statusEl.className = `panel-desc ${status.running ? "db-status-ok" : "db-status-warn"}`;
  } catch (err) {
    statusEl.textContent = err.message || String(err);
    statusEl.className = "panel-desc db-status-warn";
  }

  try {
    const { engine, databases } = await api.listDatabases();
    if (!databases.length) {
      listEl.className = "db-list empty-hint";
      listEl.innerHTML = `<li>No user databases on ${escapeHtml(engine)}</li>`;
    } else {
      listEl.className = "db-list";
      listEl.innerHTML = databases
        .map((db) => `<li><span class="db-name">${escapeHtml(db.name)}</span><span class="db-engine">${escapeHtml(engine)}</span></li>`)
        .join("");
    }
  } catch (err) {
    listEl.className = "db-list empty-hint";
    listEl.innerHTML = `<li>${escapeHtml(err.message || String(err))}</li>`;
  }

  const [mysql, mariadb, postgres] = await Promise.all([
    api.listMysqlBackups?.().catch(() => []) ?? [],
    api.listMariaDbBackups?.().catch(() => []) ?? [],
    api.listPostgresBackups?.().catch(() => []) ?? [],
  ]);
  renderBackupList(document.getElementById("mysql-backups-page-list"), mysql);
  renderBackupList(document.getElementById("mariadb-backups-list"), mariadb);
  renderBackupList(document.getElementById("postgres-backups-list"), postgres);
}

async function refreshPhpIniPage(preferredVersion) {
  if (!api?.listInstalledPhpVersions) return;
  const versionSelect = document.getElementById("php-ini-version");
  const extGrid = document.getElementById("php-ini-extensions");
  const contentEl = document.getElementById("php-ini-content");
  const pathEl = document.getElementById("php-ini-path");
  const activeHint = document.getElementById("php-ini-active-hint");
  if (!versionSelect) return;

  const [versions, active] = await Promise.all([
    api.listInstalledPhpVersions(),
    api.getActivePhpVersion().catch(() => ""),
  ]);
  const selected =
    preferredVersion ||
    phpIniSelectedVersion ||
    (versions.includes(active) ? active : versions[0] || "");
  phpIniSelectedVersion = selected;

  versionSelect.innerHTML = versions.length
    ? versions
        .map(
          (v) =>
            `<option value="${escapeHtml(v)}" ${v === selected ? "selected" : ""}>${escapeHtml(v.replace(/^php-/, "PHP "))}${v === active ? " (active)" : ""}</option>`
        )
        .join("")
    : `<option value="">No PHP installed</option>`;

  if (activeHint) {
    activeHint.textContent = active ? `Profile active: ${active.replace(/^php-/, "PHP ")}` : "";
  }

  if (!selected) {
    if (extGrid) extGrid.innerHTML = '<p class="empty-hint">Install PHP from Quick Add first.</p>';
    if (contentEl) contentEl.value = "";
    if (pathEl) pathEl.textContent = "";
    return;
  }

  const summary = await api.readPhpIni(selected);
  if (pathEl) pathEl.textContent = summary.iniPath || "";
  if (contentEl) contentEl.value = summary.content || "";
  if (extGrid) {
    if (!summary.extensions?.length) {
      extGrid.innerHTML = '<p class="empty-hint">No extensions detected</p>';
    } else {
      extGrid.innerHTML = summary.extensions
        .map(
          (ext) => `<label class="php-ext-toggle${ext.filePresent ? "" : " missing"}" title="${escapeHtml(ext.line)}">
            <input type="checkbox" data-ext="${escapeHtml(ext.name)}" ${ext.enabled ? "checked" : ""} ${ext.filePresent ? "" : "disabled"}>
            <span>${escapeHtml(ext.name)}</span>
          </label>`
        )
        .join("");
      extGrid.querySelectorAll("input[data-ext]").forEach((input) => {
        input.onchange = async () => {
          try {
            await withLoading(
              () => api.setPhpExtension(selected, input.dataset.ext, input.checked),
              `Updating ${input.dataset.ext}…`
            );
            showToast(`${input.dataset.ext} ${input.checked ? "enabled" : "disabled"}`, "success");
            await refreshPhpIniPage(selected);
          } catch (err) {
            showToast(err.message || String(err), "error");
            input.checked = !input.checked;
          }
        };
      });
    }
  }
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
  if (profile.database === "external") {
    const c = profile.databaseConnection;
    const host = c?.host || "?";
    const port = c?.port || "?";
    parts.push(`external (${host}:${port})`);
  } else if (profile.database && profile.database !== "none") {
    parts.push(profile.database);
  }
  for (const id of profile.services ?? []) {
    parts.push(id);
  }
  return parts.join(" · ") || "Stack not configured";
}

const EXTERNAL_DB_DEFAULT_PORTS = { mysql: 3306, mariadb: 3306, postgresql: 5432 };

function syncProfileExternalDbPanel() {
  const enabled = document.getElementById("profile-service-database")?.checked ?? true;
  const type = document.getElementById("profile-database-type")?.value || "mysql";
  const panel = document.getElementById("profile-external-db");
  if (panel) panel.classList.toggle("hidden", !enabled || type !== "external");
}

function syncProfileDatabaseToggle() {
  const enabled = document.getElementById("profile-service-database")?.checked ?? true;
  const typeSelect = document.getElementById("profile-database-type");
  if (typeSelect) typeSelect.disabled = !enabled;
  syncProfileExternalDbPanel();
}

function defaultPortForEngine(engine) {
  return EXTERNAL_DB_DEFAULT_PORTS[engine] ?? 3306;
}

function readExternalDbConnectionFromEditor() {
  const engine = document.getElementById("profile-db-engine")?.value || "mariadb";
  const host = (document.getElementById("profile-db-host")?.value || "").trim();
  const portRaw = document.getElementById("profile-db-port")?.value;
  const port = portRaw ? Number(portRaw) : defaultPortForEngine(engine);
  const user = (document.getElementById("profile-db-user")?.value || "").trim();
  const password = document.getElementById("profile-db-password")?.value ?? "";
  return {
    engine,
    host,
    port: Number.isFinite(port) && port > 0 ? port : defaultPortForEngine(engine),
    user: user || (engine === "postgresql" ? "postgres" : "root"),
    password,
  };
}

function applyExternalDbConnectionToEditor(conn) {
  const engine = conn?.engine || "mariadb";
  const engineEl = document.getElementById("profile-db-engine");
  const hostEl = document.getElementById("profile-db-host");
  const portEl = document.getElementById("profile-db-port");
  const userEl = document.getElementById("profile-db-user");
  const passEl = document.getElementById("profile-db-password");
  if (engineEl) engineEl.value = engine;
  if (hostEl) hostEl.value = conn?.host || "";
  if (portEl) portEl.value = conn?.port != null ? String(conn.port) : String(defaultPortForEngine(engine));
  if (userEl) userEl.value = conn?.user || "";
  if (passEl) passEl.value = conn?.password || "";
}

function readProfileServicesFromEditor() {
  const databaseEnabled = document.getElementById("profile-service-database")?.checked ?? true;
  const database = databaseEnabled
    ? document.getElementById("profile-database-type")?.value || "mysql"
    : "none";
  const services = [];
  if (document.getElementById("profile-service-redis")?.checked) services.push("redis");
  if (document.getElementById("profile-service-mailpit")?.checked) services.push("mailpit");
  const result = { database, services };
  if (database === "external") {
    result.databaseConnection = readExternalDbConnectionFromEditor();
  }
  return result;
}

function applyProfileServicesToEditor(profile) {
  const hasDatabase = !profile.database || profile.database !== "none";
  const databaseToggle = document.getElementById("profile-service-database");
  const databaseType = document.getElementById("profile-database-type");
  if (databaseToggle) databaseToggle.checked = hasDatabase;
  if (databaseType) {
    databaseType.value = hasDatabase ? profile.database || "mysql" : "mysql";
  }
  applyExternalDbConnectionToEditor(
    profile.database === "external" ? profile.databaseConnection : { engine: "mariadb" }
  );
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
  const { database, services, databaseConnection } = readProfileServicesFromEditor();
  const payload = {
    description: document.getElementById("profile-description").value.trim(),
    phpVersion: document.getElementById("profile-php-version").value,
    webServer: document.getElementById("profile-web-server").value,
    database,
    services,
  };
  if (database === "external" && databaseConnection) {
    payload.databaseConnection = databaseConnection;
  }

  if (database === "external" && !(databaseConnection?.host || "").trim()) {
    return showToast("External database host is required", "error");
  }

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
    setUpdateStatusLine(result);
    setUpdateAvailableIndicator(result.update);
    const setupVisible = !document.getElementById("view-setup")?.classList.contains("hidden");
    if (setupVisible) {
      showToast(`Update v${result.update.latestVersion} ready in Settings when setup finishes`, "success", 5000);
      return;
    }
    // Quiet notice only — no modal. Badge/chip stays until install or skip.
    showToast(`DevTent v${result.update.latestVersion} is available`, "success", 4500);
  });
  api.onUpdateDownloadProgress(({ percent, message }) => setUpdateProgress(percent, message));
  api.onNavigate?.((view) => {
    showView(view);
    if (view === "tooling") void refreshTooling();
    else if (view === "dumps") void refreshDumps().then(startDumpsFollow);
    else if (view === "logs") void refreshLogs().then(startLogFollow);
    else if (view === "doctor") void refreshDoctorPage({ repair: false });
    else if (view === "mail") void refreshMailPage();
    else if (view === "share") void refreshSharePage();
    else if (view === "database") void refreshDatabasePage();
    else if (view === "php-ini") void refreshPhpIniPage();
    else if (view === "projects") void refreshProjects();
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
      if (view === "doctor") await refreshDoctorPage({ repair: false });
      if (view === "mail") await refreshMailPage();
      if (view === "share") await refreshSharePage();
      if (view === "database") await refreshDatabasePage();
      if (view === "php-ini") await refreshPhpIniPage();
      if (view === "profiles") {
        await refreshProfiles();
        hideProfileEditor();
      }
      if (view === "settings") {
        const { root } = await api.getRoot();
        showSettingsSection(updateBadgeVisible ? "updates" : "general");
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
    lastDumpsSignature = "";
    await refreshDumps();
  });
  document.getElementById("btn-dumps-clear-type")?.addEventListener("click", async () => {
    const types = dumpTypesForFilter(currentDumpFilter);
    if (!types) {
      await api.clearDumps();
    } else {
      await api.clearDumps(types);
    }
    lastDumpsSignature = "";
    await refreshDumps();
    showToast(types ? `Cleared ${types.join(", ")}` : "Dumps cleared", "success");
  });
  document.getElementById("dumps-search")?.addEventListener("input", (e) => {
    currentDumpSearch = e.target.value || "";
    lastDumpsSignature = "";
    void refreshDumps();
  });
  document.getElementById("dumps-site-filter")?.addEventListener("change", (e) => {
    currentDumpSite = e.target.value || "";
    lastDumpsSignature = "";
    void refreshDumps();
  });
  document.getElementById("btn-dumps-install-telemetry")?.addEventListener("click", async () => {
    const site = document.getElementById("dumps-telemetry-site")?.value;
    if (!site) {
      showToast("Select a site first", "error");
      return;
    }
    try {
      const result = await withLoading(
        () => api.installLaravelQueryCapture(site),
        `Installing telemetry for ${site}…`
      );
      showToast(result.message || "Telemetry installed", result.installed ? "success" : "error");
    } catch (err) {
      showToast(err.message || String(err), "error");
    }
  });
  document.querySelectorAll("[data-dump-filter]").forEach((chip) => {
    chip.addEventListener("click", () => {
      currentDumpFilter = chip.dataset.dumpFilter || "all";
      document.querySelectorAll("[data-dump-filter]").forEach((c) => {
        c.classList.toggle("active", c.dataset.dumpFilter === currentDumpFilter);
      });
      lastDumpsSignature = "";
      void refreshDumps();
    });
  });
  document.getElementById("dumps-follow")?.addEventListener("change", () => {
    if (document.getElementById("dumps-follow")?.checked) startDumpsFollow();
    else stopDumpsFollow();
  });

  document.getElementById("btn-projects-empty-quick-app")?.addEventListener("click", () => {
    showView("quick-app");
    void refreshTemplates();
  });

  const isMacPalette =
    /Mac|iPhone|iPad/.test(navigator.platform || "") || /Mac OS X/.test(navigator.userAgent || "");
  const paletteBtn = document.getElementById("btn-command-palette");
  if (paletteBtn) {
    paletteBtn.textContent = isMacPalette ? "⌘K" : "Ctrl+K";
    paletteBtn.addEventListener("click", () => openCommandPalette());
  }

  document.getElementById("site-drawer-backdrop")?.addEventListener("click", closeSiteDrawer);
  document.getElementById("site-drawer-close")?.addEventListener("click", closeSiteDrawer);
  document.getElementById("site-drawer-open")?.addEventListener("click", () => {
    if (!siteDrawerVhost) return;
    api.openExternal(projectUrl(siteDrawerVhost));
  });
  document.getElementById("site-drawer-folder")?.addEventListener("click", () => {
    if (!siteDrawerVhost) return;
    if (siteDrawerVhost.projectPath && siteDrawerVhost.source !== "www") {
      api.openProjectPath(siteDrawerVhost.projectPath);
    } else {
      api.openPath(`www/${siteDrawerVhost.name}`);
    }
  });
  document.getElementById("site-drawer-php")?.addEventListener("change", async (e) => {
    if (!siteDrawerVhost) return;
    const version = e.target.value;
    await withLoading(
      () => api.setSitePhpVersion(siteDrawerVhost.name, version),
      `Setting PHP for ${siteDrawerVhost.name}…`
    );
    showToast(`${siteDrawerVhost.name} → ${version}`, "success");
    await refreshProjects();
    await refreshServices();
    const state = await api.getState();
    const updated = state.virtualHosts?.find((v) => v.name === siteDrawerVhost.name);
    if (updated) await openSiteDrawer(updated);
  });
  document.getElementById("site-drawer-ssl")?.addEventListener("click", async () => {
    if (!siteDrawerVhost) return;
    const result = await withLoading(
      () => api.enableSsl(siteDrawerVhost.domain),
      "Generating certificate…"
    );
    showToast(result.message, result.success ? "success" : "error");
    if (result.success) {
      await refreshProjects();
      await refreshAll();
      const state = await api.getState();
      const updated = state.virtualHosts?.find((v) => v.name === siteDrawerVhost.name);
      if (updated) await openSiteDrawer(updated);
    }
  });
  document.getElementById("site-drawer-share")?.addEventListener("click", async () => {
    if (!siteDrawerVhost) return;
    try {
      const shares = api.listShares ? await api.listShares().catch(() => []) : [];
      const active = shares.find((s) => s.siteName === siteDrawerVhost.name);
      if (active) {
        await withLoading(
          () => api.stopShare(siteDrawerVhost.name),
          `Stopping share for ${siteDrawerVhost.name}…`
        );
        showToast(`Stopped public share for ${siteDrawerVhost.name}`, "success");
      } else {
        const session = await withLoading(
          () => api.startShare(siteDrawerVhost.name),
          `Sharing ${siteDrawerVhost.name}…`
        );
        showToast(`Public URL copied — ${session.publicUrl}`, "success", 10000);
        try {
          await navigator.clipboard.writeText(session.publicUrl);
        } catch {
          // ignore
        }
      }
      await refreshProjects();
      const state = await api.getState();
      const updated = state.virtualHosts?.find((v) => v.name === siteDrawerVhost.name);
      if (updated) await openSiteDrawer(updated);
    } catch (err) {
      showToast(err.message || String(err), "error");
    }
  });
  document.getElementById("site-drawer-laravel-env")?.addEventListener("click", async () => {
    if (!siteDrawerVhost) return;
    try {
      const snippet = await api.getLaravelEnv(siteDrawerVhost.name);
      await navigator.clipboard.writeText(snippet.envBlock);
      showToast(`Copied Laravel .env snippet for ${snippet.domain}`, "success");
    } catch (err) {
      showToast(err.message || String(err), "error");
    }
  });
  document.getElementById("site-drawer-install-telemetry")?.addEventListener("click", async () => {
    if (!siteDrawerVhost) return;
    try {
      const result = await withLoading(
        () => api.installLaravelQueryCapture(siteDrawerVhost.name),
        `Installing telemetry for ${siteDrawerVhost.name}…`
      );
      showToast(result.message || "Telemetry installed", result.installed ? "success" : "error");
      await openSiteDrawer(siteDrawerVhost);
    } catch (err) {
      showToast(err.message || String(err), "error");
    }
  });
  document.getElementById("site-drawer-create-db")?.addEventListener("click", async () => {
    if (!siteDrawerVhost) return;
    try {
      const result = await withLoading(
        () => api.createDatabase(siteDrawerVhost.name),
        `Creating database for ${siteDrawerVhost.name}…`
      );
      showToast(result.message || `Created ${result.name}`, "success");
    } catch (err) {
      showToast(err.message || String(err), "error");
    }
  });
  document.getElementById("site-drawer-queue")?.addEventListener("change", async (e) => {
    if (!siteDrawerVhost) return;
    try {
      await withLoading(
        () => api.setSiteWorker(siteDrawerVhost.name, "queue", e.target.checked),
        e.target.checked ? "Enabling queue worker…" : "Disabling queue worker…"
      );
      showToast(
        e.target.checked ? "Queue worker enabled — restart services to apply" : "Queue worker disabled",
        "success"
      );
    } catch (err) {
      showToast(err.message || String(err), "error");
      e.target.checked = !e.target.checked;
    }
  });
  document.getElementById("site-drawer-vite")?.addEventListener("change", async (e) => {
    if (!siteDrawerVhost) return;
    try {
      await withLoading(
        () => api.setSiteWorker(siteDrawerVhost.name, "vite", e.target.checked),
        e.target.checked ? "Enabling Vite worker…" : "Disabling Vite worker…"
      );
      showToast(
        e.target.checked ? "Vite worker enabled — restart services to apply" : "Vite worker disabled",
        "success"
      );
    } catch (err) {
      showToast(err.message || String(err), "error");
      e.target.checked = !e.target.checked;
    }
  });

  document.getElementById("btn-database-refresh")?.addEventListener("click", () => refreshDatabasePage());
  document.getElementById("database-create-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = document.getElementById("database-create-name")?.value?.trim();
    if (!name) return;
    try {
      const result = await withLoading(() => api.createDatabase(name), `Creating ${name}…`);
      showToast(result.message || `Created ${result.name}`, "success");
      document.getElementById("database-create-name").value = "";
      await refreshDatabasePage();
    } catch (err) {
      showToast(err.message || String(err), "error");
    }
  });
  document.getElementById("btn-backup-mysql-page")?.addEventListener("click", async () => {
    const backup = await withLoading(() => api.backupMysql(), "Backing up MySQL…");
    if (backup) showToast(`MySQL backup saved (${formatBackupSize(backup.sizeBytes)})`, "success");
    else showToast("MySQL is not running — start it first to back up", "error");
    await refreshDatabasePage();
  });
  document.getElementById("btn-backup-mariadb")?.addEventListener("click", async () => {
    const backup = await withLoading(() => api.backupMariaDb(), "Backing up MariaDB…");
    if (backup) showToast(`MariaDB backup saved (${formatBackupSize(backup.sizeBytes)})`, "success");
    else showToast("MariaDB is not running — start it first to back up", "error");
    await refreshDatabasePage();
  });
  document.getElementById("btn-backup-postgres")?.addEventListener("click", async () => {
    const backup = await withLoading(() => api.backupPostgres(), "Backing up PostgreSQL…");
    if (backup) showToast(`PostgreSQL backup saved (${formatBackupSize(backup.sizeBytes)})`, "success");
    else showToast("PostgreSQL is not running — start it first to back up", "error");
    await refreshDatabasePage();
  });

  document.getElementById("php-ini-version")?.addEventListener("change", (e) => {
    phpIniSelectedVersion = e.target.value;
    void refreshPhpIniPage(phpIniSelectedVersion);
  });
  document.getElementById("btn-php-ini-save")?.addEventListener("click", async () => {
    const version = document.getElementById("php-ini-version")?.value;
    const content = document.getElementById("php-ini-content")?.value ?? "";
    if (!version) {
      showToast("No PHP version selected", "error");
      return;
    }
    try {
      await withLoading(() => api.writePhpIni(version, content), "Saving php.ini…");
      showToast("php.ini saved", "success");
      await refreshPhpIniPage(version);
    } catch (err) {
      showToast(err.message || String(err), "error");
    }
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

  document.getElementById("btn-update-available")?.addEventListener("click", () => {
    openPendingUpdate();
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
    clearUpdateAvailableIndicator();
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
    const name = prompt("Site name (used for the local domain):", defaultName);
    if (!name) return;
    await withLoading(() => api.linkProject(projectPath, name), "Linking project…");
    handleHostsSyncResult(await api.syncVhosts());
    const root = await api.getRoot();
    showToast(`Linked ${name}.${root.tld || "localhost"}`, "success");
    await refreshProjects();
  });

  document.getElementById("btn-open-doctor")?.addEventListener("click", () => {
    showView("doctor");
    void refreshDoctorPage({ repair: false });
  });

  document.getElementById("btn-doctor-check")?.addEventListener("click", async () => {
    await refreshDoctorPage({ repair: false });
    showToast("Doctor check finished", "success");
  });

  document.getElementById("btn-doctor-fix")?.addEventListener("click", async () => {
    const ok = confirm(
      "Run DevTent doctor with automatic repairs?\n\nThis syncs Procfile, regenerates vhosts, and verifies configs."
    );
    if (!ok) return;
    await refreshDoctorPage({ repair: true });
    showToast("Doctor finished", "success");
    await refreshAll();
  });

  document.getElementById("btn-doctor-trust-ca")?.addEventListener("click", async () => {
    try {
      const result = await withLoading(() => api.trustMkcertCa(), "Trusting local CA…");
      showToast(result?.message || "Local CA trusted", "success");
      await refreshDoctorCaDns();
    } catch (err) {
      showToast(err.message || String(err), "error");
    }
  });

  document.getElementById("btn-doctor-dns-start")?.addEventListener("click", async () => {
    try {
      const status = await withLoading(() => api.startLocalDns(), "Starting local DNS…");
      showToast(`DNS on ${status.bind}:${status.port} for *.${status.tld}`, "success");
      await refreshDoctorCaDns();
    } catch (err) {
      showToast(err.message || String(err), "error");
    }
  });

  document.getElementById("btn-doctor-dns-stop")?.addEventListener("click", async () => {
    try {
      await withLoading(() => api.stopLocalDns(), "Stopping local DNS…");
      showToast("Local DNS stopped", "success");
      await refreshDoctorCaDns();
    } catch (err) {
      showToast(err.message || String(err), "error");
    }
  });

  document.getElementById("btn-doctor-dns-resolver")?.addEventListener("click", async () => {
    try {
      const result = await withLoading(() => api.installLocalDnsResolver(), "Installing OS resolver…");
      showToast(result?.message || "Resolver install requested", result?.ok === false ? "error" : "success", 8000);
      await refreshDoctorCaDns();
    } catch (err) {
      showToast(err.message || String(err), "error");
    }
  });

  document.getElementById("btn-share-cf-login")?.addEventListener("click", async () => {
    try {
      const result = await withLoading(() => api.cloudflareLogin(), "Opening Cloudflare login…");
      showToast(result?.message || (result?.ok ? "Logged in" : "Login incomplete"), result?.ok ? "success" : "error");
      await refreshSharePage();
    } catch (err) {
      showToast(err.message || String(err), "error");
    }
  });

  document.getElementById("btn-share-named-create")?.addEventListener("click", async () => {
    const name = prompt("Tunnel name (letters, numbers, hyphens):", "devtent");
    if (!name) return;
    try {
      const tunnel = await withLoading(() => api.createNamedTunnel(name), `Creating ${name}…`);
      showToast(`Created tunnel ${tunnel.name}`, "success");
      await refreshSharePage();
    } catch (err) {
      showToast(err.message || String(err), "error");
    }
  });

  document.getElementById("btn-mail-open")?.addEventListener("click", () => {
    api.openExternal("http://127.0.0.1:8025");
  });

  document.getElementById("btn-mail-start")?.addEventListener("click", async () => {
    try {
      await withLoading(() => api.startService("mailpit"), "Starting Mailpit…");
      showToast("Mailpit started", "success");
      await refreshMailPage();
    } catch (err) {
      showToast(err.message || String(err), "error");
    }
  });

  document.getElementById("btn-mail-copy-env")?.addEventListener("click", async () => {
    const text = document.getElementById("mail-env-snippet")?.textContent ?? "";
    try {
      await navigator.clipboard.writeText(text);
      showToast("Copied Laravel mail .env block", "success");
    } catch {
      showToast("Could not copy — select the block manually", "error");
    }
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
  document.getElementById("profile-database-type")?.addEventListener("change", () => {
    syncProfileExternalDbPanel();
  });
  document.getElementById("profile-db-engine")?.addEventListener("change", () => {
    const engine = document.getElementById("profile-db-engine")?.value || "mariadb";
    const portEl = document.getElementById("profile-db-port");
    if (portEl && !portEl.value) portEl.value = String(defaultPortForEngine(engine));
  });

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

  setupCommandPalette();
  setupKeyboardShortcuts();
}

const PALETTE_VIEWS = [
  "dashboard",
  "projects",
  "services",
  "logs",
  "dumps",
  "database",
  "php-ini",
  "tooling",
  "mail",
  "share",
  "doctor",
  "quick-add",
  "quick-app",
  "profiles",
  "settings",
];

let paletteIndex = 0;
let paletteCommands = [];

function buildPaletteCommands() {
  const nav = PALETTE_VIEWS.map((view, i) => ({
    id: `nav-${view}`,
    label: TITLES[view] || view,
    hint: i < 9 ? String(i + 1) : "",
    group: "Navigate",
    run: () => {
      showView(view);
      if (view === "dumps") void refreshDumps().then(startDumpsFollow);
      else if (view === "share") void refreshSharePage();
      else if (view === "doctor") void refreshDoctorPage({ repair: false });
      else if (view === "mail") void refreshMailPage();
      else if (view === "services") void refreshServices();
      else if (view === "projects") void refreshProjects();
      else if (view === "database") void refreshDatabasePage();
      else if (view === "php-ini") void refreshPhpIniPage();
    },
  }));

  const siteCommands = [];
  // Sites are loaded asynchronously when opening the palette
  const cachedHosts = window.__devtentPaletteHosts || [];
  for (const v of cachedHosts) {
    const url = projectUrl(v);
    siteCommands.push({
      id: `site-open-${v.name}`,
      label: `Open ${v.name}`,
      hint: v.domain,
      group: "Sites",
      run: () => api.openExternal(url),
    });
    siteCommands.push({
      id: `site-drawer-${v.name}`,
      label: `Details: ${v.name}`,
      hint: "drawer",
      group: "Sites",
      run: () => {
        showView("projects");
        void openSiteDrawer(v);
      },
    });
  }

  const actions = [
    {
      id: "start-all",
      label: "Start all services",
      hint: "S",
      group: "Actions",
      run: async () => {
        await withLoading(() => api.startAll(), "Starting services…");
        showToast("Services started", "success");
        await refreshServices();
      },
    },
    {
      id: "stop-all",
      label: "Stop all services",
      hint: "",
      group: "Actions",
      run: async () => {
        await withLoading(() => api.stopAll(), "Stopping services…");
        showToast("Services stopped", "success");
        await refreshServices();
      },
    },
    {
      id: "sync-vhosts",
      label: "Sync virtual hosts",
      hint: "",
      group: "Actions",
      run: async () => {
        handleHostsSyncResult(await api.syncVhosts());
        showToast("Virtual hosts synced", "success");
        await refreshProjects();
      },
    },
    {
      id: "doctor",
      label: "Run doctor check",
      hint: "D",
      group: "Actions",
      run: async () => {
        showView("doctor");
        await refreshDoctorPage({ repair: false });
      },
    },
    {
      id: "refresh",
      label: "Refresh current view",
      hint: "R",
      group: "Actions",
      run: async () => {
        await refreshAll();
        showToast("Refreshed", "success");
      },
    },
    {
      id: "dumps-clear",
      label: "Clear dumps",
      hint: "",
      group: "Actions",
      run: async () => {
        await api.clearDumps();
        lastDumpsSignature = "";
        await refreshDumps();
        showToast("Dumps cleared", "success");
      },
    },
  ];
  return [...nav, ...siteCommands, ...actions];
}

async function openCommandPalette() {
  const el = document.getElementById("command-palette");
  const input = document.getElementById("command-palette-input");
  if (!el || !input) return;
  try {
    const state = await api.getState();
    window.__devtentPaletteHosts = state.virtualHosts || [];
  } catch {
    window.__devtentPaletteHosts = [];
  }
  paletteCommands = buildPaletteCommands();
  el.classList.remove("hidden");
  input.value = "";
  paletteIndex = 0;
  renderPaletteResults("");
  input.focus();
}

function closeCommandPalette() {
  document.getElementById("command-palette")?.classList.add("hidden");
}

function renderPaletteResults(query) {
  const list = document.getElementById("command-palette-results");
  if (!list) return;
  const q = query.trim().toLowerCase();
  const filtered = paletteCommands.filter(
    (c) => !q || c.label.toLowerCase().includes(q) || c.group.toLowerCase().includes(q)
  );
  if (paletteIndex >= filtered.length) paletteIndex = Math.max(0, filtered.length - 1);
  list.innerHTML = filtered
    .map(
      (c, i) => `<li class="command-palette-item${i === paletteIndex ? " active" : ""}" data-index="${i}" role="option">
      <span class="command-palette-label">${escapeHtml(c.label)}</span>
      <span class="command-palette-meta">${escapeHtml(c.group)}${c.hint ? ` · ${escapeHtml(c.hint)}` : ""}</span>
    </li>`
    )
    .join("");
  list.querySelectorAll(".command-palette-item").forEach((item) => {
    item.onmouseenter = () => {
      paletteIndex = Number(item.dataset.index);
      renderPaletteResults(query);
    };
    item.onclick = () => void runPaletteCommand(filtered[Number(item.dataset.index)]);
  });
  list.dataset.filtered = JSON.stringify(filtered.map((c) => c.id));
}

async function runPaletteCommand(cmd) {
  if (!cmd) return;
  closeCommandPalette();
  try {
    await cmd.run();
  } catch (err) {
    showToast(err.message || String(err), "error");
  }
}

function setupCommandPalette() {
  const input = document.getElementById("command-palette-input");
  document.getElementById("command-palette-backdrop")?.addEventListener("click", closeCommandPalette);
  input?.addEventListener("input", () => {
    paletteIndex = 0;
    renderPaletteResults(input.value);
  });
  input?.addEventListener("keydown", (e) => {
    const list = document.getElementById("command-palette-results");
    const ids = JSON.parse(list?.dataset.filtered || "[]");
    const filtered = ids.map((id) => paletteCommands.find((c) => c.id === id)).filter(Boolean);
    if (e.key === "ArrowDown") {
      e.preventDefault();
      paletteIndex = Math.min(paletteIndex + 1, Math.max(0, filtered.length - 1));
      renderPaletteResults(input.value);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      paletteIndex = Math.max(paletteIndex - 1, 0);
      renderPaletteResults(input.value);
    } else if (e.key === "Enter") {
      e.preventDefault();
      void runPaletteCommand(filtered[paletteIndex]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      closeCommandPalette();
    }
  });
}

function setupKeyboardShortcuts() {
  document.addEventListener("keydown", (e) => {
    const tag = (e.target?.tagName || "").toLowerCase();
    const typing = tag === "input" || tag === "textarea" || tag === "select" || e.target?.isContentEditable;
    const mod = e.ctrlKey || e.metaKey;

    if (mod && e.key.toLowerCase() === "k") {
      e.preventDefault();
      const open = !document.getElementById("command-palette")?.classList.contains("hidden");
      if (open) closeCommandPalette();
      else openCommandPalette();
      return;
    }

    if (e.key === "Escape") {
      closeCommandPalette();
      closeSiteDrawer();
      return;
    }

    if (typing || mod || e.altKey) return;

    if (e.key >= "1" && e.key <= "9") {
      const view = PALETTE_VIEWS[Number(e.key) - 1];
      if (view) {
        e.preventDefault();
        showView(view);
      }
      return;
    }

    const key = e.key.toLowerCase();
    if (key === "r") {
      e.preventDefault();
      void refreshAll();
    } else if (key === "s") {
      e.preventDefault();
      void withLoading(() => api.startAll(), "Starting services…").then(() => {
        showToast("Services started", "success");
        return refreshServices();
      });
    } else if (key === "d") {
      e.preventDefault();
      showView("doctor");
      void refreshDoctorPage({ repair: false });
    } else if (key === "/") {
      e.preventDefault();
      openCommandPalette();
    }
  });
}

boot().catch((err) => {
  showToast(err.message || "Failed to start", "error");
  console.error(err);
});
