export interface OAuthConfig {
  clientId: string;
  clientSecret: string;
  tokenUrl?: string;
  scope?: string;
}

export interface SiteConfig {
  org: string;
  tenant: string;
  folder: string;
  token: string;
  oauth?: OAuthConfig;
}

export type SiteConfigs = Record<string, SiteConfig>;

export const EMPTY_CONFIG: SiteConfig = {
  org: "",
  tenant: "",
  folder: "",
  token: "",
};

// A request needs either a PAT or a complete OAuth client-credentials pair —
// at least one, not necessarily both (OAuth is tried first, PAT is the
// runtime fallback; see uipathAuth.ts).
export function hasValidAuth(config: SiteConfig): boolean {
  return (
    !!config.token || !!(config.oauth?.clientId && config.oauth?.clientSecret)
  );
}

// Singleton cache of the saved site configs. Loaded from storage on first
// access and kept in sync via `storage.onChanged`, so options-page edits take
// effect without callers reloading. `getConfig` always resolves to a
// SiteConfig — EMPTY_CONFIG when the host has none — so callers never need to
// guard for "not loaded yet" or re-read storage themselves.
let configs: SiteConfigs | null = null;

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.siteConfigs) {
    configs = (changes.siteConfigs.newValue as SiteConfigs | undefined) ?? {};
  }
});

export async function getConfig(hostname: string): Promise<SiteConfig> {
  if (configs === null) {
    const raw = await chrome.storage.local.get("siteConfigs");
    configs =
      raw && typeof raw === "object" && "siteConfigs" in raw
        ? ((raw as { siteConfigs?: SiteConfigs }).siteConfigs ?? {})
        : {};
  }
  return configs[hostname] ?? EMPTY_CONFIG;
}
