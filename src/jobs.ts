import {
  getStateColor,
  renderJobDetails,
} from "./render";
import type { UiPathJob } from "./api";
import type { SavedJob } from "./cache";

let savedJobs: SavedJob[] = [];

const listEl = document.getElementById("list");
const searchEl = document.getElementById("search") as HTMLInputElement | null;
const stateEl = document.getElementById(
  "state-filter",
) as HTMLSelectElement | null;

document.getElementById("clear-btn")?.addEventListener("click", () => {
  if (confirm("Delete all saved job records?")) {
    chrome.storage.local.set({ savedJobs: [] }, loadJobs);
  }
});

searchEl?.addEventListener("input", renderJobs);
stateEl?.addEventListener("change", renderJobs);

document.addEventListener("DOMContentLoaded", loadJobs);

function loadJobs() {
  chrome.storage.local.get("savedJobs", (data) => {
    const raw = data as { savedJobs?: SavedJob[] };
    savedJobs = (raw.savedJobs ?? []).map(normalizeSavedJob);
    renderJobs();
  });
}

function normalizeSavedJob(j: SavedJob): SavedJob {
  if (!j.matches && "matchedJob" in j) {
    const old = j as SavedJob & {
      matchedJob?: UiPathJob;
      matchedOutput?: Record<string, unknown>;
      videoUrl?: string;
    };
    j.matches = [];
    if (old.matchedJob) {
      j.matches.push({
        job: old.matchedJob,
        output: old.matchedOutput ?? {},
        videoUrl: old.videoUrl ?? "",
        jobUrl: "",
      });
    }
  }
  return j;
}

function renderJobs() {
  if (!listEl) return;

  const search = (searchEl?.value || "").toLowerCase();
  const stateFilter = stateEl?.value || "";

  let filtered = savedJobs;
  if (search) {
    filtered = filtered.filter(
      (j) =>
        j.selectedOrderId.toLowerCase().includes(search) ||
        j.matches.some(
          (m) =>
            m.job.Key?.toLowerCase().includes(search) ||
            m.job.Id?.toLowerCase().includes(search),
        ),
    );
  }
  if (stateFilter) {
    filtered = filtered.filter((j) =>
      j.matches.some((m) => m.job.State === stateFilter),
    );
  }

  if (filtered.length === 0) {
    listEl.innerHTML = `<p class="empty">${
      savedJobs.length === 0
        ? "No saved jobs yet. Scan a page first."
        : "No matches for the current filters."
    }</p>`;
    return;
  }

  listEl.innerHTML = "";
  for (const saved of filtered) {
    const card = document.createElement("div");
    card.className = "job-card";

    const firstMatch = saved.matches[0];
    const stateColor = firstMatch
      ? getStateColor(firstMatch.job.State)
      : "#757575";
    const extraCount = saved.matches.length - 1;

    card.innerHTML = `
      <div class="job-card-header">
        <span class="job-state" style="background:${stateColor}">${firstMatch?.job.State || "—"}</span>
        <span class="job-order-id">${saved.selectedOrderId || "(no order)"}</span>
      </div>
      <div class="job-card-body">
        <span>${firstMatch?.job.Key || firstMatch?.job.Id || "—"}</span>
        <span>${new Date(saved.scannedAt).toLocaleString()}</span>
        <span>${saved.hostname}</span>
        ${firstMatch.jobUrl ? `<a href="${firstMatch.jobUrl}" target="_blank" class="job-link">Go to job ↗</a>` : ""}
      </div>
      ${extraCount > 0 ? `<div class="job-card-extra">+${extraCount} more match${extraCount > 1 ? "es" : ""}</div>` : ""}
    `;

    let expanded = false;
    let detailIndex = 0;
    card.addEventListener("click", () => {
      expanded = !expanded;
      const existing = card.querySelector(".job-expanded");
      if (existing) {
        existing.remove();
        return;
      }
      if (saved.matches.length === 0) return;

      const details = document.createElement("div");
      details.className = "job-expanded";

      if (saved.matches.length > 1) {
        const nav = document.createElement("div");
        nav.className = "match-nav";
        for (const [i, m] of saved.matches.entries()) {
          const dot = document.createElement("span");
          dot.className = `match-dot${i === detailIndex ? " active" : ""}`;
          dot.style.background = getStateColor(m.job.State);
          dot.addEventListener("click", (e) => {
            e.stopPropagation();
            detailIndex = i;
            renderJobDetails(details, m);
            const dots = nav.querySelectorAll(".match-dot");
            for (let j = 0; j < dots.length; j++) {
              dots[j].className = `match-dot${j === i ? " active" : ""}`;
            }
          });
          nav.appendChild(dot);
        }
        details.appendChild(nav);
      }

      renderJobDetails(details, saved.matches[detailIndex]);
      card.appendChild(details);
    });

    listEl.appendChild(card);
  }
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
