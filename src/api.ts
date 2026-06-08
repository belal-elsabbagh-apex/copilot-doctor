export interface SiteConfig {
  org: string;
  tenant: string;
  folder: string;
  token: string;
}

export type SiteConfigs = Record<string, SiteConfig>;

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

export async function fetchJobsSince(
  hostname: string,
  since: Date,
  orderUid: string,
): Promise<UiPathJob[]> {
  const sinceStr = since.toISOString();
  let filter = `CreationTime gt ${sinceStr}`;
  if (orderUid) {
    filter += ` and contains(OutputArguments, '${orderUid}')`;
  }
  const data = await sendUiPathRequest(hostname, "/odata/Jobs", {
    $filter: filter,
    $orderby: "CreationTime desc",
    $top: orderUid ? "10" : "200",
    $select: "Id,Key,State,CreationTime",
  });
  if (data && typeof data === "object" && "value" in data) {
    return (data as { value: UiPathJob[] }).value || [];
  }
  return [];
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

export function fetchJobUrl(config: SiteConfig, jobKey: string): string {
  return `https://cloud.uipath.com/${config.org}/${config.tenant}/orchestrator_/jobs(sidepanel:sidepanel/jobs/${jobKey}/details)`;
}
