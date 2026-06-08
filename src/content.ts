import type { OrderScanData, ScanResult, SavedJob } from "./cache";
import { getJobByOrderId } from "./jobMatcher";
import {
  getCardDate,
  getSelectedOrderId,
  getVisibleOrderIds,
} from "./orderParser";
import { getConfig } from "./config";

const hostname = location.hostname;

const VALID_HOSTS = new Set([
  "copilot.apexmedical.ai",
  "pre-prod-copilot.apexmedicalai.com",
]);

// Per-order, page-life cache. Results for every visible order are retained so
// re-selecting an order you've passed over is instant (stale-while-revalidate).
type CacheEntry = { data: OrderScanData; scannedAt: number };
const orderCache = new Map<string, CacheEntry>();
const MAX_CACHE_ENTRIES = 50;
const REVALIDATE_AFTER_MS = 15_000;
let scanToken = 0;

function setCacheEntry(orderId: string, data: OrderScanData) {
  orderCache.delete(orderId); // re-insert to keep Map order = LRU recency
  orderCache.set(orderId, { data, scannedAt: Date.now() });
  while (orderCache.size > MAX_CACHE_ENTRIES) {
    const oldest = orderCache.keys().next().value;
    if (oldest === undefined) break;
    orderCache.delete(oldest);
  }
}

function snapshotOrders(orderIds: string[]): Record<string, OrderScanData> {
  const orders: Record<string, OrderScanData> = {};
  for (const id of orderIds) {
    const entry = orderCache.get(id);
    if (entry) orders[id] = entry.data;
  }
  return orders;
}

function getCachedSnapshot(): ScanResult {
  return {
    selectedOrderId: getSelectedOrderId(),
    orders: snapshotOrders(getVisibleOrderIds()),
    scanError: "",
  };
}

function setupAutoScan() {
  let lastSelectedId = "";
  let cachedIds = "";
  const observer = new MutationObserver(() => {
    const currentIds = getVisibleOrderIds().join(",");
    const selectedId = getSelectedOrderId();
    if (selectedId && selectedId !== lastSelectedId) {
      lastSelectedId = selectedId;
      clearTimeout(scanTimer);
      scanTimer = setTimeout(() => {
        console.debug("[Copilot Doctor] auto-scan triggered for:", selectedId);
        scanAllOrders().catch((err) =>
          console.error("[Copilot Doctor] auto-scan failed:", err),
        );
      }, 400);
    } else if (currentIds !== cachedIds) {
      cachedIds = currentIds;
      clearTimeout(scanTimer);
      scanTimer = setTimeout(() => {
        console.debug(
          "[Copilot Doctor] auto-scan triggered (visible orders changed):",
          currentIds,
        );
        scanAllOrders().catch((err) =>
          console.error("[Copilot Doctor] auto-scan failed:", err),
        );
      }, 400);
    }
  });
  observer.observe(document.body, {
    attributes: true,
    subtree: true,
    attributeFilter: ["class"],
  });
  if (getSelectedOrderId()) {
    scanAllOrders().catch((err) =>
      console.error("[Copilot Doctor] initial scan failed:", err),
    );
  }
}

async function scanAllOrders(): Promise<ScanResult> {
  console.debug("[Copilot Doctor] scanAllOrders() started");
  const myToken = ++scanToken;

  const selectedOrderId = getSelectedOrderId();
  const orderIds = getVisibleOrderIds();

  if (orderIds.length === 0) {
    const empty: ScanResult = {
      selectedOrderId: "",
      orders: {},
      scanError: "No visible order cards found on this page.",
    };
    chrome.runtime.sendMessage({ type: "SCAN_RESULTS", ...empty });
    return empty;
  }

  // 1. Emit the cached (stale) snapshot immediately for an instant paint.
  const stale: ScanResult = {
    selectedOrderId,
    orders: snapshotOrders(orderIds),
    scanError: "",
  };
  if (Object.keys(stale.orders).length > 0) {
    chrome.runtime.sendMessage({ type: "SCAN_RESULTS", ...stale });
  }

  // 2. Revalidate visible orders that are uncached or past the freshness window.
  const now = Date.now();
  const toFetch = orderIds.filter((id) => {
    const entry = orderCache.get(id);
    return !entry || now - entry.scannedAt >= REVALIDATE_AFTER_MS;
  });

  if (toFetch.length === 0) {
    persistScanResult(hostname, stale);
    return stale;
  }

  chrome.runtime.sendMessage({ type: "SCAN_STATUS", phase: "fetching" });

  const config = await getConfig(hostname);
  for (const orderId of toFetch) {
    if (myToken !== scanToken) return stale; // superseded by a newer scan
    const data = await getJobByOrderId(
      hostname,
      orderId,
      getCardDate(orderId),
      config,
    );
    setCacheEntry(orderId, data);
  }
  if (myToken !== scanToken) return stale;

  // 3. Emit the fresh, reconciled snapshot.
  const fresh: ScanResult = {
    selectedOrderId,
    orders: snapshotOrders(orderIds),
    scanError: "",
  };
  chrome.runtime.sendMessage({ type: "SCAN_RESULTS", ...fresh });
  persistScanResult(hostname, fresh);
  console.debug("[Copilot Doctor] SCAN_RESULTS sent (fresh)");
  return fresh;
}

function persistScanResult(
  host: string,
  scan: ScanResult,
) {
  const selectedData = scan.orders[scan.selectedOrderId];
  if (!selectedData) return;
  chrome.storage.local.get("savedJobs", (data) => {
    const raw = data as { savedJobs?: SavedJob[] };
    const saved: SavedJob[] = raw?.savedJobs ?? [];
    saved.unshift({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      scannedAt: Date.now(),
      hostname: host,
      selectedOrderId: scan.selectedOrderId,
      matches: selectedData.matches,
      jobCount: selectedData.jobCount,
      scanError: selectedData.scanError,
    });
    chrome.storage.local.set({ savedJobs: saved });
  });
}

function setupContentMessageListener() {
  chrome.runtime.onMessage.addListener(
    (
      message: unknown,
      _sender: chrome.runtime.MessageSender,
      sendResponse: (response?: unknown) => void,
    ) => {
      const msg = message as { type: string };
      console.debug("[Copilot Doctor] message received:", msg);
      if (msg?.type === "SCAN_ORDERS") {
        sendResponse(getCachedSnapshot()); // instant cached paint
        scanAllOrders().catch((err) =>
          console.error("[Copilot Doctor] scan failed:", err),
        );
        return undefined;
      }
      return undefined;
    },
  );
}

console.debug("[Copilot Doctor] content script loaded");
console.debug("[Copilot Doctor] hostname:", hostname);

if (!VALID_HOSTS.has(hostname)) {
  console.error(`[Copilot Doctor] unsupported host "${hostname}" — skipping`);
}

let scanTimer = 0;

function init() {
  setupContentMessageListener();
  setupAutoScan();
}
init();
