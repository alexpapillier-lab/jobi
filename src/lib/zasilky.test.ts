import { describe, expect, it } from "vitest";
import { cisloZasilky, druhaPobocka, htmlProtokolu, krokyPresunu, mapZasilka, nepreveztePolozky, otevrenyKoncept, popisUmisteni, stitekUmisteni, umisteniZakazky, type Zasilka } from "./zasilky";

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

describe("nastavení modulu", () => {
  it("výchozí hodnoty a normalizace", async () => {
    const { normalizujNastaveniZasilek } = await import("./zasilky");
    expect(normalizujNastaveniZasilek(undefined)).toEqual({ postup: true, filtr: true, upozorneniDni: 0, portal: true });
    expect(normalizujNastaveniZasilek({ zasilky_postup: false, zasilky_filtr: false, zasilky_upozorneni_dni: 3.7, zasilky_portal: false }))
      .toEqual({ postup: false, filtr: false, upozorneniDni: 3, portal: false });
    expect(normalizujNastaveniZasilek({ zasilky_upozorneni_dni: -5 }).upozorneniDni).toBe(0);
    expect(normalizujNastaveniZasilek({ zasilky_upozorneni_dni: "7" }).upozorneniDni).toBe(0);
  });
});

describe("dniBezZmenyJinde", () => {
  it("hlásí jen zakázky mimo pobočku po limitu", async () => {
    const { dniBezZmenyJinde } = await import("./zasilky");
    const ted = new Date("2026-09-16T12:00:00Z");
    const pred5 = "2026-09-11T10:00:00Z";
    expect(dniBezZmenyJinde({ branchId: "b", locationBranchId: "p", updatedAt: pred5 }, 3, ted)).toBe(5);
    expect(dniBezZmenyJinde({ branchId: "b", locationBranchId: "p", updatedAt: pred5 }, 7, ted)).toBeNull();
    expect(dniBezZmenyJinde({ branchId: "b", updatedAt: pred5 }, 3, ted)).toBeNull(); // doma
    expect(dniBezZmenyJinde({ branchId: "b", locationBranchId: "p", updatedAt: pred5 }, 0, ted)).toBeNull(); // vypnuto
    expect(dniBezZmenyJinde({ branchId: "b", locationBranchId: null, transitShipmentId: "z", updatedAt: pred5 }, 3, ted)).toBe(5); // na cestě zpět
  });
});

describe("krokyPresunu", () => {
  const z = (prepis: Partial<Zasilka> & { polozkaPrevzata?: boolean }): Zasilka => ({
    id: "z", serviceId: "s", cislo: 1, fromBranchId: "b", toBranchId: "p", status: "sent", carrier: "", trackingNumber: "", note: "",
    createdBy: null, createdAt: "2026-09-10T10:00:00Z", sentBy: null, sentAt: "2026-09-10T11:00:00Z", receivedBy: null, receivedAt: null,
    polozky: [{ id: "i", shipmentId: prepis.id ?? "z", ticketId: "t", addedAt: "2026-09-10T10:00:00Z", receivedAt: prepis.polozkaPrevzata ? "2026-09-11T08:00:00Z" : null, note: "" }],
    ...prepis,
  });
  const t = (u: Partial<{ locationBranchId: string | null; transitShipmentId: string | null }> = {}) => ({ id: "t", branchId: "b", ...u });

  it("zakázka opravená doma žádné kroky nemá", () => {
    expect(krokyPresunu(t(), [], nazev, false)).toEqual({ predOpravou: [], poOprave: [] });
  });

  it("v konceptu: čeká na odeslání", () => {
    const k = krokyPresunu(t(), [z({ status: "draft", sentAt: null })], nazev, false);
    expect(k.predOpravou[0]).toMatchObject({ id: "odeslano", hotovo: false, poznamka: "V konceptu zásilky Z-0001, čeká na odeslání" });
    expect(k.predOpravou[1]).toMatchObject({ id: "prevzato", hotovo: false });
  });

  it("na cestě → převzato v Praze → opraveno, čeká na zpáteční zásilku", () => {
    const naCeste = krokyPresunu(t({ locationBranchId: "p", transitShipmentId: "z" }), [z({})], nazev, false);
    expect(naCeste.predOpravou[0].hotovo).toBe(true);
    expect(naCeste.predOpravou[1]).toMatchObject({ hotovo: false, poznamka: "Na cestě" });

    const vPraze = krokyPresunu(t({ locationBranchId: "p" }), [z({ polozkaPrevzata: true, status: "received" })], nazev, true);
    expect(vPraze.predOpravou[1].hotovo).toBe(true);
    expect(vPraze.poOprave[0]).toMatchObject({ id: "zpet", label: "Zpět v pobočce Brno", hotovo: false, poznamka: "Opraveno – přidejte do zásilky zpět", akce: true });
  });

  it("zpáteční zásilka: koncept, na cestě, doma", () => {
    const tam = z({ polozkaPrevzata: true, status: "received" });
    const zpetKoncept = z({ id: "y", cislo: 2, fromBranchId: "p", toBranchId: "b", status: "draft", createdAt: "2026-09-12T10:00:00Z", sentAt: null });
    expect(krokyPresunu(t({ locationBranchId: "p" }), [tam, zpetKoncept], nazev, true).poOprave[0]).toMatchObject({ hotovo: false, poznamka: "V konceptu zpáteční zásilky Z-0002", akce: false });
    const zpetSent = { ...zpetKoncept, status: "sent" as const };
    expect(krokyPresunu(t({ locationBranchId: null, transitShipmentId: "y" }), [tam, zpetSent], nazev, true).poOprave[0]).toMatchObject({ hotovo: false, poznamka: "Na cestě zpět" });
    const zpetDoma = { ...zpetSent, status: "received" as const, polozky: [{ ...zpetSent.polozky[0], receivedAt: "2026-09-13T08:00:00Z" }] };
    expect(krokyPresunu(t(), [tam, zpetDoma], nazev, true).poOprave[0]).toMatchObject({ hotovo: true });
  });
});
