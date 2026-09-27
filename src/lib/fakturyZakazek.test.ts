import { describe, expect, it } from "vitest";
import { mapaFakturZakazek, stitekFaktury } from "./fakturyZakazek";

describe("faktury zakázek", () => {
  it("souhrnná faktura kryje víc zakázek, každá dostane její číslo", () => {
    const mapa = mapaFakturZakazek(
      [
        { ticket_id: "z1", invoice_id: "f1", invoices: { number: "F2026-0042" } },
        { ticket_id: "z2", invoice_id: "f1", invoices: { number: "F2026-0042" } },
      ],
      [],
    );
    expect(mapa.z1).toEqual({ id: "f1", cislo: "F2026-0042", druh: "faktura" });
    expect(mapa.z2?.id).toBe("f1");
    expect(stitekFaktury(mapa.z2)).toBe("F2026-0042");
  });

  it("faktura má přednost před zálohou; samotná záloha štítek nemá", () => {
    const mapa = mapaFakturZakazek(
      [{ ticket_id: "z1", invoice_id: "f1", invoices: [{ number: "F1" }] }],
      [
        { id: "zf1", ticket_id: "z1", number: "ZF1" },
        { id: "zf2", ticket_id: "z2", number: "ZF2" },
      ],
    );
    expect(mapa.z1).toEqual({ id: "f1", cislo: "F1", druh: "faktura" });
    expect(mapa.z2).toEqual({ id: "zf2", cislo: "ZF2", druh: "zaloha" });
    expect(stitekFaktury(mapa.z2)).toBeNull();
    expect(stitekFaktury(undefined)).toBeNull();
  });

  it("koncept bez čísla a neúplné řádky", () => {
    const mapa = mapaFakturZakazek(
      [
        { ticket_id: "z1", invoice_id: "f1", invoices: { number: "  " } },
        { ticket_id: null, invoice_id: "f2" },
        { ticket_id: "z3", invoice_id: null },
      ],
      [{ id: "zf", ticket_id: null }],
    );
    expect(Object.keys(mapa)).toEqual(["z1"]);
    expect(stitekFaktury(mapa.z1)).toBe("koncept faktury");
  });
});
