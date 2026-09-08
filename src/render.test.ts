import { describe, expect, test } from "bun:test";
import type { UiPathQueueItem } from "./api";
import { queueItemException, queueItemSummary } from "./render";

describe("queueItemSummary", () => {
  test("includes the Reference and a .job-state chip", () => {
    const html = queueItemSummary({ Status: "Successful", Reference: "593802418" });
    expect(html).toContain("593802418");
    expect(html).toContain('class="job-state"');
  });

  test("includes retry 2 when RetryNumber is 2", () => {
    const html = queueItemSummary({ Status: "Retried", RetryNumber: 2 });
    expect(html).toContain("retry 2");
  });

  test("emits a class=\"age\" span for an item created 24h ago", () => {
    const creationTime = new Date(Date.now() - 86_400_000).toISOString();
    const html = queueItemSummary({ Status: "Successful", CreationTime: creationTime });
    expect(html).toContain('class="age"');
  });

  test("omits the age span entirely when CreationTime is absent", () => {
    const html = queueItemSummary({ Status: "Successful" });
    expect(html).not.toContain('class="age"');
  });

  test("HTML-escapes a Reference containing <", () => {
    const html = queueItemSummary({ Status: "Successful", Reference: "<script>" });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});

describe("queueItemException", () => {
  test("returns 'Type: Reason' from ProcessingException", () => {
    const item: UiPathQueueItem = {
      ProcessingException: { Type: "BusinessException", Reason: "Invalid order" },
    };
    expect(queueItemException(item)).toBe("BusinessException: Invalid order");
  });

  test("falls back to ProcessingExceptionType alone", () => {
    const item: UiPathQueueItem = { ProcessingExceptionType: "BusinessException" };
    expect(queueItemException(item)).toBe("BusinessException");
  });

  test("returns '' when neither is set", () => {
    expect(queueItemException({})).toBe("");
  });
});
