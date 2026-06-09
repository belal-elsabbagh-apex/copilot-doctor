import {
  confirmJobsForOrder,
  fetchJobMatch,
  searchJobsByOrderId,
  type UiPathJob,
  type JobMatch,
} from "./api";
import type { SiteConfig } from "./config";
import type { OrderScanData } from "./cache";

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
      matches.push(await fetchJobMatch(hostname, config, job));
    }
  }

  return {
    matches,
    jobCount: candidates.length,
    scanError: fetchError,
  };
}
