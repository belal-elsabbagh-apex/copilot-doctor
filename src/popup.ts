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

  chrome.storage.local.get(["siteConfigs", "cachedOrderIds"], (data) => {
    const raw = data as StorageResult & { cachedOrderIds?: Record<string, string[]> };
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
    const ids = raw.cachedOrderIds?.[currentHost];
    if (ids?.length) renderCachedOrders(ids);
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

function renderCachedOrders(ids: string[]) {
  if (!content) return;
  let el = content.querySelector(".cached-orders") as HTMLElement | null;
  if (!el) {
    el = document.createElement("div");
    el.className = "cached-orders";
    content.prepend(el);
  }
  el.innerHTML = `<strong>Orders on page</strong> ${ids.map((id) =>
    `<button class="order-chip" data-id="${id}">${id}</button>`
  ).join(" ")}`;
  el.querySelectorAll(".order-chip").forEach((btn) =>
    (btn as HTMLElement).addEventListener("click", () => {
      const id = (btn as HTMLElement).dataset.id;
      if (id) triggerScan(id);
    })
  );
}

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

  if (videoUrl) {
    const video = document.createElement("video");
    video.src = videoUrl;
    video.controls = true;
    video.className = "video-player";
    video.preload = "metadata";
    section.appendChild(video);
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

function formatOutputValue(v: unknown): string {
  if (typeof v !== "string") return String(v);
  try {
    const parsed = JSON.parse(v);
    return `<pre class="json-pretty">${JSON.stringify(parsed, null, 2)}</pre>`;
  } catch {
    return v;
  }
}

function getStateColor(state: string): string {
  return (
    { Successful: "#4CAF50", Faulted: "#F44336", Stopped: "#FF9800" }[state] ||
    "#757575"
  );
}
