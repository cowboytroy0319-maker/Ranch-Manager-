// ============================================================================
// Owner priority 4 — the "Total cost paid" field must be VISIBLE and usable in
// the restock flow, and it must be the owner's own wording everywhere.
//
// These are source-contract tests: the wording lives in restockUI.ts (so the
// add form, the edit form and this test can never drift apart), and the rendered
// form is asserted against that wording. The behavioural half — a cost creates
// exactly one linked expense, blank creates none, double-submit duplicates
// nothing, void reverses inventory and drops the expense — lives in
// src/server/productBlocker.test.ts against the local Postgres.
// ============================================================================
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  RESTOCK_COST_EDIT_HELP,
  RESTOCK_COST_HELP,
  RESTOCK_COST_LABEL,
} from "./restockUI";

const modalsRaw = readFileSync(new URL("./FeedModals.tsx", import.meta.url), "utf8");
/** The file with every comment removed — so "the literal label is gone" means
 *  gone from the JSX, not merely absent from a docblock too. */
const modalsSource = modalsRaw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("the cost field's wording is the owner's wording", () => {
  test("the label is exactly 'Total cost paid'", () => {
    expect(RESTOCK_COST_LABEL).toBe("Total cost paid");
  });

  test("the old label is gone from the restock forms", () => {
    expect(modalsSource.includes("Total cost ($)")).toBe(false);
    expect(modalsSource.includes("Total cost paid")).toBe(false); // rendered from the constant, never hard-coded twice
    expect(modalsSource).toContain("{RESTOCK_COST_LABEL}");
    expect(modalsSource).toContain("fill in ${RESTOCK_COST_LABEL}"); // the modal subtitle names the field too
  });

  test("the helper text keeps both honest outcomes: a cost records the expense, blank only moves inventory", () => {
    expect(RESTOCK_COST_HELP).toContain("Optional");
    expect(RESTOCK_COST_HELP).toContain("linked Hay & feed expense");
    expect(RESTOCK_COST_HELP.toLowerCase()).toContain("blank");
    expect(RESTOCK_COST_HELP.toLowerCase()).toContain("inventory");
    expect(RESTOCK_COST_EDIT_HELP).toContain("Optional");
    expect(RESTOCK_COST_EDIT_HELP.toLowerCase()).toContain("inventory");
  });
});

describe("the cost field is visible and reachable on a 375 px phone", () => {
  test("it is rendered as its own full-width block in BOTH restock forms", () => {
    // Add restock + edit restock each render one CostPaidField.
    expect(modalsSource.split("<CostPaidField").length - 1).toBe(2);
    expect(modalsSource).toContain('id="restock-total-cost-paid"');
    expect(modalsSource).toContain('id="edit-restock-total-cost-paid"');
    // Full-width on phone AND desktop (sm:col-span-2 spans the 2-col grid).
    expect(modalsSource).toContain("sm:col-span-2");
  });

  test("the input is a 44 px+ tap target with 16px text, and a visible $ affix", () => {
    expect(modalsSource).toContain("const costInputCls");
    const cls = modalsSource.slice(modalsSource.indexOf("const costInputCls"));
    const classList = cls.slice(0, cls.indexOf(";"));
    expect(classList).toContain("min-h-11"); // 44 px
    expect(classList).toContain("w-full");
    expect(classList).toContain("text-base"); // 16px — iOS Safari must not zoom on focus
    // The dollar affix sits inside the field's own input row.
    expect(modalsSource).toContain("pointer-events-none absolute left-3");
  });

  test("the label and helper actually render (not just declared)", () => {
    expect(modalsSource).toContain("{help}");
    expect(modalsSource).toContain("help={RESTOCK_COST_HELP}");
    expect(modalsSource).toContain("help={RESTOCK_COST_EDIT_HELP}");
    // The label element is the field's own, real <label htmlFor=...>
    expect(modalsSource).toContain("htmlFor={id}");
  });

  test("the cost field sits in the same visible block as quantity and date — not below Vendor or Notes", () => {
    const addForm = modalsSource.slice(modalsSource.indexOf('id="restock-form"'));
    const iQty = addForm.indexOf("Quantity added");
    const iDate = addForm.indexOf("Restock date *");
    const iCost = addForm.indexOf("<CostPaidField");
    const iVendor = addForm.indexOf('label="Vendor"');
    const iNotes = addForm.indexOf('label="Notes"');
    expect(iQty > -1).toBe(true);
    expect(iDate > iQty).toBe(true);
    expect(iCost > iDate).toBe(true);
    expect(iVendor > iCost).toBe(true);
    expect(iNotes > iVendor).toBe(true);
  });
});
