import { describe, it, expect } from "vitest";
import {
  MAX_NAZEV_POLOZKY,
  cenaBezDph,
  datumVydaniZakazky,
  jeFiremniZakaznik,
  nazevRadkuZakazky,
  obdobiOdDo,
  obdobiZMesice,
  opravyZJsonu,
  patriZakaznikovi,
  poznamkaSouhrnu,
  sestavPolozky,
  souhrnVyberu,
  vazbyZVyberu,
  vyberKandidaty,
  vychoziMesic,
  vychoziVyber,
  zakazkaZRadku,
  type ZakazkaProSouhrn,
} from "./souhrnnaFaktura";
import { computeLine } from "./invoiceMath";
import { jeStornoStav } from "./stornoStav";
import { sazbaProNovouPolozku } from "../hooks/useServiceVat";
import { radkyProExport, soucetRadku } from "../../supabase/functions/_shared/ucetnictvi";

const KONCOVE = new Set(["done", "cancelled"]);
const jeKoncovy = (s: string) => KONCOVE.has(s);
const jeStorno = (s: string) => jeStornoStav(s);

let n = 0;
function zakazka(o: Partial<ZakazkaProSouhrn> = {}): ZakazkaProSouhrn {
  n += 1;
  return {
    id: `t${n}`,
    code: `SRV26${String(n).padStart(6, "0")}`,
    status: "done",
    createdAt: "2026-09-01T08:00:00",
    updatedAt: "2026-09-10T12:00:00",
    completedAt: "2026-09-10T12:00:00",
    customerId: "firma",
    customerName: "Alza (B2B)",
    customerCompany: "Alza.cz a.s.",
    customerIco: "27082440",
    deviceLabel: "iPhone 13",
    opravy: [{ name: "Výměna displeje", price: 2000 }],
    discountType: null,
    discountValue: null,
    branchId: null,
    ...o,
  };
}

const zari = obdobiZMesice("2026-09")!;
const vyber = (zakazky: ZakazkaProSouhrn[], vyfakturovano = new Map<string, string>(), zakaznik = { id: "firma", ico: "27082440" }) =>
  vyberKandidaty(zakazky, { zakaznik, obdobi: zari, jeKoncovy, jeStorno, vyfakturovano });

describe("zákazník", () => {
  it("firemní pozná podle IČO, firmy nebo „(B2B)“ v názvu", () => {
    expect(jeFiremniZakaznik({ name: "Jan Novák", ico: "123 45 678" })).toBe(true);
    expect(jeFiremniZakaznik({ name: "Jan Novák", company: "Novák s.r.o." })).toBe(true);
    expect(jeFiremniZakaznik({ name: "Mobil Pohotovost (B2B)" })).toBe(true);
    expect(jeFiremniZakaznik({ name: "Jan Novák", company: "  ", ico: "" })).toBe(false);
  });

  it("zakázka patří zákazníkovi podle karty i podle IČO jiné kontaktní osoby", () => {
    expect(patriZakaznikovi({ customerId: "firma", customerIco: null }, { id: "firma", ico: null })).toBe(true);
    expect(patriZakaznikovi({ customerId: "jina-karta", customerIco: "270 82 440" }, { id: "firma", ico: "27082440" })).toBe(true);
    expect(patriZakaznikovi({ customerId: "jina-karta", customerIco: null }, { id: "firma", ico: "27082440" })).toBe(false);
    // Prázdné IČO nesmí spárovat všechny zakázky bez IČO.
    expect(patriZakaznikovi({ customerId: "x", customerIco: "" }, { id: "firma", ico: "" })).toBe(false);
  });
});

describe("období", () => {
  it("měsíc je celý v místním čase, i únor", () => {
    const unor = obdobiZMesice("2026-02")!;
    expect(unor.start).toEqual(new Date(2026, 1, 1, 0, 0, 0, 0));
    expect(unor.end.getDate()).toBe(28);
    expect(unor.end.getHours()).toBe(23);
    expect(obdobiZMesice("2026-13")).toBeNull();
    expect(obdobiZMesice("")).toBeNull();
  });

  it("od–do bere oba dny celé a obrácené pořadí prohodí", () => {
    const r = obdobiOdDo("2026-09-30", "2026-09-01")!;
    expect(r.start).toEqual(new Date(2026, 8, 1));
    expect(r.end.getDate()).toBe(30);
    expect(r.end.getHours()).toBe(23);
    expect(obdobiOdDo("", "2026-09-01")).toBeNull();
  });

  it("výchozí měsíc: v prvních dnech minulý, jinak běžící", () => {
    expect(vychoziMesic(new Date(2026, 9, 3))).toBe("2026-09");
    expect(vychoziMesic(new Date(2026, 0, 5))).toBe("2025-12");
    expect(vychoziMesic(new Date(2026, 8, 27))).toBe("2026-09");
  });

  it("poznámka na faktuře", () => {
    expect(poznamkaSouhrnu(zari, 3)).toBe("Souhrnná faktura za 3 zakázky vydané v období 1. 9. 2026 – 30. 9. 2026.");
  });
});

describe("výběr kandidátů", () => {
  it("jen vydané v období, bez storna, rozpracovaných a cizích", () => {
    const ok = zakazka();
    const rozpracovana = zakazka({ status: "in_progress", completedAt: null });
    const storno = zakazka({ status: "cancelled" });
    const srpen = zakazka({ completedAt: "2026-08-31T23:59:00", updatedAt: "2026-09-02T10:00:00" });
    const cizi = zakazka({ customerId: "jiny", customerIco: "99999999" });
    const jinaOsobaStejneFirmy = zakazka({ customerId: "kontakt-2" });
    const { kandidati, vyfakturovane } = vyber([ok, rozpracovana, storno, srpen, cizi, jinaOsobaStejneFirmy]);
    expect(kandidati.map((k) => k.zakazka.id)).toEqual([ok.id, jinaOsobaStejneFirmy.id]);
    expect(vyfakturovane).toEqual([]);
  });

  it("vydání podle completed_at, starší řádek bez něj podle poslední změny", () => {
    expect(datumVydaniZakazky({ status: "done", completedAt: "2026-09-05", updatedAt: "2026-10-01" }, jeKoncovy)).toBe("2026-09-05");
    expect(datumVydaniZakazky({ status: "done", completedAt: null, updatedAt: "2026-09-07" }, jeKoncovy)).toBe("2026-09-07");
    expect(datumVydaniZakazky({ status: "in_progress", completedAt: "2026-09-05", updatedAt: null }, jeKoncovy)).toBeNull();
  });

  it("vyfakturované jdou zvlášť s číslem dokladu a nejdou vybrat", () => {
    const a = zakazka();
    const b = zakazka();
    const { kandidati, vyfakturovane } = vyber([a, b], new Map([[b.id, "FV2026-0012"]]));
    expect(kandidati.map((k) => k.zakazka.id)).toEqual([a.id]);
    expect(vyfakturovane).toHaveLength(1);
    expect(vyfakturovane[0].vyfakturovanoV).toBe("FV2026-0012");
  });

  it("řadí podle data vydání a zakázky za 0 Kč nezaškrtne", () => {
    const pozdejsi = zakazka({ completedAt: "2026-09-20T10:00:00" });
    const drivejsi = zakazka({ completedAt: "2026-09-02T10:00:00" });
    const zaruka = zakazka({ completedAt: "2026-09-05T10:00:00", opravy: [{ name: "Reklamace", price: 0 }] });
    const { kandidati } = vyber([pozdejsi, drivejsi, zaruka]);
    expect(kandidati.map((k) => k.zakazka.id)).toEqual([drivejsi.id, zaruka.id, pozdejsi.id]);
    expect([...vychoziVyber(kandidati)].sort()).toEqual([drivejsi.id, pozdejsi.id].sort());
  });

  it("cena je po slevě – stejně jako u zakázky", () => {
    const z = zakazka({ opravy: [{ name: "Displej", price: 2000 }, { name: "Baterie", price: 1000 }], discountType: "percentage", discountValue: 10 });
    const [k] = vyber([z]).kandidati;
    expect(k.hruba).toBe(3000);
    expect(k.sleva).toBe(300);
    expect(k.cena).toBe(2700);
  });
});

describe("položky a součty", () => {
  const platce = { sazba: sazbaProNovouPolozku({ vatPayer: true, defaultVatRate: 21 }), cenySDph: false };
  const neplatce = { sazba: sazbaProNovouPolozku({ vatPayer: false, defaultVatRate: 21 }), cenySDph: true };

  it("řádek za zakázku: číslo · zařízení · opravy, cena po slevě", () => {
    const z = zakazka({ code: "SRV26000123", opravy: [{ name: "Displej", price: 2000 }, { name: "Baterie", price: 1000 }], discountType: "amount", discountValue: 500 });
    const polozky = sestavPolozky(vyber([z]).kandidati, platce);
    expect(polozky).toEqual([{ name: "Zakázka SRV26000123 · iPhone 13 · Displej, Baterie", qty: 1, unit: "ks", unit_price: 2500, vat_rate: 21 }]);
  });

  it("neplátce DPH má sazbu 0 a cenu beze změny", () => {
    const polozky = sestavPolozky(vyber([zakazka()]).kandidati, neplatce);
    expect(polozky[0].vat_rate).toBe(0);
    expect(polozky[0].unit_price).toBe(2000);
  });

  it("ceny s DPH: faktura zní na stejnou částku jako zakázky", () => {
    const zakazky = [zakazka({ opravy: [{ name: "Displej", price: 1000 }] }), zakazka({ opravy: [{ name: "Baterie", price: 1490 }] })];
    const vybrane = vyber(zakazky).kandidati;
    const polozky = sestavPolozky(vybrane, { sazba: 21, cenySDph: true });
    expect(polozky[0].unit_price).toBe(826.45);
    const s = souhrnVyberu(vybrane, polozky);
    expect(s.soucetZakazek).toBe(2490);
    expect(s.faktura.total_rounded).toBe(2490);
    expect(cenaBezDph(1210, { sazba: 21, cenySDph: false })).toBe(1210);
  });

  it("rozpad na opravy: hodinová práce jako hodiny × sazba, sleva záporným řádkem, součet sedí", () => {
    const z = zakazka({
      code: "SRV26000200",
      opravy: [
        { name: "Diagnostika", price: 500 },
        { name: "Mikropájení", type: "hourly", hodiny: 1.5, sazba: 1200, price: 1800, technik: "Petr" },
      ],
      discountType: "percentage",
      discountValue: 10,
    });
    const vybrane = vyber([z]).kandidati;
    const polozky = sestavPolozky(vybrane, platce, true);
    expect(polozky.map((p) => p.name)).toEqual([
      "Zakázka SRV26000200 · iPhone 13 · Diagnostika",
      "Zakázka SRV26000200 · iPhone 13 · Mikropájení (Petr)",
      "Zakázka SRV26000200 · Sleva",
    ]);
    expect(polozky[1]).toMatchObject({ qty: 1.5, unit: "h", unit_price: 1200 });
    expect(polozky[2].unit_price).toBe(-230);
    const zakladRozpadu = polozky.reduce((s, p) => s + computeLine(p).line_total, 0);
    const zakladRadku = sestavPolozky(vybrane, platce).reduce((s, p) => s + computeLine(p).line_total, 0);
    expect(zakladRozpadu).toBe(zakladRadku);
    // Množství musí být kladné (constraint invoice_items_qty_kladne).
    expect(polozky.every((p) => p.qty > 0)).toBe(true);
  });

  it("dlouhý název se ořízne pod limit účetnictví", () => {
    const z = zakazka({ opravy: Array.from({ length: 30 }, (_, i) => ({ name: `Oprava číslo ${i + 1}`, price: 100 })) });
    const nazev = nazevRadkuZakazky(z);
    expect(nazev.length).toBeLessThanOrEqual(MAX_NAZEV_POLOZKY);
    expect(nazev.endsWith("…")).toBe(true);
  });

  it("vazby nesou konečnou cenu zakázky", () => {
    const z = zakazka({ discountType: "amount", discountValue: 100 });
    expect(vazbyZVyberu(vyber([z]).kandidati)).toEqual([{ ticket_id: z.id, castka: 1900 }]);
  });

  it("souhrnná faktura projde exportem do účetnictví stejně jako běžná", () => {
    const vybrane = vyber([zakazka({ opravy: [{ name: "Displej", price: 999.5 }] }), zakazka({ discountType: "amount", discountValue: 250 })]).kandidati;
    const polozky = sestavPolozky(vybrane, platce, true);
    const s = souhrnVyberu(vybrane, polozky);
    const radky = radkyProExport(polozky.map((p, i) => ({ ...p, sort_order: i })), s.faktura.rounding);
    // Po přičtení zaokrouhlení je základ v účetnictví stejný jako na dokladu (+ zaokrouhlení).
    expect(soucetRadku(radky)).toBeCloseTo(s.faktura.subtotal + s.faktura.rounding, 2);
    expect(radky.every((r) => r.name.length <= MAX_NAZEV_POLOZKY)).toBe(true);
  });
});

describe("mapování z databáze", () => {
  it("řádek tickets → zakázka, opravy bez názvu pryč, zařízení ze značky a modelu", () => {
    const z = zakazkaZRadku({
      id: "x",
      code: "SRV1",
      status: "",
      created_at: "2026-09-01",
      updated_at: null,
      completed_at: null,
      customer_id: null,
      customer_name: "Firma",
      customer_company: null,
      customer_ico: null,
      device_label: null,
      device_brand: "Apple",
      device_model: "iPhone 15",
      performed_repairs: [{ name: "Displej", price: "1500" }, { name: "" }, null, "x"],
      discount_type: "nesmysl",
      discount_value: null,
      branch_id: null,
    });
    expect(z.status).toBe("received");
    expect(z.deviceLabel).toBe("Apple iPhone 15");
    expect(z.opravy).toEqual([{ name: "Displej", type: undefined, price: 1500, hodiny: null, sazba: null, technik: null }]);
    expect(z.discountType).toBeNull();
    expect(opravyZJsonu(null)).toEqual([]);
  });
});
