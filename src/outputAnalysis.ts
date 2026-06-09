// Semantic analysis of a job's result. Each rule inspects an AnalysisContext —
// the parsed OutputArguments (raw + normalized view) and the job's robot logs —
// and emits zero or more comments: short, severity-tagged notes surfaced above
// the raw JSON in the UI. This is where "what does this output mean / is
// something wrong?" logic lives, kept separate from rendering.
//
// To add a check: write an AnalysisRule and register it in `RULES`. A rule may
// read output, logs, or both. Rendering picks up every comment automatically.

import type { JobLog } from "./api";
import { normalizeOutput, type NormalizedOutput } from "./outputSchema";

export type CommentSeverity = "error" | "warning" | "info";

export interface OutputComment {
  severity: CommentSeverity;
  // Stable id of the rule that produced this comment (for debugging/dedup).
  rule: string;
  message: string;
}

// Everything a rule can inspect about a job.
export interface AnalysisContext {
  output: Record<string, unknown>;
  normalized: NormalizedOutput;
  logs: JobLog[];
}

// A rule returns any comments it warrants (empty when it has nothing to say).
type AnalysisRule = {
  id: string;
  run(ctx: AnalysisContext): OutputComment[];
};

// Rule: a job whose `out_Result` is "Failure" did not complete successfully.
const resultFailureRule: AnalysisRule = {
  id: "result-failure",
  run({ output }) {
    const result = output.out_Result;
    if (typeof result === "string" && result.toLowerCase() === "failure") {
      return [
        {
          severity: "error",
          rule: "result-failure",
          message: 'Automation reported out_Result = "Failure".',
        },
      ];
    }
    return [];
  },
};

const ERROR_LEVELS = new Set(["error", "fatal", "critical"]);
const WARN_LEVELS = new Set(["warn", "warning"]);

function levelOf(log: JobLog): string {
  return (log.Level || "").toLowerCase();
}

function plural(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

// Words/phrases that suggest a failure even when the log's own level isn't
// Error/Warn (e.g. an Info line that says "operation failed"). Heuristic — broad
// by design; word-boundary anchored so substrings ("terror", "errorless") don't
// trip it. Tune the list as real logs reveal false positives/negatives.
const FAILURE_TERMS = [
  // generic errors / exceptions / faults
  "exceptions?",
  "errors?",
  "errored",
  "faults?",
  "faulted",
  "fail(?:s|ed|ing|ure)?",
  // crash / abort / terminate / panic
  "crash(?:es|ed|ing)?",
  "abort(?:s|ed|ing)?",
  "terminat(?:e|ed|es|ing|ion)",
  "kill(?:s|ed)?",
  "halt(?:s|ed|ing)?",
  "panic(?:ked|king)?",
  "fatal",
  "critical",
  "severe",
  // inability / negation
  "unable to",
  "not able",
  "cannot",
  "can[’'`]?t",
  "could ?n[o’'`]?t",
  "did ?n[o’'`]?t",
  "was ?n[o’'`]?t able",
  "no response",
  "not found",
  "missing",
  "invalid",
  "unexpected",
  "unhandled",
  "illegal",
  // auth / permission
  "denied",
  "rejected",
  "refused",
  "unauthori[sz]ed",
  "forbidden",
  "expired",
  "access denied",
  "permission denied",
  "invalid credentials",
  // network / timeout / connectivity
  "time(?:d)? ?out",
  "timeout",
  "unreachable",
  "disconnected",
  "connection (?:refused|reset|lost|closed|error)",
  "reset by peer",
  // retry / give up
  "retries exhausted",
  "max(?:imum)? retries",
  "gave up",
  "giving up",
  // memory / references / corruption
  "stack ?trace",
  "traceback",
  "null ?reference",
  "null ?pointer",
  "out of memory",
  "stack overflow",
  "overflow",
  "deadlock",
  "segfault",
  "segmentation fault",
  "corrupt(?:s|ed|ion|ing)?",
  "broken",
  // common HTTP error phrasings
  "bad request",
  "internal server error",
  "service unavailable",
  "bad gateway",
  "gateway timeout",
  "too many requests",
];

const FAILURE_PATTERN = new RegExp(`\\b(?:${FAILURE_TERMS.join("|")})\\b`, "i");

// Rule: error/fatal entries in the robot logs indicate something went wrong
// during execution, even if the output itself looks benign.
const logErrorsRule: AnalysisRule = {
  id: "log-errors",
  run({ logs }) {
    const n = logs.filter((l) => ERROR_LEVELS.has(levelOf(l))).length;
    if (n === 0) return [];
    return [
      {
        severity: "error",
        rule: "log-errors",
        message: `${plural(n, "error log")} during execution.`,
      },
    ];
  },
};

// Rule: warning-level log entries — not necessarily fatal, but worth surfacing.
const logWarningsRule: AnalysisRule = {
  id: "log-warnings",
  run({ logs }) {
    const n = logs.filter((l) => WARN_LEVELS.has(levelOf(l))).length;
    if (n === 0) return [];
    return [
      {
        severity: "warning",
        rule: "log-warnings",
        message: `${plural(n, "warning log")} during execution.`,
      },
    ];
  },
};

// Rule: logs whose *message* reads like a failure even though their level is
// benign (Info/Trace/Debug). Error/Warn levels are already covered above, so
// they're excluded here to avoid double-counting.
const logFailureIndicatorsRule: AnalysisRule = {
  id: "log-failure-indicators",
  run({ logs }) {
    const n = logs.filter((l) => {
      const level = levelOf(l);
      if (ERROR_LEVELS.has(level) || WARN_LEVELS.has(level)) return false;
      return FAILURE_PATTERN.test(l.Message || "");
    }).length;
    if (n === 0) return [];
    return [
      {
        severity: "warning",
        rule: "log-failure-indicators",
        message: `${plural(n, "log message")} mention errors or failures.`,
      },
    ];
  },
};

// Registry, run in order; their comments are concatenated.
const RULES: AnalysisRule[] = [
  resultFailureRule,
  logErrorsRule,
  logWarningsRule,
  logFailureIndicatorsRule,
];

export function analyzeOutput(
  output: Record<string, unknown>,
  logs: JobLog[] = [],
): OutputComment[] {
  const normalized = normalizeOutput(output);
  return RULES.flatMap((rule) => rule.run({ output, normalized, logs }));
}

// Whether a log entry signals a failure — by level (error/fatal/critical) or by
// failure language in its message. Used to faintly highlight the whole row.
export function isFailureLog(log: JobLog): boolean {
  if (ERROR_LEVELS.has(levelOf(log))) return true;
  return FAILURE_PATTERN.test(log.Message || "");
}

// Wraps any failure terms found in `message` in a highlight span, escaping the
// surrounding text with `esc`. Shares FAILURE_PATTERN so the highlighted terms
// are exactly the ones the log-failure-indicators rule keys on.
export function highlightFailureTerms(
  message: string,
  esc: (s: string) => string,
): string {
  const re = new RegExp(FAILURE_PATTERN.source, "gi");
  let out = "";
  let last = 0;
  for (let m = re.exec(message); m; m = re.exec(message)) {
    out += esc(message.slice(last, m.index));
    out += `<span class="log-failure-term">${esc(m[0])}</span>`;
    last = m.index + m[0].length;
    if (m.index === re.lastIndex) re.lastIndex++; // guard against zero-width
  }
  out += esc(message.slice(last));
  return out;
}
