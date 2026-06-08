import type { JobMatch } from "./api";

export function sortOutputEntries(
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

export function deepParse(v: unknown): unknown {
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

export function highlightJson(obj: unknown): string {
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

export function escHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ] ?? c,
  );
}

export function getStateColor(state: string): string {
  return (
    { Successful: "#4CAF50", Faulted: "#F44336", Stopped: "#FF9800" }[state] ||
    "#757575"
  );
}

// Short relative age (e.g. "5m ago", "2h ago") for a UiPath ISO timestamp.
// Returns "" for missing/unparseable input so callers can skip rendering it.
export function formatTimeSince(iso: string | undefined): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const sec = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

export function formatOutputValue(v: unknown): string {
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

export function renderJobDetails(container: HTMLElement, match: JobMatch): void {
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

  if (Object.keys(match.output).length > 0) {
    const outputFields = document.createElement("div");
    outputFields.className = "output-fields";
    outputFields.innerHTML = sortOutputEntries(Object.entries(match.output))
      .filter(([k]) => k.startsWith("out_"))
      .map(
        ([k, v]) =>
          `<div class="output-row"><span class="output-key">${k}</span><div class="output-value">${formatOutputValue(v)}</div></div>`,
      )
      .join("");
    container.appendChild(outputFields);
  }
}
