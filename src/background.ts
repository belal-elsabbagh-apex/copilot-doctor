import type { UiPathRequestBody } from "./api";
import { getConfig } from "./config";

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
      _sender: chrome.runtime.MessageSender,
      sendResponse: (response?: unknown) => void,
    ) => {
      const msg = message as UiPathRequestBody & { hostname: string };
      if (msg?.type === "UIPATH_REQUEST") {
        handleUiPathRequest(msg, sendResponse);
        return true;
      }
      return undefined;
    },
  );
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
