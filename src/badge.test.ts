import { describe, expect, test } from "bun:test";
import type { JobMatch } from "./api";
import { BADGE_COLOR, badgeForScan } from "./badge";
import type { ScanResult } from "./cache";

function match(output: Record<string, unknown>): JobMatch {
  return { job: { State: "Successful" }, output, videoUrl: "", jobUrl: "" };
}

function scan(orderId: string, matches: JobMatch[]): ScanResult {
  return {
    selectedOrderId: orderId,
    orders: { [orderId]: { matches, jobCount: matches.length, scanError: "" } },
    scanError: "",
  };
}

describe("badgeForScan", () => {
  test("empty badge when the selected order has no matches", () => {
    expect(badgeForScan(scan("o1", []))).toEqual({ text: "", color: BADGE_COLOR });
  });

  test("shows the match count for the selected order", () => {
    const result = scan("o1", [match({ out_Result: "Success" }), match({})]);
    expect(badgeForScan(result)).toEqual({ text: "2", color: BADGE_COLOR });
  });

  test("counts matches regardless of their output (no failure indicator)", () => {
    const result = scan("o1", [match({ out_Result: "Failure" })]);
    expect(badgeForScan(result)).toEqual({ text: "1", color: BADGE_COLOR });
  });

  test("empty when the selected order isn't in the result set", () => {
    const result: ScanResult = {
      selectedOrderId: "missing",
      orders: {},
      scanError: "",
    };
    expect(badgeForScan(result)).toEqual({ text: "", color: BADGE_COLOR });
  });
});
