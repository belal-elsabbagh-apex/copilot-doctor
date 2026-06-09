import { escHtml, getStateColor, renderJobDetails } from "./render";
import {
  confirmJobsForOrder,
  fetchJobMatch,
  fetchJobUrl,
  searchJobsByOrderId,
  type JobMatch,
  type UiPathJob,
} from "./api";
import type { SiteConfig, SiteConfigs } from "./config";

let configs: SiteConfigs = {};

const siteEl = document.getElementById("site") as HTMLSelectElement | null;
const searchEl = document.getElementById("search") as HTMLInputElement | null;
const searchBtn = document.getElementById("search-btn") as HTMLButtonElement | null;
const listEl = document.getElementById("list");

document.addEventListener("DOMContentLoaded", loadSites);
searchBtn?.addEventListener("click", runSearch);
searchEl?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") runSearch();
});

function loadSites() {
  chrome.storage.local.get("siteConfigs", (data) => {
    configs = (data as { siteConfigs?: SiteConfigs }).siteConfigs ?? {};
    const hosts = Object.keys(configs);
    if (siteEl) {
      siteEl.innerHTML = hosts.length
        ? hosts.map((h) => `<option value="${escHtml(h)}">${escHtml(h)}</option>`).join("")
        : `<option value="">No sites configured</option>`;
    }
    if (hosts.length === 0 && listEl) {
      listEl.innerHTML = `<p class="empty">No sites configured. Add one in the extension options.</p>`;
    }
  });
}

async function runSearch() {
  if (!listEl) return;

  const orderId = (searchEl?.value || "").trim();
  const host = siteEl?.value || "";
  const config = configs[host];

  if (!orderId) {
    listEl.innerHTML = `<p class="empty">Enter an order ID to search.</p>`;
    return;
  }
  if (!host || !config) {
    listEl.innerHTML = `<p class="empty">No configured site selected. Add one in the extension options.</p>`;
    return;
  }

  if (searchBtn) searchBtn.disabled = true;
  listEl.innerHTML = `<p class="status"><span class="spinner"></span> Searching…</p>`;

  try {
    const candidates = await searchJobsByOrderId(host, orderId);
    const jobs = await confirmJobsForOrder(host, candidates, orderId);
    if (jobs.length === 0) {
      listEl.innerHTML = `<p class="empty">No job found whose order is “${escHtml(orderId)}”.</p>`;
      return;
    }
    renderResults(host, config, jobs);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    listEl.innerHTML = `<div class="error-box">Error: ${escHtml(msg)}</div>`;
  } finally {
    if (searchBtn) searchBtn.disabled = false;
  }
}

function renderResults(host: string, config: SiteConfig, jobs: UiPathJob[]) {
  if (!listEl) return;
  listEl.innerHTML = "";
  const count = document.createElement("p");
  count.className = "result-count";
  count.textContent = `${jobs.length} matching job${jobs.length === 1 ? "" : "s"}`;
  listEl.appendChild(count);
  for (const job of jobs) {
    listEl.appendChild(buildCard(host, config, job));
  }
}

// A collapsible card. The header/body summary toggles it; the heavy details
// (OutputArguments + video) are fetched lazily on first expand and cached.
function buildCard(host: string, config: SiteConfig, job: UiPathJob): HTMLElement {
  const card = document.createElement("div");
  card.className = "job-card";

  const created = job.CreationTime
    ? new Date(job.CreationTime).toLocaleString()
    : "";
  const jobUrl =
    job.Key || job.Id ? fetchJobUrl(config, job.Key || job.Id || "") : "";
  card.innerHTML = `
    <div class="job-card-header">
      <span class="job-state" style="background:${getStateColor(job.State)}">${escHtml(job.State)}</span>
      <span class="job-order-id">${escHtml(job.Key || job.Id || "—")}</span>
      <span class="chevron">▸</span>
    </div>
    <div class="job-card-body">
      ${created ? `<span>${escHtml(created)}</span>` : ""}
      ${jobUrl ? `<a href="${escHtml(jobUrl)}" target="_blank" class="job-link">Go to job ↗</a>` : ""}
    </div>
  `;

  let match: JobMatch | null = null;
  let loading = false;

  card.addEventListener("click", async (e) => {
    const target = e.target as HTMLElement;
    // Don't toggle when interacting with the link or inside the expanded body.
    if (target.closest(".job-expanded") || target.closest(".job-link")) return;

    const existing = card.querySelector(".job-expanded");
    if (existing) {
      existing.remove();
      card.classList.remove("expanded");
      return;
    }
    if (loading) return;

    card.classList.add("expanded");
    const details = document.createElement("div");
    details.className = "job-expanded";
    card.appendChild(details);

    if (match) {
      renderJobDetails(details, match, host);
      return;
    }

    loading = true;
    details.innerHTML = `<p class="status"><span class="spinner"></span> Loading details…</p>`;
    try {
      match = await fetchJobMatch(host, config, job);
      details.innerHTML = "";
      renderJobDetails(details, match, host);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      details.innerHTML = `<div class="error-box">Error: ${escHtml(msg)}</div>`;
    } finally {
      loading = false;
    }
  });

  return card;
}

// Copy-to-clipboard for the output-value copy buttons rendered by renderJobDetails.
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
