import type { UiPathRequestBody } from "./api";
import { badgeForScan } from "./badge";
import { type ScanResult, clearSessionScan, setSessionScan } from "./cache";
import { getConfig } from "./config";

// Clicking the toolbar icon opens the side panel (instead of a popup). Guarded
// for Chrome < 114 where chrome.sidePanel is unavailable.
chrome.sidePanel
  ?.setPanelBehavior({ openPanelOnActionClick: true })
  .catch((err) => console.debug("[Bg] sidePanel unavailable:", err));

function setupBgOnInstalledListener() {
  chrome.runtime.onInstalled.addListener((details) => {
    if (details.reason === "install") {
      chrome.storage.local.set({ siteConfigs: {} });
      chrome.tabs.create({ url: "options.html" });
    }
  });
}

function setupBgMessageListener() {
  chrome.runtime.onMessage.addListener(
    (
      message: unknown,
      sender: chrome.runtime.MessageSender,
      sendResponse: (response?: unknown) => void,
    ) => {
      const msg = message as UiPathRequestBody & { type: string };
      if (msg?.type === "UIPATH_REQUEST") {
        handleUiPathRequest(
          msg as UiPathRequestBody & { hostname: string },
          sendResponse,
        );
        return true;
      }
      if (msg?.type === "SCAN_RESULTS" && sender.tab?.id !== undefined) {
        handleScanResults(message as ScanResult, sender.tab.id);
      }
      return undefined;
    },
  );
}

// Content scripts broadcast SCAN_RESULTS; the worker caches them per-tab in
// session storage (for the side panel to hydrate from) and reflects status on
// the toolbar badge.
function handleScanResults(result: ScanResult, tabId: number) {
  setSessionScan(tabId, result);
  const { text, color } = badgeForScan(result);
  chrome.action.setBadgeText({ tabId, text });
  if (text) chrome.action.setBadgeBackgroundColor({ tabId, color });
}

// Drop a tab's cached scan when it closes, and clear its badge when it navigates
// away (a Copilot page re-sets it on the next scan).
function setupBgTabListeners() {
  chrome.tabs.onRemoved.addListener((tabId) => {
    clearSessionScan(tabId);
  });
  chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.url) {
      chrome.action.setBadgeText({ tabId, text: "" });
    }
  });
}

async function handleUiPathRequest(
  msg: UiPathRequestBody & { hostname: string },
  sendResponse: (response: unknown) => void,
) {
  try {
    const { hostname, endpoint, params } = msg;
    console.debug("[Bg] UiPath request:", { hostname, endpoint, params });

    const config = await getConfig(hostname);

    if (!config.org || !config.tenant || !config.folder || !config.token) {
      const err = `No config found for "${hostname}". Open options to add one.`;
      console.error("[Bg] Config missing:", {
        hostname,
        hasOrg: !!config?.org,
        hasTenant: !!config?.tenant,
        hasFolder: !!config?.folder,
        hasToken: !!config?.token,
      });
      sendResponse({ error: err });
      return;
    }

    const apiPath = endpoint.startsWith("/api/")
      ? endpoint
      : `orchestrator_${endpoint}`;
    const url = new URL(
      `https://cloud.uipath.com/${config.org}/${config.tenant}/${apiPath}`,
    );
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        url.searchParams.append(k, v);
      }
    }
    console.debug(
      "[Bg] Fetching:",
      url.toString().replace(config.token, "***"),
    );

    const response = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${config.token}`,
        Accept: "application/json",
        "X-UIPATH-FolderPath": config.folder || "",
      },
    });

    if (!response.ok) {
      const text = await response.text();
      console.error("[Bg] HTTP error:", response.status, text.slice(0, 500));
      sendResponse({
        error: `UiPath API error ${response.status}: ${text.slice(0, 500)}`,
      });
      return;
    }

    const data = await response.json();
    console.debug("[Bg] Success. Response keys:", Object.keys(data));
    sendResponse({ data });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[Bg] Unhandled error:", msg);
    sendResponse({ error: `Background error: ${msg}` });
  }
}

setupBgOnInstalledListener();
setupBgMessageListener();
setupBgTabListeners();
