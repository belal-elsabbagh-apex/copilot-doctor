import {
  confirmJobsForOrder,
  fetchJobDetailsByKey,
  fetchJobMatch,
  searchJobsByOrderId,
  searchQueueItemsByOrderId,
  type UiPathJob,
  type UiPathQueueItem,
  type JobMatch,
} from "./api";
import type { SiteConfig } from "./config";
import type { OrderScanData, PendingTransaction } from "./cache";
import type { PhaseProgress } from "./progress";

// Queue statuses worth surfacing as a jobless "queued" card: an order waiting for
// a robot ("New") or one caught mid-pickup before its ExecutorJobKey is stamped
// ("InProgress"). Terminal/superseded states (Retried, Deleted, Successful,
// Failed) either already have a job or are noise.
const PENDING_STATUSES = new Set(["New", "InProgress"]);

// Progress plus, during hydration, the matches confirmed so far — the panel
// renders these to stream job cards in as they resolve.
export type ScanUpdate = PhaseProgress & { partial?: OrderScanData };

export async function getJobByOrderId(
  hostname: string,
  orderId: string,
  since: Date,
  config: SiteConfig,
  onUpdate: (u: ScanUpdate) => void = () => {},
): Promise<OrderScanData> {
  // Queue search first, best-effort: an Orchestrator failure here must not fail
  // the scan. Queue-consumer jobs (typically faulted or still running) never
  // carry the order UID in their own arguments, so searchJobsByOrderId can't see
  // them — they're only reachable through the queue item the order flowed
  // through, whose ExecutorJobKey points back at the job that processed it.
  let queueItems: UiPathQueueItem[] = [];
  onUpdate({ phase: "queue", done: 0, total: 0 });
  try {
    queueItems = await searchQueueItemsByOrderId(hostname, orderId);
  } catch (err) {
    console.error("[Copilot Doctor] queue-item search failed for", orderId, err);
  }
  const byJobKey = queueItemsByJobKey(queueItems);
  const pending = pendingFromQueueItems(queueItems);
  console.debug(
    "[Copilot Doctor] queue-item executor jobs for",
    orderId,
    ":",
    byJobKey.size,
  );

  let candidates: UiPathJob[] = [];
  let fetchError = "";
  try {
    onUpdate({ phase: "search", done: 0, total: 0 });
    // `since` (the card's lookback date) narrows the server-side search.
    candidates = await searchJobsByOrderId(hostname, orderId, since);
    console.debug(
      "[Copilot Doctor] candidates for",
      orderId,
      ":",
      candidates.length,
    );
  } catch (err) {
    fetchError = String(err);
    console.error("[Copilot Doctor] searchJobsByOrderId threw for", orderId, err);
  }

  const matches: JobMatch[] = [];

  let confirmed: UiPathJob[] = [];
  if (!fetchError && candidates.length > 0) {
    onUpdate({ phase: "confirm", done: 0, total: candidates.length });
    // Confirm via normalized output (drops incidental substring hits).
    confirmed = await confirmJobsForOrder(
      hostname,
      candidates,
      orderId,
      (done, total) => onUpdate({ phase: "confirm", done, total }),
    );
    console.debug(
      "[Copilot Doctor] confirmed matches for",
      orderId,
      ":",
      confirmed.length,
    );
  }

  // Jobs reachable only through their queue item: a queue-consumer job never
  // carries the order UID in its own arguments, so searchJobsByOrderId can't
  // see it.
  const confirmedKeys = new Set(
    confirmed.map((job) => job.Key ?? "").filter(Boolean),
  );
  const queueOnlyKeys = [...byJobKey.keys()].filter(
    (key) => !confirmedKeys.has(key),
  );
  const jobCount = candidates.length + queueOnlyKeys.length;
  const hydrateTotal = confirmed.length + queueOnlyKeys.length;

  // The two hydration paths interleave, so every snapshot re-sorts newest-first.
  const snapshot = (): OrderScanData => ({
    matches: [...matches].sort((a, b) =>
      (b.job.CreationTime ?? "").localeCompare(a.job.CreationTime ?? ""),
    ),
    pending,
    jobCount,
    scanError: fetchError,
  });

  let hydrated = 0;
  const emitHydrated = () => {
    hydrated++;
    onUpdate({
      phase: "hydrate",
      done: hydrated,
      total: hydrateTotal,
      partial: snapshot(),
    });
  };

  if (hydrateTotal > 0) {
    onUpdate({ phase: "hydrate", done: 0, total: hydrateTotal });
  }

  for (const job of confirmed) {
    matches.push(
      await fetchJobMatch(hostname, config, job, byJobKey.get(job.Key ?? "")),
    );
    emitHydrated();
  }

  // fetchJobDetailsByKey and fetchJobMatch swallow their own failures, so no
  // try/catch here.
  for (const jobKey of queueOnlyKeys) {
    const job = await fetchJobDetailsByKey(hostname, jobKey);
    if (job) {
      matches.push(
        await fetchJobMatch(hostname, config, job, byJobKey.get(jobKey)),
      );
    }
    emitHydrated();
  }

  return snapshot();
}

// Queue items indexed by the job that executed them — the order↔job bridge.
// searchQueueItemsByOrderId returns newest-processed first, so the first
// occurrence wins when a job key appears on more than one transaction.
export function queueItemsByJobKey(
  items: UiPathQueueItem[],
): Map<string, UiPathQueueItem> {
  const map = new Map<string, UiPathQueueItem>();
  for (const item of items) {
    const key = item.ExecutorJobKey;
    if (typeof key !== "string" || key.length === 0) continue;
    if (!map.has(key)) map.set(key, item);
  }
  return map;
}

// Transactions with no executor job yet — surfaced as jobless "queued" cards.
export function pendingFromQueueItems(
  items: UiPathQueueItem[],
): PendingTransaction[] {
  return items
    .filter(
      (item) => !item.ExecutorJobKey && PENDING_STATUSES.has(item.Status ?? ""),
    )
    .map((item) => ({
      status: item.Status ?? "New",
      retryNumber: item.RetryNumber ?? 0,
      creationTime: item.CreationTime,
    }));
}
