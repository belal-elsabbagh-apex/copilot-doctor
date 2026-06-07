export {};

export async function setScanCache(result: ScanResult, hostname: string) {
  await chrome.storage.local.set({ latestScanResult: { ...result, cachedHost: hostname } });
}

export async function getScanCache(): Promise<(ScanResult & { cachedHost: string }) | null> {
  const data = await chrome.storage.local.get("latestScanResult");
  const cached = (data as { latestScanResult?: ScanResult & { cachedHost: string } }).latestScanResult;
  return cached?.cachedHost ? cached : null;
}

export async function clearScanCache() {
  await chrome.storage.local.remove("latestScanResult");
}
