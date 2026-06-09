import { fetchJobLogs, type JobLog, type JobMatch } from "./api";
import {
  analyzeOutput,
  highlightFailureTerms,
  isFailureLog,
  type OutputComment,
} from "./outputAnalysis";

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

export function renderJobDetails(
  container: HTMLElement,
  match: JobMatch,
  hostname: string,
): void {
  const existingDetail = container.querySelector(".output-fields");
  if (existingDetail) existingDetail.remove();
  const existingVideo = container.querySelector("video");
  if (existingVideo) existingVideo.remove();
  const existingLogs = container.querySelector(".job-logs");
  if (existingLogs) existingLogs.remove();
  const existingComments = container.querySelector(".output-comments");
  if (existingComments) existingComments.remove();

  // Logs feed both the analysis (log-based rules) and the logs panel below, so
  // fetch them once here and share the promise.
  const jobKey = match.job.Key || "";
  const logsPromise: Promise<JobLog[]> = jobKey
    ? fetchJobLogs(hostname, jobKey)
    : Promise.resolve([]);

  // Comments depend on both output and logs, so analyze once when the logs
  // resolve. The box reserves its slot above the JSON in the meantime.
  const commentsBox = document.createElement("div");
  commentsBox.className = "output-comments";
  commentsBox.hidden = true;
  container.appendChild(commentsBox);
  logsPromise.then((logs) => {
    renderComments(commentsBox, analyzeOutput(match.output, logs));
  });

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
    // Render the entire OutputArguments object as one pretty JSON block
    // (deep-parsed so nested JSON-string fields are expanded).
    outputFields.innerHTML = formatOutputValue(match.output);
    container.appendChild(outputFields);
  }

  if (jobKey) renderLogsSection(container, logsPromise);
}

// Renders (or re-renders) the analysis comments into `box`, hiding it when there
// are none so it takes no vertical space.
function renderComments(box: HTMLElement, comments: OutputComment[]): void {
  box.innerHTML = comments
    .map(
      (c) =>
        `<div class="output-comment comment-${c.severity}">${escHtml(c.message)}</div>`,
    )
    .join("");
  box.hidden = comments.length === 0;
}

// Collapsible robot logs for a job. The data comes from the shared `logsPromise`
// (already in flight from renderJobDetails); the panel renders on first expand.
function renderLogsSection(
  container: HTMLElement,
  logsPromise: Promise<JobLog[]>,
): void {
  const wrap = document.createElement("div");
  wrap.className = "job-logs";

  const toggle = document.createElement("button");
  toggle.className = "logs-toggle";
  toggle.textContent = "View logs";

  const list = document.createElement("div");
  list.className = "logs-list";
  list.hidden = true;

  let rendered = false;

  toggle.addEventListener("click", async () => {
    if (!list.hidden) {
      list.hidden = true;
      toggle.textContent = "View logs";
      return;
    }
    list.hidden = false;
    toggle.textContent = "Hide logs";
    if (rendered) return;

    list.innerHTML = `<p class="status"><span class="spinner"></span> Loading logs…</p>`;
    const logs = await logsPromise;
    rendered = true;

    list.innerHTML = logs.length
      ? logs
          .map((l) => {
            const time = formatLogTime(l.TimeStamp);
            const level = l.Level || "";
            const msg = highlightFailureTerms(l.Message || "", escHtml);
            const flagged = isFailureLog(l) ? " log-flagged" : "";
            return `<div class="log-row log-${escHtml(level.toLowerCase())}${flagged}"><span class="log-time">${escHtml(time)}</span><span class="log-level">${escHtml(level)}</span><span class="log-msg">${msg}</span></div>`;
          })
          .join("")
      : `<p class="info-text">No logs for this job.</p>`;
  });

  wrap.appendChild(toggle);
  wrap.appendChild(list);
  container.appendChild(wrap);
}

// Compact local time for a log timestamp; "" for missing/unparseable input.
function formatLogTime(iso: string | undefined): string {
  if (!iso) return "";
  const t = new Date(iso);
  return Number.isNaN(t.getTime()) ? "" : t.toLocaleTimeString();
}
