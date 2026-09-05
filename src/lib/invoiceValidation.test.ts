import { describe, expect, it } from "vitest";
import { validateInvoiceForSave } from "./invoiceValidation";

const zaklad = { number: "FV2026-1", issue_date: "2026-09-01", due_date: "2026-09-15" };
const polozka = (unit_price: number) => ({ name: "Oprava", qty: 1, unit: "ks", unit_price, vat_rate: 21 });

describe("validateInvoiceForSave – znaménko podle druhu", () => {
  it("faktura s kladnou částkou projde, se zápornou ne", () => {
    expect(validateInvoiceForSave(zaklad, [polozka(1000)])).toEqual([]);
    expect(validateInvoiceForSave(zaklad, [polozka(-1000)]).map((e) => e.field)).toContain("items");
  });

  it("dobropis pustí zápornou i nulovou částku, kladnou odmítne", () => {
    const dobropis = { ...zaklad, kind: "credit_note" };
    expect(validateInvoiceForSave(dobropis, [polozka(-1000)])).toEqual([]);
    expect(validateInvoiceForSave(dobropis, [polozka(0)])).toEqual([]);
    expect(validateInvoiceForSave(dobropis, [polozka(1000)]).map((e) => e.field)).toContain("items");
  });

  it("zálohová faktura se chová jako faktura", () => {
    expect(validateInvoiceForSave({ ...zaklad, kind: "proforma" }, [polozka(500)])).toEqual([]);
    expect(validateInvoiceForSave({ ...zaklad, kind: "proforma" }, [polozka(-500)])).not.toEqual([]);
  });
});
