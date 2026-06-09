// Toolbar badge state derived from a scan result: the number of matched jobs
// for the selected order (empty when none), so the count is visible without
// opening the side panel.

import type { ScanResult } from "./cache";

export const BADGE_COLOR = "#2563eb";

export interface BadgeState {
  text: string;
  color: string;
}

export function badgeForScan(result: ScanResult): BadgeState {
  const matches = result.orders[result.selectedOrderId]?.matches ?? [];
  return {
    text: matches.length > 0 ? String(matches.length) : "",
    color: BADGE_COLOR,
  };
}
