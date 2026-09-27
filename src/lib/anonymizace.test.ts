import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  MAX_POCET_LET,
  MIN_POCET_LET,
  POTVRZOVACI_SLOVO,
  anonymniJmeno,
  hraniceAnonymizace,
  jeAnonymniJmeno,
  jeNezaplacena,
  jeOtevrena,
  jePotvrzeni,
  nastaveniAnonymizaceZConfigu,
  normalizujPocetLet,
  pocetZakazniku,
  vyberKandidaty,
  type FakturaK,
  type ZakazkaK,
  type ZakaznikK,
} from "./anonymizace";

const TED = new Date("2026-09-27T10:00:00Z");
const zakaznik = (id: string, createdAt = "2026-01-01T00:00:00Z", o: Partial<ZakaznikK> = {}): ZakaznikK => ({ id, createdAt, ...o });
const zakazka = (id: string, customerId: string | null, createdAt: string, o: Partial<ZakazkaK> = {}): ZakazkaK => ({ id, customerId, createdAt, completedAt: null, otevrena: false, ...o });
const faktura = (o: Partial<FakturaK>): FakturaK => ({ customerId: null, ticketId: null, issueDate: "2019-01-01", status: "paid", paidAt: "2019-01-10", ...o });

const vyber = (v: Partial<Parameters<typeof vyberKandidaty>[0]>) =>
  vyberKandidaty({ zakaznici: [], zakazky: [], poLetech: 5, ted: TED, ...v });

describe("nastavení", () => {
  it("počet let jen celé číslo 3–10, jinak vypnuto", () => {
    expect(normalizujPocetLet(5)).toBe(5);
    expect(normalizujPocetLet(MIN_POCET_LET)).toBe(3);
    expect(normalizujPocetLet(MAX_POCET_LET)).toBe(10);
    expect(normalizujPocetLet(2)).toBeNull();
    expect(normalizujPocetLet(11)).toBeNull();
    expect(normalizujPocetLet(5.5)).toBeNull();
    expect(normalizujPocetLet("5")).toBeNull();
    expect(normalizujPocetLet(null)).toBeNull();
  });

  it("z configu gdpr, chybějící = vypnuto", () => {
    expect(nastaveniAnonymizaceZConfigu({ anonymizacePoLetech: 7 })).toEqual({ anonymizacePoLetech: 7 });
    expect(nastaveniAnonymizaceZConfigu(undefined)).toEqual({ anonymizacePoLetech: null });
    expect(nastaveniAnonymizaceZConfigu({ anonymizacePoLetech: null })).toEqual({ anonymizacePoLetech: null });
  });

  it("potvrzovací slovo bez ohledu na velikost písmen a mezery", () => {
    expect(jePotvrzeni(POTVRZOVACI_SLOVO)).toBe(true);
    expect(jePotvrzeni("  anonymizovat ")).toBe(true);
    expect(jePotvrzeni("anonymizuj")).toBe(false);
    expect(jePotvrzeni("")).toBe(false);
    expect(jePotvrzeni(null)).toBe(false);
  });

  it("anonymní jméno nese začátek id karty", () => {
    expect(anonymniJmeno("1a2b3c4d-0000-4000-8000-000000000000")).toBe("Anonymizovaný zákazník #1a2b3c4d");
    expect(anonymniJmeno(null)).toBe("Anonymizovaný zákazník");
    expect(jeAnonymniJmeno(anonymniJmeno("abc"))).toBe(true);
    expect(jeAnonymniJmeno("Jan Novák")).toBe(false);
  });
});

describe("hranice", () => {
  it("kalendářní roky zpět", () => {
    expect(hraniceAnonymizace(TED, 5).toISOString()).toBe("2021-09-27T10:00:00.000Z");
  });

  it("29. února jako Postgres – 28. února, ne 1. března", () => {
    expect(hraniceAnonymizace(new Date("2028-02-29T12:00:00Z"), 5).toISOString()).toBe("2023-02-28T12:00:00.000Z");
  });
});

describe("otevřená zakázka a nezaplacená faktura", () => {
  const koncove = new Set(["vydano", "storno"]);
  it("koncový stav nebo smazaná = uzavřená; neznámý stav = otevřená", () => {
    expect(jeOtevrena("vydano", null, koncove)).toBe(false);
    expect(jeOtevrena("oprava", null, koncove)).toBe(true);
    expect(jeOtevrena("oprava", "2020-01-01", koncove)).toBe(false);
    expect(jeOtevrena("", null, koncove)).toBe(true);
    expect(jeOtevrena(null, null, new Set(["received"]))).toBe(false);
  });

  it("nezaplacená je jen vystavená/odeslaná/po splatnosti bez úhrady", () => {
    expect(jeNezaplacena(faktura({ status: "issued", paidAt: null }))).toBe(true);
    expect(jeNezaplacena(faktura({ status: "overdue", paidAt: null }))).toBe(true);
    expect(jeNezaplacena(faktura({ status: "sent", paidAt: "2020-01-01" }))).toBe(false);
    expect(jeNezaplacena(faktura({ status: "draft", paidAt: null }))).toBe(false);
    expect(jeNezaplacena(faktura({ status: "cancelled", paidAt: null }))).toBe(false);
    expect(jeNezaplacena(faktura({ status: "issued", paidAt: null, deletedAt: "2020-01-01" }))).toBe(false);
  });
});

describe("kdo je kandidát", () => {
  it("poslední zakázka starší než N let → kandidát; mladší → ne", () => {
    const r = vyber({
      zakaznici: [zakaznik("stary"), zakaznik("novy")],
      zakazky: [zakazka("z1", "stary", "2019-05-01T00:00:00Z"), zakazka("z2", "novy", "2024-05-01T00:00:00Z")],
    });
    expect(r.zakaznici.map((z) => z.id)).toEqual(["stary"]);
    expect(r.zakaznici[0].posledniAktivita.toISOString()).toBe("2019-05-01T00:00:00.000Z");
    expect(r.vylouceni).toContainEqual({ id: "novy", duvod: "nedavna_aktivita" });
  });

  it("rozhoduje nejmladší zakázka, ne ta první", () => {
    const r = vyber({
      zakaznici: [zakaznik("c")],
      zakazky: [zakazka("a", "c", "2015-01-01T00:00:00Z"), zakazka("b", "c", "2023-01-01T00:00:00Z")],
    });
    expect(r.zakaznici).toEqual([]);
  });

  it("počítá i datum vydání: stará zakázka vydaná nedávno není stará", () => {
    const r = vyber({
      zakaznici: [zakaznik("c")],
      zakazky: [zakazka("z", "c", "2020-01-01T00:00:00Z", { completedAt: "2022-03-01T00:00:00Z" })],
    });
    expect(r.zakaznici).toEqual([]);
  });

  it("podle zakázek, ne podle karty: import dnes se starými zakázkami je kandidát", () => {
    const r = vyber({
      zakaznici: [zakaznik("import", "2026-09-20T00:00:00Z")],
      zakazky: [zakazka("z", "import", "2018-01-01T00:00:00Z", { completedAt: "2018-01-05T00:00:00Z" })],
    });
    expect(r.zakaznici.map((z) => z.id)).toEqual(["import"]);
  });

  it("karta bez jediné zakázky se řídí datem založení", () => {
    const r = vyber({ zakaznici: [zakaznik("cerstva", "2026-09-01T00:00:00Z"), zakaznik("stara", "2019-01-01T00:00:00Z")] });
    expect(r.zakaznici.map((z) => z.id)).toEqual(["stara"]);
  });

  it("otevřená zakázka zákazníka → nikdy, i když je deset let stará", () => {
    const r = vyber({
      zakaznici: [zakaznik("c")],
      zakazky: [zakazka("z", "c", "2012-01-01T00:00:00Z", { otevrena: true })],
      poLetech: 3,
    });
    expect(r.zakaznici).toEqual([]);
    expect(r.vylouceni).toContainEqual({ id: "c", duvod: "otevrena_zakazka" });
  });

  it("nezaplacená faktura → nikdy (i přes zakázku, i přímo na zákazníka)", () => {
    const pres = vyber({
      zakaznici: [zakaznik("c")],
      zakazky: [zakazka("z", "c", "2015-01-01T00:00:00Z")],
      faktury: [faktura({ ticketId: "z", issueDate: "2015-01-02", status: "overdue", paidAt: null })],
    });
    expect(pres.zakaznici).toEqual([]);
    expect(pres.vylouceni).toContainEqual({ id: "c", duvod: "nezaplacena_faktura" });

    const primo = vyber({
      zakaznici: [zakaznik("c", "2015-01-01T00:00:00Z")],
      faktury: [faktura({ customerId: "c", issueDate: "2015-01-02", status: "issued", paidAt: null })],
    });
    expect(primo.zakaznici).toEqual([]);
  });

  it("zaplacená stará faktura nevadí, nedávná faktura je aktivita", () => {
    const stara = vyber({
      zakaznici: [zakaznik("c")],
      zakazky: [zakazka("z", "c", "2015-01-01T00:00:00Z")],
      faktury: [faktura({ ticketId: "z", issueDate: "2015-01-02" })],
    });
    expect(stara.zakaznici.map((z) => z.id)).toEqual(["c"]);

    const nova = vyber({
      zakaznici: [zakaznik("c")],
      zakazky: [zakazka("z", "c", "2015-01-01T00:00:00Z")],
      faktury: [faktura({ customerId: "c", issueDate: "2025-06-01", paidAt: "2025-06-02" })],
    });
    expect(nova.zakaznici).toEqual([]);
  });

  it("otevřená nebo nedávná reklamace drží zákazníka (i přes zdrojovou zakázku)", () => {
    const otevrena = vyber({
      zakaznici: [zakaznik("c")],
      zakazky: [zakazka("z", "c", "2015-01-01T00:00:00Z")],
      reklamace: [{ customerId: null, sourceTicketId: "z", createdAt: "2015-06-01T00:00:00Z", otevrena: true }],
    });
    expect(otevrena.zakaznici).toEqual([]);

    const nedavna = vyber({
      zakaznici: [zakaznik("c")],
      zakazky: [zakazka("z", "c", "2015-01-01T00:00:00Z")],
      reklamace: [{ customerId: "c", createdAt: "2015-06-01T00:00:00Z", releasedAt: "2024-01-01T00:00:00Z", otevrena: false }],
    });
    expect(nedavna.zakaznici).toEqual([]);
  });

  it("už anonymizovaný se podruhé nepočítá", () => {
    const r = vyber({ zakaznici: [zakaznik("c", "2015-01-01T00:00:00Z", { anonymizovano: true })] });
    expect(r.zakaznici).toEqual([]);
    expect(r.vylouceni).toContainEqual({ id: "c", duvod: "uz_anonymizovan" });
  });

  it("hranice: přesně N let zpět ještě není kandidát, o chvilku dřív už ano", () => {
    const hranice = hraniceAnonymizace(TED, 5).toISOString();
    const tesne = new Date(Date.parse(hranice) - 1000).toISOString();
    const r = vyber({
      zakaznici: [zakaznik("presne"), zakaznik("tesne")],
      zakazky: [zakazka("a", "presne", hranice), zakazka("b", "tesne", tesne)],
    });
    expect(r.zakaznici.map((z) => z.id)).toEqual(["tesne"]);
  });

  it("zakázky bez karty zákazníka: stará uzavřená ano, otevřená, nedávná, dlužná nebo prázdná ne", () => {
    const r = vyber({
      zakazky: [
        zakazka("stara", null, "2018-01-01T00:00:00Z"),
        zakazka("otevrena", null, "2018-01-01T00:00:00Z", { otevrena: true }),
        zakazka("nedavna", null, "2025-01-01T00:00:00Z"),
        zakazka("dluzna", null, "2018-01-01T00:00:00Z"),
        zakazka("prazdna", null, "2018-01-01T00:00:00Z", { maOsobniUdaje: false }),
      ],
      faktury: [faktura({ ticketId: "dluzna", status: "sent", paidAt: null })],
    });
    expect(r.zakazkyBezKarty).toEqual(["stara"]);
  });
});

describe("čeština", () => {
  it("skloňování počtu", () => {
    expect(pocetZakazniku(1)).toBe("1 zákazník");
    expect(pocetZakazniku(3)).toBe("3 zákazníci");
    expect(pocetZakazniku(0)).toBe("0 zákazníků");
    expect(pocetZakazniku(12)).toBe("12 zákazníků");
  });
});

describe("databáze dělá totéž co tahle logika", () => {
  const sql = fs.readFileSync(path.resolve(__dirname, "../../supabase/migrations/20260927120000_anonymizace_zakazniku.sql"), "utf-8");

  it("stejné potvrzovací slovo, rozsah let a jméno", () => {
    expect(sql).toContain(`'${POTVRZOVACI_SLOVO}'`);
    expect(sql).toMatch(/between 3 and 10/);
    expect(sql).toContain("'Anonymizovaný zákazník'");
  });

  it("nezaplacené stavy faktur a koncové stavy zakázek", () => {
    expect(sql).toMatch(/status in \('issued', 'sent', 'overdue'\)/);
    expect(sql).toMatch(/is_final/);
  });

  it("faktur se anonymizace nedotkne", () => {
    expect(sql).not.toMatch(/update\s+public\.invoices/i);
    expect(sql).not.toMatch(/delete\s+from\s+public\.invoices/i);
    expect(sql).not.toMatch(/update\s+public\.invoice_items/i);
  });

  it("úložiště se nemaže přímo z SQL (Supabase to nedovolí), ale přes edge funkci", () => {
    expect(sql).not.toMatch(/delete\s+from\s+storage\.objects/i);
    const funkce = fs.readFileSync(path.resolve(__dirname, "../../supabase/functions/gdpr-anonymizace/index.ts"), "utf-8");
    expect(funkce).toMatch(/\.remove\(/);
    expect(funkce).toContain("diagnostic-photos");
  });

  it("první běh nikdy automaticky: cron potřebuje ruční potvrzení", () => {
    expect(sql).toMatch(/zdroj = 'rucne'/);
    expect(sql).toContain("První anonymizaci musí ručně potvrdit");
  });

  it("edge funkce je v config.toml bez JWT kontroly (volá ji pg_cron)", () => {
    const toml = fs.readFileSync(path.resolve(__dirname, "../../supabase/config.toml"), "utf-8");
    expect(toml).toMatch(/\[functions\.gdpr-anonymizace\]\s*\nverify_jwt = false/);
  });
});
