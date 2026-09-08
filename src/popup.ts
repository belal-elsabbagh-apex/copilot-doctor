import type { OrderScanData, ScanResult } from "./cache";
import { getSessionScan } from "./cache";
import {
  escHtml,
  formatTimeSince,
  getStateColor,
  renderJobDetails,
} from "./render";
import type { JobMatch } from "./api";
import type { SiteConfig } from "./config";
import { scanProgressFraction, scanProgressLabel, type ScanProgress } from "./progress";

const configStatus = document.getElementById("config-status");
const content = document.getElementById("content");
const pageInfo = document.getElementById("page-info");
const progressEl = document.getElementById("scan-progress");

let currentHost: string | null = null;
let currentTabId: number | null = null;
let viewedOrderId = "";
let selectedMatchIndex = 0;
let cachedOrders: Record<string, OrderScanData> = {};

document.getElementById("open-options")?.addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

document.getElementById("open-jobs")?.addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("jobs.html") });
});

function triggerScan() {
  if (currentTabId === null) {
    if (pageInfo) pageInfo.textContent = "No active tab ID found.";
    return;
  }
  chrome.tabs.sendMessage(currentTabId, { type: "SCAN_ORDERS" }, (response) => {
    if (chrome.runtime.lastError) {
      if (pageInfo)
        pageInfo.textContent =
          chrome.runtime.lastError.message || "Unknown error";
      return;
    }
    const resp = response as (ScanResult & { error?: string }) | undefined;
    if (resp?.error) {
      if (pageInfo) pageInfo.textContent = resp.error;
      return;
    }
    // Instant cached paint from the content script's in-memory cache.
    if (resp && Object.keys(resp.orders ?? {}).length > 0) {
      applyScanResult(resp);
    }
  });
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

// Resolves the active tab, paints its cached scan instantly, then re-scans.
// Re-run whenever the side panel's active tab changes so it follows the page.
async function loadActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0];
  currentTabId = tab?.id ?? null;
  currentHost = tab?.url ? new URL(tab.url).hostname : null;
  resetView();

  if (!currentHost || currentTabId === null) {
    if (configStatus) {
      configStatus.textContent = "No active tab";
      configStatus.className = "missing";
    }
    if (pageInfo) pageInfo.textContent = "No active tab.";
    return;
  }

  updateConfigStatus(currentHost);

  // Instant paint from the per-tab session cache; fresh data follows via the
  // SCAN_ORDERS reply and SCAN_RESULTS broadcasts.
  const cached = await getSessionScan(currentTabId);
  if (cached) applyScanResult(cached);

  triggerScan();
}

function updateConfigStatus(host: string) {
  chrome.storage.local.get("siteConfigs", (data) => {
    const cfg = (data as { siteConfigs?: Record<string, SiteConfig> })
      .siteConfigs?.[host];
    if (configStatus) {
      if (cfg) {
        configStatus.textContent = `${host} — Configured`;
        configStatus.className = "ok";
      } else {
        configStatus.textContent = `${host} — No config`;
        configStatus.className = "missing";
      }
    }
  });
}

// Clear rendered state so one tab's orders never bleed into another's.
function resetView() {
  viewedOrderId = "";
  selectedMatchIndex = 0;
  cachedOrders = {};
  lastSignature = "";
  if (progressEl) progressEl.hidden = true;
  const results = content?.querySelector(".scan-results");
  if (results) results.innerHTML = "";
  if (pageInfo) pageInfo.textContent = "Select an order card to auto-scan.";
}

let tabSwitchTimer: ReturnType<typeof setTimeout> | undefined;
function scheduleReload() {
  clearTimeout(tabSwitchTimer);
  tabSwitchTimer = setTimeout(() => loadActiveTab(), 150);
}

chrome.tabs.onActivated.addListener(scheduleReload);
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (tabId === currentTabId && (changeInfo.status === "complete" || changeInfo.url)) {
    scheduleReload();
  }
});

document.addEventListener("DOMContentLoaded", loadActiveTab);

let lastSignature = "";

function orderSignature(data: OrderScanData | undefined): string {
  if (!data) return "";
  const keys = data.matches.map((m) => m.job.Key || m.job.Id || "").join(",");
  return `${keys}|${data.pending.length}|${data.jobCount}|${data.scanError}`;
}

function applyScanResult(result: ScanResult) {
  if (result.scanError) {
    lastSignature = ""; // force the next successful result to always repaint
    renderError(result.scanError);
    return;
  }
  // Only reset the viewed order / match tab when the selection actually
  // changes, so a stale→fresh repaint of the same order keeps the user's tab.
  if (result.selectedOrderId !== viewedOrderId) {
    viewedOrderId = result.selectedOrderId;
    selectedMatchIndex = 0;
  }
  cachedOrders = result.orders;
  const signature = `${viewedOrderId}\u0000${orderSignature(result.orders[viewedOrderId])}`;
  if (signature === lastSignature) return;
  lastSignature = signature;
  renderAllOrders();
}

chrome.runtime.onMessage.addListener((message: unknown) => {
  const msg = message as { type: string; hostname?: string };
  // Ignore scan traffic from background Copilot tabs that aren't the one the
  // panel is currently following.
  if (msg?.hostname && msg.hostname !== currentHost) return;
  if (msg?.type === "SCAN_RESULTS") {
    applyScanResult(message as ScanResult);
  }
  if (msg?.type === "SCAN_STATUS") {
    showProgress(message as ScanProgress);
  }
});

function renderError(error: string) {
  if (!content) return;
  content.innerHTML = `<div class="error-box">Error: ${error}</div>`;
}

function renderAllOrders() {
  if (!content) return;

  const existingError = content.querySelector(".error-box");
  if (existingError) existingError.remove();

  let resultsContainer = content.querySelector(
    ".scan-results",
  ) as HTMLElement | null;
  if (!resultsContainer) {
    resultsContainer = document.createElement("div");
    resultsContainer.className = "scan-results";
    content.appendChild(resultsContainer);
  }
  // Detach (don't destroy) the currently-rendered match section before the
  // blanket wipe below, so a repaint triggered by an unrelated streamed
  // sibling can reuse it intact instead of resetting an in-progress video.
  const preservedSection = resultsContainer.querySelector(".job-section");
  preservedSection?.remove();
  resultsContainer.innerHTML = "";

  if (pageInfo) pageInfo.textContent = "";

  renderViewedOrder(resultsContainer, preservedSection as HTMLElement | null);
}

function renderViewedOrder(
  container: HTMLElement,
  preservedSection: HTMLElement | null = null,
) {
  if (!viewedOrderId) {
    const ids = Object.keys(cachedOrders);
    viewedOrderId = ids[0] || "";
  }
  const data = cachedOrders[viewedOrderId];
  if (!data) {
    container.innerHTML += `<p class="info-text">No data cached for order ${viewedOrderId}.</p>`;
    return;
  }

  const { matches, jobCount, scanError } = data;

  if (scanError) {
    const errEl = document.createElement("div");
    errEl.className = "error-box";
    errEl.textContent = `Error: ${scanError}`;
    container.appendChild(errEl);
  }

  const orderEl = document.createElement("div");
  orderEl.className = "order";
  orderEl.innerHTML = `<strong>Order</strong><br>${viewedOrderId}`;
  container.appendChild(orderEl);

  const countEl = document.createElement("p");
  countEl.className = "info-text";
  countEl.textContent = `Recent jobs checked: ${jobCount}`;
  container.appendChild(countEl);

  if (matches.length > 1) {
    const selector = document.createElement("div");
    selector.className = "match-selector";
    const tabs: HTMLButtonElement[] = [];
    matches.forEach((m, i) => {
      const tab = document.createElement("button");
      tab.className = `match-tab${i === selectedMatchIndex ? " active" : ""}`;
      const age = formatTimeSince(m.job.CreationTime);
      tab.innerHTML = `<span class="match-tab-dot" style="background:${getStateColor(m.job.State)}"></span> ${m.job.Key || m.job.Id || `#${i + 1}`}${age ? ` <span class="age" title="${m.job.CreationTime}">${age}</span>` : ""}`;
      tab.addEventListener("click", () => {
        selectedMatchIndex = i;
        for (const t of tabs) t.classList.remove("active");
        tab.classList.add("active");
        renderMatchDetail(m, container);
      });
      tabs.push(tab);
      selector.appendChild(tab);
    });
    container.appendChild(selector);
  }

  if (matches.length > 0) {
    const idx = Math.min(selectedMatchIndex, matches.length - 1);
    renderMatchDetail(matches[idx], container, preservedSection);
  }

  const pending = data.pending ?? [];
  if (pending.length > 0) {
    const section = document.createElement("div");
    section.className = "pending-section";
    section.innerHTML =
      `<p class="info-text">In queue — no job yet: ${pending.length}</p>` +
      pending
        .map((p) => {
          const age = formatTimeSince(p.creationTime);
          const retry = p.retryNumber > 0 ? ` · retry ${p.retryNumber}` : "";
          return `<div class="job-item pending-item"><span class="job-state" style="background:${getStateColor(p.status)}">${escHtml(p.status)}</span><span>Queued transaction${age ? ` · ${age}` : ""}${retry}</span></div>`;
        })
        .join("");
    container.appendChild(section);
  }

  if (matches.length === 0 && pending.length === 0) {
    container.innerHTML += `<p class="info-text">No UiPath job found matching this order ID.</p>`;
  }
}

function renderMatchDetail(
  match: JobMatch,
  container: HTMLElement,
  preservedSection: HTMLElement | null = null,
) {
  const jobKey = match.job.Key || match.job.Id || "";
  const existing = container.querySelector(".job-section");

  // A streamed sibling job triggers a full-pane repaint, which would
  // otherwise wipe and rebuild this section (destroying an in-progress video
  // scrub position) even when the viewed match itself hasn't changed.
  if (preservedSection && jobKey && preservedSection.getAttribute("data-job-key") === jobKey) {
    container.appendChild(preservedSection);
    return;
  }
  if (existing) existing.remove();
  const section = document.createElement("div");
  section.className = "job-section";
  if (jobKey) section.setAttribute("data-job-key", jobKey);

  const stateEl = document.createElement("div");
  stateEl.className = "job-item";
  stateEl.innerHTML = `
    <span class="job-state" style="background:${getStateColor(match.job.State)}">${match.job.State}</span>
    <span>Job · ${match.job.Key || match.job.Id}</span>
    ${match.jobUrl ? `<a href="${match.jobUrl}" target="_blank" class="job-link">Go to job ↗</a>` : ""}
  `;
  section.appendChild(stateEl);

  renderJobDetails(section, match, currentHost ?? "");
  container.appendChild(section);
}

function showProgress(p: ScanProgress) {
  if (!progressEl) return;
  if (p.phase === "done") {
    progressEl.hidden = true;
    return;
  }
  if (!progressEl.firstElementChild) {
    progressEl.innerHTML =
      `<div class="progress-label"></div>` +
      `<div class="progress-track"><div class="progress-fill"></div></div>`;
  }
  const label = progressEl.querySelector(".progress-label") as HTMLElement;
  const fill = progressEl.querySelector(".progress-fill") as HTMLElement;
  label.textContent = scanProgressLabel(p);
  fill.style.width = `${Math.round(scanProgressFraction(p) * 100)}%`;
  progressEl.hidden = false;
}

document.addEventListener("click", async (e) => {
  const btn = (e.target as HTMLElement).closest(
    "[data-copy]",
  ) as HTMLElement | null;
  if (!btn) return;
  await navigator.clipboard.writeText(btn.dataset.copy ?? "");
  const check =
    '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="#22c55e" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>';
  const orig = btn.innerHTML;
  btn.innerHTML = check;
  setTimeout(() => {
    btn.innerHTML = orig;
  }, 1200);
});
