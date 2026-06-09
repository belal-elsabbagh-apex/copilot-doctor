import type { JobMatch } from "./api";

export interface OrderScanData {
  matches: JobMatch[];
  jobCount: number;
  scanError: string;
}

export interface ScanResult {
  selectedOrderId: string;
  orders: Record<string, OrderScanData>;
  scanError: string;
}

export interface SavedJob {
  id: string;
  scannedAt: number;
  hostname: string;
  selectedOrderId: string;
  matches: JobMatch[];
  jobCount: number;
  scanError: string;
}

// Per-tab scan cache in chrome.storage.session — ephemeral (cleared when the
// browser session ends, never written to disk) and shared across the side panel
// and background. Written by the background worker on SCAN_RESULTS; read by the
// side panel to paint instantly when switching tabs. Keyed by tab id so tabs
// stay independent.
export function sessionScanKey(tabId: number): string {
  return `scan:${tabId}`;
}

export function setSessionScan(tabId: number, result: ScanResult): Promise<void> {
  return chrome.storage.session.set({ [sessionScanKey(tabId)]: result });
}

export async function getSessionScan(tabId: number): Promise<ScanResult | null> {
  const key = sessionScanKey(tabId);
  const data = await chrome.storage.session.get(key);
  return (data as Record<string, ScanResult | undefined>)[key] ?? null;
}

export function clearSessionScan(tabId: number): Promise<void> {
  return chrome.storage.session.remove(sessionScanKey(tabId));
}
