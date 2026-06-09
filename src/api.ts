import type { SiteConfig } from "./config";
import { outputMatchesOrder } from "./outputSchema";

export interface UiPathJob {
  Key?: string;
  Id?: string;
  State: string;
  CreationTime?: string;
  OutputArguments?: string;
  InputArguments?: string;
}

export interface UiPathRequestBody {
  type: "UIPATH_REQUEST";
  endpoint: string;
  params?: Record<string, string>;
}

export interface JobMatch {
  job: UiPathJob;
  output: Record<string, unknown>;
  videoUrl: string;
  jobUrl: string;
}

export function sendUiPathRequest(
  hostname: string,
  endpoint: string,
  params: Record<string, string>,
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

export async function fetchJobDetailsById(
  hostname: string,
  jobId: string,
): Promise<UiPathJob | null> {
  if (!jobId) return null;
  try {
    const data = await sendUiPathRequest(hostname, `/odata/Jobs(${jobId})`, {
      $select: "Id,Key,State,CreationTime,OutputArguments,InputArguments",
    });
    return data as UiPathJob;
  } catch {
    return null;
  }
}

export async function fetchJobVideoUrl(
  hostname: string,
  jobKey: string,
): Promise<string> {
  if (!jobKey) return "";
  try {
    const data = await sendUiPathRequest(
      hostname,
      `/api/VideoRecording/jobs/${jobKey}/read`,
      {},
    );
    if (Array.isArray(data)) {
      for (const entry of data) {
        if (
          entry?.uri &&
          typeof entry.uri === "string" &&
          entry.uri.includes("recording.webm")
        ) {
          return entry.uri;
        }
      }
    }
    return "";
  } catch {
    return "";
  }
}

export interface JobLog {
  Level: string;
  Message: string;
  TimeStamp: string;
}

// Robot execution logs for a single job, oldest first. Logs live in the OData
// `RobotLogs` collection keyed by the job's GUID `Key` (not its numeric Id).
export async function fetchJobLogs(
  hostname: string,
  jobKey: string,
): Promise<JobLog[]> {
  if (!jobKey) return [];
  try {
    const data = await sendUiPathRequest(hostname, "/odata/RobotLogs", {
      $filter: `JobKey eq ${jobKey}`,
      $orderby: "TimeStamp asc",
      $top: "200",
      $select: "Level,Message,TimeStamp",
    });
    return data && typeof data === "object" && "value" in data
      ? (data as { value: JobLog[] }).value || []
      : [];
  } catch {
    return [];
  }
}

export function fetchJobUrl(config: SiteConfig, jobKey: string): string {
  return `https://cloud.uipath.com/${config.org}/${config.tenant}/orchestrator_/jobs(sidepanel:sidepanel/jobs/${jobKey}/details)`;
}

// Returns all jobs whose OutputArguments contains `orderId`, newest first
// (capped at `top`). The Jobs collection endpoint nulls OutputArguments, so the
// substring match is done server-side via OData `contains`; per-job
// OutputArguments is loaded on demand via fetchJobMatch/confirmJobsForOrder.
// When `since` is given, the query is additionally bounded to jobs created after
// it (the card's lookback date) to narrow the candidate set.
export async function searchJobsByOrderId(
  hostname: string,
  orderId: string,
  since?: Date,
  top = 50,
): Promise<UiPathJob[]> {
  const needle = orderId.trim();
  if (!needle) return [];
  const escaped = needle.replace(/'/g, "''"); // OData single-quote escaping

  let filter = `contains(OutputArguments, '${escaped}')`;
  if (since) {
    filter = `CreationTime gt ${since.toISOString()} and ${filter}`;
  }

  const data = await sendUiPathRequest(hostname, "/odata/Jobs", {
    $filter: filter,
    $orderby: "CreationTime desc",
    $top: String(top),
    $select: "Id,Key,State,CreationTime",
  });
  return data && typeof data === "object" && "value" in data
    ? (data as { value: UiPathJob[] }).value || []
    : [];
}

// Narrows `searchJobsByOrderId` candidates to the jobs whose output truly
// belongs to `orderId`. The OData `contains` filter is a substring test on the
// raw OutputArguments, so it can match jobs where the UID appears incidentally;
// this loads each candidate's OutputArguments (batched, 10 at a time) and keeps
// only those whose normalized output resolves to `orderId`. Returned jobs carry
// their OutputArguments, so the order matches the schema-agnostic match logic
// used by the content-script scan.
export async function confirmJobsForOrder(
  hostname: string,
  jobs: UiPathJob[],
  orderId: string,
): Promise<UiPathJob[]> {
  const confirmed: UiPathJob[] = [];
  for (let i = 0; i < jobs.length; i += 10) {
    const batch = jobs.slice(i, i + 10);
    const details = await Promise.allSettled(
      batch.map((job) =>
        fetchJobDetailsById(hostname, job.Id ?? "").catch(() => null),
      ),
    );
    for (const result of details) {
      const full = result.status === "fulfilled" ? result.value : null;
      if (!full?.OutputArguments) continue;
      try {
        if (outputMatchesOrder(JSON.parse(full.OutputArguments), orderId)) {
          confirmed.push(full);
        }
      } catch {
        // Unparseable OutputArguments — not a confirmable match.
      }
    }
  }
  return confirmed;
}

// Loads a single job's full details (OutputArguments, video, deep link) — the
// single-job endpoint returns OutputArguments where the collection omits it.
// If `job` already carries OutputArguments (e.g. it came from
// confirmJobsForOrder), the redundant details fetch is skipped.
export async function fetchJobMatch(
  hostname: string,
  config: SiteConfig,
  job: UiPathJob,
): Promise<JobMatch> {
  const full = job.OutputArguments
    ? job
    : ((await fetchJobDetailsById(hostname, job.Id ?? "")) ?? job);
  let output: Record<string, unknown> = {};
  if (full.OutputArguments) {
    try {
      output = JSON.parse(full.OutputArguments);
    } catch {
      output = {};
    }
  }
  const videoUrl = await fetchJobVideoUrl(hostname, full.Key || "");
  const jobUrl = fetchJobUrl(config, full.Key || full.Id || "");
  return { job: full, output, videoUrl, jobUrl };
}
