import { describe, expect, test } from "bun:test";
import type { UiPathQueueItem } from "./api";
import { pendingFromQueueItems, queueItemsByJobKey } from "./jobMatcher";

describe("queueItemsByJobKey", () => {
  test("maps each non-empty ExecutorJobKey to its item", () => {
    const items: UiPathQueueItem[] = [
      { Key: "q1", ExecutorJobKey: "job-a" },
      { Key: "q2", ExecutorJobKey: "job-b" },
    ];
    const map = queueItemsByJobKey(items);
    expect(map.get("job-a")).toBe(items[0]);
    expect(map.get("job-b")).toBe(items[1]);
    expect(map.size).toBe(2);
  });

  test("keeps the first item when two share a job key", () => {
    const first: UiPathQueueItem = { Key: "q1", ExecutorJobKey: "job-a" };
    const second: UiPathQueueItem = { Key: "q2", ExecutorJobKey: "job-a" };
    const map = queueItemsByJobKey([first, second]);
    expect(map.get("job-a")).toBe(first);
    expect(map.size).toBe(1);
  });

  test("skips items whose ExecutorJobKey is null or empty", () => {
    const items: UiPathQueueItem[] = [
      { Key: "q1", ExecutorJobKey: null },
      { Key: "q2", ExecutorJobKey: "" },
      { Key: "q3" },
    ];
    expect(queueItemsByJobKey(items).size).toBe(0);
  });
});

describe("pendingFromQueueItems", () => {
  test("keeps New/InProgress items with no ExecutorJobKey, defaulting retryNumber to 0", () => {
    const items: UiPathQueueItem[] = [
      { Key: "q1", Status: "New", CreationTime: "2024-01-01T00:00:00Z" },
      { Key: "q2", Status: "InProgress" },
    ];
    const pending = pendingFromQueueItems(items);
    expect(pending).toEqual([
      { status: "New", retryNumber: 0, creationTime: "2024-01-01T00:00:00Z" },
      { status: "InProgress", retryNumber: 0, creationTime: undefined },
    ]);
  });

  test("drops Failed/Successful/Retried items", () => {
    const items: UiPathQueueItem[] = [
      { Key: "q1", Status: "Failed" },
      { Key: "q2", Status: "Successful" },
      { Key: "q3", Status: "Retried" },
    ];
    expect(pendingFromQueueItems(items)).toEqual([]);
  });

  test("drops any item that already has an ExecutorJobKey", () => {
    const items: UiPathQueueItem[] = [
      { Key: "q1", Status: "New", ExecutorJobKey: "job-a" },
    ];
    expect(pendingFromQueueItems(items)).toEqual([]);
  });
});
