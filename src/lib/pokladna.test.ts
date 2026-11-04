import { describe, expect, it } from "vitest";
import {
  chybiUzaverka,
  csvPohybu,
  ctiCastku,
  kategorieKNabidce,
  kolikVratit,
  normalizujNastaveniPokladny,
  poDnech,
  sestavKZaplaceni,
  soucetPlatidel,
  souhrnPohybu,
  stavPoZaplaceni,
  stornovane,
  zaokrouhliHotovost,
  zaplacenoPodleZakazek,
  type FakturaProPokladnu,
  type PohybPokladny,
  type ZakazkaProPokladnu,
} from "./pokladna";

let n = 0;
const pohyb = (p: Partial<PohybPokladny>): PohybPokladny => ({
  id: `h${++n}`, pokladnaId: "a", smer: "prijem", castka: 100, zpusob: "cash", druh: "prijem", puvodniDruh: null, kategorie: null, popis: null,
  ticketId: null, invoiceId: null, zaokrouhleni: 0, prevodId: null, stornoId: null, uzaverkaId: null, createdAt: "2026-11-04T10:00:00Z", createdBy: "u1",
  ...p,
});

describe("částky", () => {
  it("hotovost na celé koruny, zaokrouhlení se pamatuje", () => {
    expect(zaokrouhliHotovost(1249.5)).toEqual({ castka: 1250, zaokrouhleni: 0.5 });
    expect(zaokrouhliHotovost(1249.49)).toEqual({ castka: 1249, zaokrouhleni: -0.49 });
    expect(zaokrouhliHotovost(990)).toEqual({ castka: 990, zaokrouhleni: 0 });
  });

  it("součet bankovek a mincí, nesmysly se ignorují", () => {
    expect(soucetPlatidel({ "5000": 1, "200": 3, "1": 4 })).toBe(5604);
    expect(soucetPlatidel({ "100": "2", "50": -1, "3": 10, "20": "x" })).toBe(200);
  });

  it("vrátit zákazníkovi", () => {
    expect(kolikVratit(1250, 2000)).toBe(750);
    expect(kolikVratit(1250, 1000)).toBeNull();
    expect(kolikVratit(1250, null)).toBeNull();
  });

  it("částka z pole", () => {
    expect(ctiCastku("1 250,50 Kč")).toBe(1250.5);
    expect(ctiCastku("99.9")).toBe(99.9);
    expect(ctiCastku("")).toBeNull();
    expect(ctiCastku("-5")).toBeNull();
    expect(ctiCastku("abc")).toBeNull();
  });
});

describe("souhrn pohybů", () => {
  it("tržba podle způsobu, výdaje, změna hotovosti; převod a rozdíl nejsou tržba", () => {
    const s = souhrnPohybu([
      pohyb({ druh: "zakazka", castka: 1250, zpusob: "cash" }),
      pohyb({ druh: "zakazka", castka: 800, zpusob: "card" }),
      pohyb({ druh: "vydej", smer: "vydej", castka: 150 }),
      pohyb({ druh: "prevod", smer: "vydej", castka: 300, prevodId: "p" }),
      pohyb({ druh: "rozdil", smer: "vydej", castka: 10 }),
      pohyb({ druh: "vklad", castka: 1000 }),
    ]);
    expect(s.trzba).toEqual({ cash: 1250, card: 800, transfer: 0 });
    expect(s.trzbaCelkem).toBe(2050);
    expect(s.vydaje).toBe(150);
    expect(s.zmenaHotovosti).toBe(1250 - 150 - 300 - 10 + 1000);
    expect(s.plateb).toBe(2);
  });

  it("storno se odečte od druhu, který ruší", () => {
    const s = souhrnPohybu([
      pohyb({ id: "x", druh: "zakazka", castka: 1250 }),
      pohyb({ druh: "storno", puvodniDruh: "zakazka", smer: "vydej", castka: 1250, stornoId: "x" }),
      pohyb({ id: "y", druh: "vydej", smer: "vydej", castka: 200 }),
      pohyb({ druh: "storno", puvodniDruh: "vydej", smer: "prijem", castka: 200, stornoId: "y" }),
    ]);
    expect(s.trzbaCelkem).toBe(0);
    expect(s.vydaje).toBe(0);
    expect(s.zmenaHotovosti).toBe(0);
  });

  it("stornované pohyby a dny", () => {
    const xs = [pohyb({ id: "x" }), pohyb({ druh: "storno", puvodniDruh: "prijem", smer: "vydej", stornoId: "x" })];
    expect([...stornovane(xs)]).toEqual(["x"]);
    const dny = poDnech([pohyb({ createdAt: "2026-11-03T10:00:00Z", castka: 50 }), pohyb({ createdAt: "2026-11-04T10:00:00Z", castka: 70 })]);
    expect(dny.map((d) => [d.den, d.trzba])).toEqual([["2026-11-04", 70], ["2026-11-03", 50]]);
  });
});

describe("zaplaceno na zakázku", () => {
  it("bez zaokrouhlení, záloha se přičte, storno odečte stejnou částku", () => {
    const m = zaplacenoPodleZakazek([
      pohyb({ druh: "zaloha", ticketId: "t", castka: 500 }),
      pohyb({ druh: "zakazka", ticketId: "t", castka: 750, zaokrouhleni: 0.5 }),
      pohyb({ druh: "storno", puvodniDruh: "zakazka", smer: "vydej", ticketId: "t", castka: 750, zaokrouhleni: 0.5 }),
      pohyb({ druh: "prijem", ticketId: "t", castka: 99 }),
    ]);
    expect(m.get("t")).toBe(500);
  });
});

describe("k zaplacení", () => {
  const zakazka = (z: Partial<ZakazkaProPokladnu>): ZakazkaProPokladnu => ({
    id: "t1", code: "Z1", title: "iPhone 13", customerName: "Jan", status: "ready", branchId: null,
    performedRepairs: [{ price: 1000 }, { price: 500 }], discountType: "percentage", discountValue: 10, ...z,
  });
  const faktura = (f: Partial<FakturaProPokladnu>): FakturaProPokladnu => ({ id: "f1", number: "FV1", total: 1600, status: "issued", customerName: "Jan", branchId: null, ticketIds: [], ...f });

  it("cena zakázky po slevě, záloha snižuje zbytek", () => {
    const k = sestavKZaplaceni([zakazka({})], [], new Map([["t1", 350]]));
    expect(k).toHaveLength(1);
    expect(k[0]).toMatchObject({ ticketId: "t1", invoiceId: null, celkem: 1350, zaplaceno: 350, zbyva: 1000 });
  });

  it("vlastní nezaplacená faktura určuje částku; zaplacená zakázku vyřadí", () => {
    expect(sestavKZaplaceni([zakazka({})], [faktura({ ticketIds: ["t1"] })], new Map())[0]).toMatchObject({ invoiceId: "f1", celkem: 1600 });
    expect(sestavKZaplaceni([zakazka({})], [faktura({ ticketIds: ["t1"], status: "paid" })], new Map())).toEqual([]);
  });

  it("souhrnná faktura se platí jako faktura, faktura bez zakázky taky", () => {
    const k = sestavKZaplaceni(
      [zakazka({}), zakazka({ id: "t2", code: "Z2" })],
      [faktura({ ticketIds: ["t1", "t2"] }), faktura({ id: "f2", number: "FV2", total: 300 })],
      new Map(),
    );
    expect(k.map((x) => x.klic)).toEqual(["f:f1", "f:f2"]);
    expect(k[0].nazev).toContain("Souhrnná");
  });

  it("zaplacená zakázka zmizí, zakázka bez ceny zůstane (cena se doplní při placení)", () => {
    expect(sestavKZaplaceni([zakazka({})], [], new Map([["t1", 1350]]))).toEqual([]);
    expect(sestavKZaplaceni([zakazka({ performedRepairs: [] })], [], new Map())).toHaveLength(1);
  });
});

describe("nastavení", () => {
  const stavy = [
    { key: "ready", label: "Připraveno k převzetí", isFinal: false },
    { key: "cancelled", label: "Stornováno", isFinal: true },
    { key: "done", label: "Vydáno", isFinal: true },
  ];

  it("výchozí hodnoty", () => {
    expect(normalizujNastaveniPokladny(undefined)).toEqual({ zapnuto: false, stavPoPlatbe: null, zaokrouhlovat: true, od: null, upozorneni: true });
    expect(normalizujNastaveniPokladny({ pokladna: true, pokladna_od: "2026-11-04", pokladna_zaokrouhlovat: false }).od).toBe("2026-11-04");
  });

  it("stav po zaplacení: vybraný, žádný, nebo sám najde Vydáno (ne storno)", () => {
    expect(stavPoZaplaceni({ stavPoPlatbe: null }, stavy)).toBe("done");
    expect(stavPoZaplaceni({ stavPoPlatbe: "" }, stavy)).toBeNull();
    expect(stavPoZaplaceni({ stavPoPlatbe: "ready" }, stavy)).toBe("ready");
    expect(stavPoZaplaceni({ stavPoPlatbe: "smazany" }, stavy)).toBe("done");
  });

  it("kategorie: naposledy použité první, bez duplicit", () => {
    const k = kategorieKNabidce([pohyb({ druh: "vydej", kategorie: "Nájem", createdAt: "2026-11-04T09:00:00Z" }), pohyb({ druh: "vydej", kategorie: "díly" })], "vydej");
    expect(k.slice(0, 3)).toEqual(["díly", "Nájem", "Poštovné"]);
  });
});

describe("export", () => {
  it("CSV se středníky, čárkou v číslech a stornem s druhem", () => {
    const csv = csvPohybu(
      [pohyb({ druh: "zakazka", castka: 1250, ticketId: "t", popis: 'a;"b"' }), pohyb({ druh: "storno", puvodniDruh: "zakazka", smer: "vydej", castka: 1250, createdAt: "2026-11-04T11:00:00Z" })],
      () => "Pult", () => "Jana", () => "Z1",
    );
    const radky = csv.replace("﻿", "").split("\r\n");
    expect(radky[0]).toContain("Datum;Čas;Pokladna");
    expect(radky[1]).toContain(';Platba zakázky;;"a;""b""";Z1;Hotově;1250,00;;;Jana');
    expect(radky[2]).toContain("Storno – Platba zakázky");
  });
});

describe("chybí uzávěrka", () => {
  it("jen když je starší hotovost po poslední uzávěrce", () => {
    expect(chybiUzaverka(null, undefined)).toBe(false);
    expect(chybiUzaverka(null, "2026-11-03T10:00:00Z")).toBe(true);
    expect(chybiUzaverka("2026-11-03T18:00:00Z", "2026-11-03T10:00:00Z")).toBe(false);
    expect(chybiUzaverka("2026-11-02T18:00:00Z", "2026-11-03T10:00:00Z")).toBe(true);
  });
});
