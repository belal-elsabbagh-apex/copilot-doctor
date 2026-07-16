import type { OAuthConfig, SiteConfig } from "./config";

interface CachedToken {
  accessToken: string;
  expiresAt: number; // epoch ms
}

// In-memory only, keyed by hostname (each hostname's SiteConfig has its own
// oauth creds). Cleared wholesale on any siteConfigs change (see the listener
// below) so a rotated secret never hides behind a stale cached token.
const tokenCache = new Map<string, CachedToken>();

const SKEW_MS = 60_000;

export function deriveTokenUrl(org: string): string {
  return `https://cloud.uipath.com/${org}/identity_/connect/token`;
}

// Never throws — a network error, non-2xx, or missing access_token is treated
// as failure so the caller can fall back to the static bearer PAT.
async function fetchOAuthToken(
  org: string,
  oauth: OAuthConfig,
): Promise<{ accessToken: string; expiresIn: number } | null> {
  const tokenUrl = oauth.tokenUrl || deriveTokenUrl(org);
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: oauth.clientId,
    client_secret: oauth.clientSecret,
  });
  if (oauth.scope) body.set("scope", oauth.scope);

  try {
    const res = await fetch(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      access_token?: string;
      expires_in?: number;
    };
    if (!data.access_token) return null;
    return { accessToken: data.access_token, expiresIn: data.expires_in ?? 0 };
  } catch (err) {
    console.debug("[uipathAuth] OAuth token fetch failed:", err);
    return null;
  }
}

// Cache-or-fetch. Returns null (never throws) if oauth isn't usable right now.
async function getOAuthAccessToken(
  hostname: string,
  org: string,
  oauth: OAuthConfig,
): Promise<string | null> {
  const cached = tokenCache.get(hostname);
  if (cached && cached.expiresAt > Date.now()) return cached.accessToken;

  const fetched = await fetchOAuthToken(org, oauth);
  if (!fetched) return null;

  tokenCache.set(hostname, {
    accessToken: fetched.accessToken,
    expiresAt: Date.now() + fetched.expiresIn * 1000 - SKEW_MS,
  });
  return fetched.accessToken;
}

// Resolution order: (1) cached/fresh OAuth token if oauth configured and the
// fetch succeeds, (2) static bearer PAT if present, (3) throw.
export async function resolveAuthHeader(
  hostname: string,
  config: SiteConfig,
): Promise<string> {
  if (config.oauth?.clientId && config.oauth?.clientSecret) {
    const token = await getOAuthAccessToken(hostname, config.org, config.oauth);
    if (token) return `Bearer ${token}`;
  }
  if (config.token) return `Bearer ${config.token}`;
  throw new Error(
    `No valid auth configured for "${hostname}": add a PAT or OAuth Client ID/Secret in options.`,
  );
}

// Config edits (rotated secret, cleared oauth, new token) must not hide behind
// a stale cached access token. Mirrors config.ts's own listener on this same
// storage key — Chrome supports multiple independent listeners on one key.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.siteConfigs) {
    tokenCache.clear();
  }
});
