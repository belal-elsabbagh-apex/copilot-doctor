import { describe, expect, test } from "bun:test";
import { normalizeOutput, outputMatchesOrder } from "./outputSchema";

const ORDER_UID = "32e36462-2526-49af-8c92-571a7699db09";

// Schema A — flat `out_`-prefixed job output.
const jobOutput = {
  out_Account: "OPTUM",
  out_OrderUid: ORDER_UID,
  out_Result: "Success",
  extra: "ignored — not an out_ field",
};

// Schema B — UiPath queue transaction item (order data nested in SpecificContent).
const transactionItem = {
  transactionItem: {
    Id: 878505766,
    Reference: "593802418",
    QueueName: "OPTUM CARE NETWORK auth submit queue",
    SpecificContent: {
      orderUid: ORDER_UID,
      MemberFullName: "Spencer, Concepcion M",
      token: "eyJhbGciOiJSUzI1NiJ9.secret.signature",
      callbackContext: `{"physicianId":82}`,
    },
  },
};

describe("normalizeOutput", () => {
  test("recognizes flat job output and extracts the order UID", () => {
    const n = normalizeOutput(jobOutput);
    expect(n.schema).toBe("jobOutput");
    expect(n.orderUid).toBe(ORDER_UID);
  });

  test("job output shows only out_ fields, ordered by priority", () => {
    const keys = normalizeOutput(jobOutput).fields.map(([k]) => k);
    expect(keys).toEqual(["out_OrderUid", "out_Result", "out_Account"]);
  });

  test("recognizes a transaction item and extracts the nested order UID", () => {
    const n = normalizeOutput(transactionItem);
    expect(n.schema).toBe("transactionItem");
    expect(n.orderUid).toBe(ORDER_UID);
  });

  test("transaction item hides token and callbackContext", () => {
    const keys = normalizeOutput(transactionItem).fields.map(([k]) => k);
    expect(keys).toContain("orderUid");
    expect(keys).toContain("MemberFullName");
    expect(keys).not.toContain("token");
    expect(keys).not.toContain("callbackContext");
  });

  test("unknown shape falls back to all fields and an empty UID", () => {
    const n = normalizeOutput({ foo: 1, bar: 2 });
    expect(n.schema).toBe("unknown");
    expect(n.orderUid).toBe("");
    expect(n.fields.map(([k]) => k)).toEqual(["foo", "bar"]);
  });

  test("missing order UID normalizes to empty string", () => {
    expect(normalizeOutput({ out_Result: "Success" }).orderUid).toBe("");
    expect(
      normalizeOutput({ transactionItem: { SpecificContent: {} } }).orderUid,
    ).toBe("");
  });
});

describe("outputMatchesOrder", () => {
  test("matches the right order across both schemas", () => {
    expect(outputMatchesOrder(jobOutput, ORDER_UID)).toBe(true);
    expect(outputMatchesOrder(transactionItem, ORDER_UID)).toBe(true);
  });

  test("rejects a different order id", () => {
    expect(outputMatchesOrder(jobOutput, "different-uid")).toBe(false);
    expect(outputMatchesOrder(transactionItem, "different-uid")).toBe(false);
  });
});
