import {
  fetchJobsSince,
  fetchJobDetailsById,
  fetchJobVideoUrl,
  fetchJobUrl,
  type SiteConfig,
  type UiPathJob,
  type JobMatch,
} from "./api";
import type { OrderScanData } from "./cache";

export async function getJobByOrderId(
  hostname: string,
  orderId: string,
  since: Date,
  config: SiteConfig,
): Promise<OrderScanData> {
  let jobs: UiPathJob[] = [];
  let fetchError = "";
  try {
    jobs = await fetchJobsSince(hostname, since, orderId);
    console.debug("[Copilot Doctor] jobs fetched for", orderId, ":", jobs.length);
  } catch (err) {
    fetchError = String(err);
    console.error("[Copilot Doctor] fetchJobsSince threw for", orderId, err);
  }

  const matches: JobMatch[] = [];
  if (!fetchError && jobs.length > 0) {
    console.debug("[Copilot Doctor] searching for matching jobs for", orderId);
    for (let i = 0; i < jobs.length; i += 10) {
      const batch = jobs.slice(i, i + 10);
      const results = await Promise.allSettled(
        batch.map((job) =>
          fetchJobDetailsById(hostname, job.Id ?? "").catch(() => null),
        ),
      );
      for (const result of results) {
        const fullJob = result.status === "fulfilled" ? result.value : null;
        if (!fullJob?.OutputArguments) continue;
        try {
          const output = JSON.parse(fullJob.OutputArguments);
          if (output.out_OrderUid === orderId) {
            console.debug(
              "[Copilot Doctor] match found:",
              fullJob.Key || fullJob.Id,
            );
            const videoUrl = await fetchJobVideoUrl(
              hostname,
              fullJob.Key || "",
            );
            const jobUrl = fetchJobUrl(
              config,
              fullJob.Key || fullJob.Id || "",
            );
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

  return {
    matches,
    jobCount: jobs.length,
    scanError: fetchError,
  };
}
