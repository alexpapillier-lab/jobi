import { describe, expect, it } from "vitest";
import { pridejMesice, ticketDocumentData } from "./documentData";
import type { TicketEx } from "../pages/Orders";
import { itemsTotal } from "../../jobidocs/core/variables";

const zakazka = (extra: Partial<TicketEx>): TicketEx =>
  ({ id: "t1", code: "E2E26000001", customerName: "Jan Novák", deviceLabel: "iPhone 13", createdAt: "2026-09-01T10:00:00Z", status: "received", ...extra }) as unknown as TicketEx;

describe("ticketDocumentData", () => {
  it("záruka nepřeteče přes konec měsíce", () => {
    expect(pridejMesice(new Date(2026, 0, 31), 1).getDate()).toBe(28);
    expect(pridejMesice(new Date(2024, 0, 31), 1).getDate()).toBe(29);
    const r = pridejMesice(new Date(2026, 4, 15), 12);
    expect([r.getFullYear(), r.getMonth(), r.getDate()]).toEqual([2027, 4, 15]);
  });

  it("sleva se promítne do celkové částky na dokladu", () => {
    const d = ticketDocumentData(zakazka({ performedRepairs: [{ id: "a", name: "Displej", type: "manual", price: 1000 }], discountType: "percentage", discountValue: 10 } as Partial<TicketEx>), {});
    expect(d.totals?.total).toBe(900);
    expect(itemsTotal(d)).toBe(900);
    const e = ticketDocumentData(zakazka({ performedRepairs: [{ id: "a", name: "Displej", type: "manual", price: 1000 }], discountType: "amount", discountValue: 1500 } as Partial<TicketEx>), {});
    expect(e.totals?.total).toBe(0);
  });

  it("hodinová práce jde jako hodiny × sazba, ostatní 1 ks", () => {
    const d = ticketDocumentData(zakazka({ performedRepairs: [
      { id: "a", name: "Diagnostika", type: "hourly", hodiny: 1.5, sazba: 800, price: 1200, technik: "Petr" },
      { id: "b", name: "Displej", type: "manual", price: 1000 },
    ] } as Partial<TicketEx>), {});
    expect(d.items?.[0]).toMatchObject({ name: "Diagnostika (Petr)", qty: 1.5, unit: "h", unitPrice: 800, total: 1200 });
    expect(d.items?.[1]).toMatchObject({ name: "Displej", qty: 1, unit: "ks", total: 1000 });
    expect(d.totals?.total).toBe(2200);
  });
});
