import {
  confirmJobsForOrder,
  fetchJobDetailsByKey,
  fetchJobMatch,
  searchJobsByOrderId,
  searchQueueItemsByOrderId,
  type UiPathJob,
  type JobMatch,
} from "./api";
import type { SiteConfig } from "./config";
import type { OrderScanData, PendingTransaction } from "./cache";

// Queue statuses worth surfacing as a jobless "queued" card: an order waiting for
// a robot ("New") or one caught mid-pickup before its ExecutorJobKey is stamped
// ("InProgress"). Terminal/superseded states (Retried, Deleted, Successful,
// Failed) either already have a job or are noise.
const PENDING_STATUSES = new Set(["New", "InProgress"]);

export async function getJobByOrderId(
  hostname: string,
  orderId: string,
  since: Date,
  config: SiteConfig,
): Promise<OrderScanData> {
  let candidates: UiPathJob[] = [];
  let fetchError = "";
  try {
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
  // Job Keys already matched, so the second path doesn't add a job twice (a
  // successful job can be found by both its output and its queue item).
  const seenKeys = new Set<string>();
  const addMatch = (match: JobMatch) => {
    matches.push(match);
    const key = match.job.Key || match.job.Id;
    if (key) seenKeys.add(key);
  };

  if (!fetchError && candidates.length > 0) {
    // Confirm via normalized output (drops incidental substring hits), then
    // hydrate each confirmed job into a full match (video + deep link).
    const confirmed = await confirmJobsForOrder(hostname, candidates, orderId);
    console.debug(
      "[Copilot Doctor] confirmed matches for",
      orderId,
      ":",
      confirmed.length,
    );
    for (const job of confirmed) {
      addMatch(await fetchJobMatch(hostname, config, job));
    }
  }

  // Second path: queue-consumer jobs (typically faulted or still running) never
  // carry the order UID in their own arguments, so searchJobsByOrderId can't see
  // them. Correlate through the queue item the order flowed through, whose
  // ExecutorJobKey points back at the job that processed it. Best-effort: a
  // failure here must not fail the whole scan or clobber the output-based
  // matches/error above.
  let queueJobsChecked = 0;
  let pending: PendingTransaction[] = [];
  try {
    const queueItems = await searchQueueItemsByOrderId(hostname, orderId);
    const jobKeys = [
      ...new Set(
        queueItems
          .map((item) => item.ExecutorJobKey)
          .filter((k): k is string => typeof k === "string" && k.length > 0),
      ),
    ];
    // Transactions with no executor job yet — surfaced as "queued" cards.
    pending = queueItems
      .filter(
        (item) => !item.ExecutorJobKey && PENDING_STATUSES.has(item.Status ?? ""),
      )
      .map((item) => ({
        status: item.Status ?? "New",
        retryNumber: item.RetryNumber ?? 0,
        creationTime: item.CreationTime,
      }));
    console.debug(
      "[Copilot Doctor] queue-item executor jobs for",
      orderId,
      ":",
      jobKeys.length,
    );
    for (const jobKey of jobKeys) {
      if (seenKeys.has(jobKey)) continue;
      queueJobsChecked++;
      const job = await fetchJobDetailsByKey(hostname, jobKey);
      if (job) addMatch(await fetchJobMatch(hostname, config, job));
    }
  } catch (err) {
    console.error(
      "[Copilot Doctor] queue-item correlation failed for",
      orderId,
      err,
    );
  }

  // Newest first — the two paths are interleaved, so re-sort the merged set.
  matches.sort((a, b) =>
    (b.job.CreationTime ?? "").localeCompare(a.job.CreationTime ?? ""),
  );

  return {
    matches,
    pending,
    jobCount: candidates.length + queueJobsChecked,
    scanError: fetchError,
  };
}
