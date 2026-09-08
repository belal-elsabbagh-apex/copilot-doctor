import { describe, expect, test } from "bun:test";
import {
  scanProgressFraction,
  scanProgressLabel,
  type ScanProgress,
} from "./progress";

function progress(overrides: Partial<ScanProgress>): ScanProgress {
  return {
    phase: "queue",
    done: 0,
    total: 0,
    orderIndex: 1,
    orderTotal: 1,
    ...overrides,
  };
}

describe("scanProgressFraction", () => {
  test("weighs hydrate progress within the current order's share of the scan", () => {
    const p = progress({
      phase: "hydrate",
      done: 2,
      total: 4,
      orderIndex: 2,
      orderTotal: 2,
    });
    expect(scanProgressFraction(p)).toBeCloseTo(0.85);
  });

  test("queue phase with no progress is 0; done is always 1", () => {
    expect(scanProgressFraction(progress({ phase: "queue" }))).toBe(0);
    expect(scanProgressFraction(progress({ phase: "done" }))).toBe(1);
  });

  test("is monotonically non-decreasing across a full scan", () => {
    const sequence: ScanProgress[] = [
      progress({ phase: "queue" }),
      progress({ phase: "search" }),
      progress({ phase: "confirm", done: 0, total: 3 }),
      progress({ phase: "confirm", done: 3, total: 3 }),
      progress({ phase: "hydrate", done: 0, total: 2 }),
      progress({ phase: "hydrate", done: 1, total: 2 }),
      progress({ phase: "hydrate", done: 2, total: 2 }),
      progress({ phase: "done" }),
    ];
    const fractions = sequence.map(scanProgressFraction);
    for (let i = 1; i < fractions.length; i++) {
      expect(fractions[i]).toBeGreaterThanOrEqual(fractions[i - 1]);
    }
    expect(fractions[fractions.length - 1]).toBe(1);
  });
});

describe("scanProgressLabel", () => {
  test("prefixes the order position when scanning more than one order", () => {
    const p = progress({
      phase: "hydrate",
      done: 2,
      total: 4,
      orderIndex: 2,
      orderTotal: 2,
    });
    expect(scanProgressLabel(p)).toBe("Order 2/2 · Loading job 3/4…");
  });

  test("omits the order prefix for a single-order scan", () => {
    const p = progress({ phase: "hydrate", done: 2, total: 4 });
    expect(scanProgressLabel(p)).toBe("Loading job 3/4…");
  });

  test("shows the candidate count while confirming", () => {
    const p = progress({ phase: "confirm", done: 10, total: 12 });
    expect(scanProgressLabel(p)).toBe("Confirming 10/12 candidates…");
  });
});
