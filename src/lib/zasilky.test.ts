import { describe, expect, it } from "vitest";
import { cisloZasilky, druhaPobocka, htmlProtokolu, mapZasilka, nepreveztePolozky, otevrenyKoncept, popisUmisteni, stitekUmisteni, umisteniZakazky, type Zasilka } from "./zasilky";

const nazev = (id: string) => ({ b: "Brno", p: "Praha" }[id] ?? id);

describe("umístění zakázky", () => {
  it("doma: bez umístění nebo umístění na vlastní pobočce", () => {
    expect(umisteniZakazky({ branchId: "b" })).toEqual({ druh: "doma" });
    expect(umisteniZakazky({ branchId: "b", locationBranchId: "b" })).toEqual({ druh: "doma" });
    expect(stitekUmisteni({ druh: "doma" }, nazev)).toBeNull();
  });

  it("jinde a na cestě", () => {
    expect(umisteniZakazky({ branchId: "b", locationBranchId: "p" })).toEqual({ druh: "jinde", branchId: "p" });
    expect(umisteniZakazky({ branchId: "b", locationBranchId: "p", transitShipmentId: "z1" })).toEqual({ druh: "na_ceste", doBranchId: "p", shipmentId: "z1" });
    // Cesta zpátky domů: location je NULL (cíl = vlastní pobočka), cestuje se k branchId.
    expect(umisteniZakazky({ branchId: "b", locationBranchId: null, transitShipmentId: "z2" })).toEqual({ druh: "na_ceste", doBranchId: "b", shipmentId: "z2" });
    expect(stitekUmisteni({ druh: "jinde", branchId: "p" }, nazev)).toBe("Praha");
    expect(stitekUmisteni({ druh: "na_ceste", doBranchId: "b", shipmentId: "z" }, nazev)).toBe("→ Brno");
    expect(popisUmisteni({ druh: "na_ceste", doBranchId: "p", shipmentId: "z" }, nazev, "Brno")).toBe("Na cestě do pobočky Praha");
    expect(popisUmisteni({ druh: "doma" }, nazev, "Brno")).toBe("Na své pobočce (Brno)");
  });
});

describe("zásilka", () => {
  const radek = {
    id: "z1", service_id: "s", cislo: 7, from_branch_id: "b", to_branch_id: "p", status: "sent", carrier: "PPL", tracking_number: "123",
    note: null, created_by: "u", created_at: "2026-09-16T10:00:00Z", sent_by: "u", sent_at: "2026-09-16T11:00:00Z", received_by: null, received_at: null,
    ticket_shipment_items: [
      { id: "i2", shipment_id: "z1", ticket_id: "t2", added_at: "2026-09-16T10:05:00Z", received_at: null, note: null },
      { id: "i1", shipment_id: "z1", ticket_id: "t1", added_at: "2026-09-16T10:01:00Z", received_at: "2026-09-17T08:00:00Z", note: null },
    ],
  };

  it("mapuje řádek, položky řadí podle přidání a spočítá nepřevzaté", () => {
    const z = mapZasilka(radek);
    expect(z.cislo).toBe(7);
    expect(cisloZasilky(z)).toBe("Z-0007");
    expect(z.polozky.map((p) => p.ticketId)).toEqual(["t1", "t2"]);
    expect(nepreveztePolozky(z).map((p) => p.ticketId)).toEqual(["t2"]);
    expect(nepreveztePolozky({ ...z, status: "draft" })).toEqual([]);
    expect(z.note).toBe("");
  });

  it("otevřený koncept a druhá pobočka", () => {
    const koncept: Zasilka = { ...mapZasilka(radek), id: "k", status: "draft" };
    const zasilky = [mapZasilka(radek), koncept];
    expect(otevrenyKoncept(zasilky, "b", "p")?.id).toBe("k");
    expect(otevrenyKoncept(zasilky, "p", "b")).toBeNull();
    expect(druhaPobocka([{ id: "b" }, { id: "p" }], "b")).toBe("p");
    expect(druhaPobocka([{ id: "b" }, { id: "p" }, { id: "o" }], "b")).toBeNull();
  });

  it("protokol obsahuje pobočky, zakázky a escapuje HTML", () => {
    const html = htmlProtokolu(mapZasilka(radek), {
      nazevPobocky: nazev,
      zakazky: [{ ticketId: "t1", code: "BR26000001", device: "iPhone <13>", customer: "Novák & syn" }],
      servis: "Servis",
    });
    expect(html).toContain("Z-0007");
    expect(html).toContain("Brno");
    expect(html).toContain("Praha");
    expect(html).toContain("BR26000001");
    expect(html).toContain("iPhone &lt;13&gt;");
    expect(html).toContain("Novák &amp; syn");
    expect(html).toContain("PPL");
  });
});
