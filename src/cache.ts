window.ScanCache = {
  set(result: ScanResult, hostname: string): Promise<void> {
    return chrome.storage.local.set({ latestScanResult: { ...result, cachedHost: hostname } });
  },

  get(): Promise<(ScanResult & { cachedHost: string }) | null> {
    return chrome.storage.local.get("latestScanResult").then((data) => {
      const cached = (data as { latestScanResult?: ScanResult & { cachedHost: string } }).latestScanResult;
      return cached?.cachedHost ? cached : null;
    });
  },

  clear(): Promise<void> {
    return chrome.storage.local.remove("latestScanResult");
  },
};
