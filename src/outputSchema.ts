// UiPath jobs surface their result as an `OutputArguments` JSON string, but the
// shape varies by automation. This module normalizes every known shape behind a
// single interface so order-UID matching and field rendering work uniformly,
// regardless of which schema a given job emitted.
//
// To support a new shape: write an OutputAdapter and register it in `ADAPTERS`.
// Nothing else changes — matching (jobMatcher) and display (render) both read
// the normalized view.

export type OutputSchemaId = "jobOutput" | "transactionItem" | "unknown";

// Schema-agnostic view of a job's parsed OutputArguments.
export interface NormalizedOutput {
  // Which adapter recognized the raw output.
  schema: OutputSchemaId;
  // The order this output pertains to, or "" if none could be extracted.
  orderUid: string;
  // Display fields, already filtered and ordered: [key, value] pairs.
  fields: [string, unknown][];
  // The original parsed object, untouched.
  raw: Record<string, unknown>;
}

interface OutputAdapter {
  id: OutputSchemaId;
  // True when this adapter recognizes the raw output shape.
  matches(raw: Record<string, unknown>): boolean;
  // The order UID embedded in the output, or "" if absent.
  orderUid(raw: Record<string, unknown>): string;
  // Human-relevant fields to display, already ordered.
  fields(raw: Record<string, unknown>): [string, unknown][];
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function asString(v: unknown): string {
  return typeof v === "string" ? v : "";
}

// Schema A — flat job output keyed by `out_`-prefixed fields (e.g. out_OrderUid).
const JOB_OUTPUT_ORDER = [
  "out_OrderUid",
  "out_Result",
  "out_Account",
  "out_QueueItemReference",
  "out_AuthId",
];

const jobOutputAdapter: OutputAdapter = {
  id: "jobOutput",
  matches: (raw) => Object.keys(raw).some((k) => k.startsWith("out_")),
  orderUid: (raw) => asString(raw.out_OrderUid),
  fields: (raw) =>
    Object.entries(raw)
      .filter(([k]) => k.startsWith("out_"))
      .sort(([a], [b]) => {
        const ia = JOB_OUTPUT_ORDER.indexOf(a);
        const ib = JOB_OUTPUT_ORDER.indexOf(b);
        if (ia !== -1 && ib !== -1) return ia - ib;
        if (ia !== -1) return -1;
        if (ib !== -1) return 1;
        return a.localeCompare(b);
      }),
};

// Schema B — a UiPath queue transaction item; order data lives under
// `transactionItem.SpecificContent`. `token`/`callbackContext` carry an auth
// JWT and internal routing data, so they are hidden from the field list.
const TX_HIDDEN_FIELDS = new Set(["token", "callbackContext"]);

function specificContent(raw: Record<string, unknown>): Record<string, unknown> | null {
  return asRecord(asRecord(raw.transactionItem)?.SpecificContent);
}

const transactionItemAdapter: OutputAdapter = {
  id: "transactionItem",
  matches: (raw) => specificContent(raw) !== null,
  orderUid: (raw) => asString(specificContent(raw)?.orderUid),
  fields: (raw) =>
    Object.entries(specificContent(raw) ?? {}).filter(
      ([k]) => !TX_HIDDEN_FIELDS.has(k),
    ),
};

// Registry, tried in order; first match wins.
const ADAPTERS: OutputAdapter[] = [jobOutputAdapter, transactionItemAdapter];

export function normalizeOutput(
  raw: Record<string, unknown>,
): NormalizedOutput {
  for (const adapter of ADAPTERS) {
    if (adapter.matches(raw)) {
      return {
        schema: adapter.id,
        orderUid: adapter.orderUid(raw),
        fields: adapter.fields(raw),
        raw,
      };
    }
  }
  // Unknown shape: show everything so nothing is silently dropped.
  return { schema: "unknown", orderUid: "", fields: Object.entries(raw), raw };
}

// Does this parsed output belong to `orderId`? Used by the matcher to decide a
// candidate job is a hit across every supported schema.
export function outputMatchesOrder(
  raw: Record<string, unknown>,
  orderId: string,
): boolean {
  return normalizeOutput(raw).orderUid === orderId;
}
