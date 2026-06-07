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
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0];
  if (!tab?.id) {
    if (pageInfo) pageInfo.textContent = "No active tab ID found.";
    return;
  }
  chrome.tabs.sendMessage(
    tab.id,
    { type: "SCAN_ORDERS", orderId },
    (response) => {
      const resp = response as { error?: string } | undefined;
      if (chrome.runtime.lastError) {
        if (pageInfo)
          pageInfo.textContent =
            chrome.runtime.lastError.message || "Unknown error";
        return;
      }
      if (resp?.error && pageInfo) pageInfo.textContent = resp.error;
    },
  );
}

document.getElementById("scan-page")?.addEventListener("click", () => {
  triggerScan();
});

const manifest = chrome.runtime.getManifest();
const titleEl = document.querySelector("h1");
if (titleEl) {
  const icon = document.createElement("img");
  icon.src = "icons/icon16.png";
  icon.className = "title-icon";
  icon.alt = "";
  titleEl.prepend(icon);
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

  ScanCache.get().then((cached) => {
    if (cached && cached.cachedHost === currentHost && cached.selectedOrderId) {
      selectedMatchIndex = 0;
      renderResults(cached as ScanResult);
      return;
    }
    triggerScan();
  });
});

chrome.runtime.onMessage.addListener((message: unknown) => {
  const msg = message as { type: string };
  console.debug("[Copilot Doctor popup] received message:", msg);
  if (msg?.type === "SCAN_RESULTS") {
    selectedMatchIndex = 0;
    renderResults(message as ScanResult);
  }
  if (msg?.type === "SCAN_STATUS") {
    const status = msg as { type: string; phase: string };
    showStatusIndicator(status.phase);
  }
});

function renderResults(result: ScanResult) {
  if (!content) return;
  const existingStatus = content.querySelector(".scan-status");
  if (existingStatus) existingStatus.remove();

  let resultsContainer = content.querySelector(
    ".scan-results",
  ) as HTMLElement | null;
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

  if (pageInfo) pageInfo.textContent = "";
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
        for (const t of tabs) t.classList.remove("active");
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
    ${match.jobUrl ? `<a href="${match.jobUrl}" target="_blank" class="job-link">Go to job ↗</a>` : ""}
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
          `<div class="output-row"><span class="output-key">${k}</span><div class="output-value">${formatOutputValue(v)}</div></div>`,
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
    try {
      return deepParse(JSON.parse(v));
    } catch {
      return v;
    }
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

function highlightJson(obj: unknown): string {
  const json = JSON.stringify(obj, null, 2);
  return json
    .replace(/("(?:\\.|[^"\\])*")\s*:/g, '<span class="hl-key">$1</span>:')
    .replace(/:\s*"((?:\\.|[^"\\])*)"/g, ':<span class="hl-str">$1</span>')
    .replace(
      /:\s*(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g,
      ':<span class="hl-num">$1</span>',
    )
    .replace(/:\s*(true|false|null)\b/g, ':<span class="hl-bool">$1</span>');
}

function formatOutputValue(v: unknown): string {
  const parsed = deepParse(v);
  let content: string;
  if (parsed === null) content = `<span class="hl-bool">null</span>`;
  else if (typeof parsed === "boolean")
    content = `<span class="hl-bool">${parsed}</span>`;
  else if (typeof parsed === "number")
    content = `<span class="hl-num">${parsed}</span>`;
  else if (typeof parsed === "string")
    content = `<span class="hl-str">${escHtml(parsed)}</span>`;
  else content = `<pre class="json-pretty">${highlightJson(parsed)}</pre>`;
  const raw = JSON.stringify(parsed, null, 2);
  const icon =
    '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
  return `<div class="output-value-wrap">${content}<button class="copy-btn" data-copy="${escHtml(raw)}" title="Copy">${icon}</button></div>`;
}

function getStateColor(state: string): string {
  return (
    { Successful: "#4CAF50", Faulted: "#F44336", Stopped: "#FF9800" }[state] ||
    "#757575"
  );
}

function showStatusIndicator(phase: string) {
  if (!content) return;
  let el = content.querySelector(".scan-status") as HTMLElement | null;
  if (!el) {
    el = document.createElement("div");
    el.className = "scan-status";
    content.prepend(el);
  }
  const labels: Record<string, string> = {
    scanning: "Scanning order",
    fetching: "Fetching job data",
  };
  el.innerHTML = `<span class="spinner"></span> ${labels[phase] || phase}...`;
}

function escHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ] ?? c,
  );
}

document.addEventListener("click", (e) => {
  const btn = (e.target as HTMLElement).closest(
    "[data-copy]",
  ) as HTMLElement | null;
  if (!btn) return;
  navigator.clipboard.writeText(btn.dataset.copy ?? "").then(() => {
    const check =
      '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="#22c55e" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>';
    const orig = btn.innerHTML;
    btn.innerHTML = check;
    setTimeout(() => {
      btn.innerHTML = orig;
    }, 1200);
  });
});
