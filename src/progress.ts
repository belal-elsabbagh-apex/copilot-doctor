// Scan progress shared by the content script (producer) and side panel
// (consumer). Phases carry fixed weights so the bar only moves forward: the
// item counts for confirm/hydrate aren't known until the phase before them
// finishes.

export type ScanPhase = "queue" | "search" | "confirm" | "hydrate" | "done";

// Progress inside one order's fetch. `total` is 0 when the phase has no
// countable items.
export interface PhaseProgress {
  phase: ScanPhase;
  done: number;
  total: number;
}

// SCAN_STATUS payload: a PhaseProgress plus the order's place in the scan.
export interface ScanProgress extends PhaseProgress {
  orderIndex: number; // 1-based
  orderTotal: number;
}

const ORDER_UNITS = 10;

const PHASE_WEIGHT: Record<ScanPhase, number> = {
  queue: 1,
  search: 1,
  confirm: 2,
  hydrate: 6,
  done: 0,
};

const PHASE_START: Record<ScanPhase, number> = {
  queue: 0,
  search: 1,
  confirm: 2,
  hydrate: 4,
  done: ORDER_UNITS,
};

const PHASE_LABEL: Record<ScanPhase, (p: ScanProgress) => string> = {
  queue: () => "Checking queue…",
  search: () => "Searching jobs…",
  confirm: (p) =>
    p.total > 0
      ? `Confirming ${p.done}/${p.total} candidates…`
      : "Confirming candidates…",
  hydrate: (p) =>
    p.total > 0
      ? `Loading job ${Math.min(p.done + 1, p.total)}/${p.total}…`
      : "Loading jobs…",
  done: () => "Done",
};

// 0..1 across the whole scan (every order being fetched).
export function scanProgressFraction(p: ScanProgress): number {
  const orderTotal = Math.max(1, p.orderTotal);
  const index = Math.min(Math.max(p.orderIndex, 1), orderTotal);
  if (p.phase === "done") return 1;
  const within = p.total > 0 ? Math.min(p.done, p.total) / p.total : 0;
  const units = PHASE_START[p.phase] + PHASE_WEIGHT[p.phase] * within;
  return (index - 1 + units / ORDER_UNITS) / orderTotal;
}

export function scanProgressLabel(p: ScanProgress): string {
  const prefix =
    p.orderTotal > 1 ? `Order ${p.orderIndex}/${p.orderTotal} · ` : "";
  return prefix + PHASE_LABEL[p.phase](p);
}
