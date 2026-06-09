import { describe, expect, test } from "bun:test";
import {
  analyzeOutput,
  highlightFailureTerms,
  isFailureLog,
} from "./outputAnalysis";

const id = (s: string) => s;

describe("analyzeOutput — result-failure rule", () => {
  test("flags out_Result = 'Failure' as an error", () => {
    const comments = analyzeOutput({ out_Result: "Failure" });
    expect(comments).toHaveLength(1);
    expect(comments[0].severity).toBe("error");
    expect(comments[0].rule).toBe("result-failure");
  });

  test("is case-insensitive on the result value", () => {
    expect(analyzeOutput({ out_Result: "failure" })).toHaveLength(1);
    expect(analyzeOutput({ out_Result: "FAILURE" })).toHaveLength(1);
  });

  test("stays silent on a successful result", () => {
    expect(analyzeOutput({ out_Result: "Success" })).toEqual([]);
  });

  test("stays silent when out_Result is absent", () => {
    expect(analyzeOutput({ out_OrderUid: "abc" })).toEqual([]);
  });

  test("ignores a non-string out_Result", () => {
    expect(analyzeOutput({ out_Result: false })).toEqual([]);
  });
});

describe("analyzeOutput — log-errors rule", () => {
  const ok = { Level: "Info", Message: "started", TimeStamp: "" };
  const err = { Level: "Error", Message: "boom", TimeStamp: "" };
  const fatal = { Level: "Fatal", Message: "dead", TimeStamp: "" };

  test("flags error/fatal log entries with a count", () => {
    const comments = analyzeOutput({ out_Result: "Success" }, [ok, err, fatal]);
    const logComment = comments.find((c) => c.rule === "log-errors");
    expect(logComment?.severity).toBe("error");
    expect(logComment?.message).toContain("2 error logs");
  });

  test("singular wording for a single error", () => {
    const comments = analyzeOutput({}, [err]);
    expect(comments[0].message).toContain("1 error log ");
  });

  test("stays silent when no logs are error level", () => {
    expect(analyzeOutput({}, [ok])).toEqual([]);
  });

  test("defaults to no logs when the argument is omitted", () => {
    expect(analyzeOutput({ out_Result: "Success" })).toEqual([]);
  });

  test("combines output and log comments", () => {
    const comments = analyzeOutput({ out_Result: "Failure" }, [err]);
    expect(comments.map((c) => c.rule)).toEqual(["result-failure", "log-errors"]);
  });
});

describe("analyzeOutput — log-warnings rule", () => {
  const warn = { Level: "Warning", Message: "slow", TimeStamp: "" };
  const warnAbbr = { Level: "Warn", Message: "retrying", TimeStamp: "" };

  test("flags warning-level entries as a warning", () => {
    const comments = analyzeOutput({}, [warn, warnAbbr]);
    expect(comments).toHaveLength(1);
    expect(comments[0].rule).toBe("log-warnings");
    expect(comments[0].severity).toBe("warning");
    expect(comments[0].message).toContain("2 warning logs");
  });

  test("does not count error-level logs as warnings", () => {
    const comments = analyzeOutput({}, [
      { Level: "Error", Message: "boom", TimeStamp: "" },
    ]);
    expect(comments.some((c) => c.rule === "log-warnings")).toBe(false);
  });
});

describe("analyzeOutput — log-failure-indicators rule", () => {
  test("flags failure language in a benign-level log", () => {
    const comments = analyzeOutput({}, [
      { Level: "Info", Message: "Submission failed: gateway timeout", TimeStamp: "" },
    ]);
    const c = comments.find((x) => x.rule === "log-failure-indicators");
    expect(c?.severity).toBe("warning");
    expect(c?.message).toContain("1 log message");
  });

  test("ignores benign info messages", () => {
    expect(
      analyzeOutput({}, [{ Level: "Info", Message: "Order processed", TimeStamp: "" }]),
    ).toEqual([]);
  });

  test.each([
    "Request was rejected by the server",
    "Host unreachable",
    "Process ran out of memory",
    "Access denied for user",
    "Operation could not complete",
    "Unhandled exception occurred",
    "Connection refused",
    "Maximum retries exhausted",
    "Received a 503 service unavailable",
  ])("flags failure language: %s", (message) => {
    const comments = analyzeOutput({}, [{ Level: "Info", Message: message, TimeStamp: "" }]);
    expect(comments.some((c) => c.rule === "log-failure-indicators")).toBe(true);
  });

  test.each([
    "Order processed successfully",
    "Submitted authorization for review",
    "Terror movie night scheduled", // 'terror' must not match 'error'
    "Mirror image generated",
  ])("does not flag benign message: %s", (message) => {
    const comments = analyzeOutput({}, [{ Level: "Info", Message: message, TimeStamp: "" }]);
    expect(comments.some((c) => c.rule === "log-failure-indicators")).toBe(false);
  });

  test("does not double-count error-level logs (covered by log-errors)", () => {
    const comments = analyzeOutput({}, [
      { Level: "Error", Message: "exception thrown", TimeStamp: "" },
    ]);
    expect(comments.map((c) => c.rule)).toEqual(["log-errors"]);
  });

  test("all log rules can fire together", () => {
    const comments = analyzeOutput({ out_Result: "Failure" }, [
      { Level: "Error", Message: "boom", TimeStamp: "" },
      { Level: "Warning", Message: "slow", TimeStamp: "" },
      { Level: "Info", Message: "could not reach host", TimeStamp: "" },
    ]);
    expect(comments.map((c) => c.rule)).toEqual([
      "result-failure",
      "log-errors",
      "log-warnings",
      "log-failure-indicators",
    ]);
  });
});

describe("highlightFailureTerms", () => {
  test("wraps a failure term in a highlight span", () => {
    expect(highlightFailureTerms("operation failed", id)).toBe(
      'operation <span class="log-failure-term">failed</span>',
    );
  });

  test("highlights multiple terms in one message", () => {
    const html = highlightFailureTerms("connection refused, retries exhausted", id);
    expect(html).toContain('<span class="log-failure-term">connection refused</span>');
    expect(html).toContain('<span class="log-failure-term">retries exhausted</span>');
  });

  test("leaves benign messages untouched", () => {
    expect(highlightFailureTerms("Order processed", id)).toBe("Order processed");
  });

  test("escapes surrounding text and the matched term via esc", () => {
    const esc = (s: string) => s.replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const html = highlightFailureTerms("<b> error </b>", esc);
    expect(html).toBe(
      '&lt;b&gt; <span class="log-failure-term">error</span> &lt;/b&gt;',
    );
  });
});

describe("isFailureLog", () => {
  test("true for error/fatal level even with a benign message", () => {
    expect(isFailureLog({ Level: "Error", Message: "boom", TimeStamp: "" })).toBe(true);
    expect(isFailureLog({ Level: "Fatal", Message: "done", TimeStamp: "" })).toBe(true);
  });

  test("true for a benign level whose message reads like a failure", () => {
    expect(
      isFailureLog({ Level: "Info", Message: "request timed out", TimeStamp: "" }),
    ).toBe(true);
  });

  test("false for a benign info entry", () => {
    expect(
      isFailureLog({ Level: "Info", Message: "Order processed", TimeStamp: "" }),
    ).toBe(false);
  });
});
