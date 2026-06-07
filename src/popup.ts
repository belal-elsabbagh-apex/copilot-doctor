export {};

const configStatus = document.getElementById("config-status");
const content = document.getElementById("content");
const pageInfo = document.getElementById("page-info");

let selectedMatchIndex = 0;

document.getElementById("open-options")?.addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

document.getElementById("open-jobs")?.addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("jobs.html") });
});

async function triggerScan(orderId?: string) {
  if (pageInfo) pageInfo.textContent = "Scanning...";
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0];
  if (!tab?.id) {
    if (pageInfo) pageInfo.textContent = "No active tab ID found.";
    return;
  }
  chrome.tabs.sendMessage(tab.id, { type: "SCAN_ORDERS", orderId }, (response) => {
    const resp = response as { error?: string } | undefined;
    if (chrome.runtime.lastError) {
      if (pageInfo)
        pageInfo.textContent = chrome.runtime.lastError.message || "Unknown error";
      return;
    }
    if (resp?.error && pageInfo) pageInfo.textContent = resp.error;
  });
}

document.getElementById("scan-page")?.addEventListener("click", () => triggerScan());

const manifest = chrome.runtime.getManifest();
const titleEl = document.querySelector("h1");
if (titleEl) {
  const ver = document.createElement("span");
  ver.className = "version";
  ver.textContent = `v${manifest.version}`;
  titleEl.appendChild(ver);
}

document.addEventListener("DOMContentLoaded", async () => {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0];
  const currentHost = tab?.url ? new URL(tab.url).hostname : null;

  if (!currentHost) {
    if (configStatus) {
      configStatus.textContent = "No active tab";
      configStatus.className = "missing";
    }
    if (pageInfo) pageInfo.textContent = "No active tab.";
    return;
  }

  chrome.storage.local.get("siteConfigs", (data) => {
    const raw = data as StorageResult;
    const cfg = raw.siteConfigs?.[currentHost];
    if (configStatus) {
      if (cfg) {
        configStatus.textContent = `${currentHost} — Configured`;
        configStatus.className = "ok";
      } else {
        configStatus.textContent = `${currentHost} — No config`;
        configStatus.className = "missing";
      }
    }
  });

  triggerScan();
});

chrome.runtime.onMessage.addListener((message: unknown) => {
  const msg = message as { type: string };
  console.debug("[Copilot Doctor popup] received message:", msg);
  if (msg?.type === "SCAN_RESULTS") {
    selectedMatchIndex = 0;
    renderResults(message as ScanResult);
  }
});

function renderResults(result: ScanResult) {
  if (!content) return;
  let resultsContainer = content.querySelector(".scan-results") as HTMLElement | null;
  if (!resultsContainer) {
    resultsContainer = document.createElement("div");
    resultsContainer.className = "scan-results";
    content.appendChild(resultsContainer);
  }
  resultsContainer.innerHTML = "";

  const { selectedOrderId, matches, jobCount, scanError } = result;

  if (scanError) {
    const errEl = document.createElement("div");
    errEl.className = "error-box";
    errEl.textContent = `Error: ${scanError}`;
    resultsContainer.appendChild(errEl);
  }

  if (!selectedOrderId) {
    resultsContainer.innerHTML += `<p class="info-text">No selected order card found on this page.</p>`;
    return;
  }

  const orderEl = document.createElement("div");
  orderEl.className = "order";
  orderEl.innerHTML = `<strong>Selected Order</strong><br>${selectedOrderId}`;
  resultsContainer.appendChild(orderEl);

  const countEl = document.createElement("p");
  countEl.className = "info-text";
  countEl.textContent = `Recent jobs checked: ${jobCount ?? 0}`;
  resultsContainer.appendChild(countEl);

  if (matches.length > 1) {
    const selector = document.createElement("div");
    selector.className = "match-selector";
    const tabs: HTMLButtonElement[] = [];
    matches.forEach((m, i) => {
      const tab = document.createElement("button");
      tab.className = `match-tab${i === selectedMatchIndex ? " active" : ""}`;
      tab.innerHTML = `<span class="match-tab-dot" style="background:${getStateColor(m.job.State)}"></span> ${m.job.Key || m.job.Id || `#${i + 1}`}`;
      tab.addEventListener("click", () => {
        selectedMatchIndex = i;
        tabs.forEach((t) => t.classList.remove("active"));
        tab.classList.add("active");
        renderMatchDetail(m, resultsContainer);
      });
      tabs.push(tab);
      selector.appendChild(tab);
    });
    resultsContainer.appendChild(selector);
  }

  if (matches.length > 0) {
    const idx = Math.min(selectedMatchIndex, matches.length - 1);
    renderMatchDetail(matches[idx], resultsContainer);
  } else {
    resultsContainer.innerHTML += `<p class="info-text">No UiPath job found matching this order ID.</p>`;
  }
}

function renderMatchDetail(match: JobMatch, container: HTMLElement) {
  const existing = container.querySelector(".job-section");
  if (existing) existing.remove();

  const { job: matchedJob, output: matchedOutput, videoUrl } = match;

  const section = document.createElement("div");
  section.className = "job-section";

  const stateEl = document.createElement("div");
  stateEl.className = "job-item";
  stateEl.innerHTML = `
    <span class="job-state" style="background:${getStateColor(matchedJob.State)}">${matchedJob.State}</span>
    <span>Job · ${matchedJob.Key || matchedJob.Id}</span>
  `;
  section.appendChild(stateEl);

  if (videoUrl) {
    const video = document.createElement("video");
    video.src = videoUrl;
    video.controls = true;
    video.className = "video-player";
    video.preload = "metadata";
    section.appendChild(video);
  }

  if (matchedOutput) {
    const outputFields = document.createElement("div");
    outputFields.className = "output-fields";
    outputFields.innerHTML = sortOutputEntries(Object.entries(matchedOutput))
      .filter(([k]) => k.startsWith("out_"))
      .map(
        ([k, v]) =>
          `<div class="output-row"><span class="output-key">${k}</span><span class="output-value">${formatOutputValue(v)}</span></div>`,
      )
      .join("");
    section.appendChild(outputFields);
  }

  container.appendChild(section);
}

function sortOutputEntries(entries: [string, unknown][]): [string, unknown][] {
  const order = [
    "out_OrderUid",
    "out_Result",
    "out_Account",
    "out_QueueItemReference",
    "out_AuthId",
  ];
  return [...entries].sort((a, b) => {
    const ia = order.indexOf(a[0]);
    const ib = order.indexOf(b[0]);
    if (ia !== -1 && ib !== -1) return ia - ib;
    if (ia !== -1) return -1;
    if (ib !== -1) return 1;
    return a[0].localeCompare(b[0]);
  });
}

function deepParse(v: unknown): unknown {
  if (typeof v === "string") {
    try { return deepParse(JSON.parse(v)); } catch { return v; }
  }
  if (Array.isArray(v)) return v.map(deepParse);
  if (v && typeof v === "object") {
    const o: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      o[k] = deepParse(val);
    }
    return o;
  }
  return v;
}

function renderJson(v: unknown, indent = 0): string {
  const pad = "  ".repeat(indent);
  if (v === null) return `<span class="hl-bool">null</span>`;
  if (typeof v === "boolean") return `<span class="hl-bool">${v}</span>`;
  if (typeof v === "number") return `<span class="hl-num">${v}</span>`;
  if (typeof v === "string") return `<span class="hl-str">${JSON.stringify(v)}</span>`;
  if (Array.isArray(v)) {
    if (v.length === 0) return `<span class="hl-punc">[ ]</span>`;
    const items = v.map(item =>
      `${pad}  <div class="hl-row">${renderJson(item, indent + 1)}</div>`
    ).join("\n");
    return `<span class="hl-punc">[</span>\n${items}\n${pad}<span class="hl-punc">]</span>`;
  }
  if (typeof v === "object") {
    const entries = Object.entries(v as Record<string, unknown>);
    if (entries.length === 0) return `<span class="hl-punc">{ }</span>`;
    const items = entries.map(([k, val]) =>
      `${pad}  <div class="hl-row"><span class="hl-key">${JSON.stringify(k)}</span><span class="hl-punc">: </span>${renderJson(val, indent + 1)}</div>`
    ).join("\n");
    return `<span class="hl-punc">{</span>\n${items}\n${pad}<span class="hl-punc">}</span>`;
  }
  return String(v);
}

function formatOutputValue(v: unknown): string {
  const parsed = deepParse(v);
  const html = renderJson(parsed);
  return `<div class="json-tree">${html}</div>`;
}

function getStateColor(state: string): string {
  return (
    { Successful: "#4CAF50", Faulted: "#F44336", Stopped: "#FF9800" }[state] ||
    "#757575"
  );
}
