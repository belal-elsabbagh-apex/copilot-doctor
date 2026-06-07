export {};

let editingHost: string | null = null;
let allConfigs: SiteConfigs = {};

const statusEl = document.getElementById("status");
const editor = document.getElementById("editor");
const siteList = document.getElementById("site-list");
const sitesContainer = document.getElementById("sites");
const emptyMsg = document.getElementById("empty-msg");
const editorTitle = document.getElementById("editor-title");

document.addEventListener("DOMContentLoaded", loadConfigs);

document.getElementById("add-site")?.addEventListener("click", () => {
  editingHost = null;
  if (editorTitle) editorTitle.textContent = "Add Site";
  clearEditor();
  showEditor();
});

document.getElementById("cancel")?.addEventListener("click", () => {
  showList();
});

document.getElementById("delete")?.addEventListener("click", () => {
  if (!editingHost || !confirm(`Delete config for "${editingHost}"?`)) return;
  delete allConfigs[editingHost];
  saveConfigs();
  showList();
});

document.getElementById("save")?.addEventListener("click", saveCurrent);
document.getElementById("test")?.addEventListener("click", testConnection);

function loadConfigs() {
  chrome.storage.local.get("siteConfigs", (data) => {
    const d = data as StorageResult;
    allConfigs = d.siteConfigs ?? {};
    renderList();
  });
}

function saveConfigs() {
  chrome.storage.local.set({ siteConfigs: allConfigs }, () => {
    renderList();
  });
}

function renderList() {
  const hosts = Object.keys(allConfigs);
  if (sitesContainer) sitesContainer.innerHTML = "";
  if (emptyMsg) emptyMsg.style.display = hosts.length === 0 ? "block" : "none";

  for (const host of hosts.sort()) {
    const cfg = allConfigs[host];
    const card = document.createElement("div");
    card.className = "site-card";
    card.innerHTML = `
      <div class="site-host">${host}</div>
      <div class="site-summary">${cfg.org} / ${cfg.tenant} / ${cfg.folder}</div>
    `;
    card.addEventListener("click", () => editSite(host));
    sitesContainer?.appendChild(card);
  }
}

function editSite(host: string) {
  editingHost = host;
  if (editorTitle) editorTitle.textContent = `Edit: ${host}`;
  const cfg = allConfigs[host];
  const hostnameEl = document.getElementById(
    "hostname",
  ) as HTMLInputElement | null;
  const orgEl = document.getElementById("org") as HTMLInputElement | null;
  const tenantEl = document.getElementById("tenant") as HTMLInputElement | null;
  const folderEl = document.getElementById("folder") as HTMLInputElement | null;
  const tokenEl = document.getElementById("token") as HTMLInputElement | null;
  if (hostnameEl) hostnameEl.value = host;
  if (orgEl) orgEl.value = cfg.org || "";
  if (tenantEl) tenantEl.value = cfg.tenant || "";
  if (folderEl) folderEl.value = cfg.folder || "";
  if (tokenEl) tokenEl.value = cfg.token || "";
  showEditor();
}

function clearEditor() {
  for (const id of ["hostname", "org", "folder", "token"] as const) {
    const el = document.getElementById(id) as HTMLInputElement | null;
    if (el) el.value = "";
  }
  const tenantEl = document.getElementById("tenant") as HTMLInputElement | null;
  if (tenantEl) tenantEl.value = "DefaultTenant";
}

function showEditor() {
  const isEdit = !!editingHost;
  const deleteBtn = document.getElementById("delete");
  if (deleteBtn) deleteBtn.style.display = isEdit ? "inline-block" : "none";
  if (siteList) siteList.style.display = "none";
  editor?.classList.remove("hidden");
}

function showList() {
  if (statusEl) {
    statusEl.textContent = "";
    statusEl.className = "";
  }
  editingHost = null;
  editor?.classList.add("hidden");
  if (siteList) siteList.style.display = "block";
  renderList();
}

function saveCurrent() {
  const hostEl = document.getElementById("hostname") as HTMLInputElement | null;
  if (!hostEl) return;
  const host = hostEl.value.trim();
  if (!host) {
    showStatus("Hostname is required", "error");
    return;
  }

  const orgEl = document.getElementById("org") as HTMLInputElement | null;
  const tenantEl = document.getElementById("tenant") as HTMLInputElement | null;
  const folderEl = document.getElementById("folder") as HTMLInputElement | null;
  const tokenEl = document.getElementById("token") as HTMLInputElement | null;

  const org = orgEl?.value.trim() ?? "";
  const tenant = tenantEl?.value.trim() ?? "";
  const folder = folderEl?.value.trim() ?? "";
  const token = tokenEl?.value.trim() ?? "";

  if (!org || !tenant || !folder || !token) {
    showStatus("All fields are required", "error");
    return;
  }

  allConfigs[host] = { org, tenant, folder, token };

  if (editingHost && editingHost !== host) {
    delete allConfigs[editingHost];
  }

  editingHost = host;
  saveConfigs();
  showStatus("Saved", "success");
}

async function testConnection() {
  const orgEl = document.getElementById("org") as HTMLInputElement | null;
  const tenantEl = document.getElementById("tenant") as HTMLInputElement | null;
  const folderEl = document.getElementById("folder") as HTMLInputElement | null;
  const tokenEl = document.getElementById("token") as HTMLInputElement | null;
  const hostnameEl = document.getElementById(
    "hostname",
  ) as HTMLInputElement | null;

  const org = orgEl?.value.trim() ?? "";
  const tenant = tenantEl?.value.trim() ?? "";
  const folder = folderEl?.value.trim() ?? "";
  const token = tokenEl?.value.trim() ?? "";
  const hostname = hostnameEl?.value.trim() ?? "";

  if (!hostname || !org || !tenant || !folder || !token) {
    showStatus("Fill in all fields first", "error");
    return;
  }

  showStatus("Testing connection...", "info");

  chrome.runtime.sendMessage(
    {
      type: "UIPATH_REQUEST",
      hostname,
      endpoint: "/odata/Jobs",
      params: { $top: "1" },
    },
    (response: unknown) => {
      const resp = response as { error?: string } | undefined;
      if (resp?.error) {
        showStatus(`Connection failed: ${resp.error}`, "error");
      } else {
        showStatus("Connection successful!", "success");
      }
    },
  );
}

function showStatus(msg: string, type: "success" | "error" | "info") {
  if (statusEl) {
    statusEl.textContent = msg;
    statusEl.className = `${type} show`;
  }
  setTimeout(() => {
    if (statusEl) {
      statusEl.textContent = "";
      statusEl.className = "";
    }
  }, 5000);
}
