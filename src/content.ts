const hostname = location.hostname;

const VALID_HOSTS = new Set([
  "copilot.apexmedical.ai",
  "pre-prod-copilot.apexmedicalai.com",
]);

function getConfig(): Promise<SiteConfig | undefined> {
  return chrome.storage.local.get("siteConfigs").then((raw) =>
    raw && typeof raw === "object" && "siteConfigs" in raw
      ? (raw as StorageResult).siteConfigs?.[hostname]
      : undefined,
  );
}

function cacheOrderIds() {
  const cards = document.querySelectorAll<HTMLElement>(".order-card");
  const ids: string[] = [];
  for (let i = 0; i < cards.length && ids.length < 10; i++) {
    if (cards[i].id) ids.push(cards[i].id);
  }
  chrome.storage.local.set({ cachedOrderIds: { [hostname]: ids } });
}

function setupAutoScan() {
  let lastId: string | null = null;
  const observer = new MutationObserver(() => {
    cacheOrderIds();
    const selected = document.querySelector(
      ".order-card:has(.patient-card-selected)",
    );
    const id = selected?.id || null;
    if (id && id !== lastId) {
      ScanCache.clear();
      lastId = id;
      clearTimeout(scanTimer);
      scanTimer = setTimeout(() => {
        console.debug("[Copilot Doctor] auto-scan triggered for:", id);
        scanPage().catch((err) =>
          console.error("[Copilot Doctor] auto-scan failed:", err),
        );
      }, 400);
    }
  });
  observer.observe(document.body, {
    attributes: true,
    subtree: true,
    attributeFilter: ["class"],
  });
  if (document.querySelector(".order-card:has(.patient-card-selected)")) {
    scanPage().catch((err) =>
      console.error("[Copilot Doctor] initial scan failed:", err),
    );
  }
}

async function scanPage(orderId?: string) {
  console.debug("[Copilot Doctor] scanPage() started");

  chrome.runtime.sendMessage({ type: "SCAN_STATUS", phase: "scanning" });

  const config = await getConfig();
  console.debug("[Copilot Doctor] config found:", !!config);

  if (!config) {
    const err = `No config found for "${hostname}". Open Settings and add one.`;
    console.error("[Copilot Doctor]", err);
    chrome.runtime.sendMessage({ type: "SCAN_RESULTS", scanError: err });
    return { scanError: err };
  }

  const selectedCard = getSelectedCard();
  const selectedOrderId = orderId || selectedCard?.id || null;
  console.debug("[Copilot Doctor] selectedOrderId:", selectedOrderId);

  const cardDate = getSelectedCardDate(selectedCard);

  let jobs: UiPathJob[] = [];
  let fetchError: string | null = null;
  try {
    chrome.runtime.sendMessage({ type: "SCAN_STATUS", phase: "fetching" });
    jobs = await fetchJobsSince(config, cardDate, selectedOrderId);
    console.debug("[Copilot Doctor] jobs fetched:", jobs.length);
  } catch (err) {
    fetchError = String(err);
    console.error("[Copilot Doctor] fetchJobsSince threw:", err);
  }

  const matches: JobMatch[] = [];
  if (selectedOrderId && !fetchError && jobs.length > 0) {
    console.debug("[Copilot Doctor] searching for matching jobs...");
    for (let i = 0; i < jobs.length; i += 10) {
      const batch = jobs.slice(i, i + 10);
      const results = await Promise.allSettled(
        batch.map((job) => fetchJobDetailsById(job.Id).catch(() => null)),
      );
      for (const result of results) {
        const fullJob = result.status === "fulfilled" ? result.value : null;
        if (!fullJob?.OutputArguments) continue;
        try {
          const output = JSON.parse(fullJob.OutputArguments);
          if (output.out_OrderUid !== selectedOrderId) {
            console.debug(
              "[Copilot Doctor] match found:",
              fullJob.Key || fullJob.Id,
            );
            const videoUrl = await fetchJobVideoUrl(fullJob.Key || "");
            const jobUrl = fetchJobUrl(fullJob.Key || fullJob.Id || "", config);
            matches.push({ job: fullJob, output, videoUrl, jobUrl });
          }
        } catch (parseErr) {
          console.debug(
            "[Copilot Doctor] unparseable OutputArguments on job",
            fullJob.Key || fullJob.Id,
            parseErr,
          );
        }
      }
    }
  }
  console.debug("[Copilot Doctor] matches found:", matches.length);

  const result: ScanResult = {
    selectedOrderId,
    matches,
    jobCount: jobs.length,
    scanError: fetchError,
  };
  chrome.runtime.sendMessage({ type: "SCAN_RESULTS", ...result });
  ScanCache.set(result, hostname);
  persistScanResult(hostname, result);
  console.debug("[Copilot Doctor] SCAN_RESULTS sent");
  return result;
}

function getSelectedCard(): Element | null {
  return (
    document.querySelector(".order-card:has(.patient-card-selected)") || null
  );
}

function getSelectedCardDate(card: Element | null): Date {
  if (!card) return new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const el = card.querySelector(".date p");
  const text = (el?.textContent || "").trim();
  const parts = text.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (parts) {
    const d = new Date(+parts[3], +parts[1] - 1, +parts[2]);
    if (!Number.isNaN(d.getTime())) {
      d.setHours(0, 0, 0, 0);
      console.debug("[Copilot Doctor] card date:", d.toISOString());
      return d;
    }
  }
  console.debug(
    "[Copilot Doctor] no parseable date on card, defaulting to 30 days ago",
  );
  return new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
}

async function fetchJobsSince(
  _config: SiteConfig,
  since: Date,
  orderUid: string | null,
): Promise<UiPathJob[]> {
  const sinceStr = since.toISOString();
  let filter = `CreationTime gt ${sinceStr}`;
  if (orderUid) {
    filter += ` and contains(OutputArguments, '${orderUid}')`;
  }
  console.debug(
    "[Copilot Doctor] fetching jobs since:",
    sinceStr,
    "filter:",
    filter,
  );
  const data = await sendUiPathRequest("/odata/Jobs", {
    $filter: filter,
    $orderby: "CreationTime desc",
    $top: orderUid ? "10" : "200",
    $select: "Id,Key,State,CreationTime",
  });
  console.debug(
    "[Copilot Doctor] API response keys:",
    data ? Object.keys(data as object) : "null",
  );
  if (data && typeof data === "object" && "value" in data) {
    const jobs = (data as { value: UiPathJob[] }).value || [];
    console.debug("[Copilot Doctor] jobs returned:", jobs.length);
    return jobs;
  }
  console.warn(
    "[Copilot Doctor] API response missing 'value' key. Full response:",
    JSON.stringify(data).slice(0, 500),
  );
  return [];
}

async function fetchJobDetailsById(
  jobId: string | undefined,
): Promise<UiPathJob | null> {
  if (!jobId) return null;
  try {
    const data = await sendUiPathRequest(`/odata/Jobs(${jobId})`, {
      $select: "Id,Key,State,CreationTime,OutputArguments,InputArguments",
    });
    return data as UiPathJob;
  } catch (err) {
    console.debug(
      "[Copilot Doctor] fetchJobDetailsById failed for",
      jobId,
      err,
    );
    return null;
  }
}

async function fetchJobVideoUrl(jobKey: string): Promise<string | null> {
  if (!jobKey) return null;
  try {
    const data = await sendUiPathRequest(
      `/api/VideoRecording/jobs/${jobKey}/read`,
      undefined,
    );
    if (Array.isArray(data)) {
      for (const entry of data) {
        if (
          entry?.uri &&
          typeof entry.uri === "string" &&
          entry.uri.includes("recording.webm")
        ) {
          console.debug("[Copilot Doctor] video URL found");
          return entry.uri;
        }
      }
    }
    return null;
  } catch (err) {
    console.debug("[Copilot Doctor] no video for job", jobKey, err);
    return null;
  }
}
function fetchJobUrl(jobKey: string, cfg: SiteConfig): string {
  return `https://cloud.uipath.com/${cfg.org}/${cfg.tenant}/orchestrator_/jobs(sidepanel:sidepanel/jobs/${jobKey}/details)`;
}

function persistScanResult(
  host: string,
  scan: {
    selectedOrderId: string | null;
    matches: JobMatch[];
    jobCount: number;
    scanError: string | null;
  },
) {
  chrome.storage.local.get("savedJobs", (data) => {
    const raw = data as { savedJobs?: SavedJob[] };
    const saved: SavedJob[] = raw?.savedJobs ?? [];
    saved.unshift({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      scannedAt: Date.now(),
      hostname: host,
      selectedOrderId: scan.selectedOrderId,
      matches: scan.matches,
      jobCount: scan.jobCount,
      scanError: scan.scanError,
    });
    chrome.storage.local.set({ savedJobs: saved });
  });
}

function sendUiPathRequest(
  endpoint: string,
  params: Record<string, string> | undefined,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      { type: "UIPATH_REQUEST", hostname, endpoint, params },
      (response) => {
        const resp = response as { error?: string; data?: unknown } | undefined;
        if (resp?.error) {
          reject(new Error(resp.error));
        } else if (resp?.data !== undefined) {
          resolve(resp.data);
        } else {
          resolve(resp);
        }
      },
    );
  });
}

function setupContentMessageListener() {
  chrome.runtime.onMessage.addListener(
    (
      message: unknown,
      _sender: chrome.runtime.MessageSender,
      sendResponse: (response?: unknown) => void,
    ) => {
      const msg = message as { type: string; orderId?: string };
      console.debug("[Copilot Doctor] message received:", msg);
      if (msg?.type === "SCAN_ORDERS") {
        scanPage(msg.orderId).then(sendResponse);
        return true;
      }
      return undefined;
    },
  );
}

console.debug("[Copilot Doctor] content script loaded");
console.debug("[Copilot Doctor] hostname:", hostname);

if (!VALID_HOSTS.has(hostname)) {
  console.error(`[Copilot Doctor] unsupported host "${hostname}" — skipping`);
}

let scanTimer: ReturnType<typeof setTimeout> | undefined;

setupContentMessageListener();
setupAutoScan();
cacheOrderIds();
