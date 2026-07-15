const api = window.devtent;

async function refresh() {
  if (!api) return;

  const state = await api.getState();
  const { active } = await api.listProfiles().catch(() => ({ active: "default" }));
  const profileServices = await api.getProfileServices(active).catch(() => []);
  const running = await api.getServices();
  const runningMap = new Map(running.map((s) => [s.name, s]));
  const profiles = (await api.listProfiles().catch(() => ({ profiles: [] }))).profiles ?? [];

  const runningCount = running.filter((s) => s.running).length;
  const statusPill = document.getElementById("global-status");
  const statusText = document.getElementById("status-text");

  if (runningCount > 0) {
    statusPill.classList.add("running");
    statusText.textContent = `${runningCount} running`;
  } else {
    statusPill.classList.remove("running");
    statusText.textContent = "Idle";
  }

  document.getElementById("sites-count").textContent = String(
    state.virtualHosts?.length ?? 0
  );

  const doctorBadge = document.getElementById("doctor-badge");
  if (doctorBadge && api.getEnvironmentHealth) {
    try {
      const health = await api.getEnvironmentHealth();
      const issues = (health || []).filter((h) => h.severity === "warn" || h.severity === "error");
      if (issues.length) {
        doctorBadge.textContent = String(issues.length);
        doctorBadge.classList.add("warn");
      } else {
        doctorBadge.textContent = "";
        doctorBadge.classList.remove("warn");
      }
    } catch {
      doctorBadge.textContent = "";
      doctorBadge.classList.remove("warn");
    }
  }

  const profileNote = document.getElementById("profile-services-note");
  if (profileNote) {
    profileNote.textContent = profileServices.length
      ? `Active profile: ${active} · ${profileServices.map((s) => s.name).join(", ")}`
      : `Active profile: ${active}`;
  }

  const svcList = document.getElementById("service-list");
  svcList.innerHTML = "";
  if (!profileServices.length) {
    svcList.innerHTML = '<li class="empty">No services in active profile — edit in Profiles</li>';
  } else {
    profileServices.forEach((svc) => {
      const isRunning = runningMap.get(svc.id)?.running;
      const li = document.createElement("li");
      li.className = isRunning ? "running" : "";
      const disabled = !svc.runtimeInstalled ? "disabled" : "";
      li.innerHTML = `
        <span class="svc-dot"></span>
        <span class="svc-name">${svc.name}${svc.runtimeInstalled ? "" : " (not installed)"}</span>
        <button class="svc-action" ${disabled}>${isRunning ? "Stop" : "Start"}</button>`;
      const btn = li.querySelector(".svc-action");
      if (svc.runtimeInstalled) {
        btn.onclick = async (e) => {
          e.stopPropagation();
          if (isRunning) await api.stopService(svc.id);
          else await api.startService(svc.id);
          refresh();
        };
      }
      svcList.appendChild(li);
    });
  }

  const siteList = document.getElementById("site-list");
  siteList.innerHTML = "";
  (state.virtualHosts ?? []).forEach((v) => {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    const url = v.ssl ? `https://${v.domain}` : `http://${v.domain}`;
    btn.textContent = v.ssl ? `${v.domain} 🔒` : v.domain;
    btn.onclick = () => api.openExternal(url);
    li.appendChild(btn);
    siteList.appendChild(li);
  });

  const profileList = document.getElementById("profile-list");
  profileList.innerHTML = "";
  profiles.forEach((p) => {
    const li = document.createElement("li");
    li.className = p.name === active ? "active" : "";
    const php = p.phpVersion ? p.phpVersion.replace(/^php-/, "PHP ") : "";
    const label = [p.name, php, p.description].filter(Boolean).join(" · ");
    li.textContent = label;
    if (p.name !== active) {
      li.onclick = async () => {
        await api.switchProfile(p.name);
        refresh();
      };
    }
    profileList.appendChild(li);
  });
}

function bind() {
  if (!api) return;

  api.onRefresh(() => refresh());

  document.getElementById("btn-popup-close")?.addEventListener("click", () => {
    api.closeQuickPanel?.();
  });

  document.getElementById("btn-start-all").onclick = async () => {
    await api.startAll();
    refresh();
  };

  document.getElementById("btn-stop-all").onclick = async () => {
    await api.stopAll();
    refresh();
  };

  document.getElementById("btn-www").onclick = () => api.openPath("www");
  document.getElementById("btn-dashboard").onclick = () => api.openDashboard();
  document.getElementById("btn-mail")?.addEventListener("click", () => api.openDashboard("mail"));
  document.getElementById("btn-dumps")?.addEventListener("click", () => api.openDashboard("dumps"));
  document.getElementById("btn-database")?.addEventListener("click", () => api.openDashboard("database"));
  document.getElementById("btn-doctor")?.addEventListener("click", () => api.openDashboard("doctor"));
  document.getElementById("btn-services")?.addEventListener("click", () => api.openDashboard("services"));
  document.getElementById("btn-settings").onclick = () => api.openDashboard("settings");
  document.getElementById("btn-terminal").onclick = () => api.openTerminal();
  document.getElementById("btn-logs").onclick = () => api.openDashboard("logs");
  document.getElementById("btn-quit").onclick = () => api.quit();

  document.getElementById("btn-sites").onclick = () => {
    const section = document.getElementById("sites-section");
    section.classList.toggle("hidden");
    if (!section.classList.contains("hidden")) {
      api.syncVhosts().then(refresh);
    }
  };

  document.getElementById("btn-edit-procfile").onclick = async () => {
    document.getElementById("advanced-section")?.classList.remove("hidden");
    const editor = document.getElementById("procfile-editor");
    editor.classList.toggle("hidden");
    if (!editor.classList.contains("hidden")) {
      document.getElementById("procfile-raw").value = await api.readProcfileRaw();
    }
  };

  document.getElementById("btn-save-procfile").onclick = async () => {
    const content = document.getElementById("procfile-raw").value;
    await api.writeProcfileRaw(content);
    document.getElementById("procfile-editor").classList.add("hidden");
    refresh();
  };
}

bind();
refresh();
