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
