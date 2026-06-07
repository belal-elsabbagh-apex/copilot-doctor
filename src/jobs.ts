export {};

let savedJobs: SavedJob[] = [];

const listEl = document.getElementById("list");
const searchEl = document.getElementById("search") as HTMLInputElement | null;
const stateEl = document.getElementById("state-filter") as HTMLSelectElement | null;

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
  if (!j.matches && ("matchedJob" in j)) {
    const old = j as SavedJob & {
      matchedJob?: UiPathJob | null;
      matchedOutput?: Record<string, unknown> | null;
      videoUrl?: string | null;
    };
    j.matches = [];
    if (old.matchedJob) {
      j.matches.push({
        job: old.matchedJob,
        output: old.matchedOutput ?? null,
        videoUrl: old.videoUrl ?? null,
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
        j.selectedOrderId?.toLowerCase().includes(search) ||
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
  filtered.forEach((saved) => {
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
        saved.matches.forEach((m, i) => {
          const dot = document.createElement("span");
          dot.className = `match-dot${i === detailIndex ? " active" : ""}`;
          dot.style.background = getStateColor(m.job.State);
          dot.addEventListener("click", (e) => {
            e.stopPropagation();
            detailIndex = i;
            renderMatchDetail(details, m);
            nav.querySelectorAll(".match-dot").forEach((d, j) => {
              d.className = `match-dot${j === i ? " active" : ""}`;
            });
          });
          nav.appendChild(dot);
        });
        details.appendChild(nav);
      }

      renderMatchDetail(details, saved.matches[detailIndex]);
      card.appendChild(details);
    });

    listEl.appendChild(card);
  });
}

function renderMatchDetail(container: HTMLElement, match: JobMatch) {
  const existingDetail = container.querySelector(".output-fields");
  if (existingDetail) existingDetail.remove();
  const existingVideo = container.querySelector("video");
  if (existingVideo) existingVideo.remove();

  if (match.videoUrl) {
    const video = document.createElement("video");
    video.src = match.videoUrl;
    video.controls = true;
    video.className = "video-player";
    video.preload = "metadata";
    container.appendChild(video);
  }

  if (match.output) {
    const outputFields = document.createElement("div");
    outputFields.className = "output-fields";
    outputFields.innerHTML = sortOutputEntries(Object.entries(match.output))
      .filter(([k]) => k.startsWith("out_"))
      .map(
        ([k, v]) =>
          `<div class="output-row"><span class="output-key">${k}</span><span class="output-value">${formatOutputValue(v)}</span></div>`,
      )
      .join("");
    container.appendChild(outputFields);
  }
}

function sortOutputEntries(
  entries: [string, unknown][],
): [string, unknown][] {
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

function highlightJson(obj: unknown): string {
  const json = JSON.stringify(obj, null, 2);
  return json.replace(
    /("(?:\\.|[^"\\])*")\s*:/g,
    '<span class="hl-key">$1</span>:',
  ).replace(
    /:\s*"((?:\\.|[^"\\])*)"/g,
    ':<span class="hl-str">$1</span>',
  ).replace(
    /:\s*(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g,
    ':<span class="hl-num">$1</span>',
  ).replace(
    /:\s*(true|false|null)\b/g,
    ':<span class="hl-bool">$1</span>',
  );
}

function formatOutputValue(v: unknown): string {
  const parsed = deepParse(v);
  if (parsed === null) return `<span class="hl-bool">null</span>`;
  if (typeof parsed === "boolean") return `<span class="hl-bool">${parsed}</span>`;
  if (typeof parsed === "number") return `<span class="hl-num">${parsed}</span>`;
  if (typeof parsed === "string") return `<span class="hl-str">${escHtml(parsed)}</span>`;
  const raw = JSON.stringify(parsed, null, 2);
  return `<div class="output-value-wrap"><pre class="json-pretty">${highlightJson(parsed)}</pre><button class="copy-btn" data-copy="${escHtml(raw)}" title="Copy">📋</button></div>`;
}

function getStateColor(state: string): string {
  return (
    { Successful: "#4CAF50", Faulted: "#F44336", Stopped: "#FF9800" }[state] ||
    "#757575"
  );
}

function escHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c,
  );
}

document.addEventListener("click", (e) => {
  const btn = (e.target as HTMLElement).closest("[data-copy]") as HTMLElement | null;
  if (!btn) return;
  navigator.clipboard.writeText(btn.dataset.copy ?? "").then(() => {
    const orig = btn.textContent;
    btn.textContent = "✓";
    setTimeout(() => { btn.textContent = orig; }, 1200);
  });
});
