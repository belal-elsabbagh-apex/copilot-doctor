interface SiteConfig {
  org: string;
  tenant: string;
  folder: string;
  token: string;
}

type SiteConfigs = Record<string, SiteConfig>;

interface StorageResult {
  siteConfigs?: SiteConfigs;
}

interface UiPathJob {
  Key?: string;
  Id?: string;
  State: string;
  CreationTime?: string;
  OutputArguments?: string;
  InputArguments?: string;
}

interface UiPathRequestBody {
  type: "UIPATH_REQUEST";
  endpoint: string;
  params?: Record<string, string>;
}

interface JobMatch {
  job: UiPathJob;
  output: Record<string, unknown> | null;
  videoUrl: string | null;
  jobUrl?: string;
}

interface ScanResult {
  selectedOrderId: string | null;
  matches: JobMatch[];
  jobCount: number;
  scanError: string | null;
  cachedHost?: string;
}

interface SavedJob {
  id: string;
  scannedAt: number;
  hostname: string;
  selectedOrderId: string | null;
  matches: JobMatch[];
  jobCount: number;
  scanError?: string | null;
}
