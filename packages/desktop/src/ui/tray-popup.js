const api = window.devtent;

async function refresh() {
  if (!api) return;

  const state = await api.getState();
  const services = await api.getServices();
  const { active, profiles } = await api.listProfiles().catch(() => ({
    active: "default",
    profiles: [],
  }));

  const runningCount = services.filter((s) => s.running).length;
  const statusPill = document.getElementById("global-status");
  const statusDot = document.getElementById("status-dot");
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

  const toggleList = document.getElementById("procfile-toggles");
  toggleList.innerHTML = "";
  const toggles = await api.getProcfileToggles().catch(() => []);
  toggles.forEach((t) => {
    const li = document.createElement("li");
    li.innerHTML = `<span class="toggle-label">${t.name}</span>`;
    const btn = document.createElement("button");
    btn.className = "toggle-switch" + (t.enabled ? " on" : "");
    btn.type = "button";
    btn.title = t.command;
    btn.onclick = async () => {
      await api.setProcfileToggle(t.id, !t.enabled);
      refresh();
    };
    li.appendChild(btn);
    toggleList.appendChild(li);
  });

  const svcList = document.getElementById("service-list");
  svcList.innerHTML = "";
  if (!services.length) {
    svcList.innerHTML = '<li class="empty">Toggle NGINX, MySQL, or PHP above after installing runtimes</li>';
  } else {
    services.forEach((svc) => {
      const li = document.createElement("li");
      li.className = svc.running ? "running" : "";
      li.innerHTML = `
        <span class="svc-dot"></span>
        <span class="svc-name">${svc.name}</span>
        <button class="svc-action">${svc.running ? "Stop" : "Start"}</button>`;
      li.querySelector(".svc-action").onclick = async (e) => {
        e.stopPropagation();
        if (svc.running) await api.stopService(svc.name);
        else await api.startService(svc.name);
        refresh();
      };
      svcList.appendChild(li);
    });
  }

  const siteList = document.getElementById("site-list");
  siteList.innerHTML = "";
  (state.virtualHosts ?? []).forEach((v) => {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.textContent = v.domain;
    btn.onclick = () => api.openExternal(`http://${v.domain}`);
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
  document.getElementById("btn-settings").onclick = () => api.openDashboard();
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
