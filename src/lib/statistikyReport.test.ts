/**
 * Report statistik e-mailem – období, termíny, nastavení a žebříčky.
 *
 * Funkce běží na serveru (supabase/functions/_shared/statistikyReport.ts);
 * tady se importují přímo, stejně jako `_shared/tokeny.ts` v apiVerejne.test.
 * Hranice měsíců přes přelom roku a přechod na letní čas jsou přesně to,
 * co se bez testu rozbije až v prosinci.
 */
import { describe, it, expect } from "vitest";
import {
  castiVPasmu,
  hodnotniZakaznici,
  isoTyden,
  jeCasOdeslat,
  jeStornoStav,
  korunyCele,
  nastaveniReportuZConfigu,
  nazevSouboru,
  normalizujEmaily,
  obdobiReportu,
  pravidelniZakaznici,
  procentniZmena,
  pulnocVPasmu,
  type ZakazkaProZebricek,
} from "../../supabase/functions/_shared/statistikyReport";
import { jeStornoStav as jeStornoVAplikaci } from "./stornoStav";

describe("nastaveniReportuZConfigu", () => {
  it("bez configu vrátí vypnutý měsíční report v 7 hodin", () => {
    expect(nastaveniReportuZConfigu(undefined)).toEqual({ zapnuto: false, frekvence: "mesicne", emaily: [], hodina: 7 });
  });

  it("přečte platné hodnoty a neplatné nahradí výchozími", () => {
    const n = nastaveniReportuZConfigu({ zapnuto: true, frekvence: "tydne", emaily: ["A@B.cz", " a@b.cz", "nesmysl", 5], hodina: "9" });
    expect(n).toEqual({ zapnuto: true, frekvence: "tydne", emaily: ["a@b.cz"], hodina: 9 });
    expect(nastaveniReportuZConfigu({ hodina: 99, frekvence: "denne" }).hodina).toBe(7);
    expect(nastaveniReportuZConfigu({ frekvence: "denne" }).frekvence).toBe("mesicne");
  });
});

describe("normalizujEmaily", () => {
  it("ořeže, sjednotí, odstraní duplicity a omezí počet", () => {
    expect(normalizujEmaily([" X@Y.cz ", "x@y.cz", "bez-zavinace", "z@w.io"])).toEqual(["x@y.cz", "z@w.io"]);
    expect(normalizujEmaily(Array.from({ length: 20 }, (_, i) => `u${i}@a.cz`))).toHaveLength(10);
    expect(normalizujEmaily("a@b.cz")).toEqual([]);
  });
});

describe("čas v Europe/Prague", () => {
  it("půlnoc v Praze je v zimě 23:00 UTC a v létě 22:00 UTC", () => {
    expect(pulnocVPasmu(2026, 1, 1).toISOString()).toBe("2025-12-31T23:00:00.000Z");
    expect(pulnocVPasmu(2026, 8, 1).toISOString()).toBe("2026-07-31T22:00:00.000Z");
  });

  it("nástěnné hodiny a den v týdnu", () => {
    // 2026-09-15 je úterý; 22:30 UTC = 0:30 středy v Praze.
    const c = castiVPasmu(new Date("2026-09-15T22:30:00Z"));
    expect([c.rok, c.mesic, c.den, c.hodina, c.denVTydnu]).toEqual([2026, 9, 16, 0, 3]);
  });

  it("ISO týden: 29. 12. 2025 je 1. týden roku 2026", () => {
    expect(isoTyden(new Date("2025-12-29T12:00:00Z"))).toEqual({ rok: 2026, tyden: 1 });
    expect(isoTyden(new Date("2026-08-31T12:00:00Z"))).toEqual({ rok: 2026, tyden: 36 });
  });
});

describe("obdobiReportu", () => {
  it("měsíční report 1. září pokrývá celý srpen a srovnává s červencem", () => {
    const o = obdobiReportu("mesicne", new Date("2026-09-01T05:20:00Z"));
    expect(o.od.toISOString()).toBe("2026-07-31T22:00:00.000Z");
    expect(o.do.toISOString()).toBe("2026-08-31T22:00:00.000Z");
    expect(o.klic).toBe("2026-08");
    expect(o.nazev).toBe("Srpen 2026");
    expect(o.predchoziNazev).toBe("Červenec 2026");
    expect(o.predchoziOd.toISOString()).toBe("2026-06-30T22:00:00.000Z");
  });

  it("přelom roku: v lednu je minulý měsíc prosinec a předminulý listopad", () => {
    const o = obdobiReportu("mesicne", new Date("2026-01-01T07:00:00Z"));
    expect(o.klic).toBe("2025-12");
    expect(o.nazev).toBe("Prosinec 2025");
    expect(o.predchoziNazev).toBe("Listopad 2025");
    const u = obdobiReportu("mesicne", new Date("2026-02-01T07:00:00Z"));
    expect(u.nazev).toBe("Leden 2026");
    expect(u.predchoziNazev).toBe("Prosinec 2025");
  });

  it("týdenní report v pondělí pokrývá minulé pondělí až neděli", () => {
    // Pondělí 7. 9. 2026 ráno → týden 36: 31. 8. – 6. 9.
    const o = obdobiReportu("tydne", new Date("2026-09-07T06:00:00Z"));
    expect(o.od.toISOString()).toBe("2026-08-30T22:00:00.000Z");
    expect(o.do.toISOString()).toBe("2026-09-06T22:00:00.000Z");
    expect(o.klic).toBe("2026-W36");
    expect(o.nazev).toBe("Týden 36 (31. 8. – 6. 9. 2026)");
    expect(o.predchoziNazev).toBe("Týden 35 (24. 8. – 30. 8. 2026)");
  });

  it("týden přes přechod na zimní čas má pořád půlnoční hranice", () => {
    // Pondělí 2. 11. 2026; minulý týden 26. 10. – 1. 11. obsahuje změnu času 25.→26.? ne – 25. 10. je neděle.
    const o = obdobiReportu("tydne", new Date("2026-11-02T08:00:00Z"));
    expect(o.od.toISOString()).toBe("2026-10-25T23:00:00.000Z");
    expect(o.do.toISOString()).toBe("2026-11-01T23:00:00.000Z");
    const p = obdobiReportu("tydne", new Date("2026-10-26T08:00:00Z"));
    // 19.–25. 10.: začíná v letním čase (22:00 UTC), končí v zimním (23:00 UTC).
    expect(p.od.toISOString()).toBe("2026-10-18T22:00:00.000Z");
    expect(p.do.toISOString()).toBe("2026-10-25T23:00:00.000Z");
  });

  it("aktuální období běží od začátku měsíce do teď a má vlastní klíč", () => {
    const ted = new Date("2026-09-15T10:00:00Z");
    const o = obdobiReportu("mesicne", ted, "aktualni");
    expect(o.od.toISOString()).toBe("2026-08-31T22:00:00.000Z");
    expect(o.do).toEqual(ted);
    expect(o.klic).toBe("2026-09-rozpracovano");
    expect(o.nazev).toBe("Září 2026 (do 15. 9. 2026)");
    expect(o.predchoziNazev).toBe("Srpen 2026");

    const t = obdobiReportu("tydne", ted, "aktualni");
    expect(t.klic).toBe("2026-W38-rozpracovano");
    expect(t.nazev).toBe("Týden 38 (14. 9. 2026 – do 15. 9. 2026)");
  });

  it("týden přes přelom roku nese rok u obou dat", () => {
    // Pondělí 4. 1. 2027 → minulý týden 28. 12. 2026 – 3. 1. 2027 (ISO týden 53 roku 2026).
    const o = obdobiReportu("tydne", new Date("2027-01-04T08:00:00Z"));
    expect(o.nazev).toBe("Týden 53 (28. 12. 2026 – 3. 1. 2027)");
    expect(o.klic).toBe("2026-W53");
  });
});

describe("jeCasOdeslat", () => {
  const zapnuto = { zapnuto: true, frekvence: "mesicne" as const, emaily: ["a@b.cz"], hodina: 7 };

  it("měsíčně: první den v měsíci od nastavené hodiny (pražského času)", () => {
    expect(jeCasOdeslat(zapnuto, new Date("2026-09-01T04:30:00Z"))).toBe(false); // 6:30 v Praze
    expect(jeCasOdeslat(zapnuto, new Date("2026-09-01T05:10:00Z"))).toBe(true); // 7:10 v Praze
    expect(jeCasOdeslat(zapnuto, new Date("2026-09-01T20:10:00Z"))).toBe(true); // ještě 1. 9.
    expect(jeCasOdeslat(zapnuto, new Date("2026-09-02T05:10:00Z"))).toBe(false);
    // 31. 12. 23:30 UTC už je v Praze 1. 1. 0:30 – před sedmou.
    expect(jeCasOdeslat(zapnuto, new Date("2025-12-31T23:30:00Z"))).toBe(false);
  });

  it("týdně: pondělí", () => {
    const t = { ...zapnuto, frekvence: "tydne" as const };
    expect(jeCasOdeslat(t, new Date("2026-09-07T06:00:00Z"))).toBe(true);
    expect(jeCasOdeslat(t, new Date("2026-09-08T06:00:00Z"))).toBe(false);
  });

  it("vypnutý report nebo bez příjemců nikdy", () => {
    expect(jeCasOdeslat({ ...zapnuto, zapnuto: false }, new Date("2026-09-01T10:00:00Z"))).toBe(false);
    expect(jeCasOdeslat({ ...zapnuto, emaily: [] }, new Date("2026-09-01T10:00:00Z"))).toBe(false);
  });
});

describe("čísla", () => {
  it("procentní změna a dělení nulou", () => {
    expect(procentniZmena(120, 100)).toBeCloseTo(20);
    expect(procentniZmena(80, 100)).toBeCloseTo(-20);
    expect(procentniZmena(50, 0)).toBeNull();
  });

  it("koruny celé s nedělitelnými mezerami", () => {
    expect(korunyCele(367478.4)).toBe("367 478 Kč");
    expect(korunyCele(NaN)).toBe("0 Kč");
  });

  it("název souboru", () => {
    const o = obdobiReportu("mesicne", new Date("2026-09-01T07:00:00Z"));
    expect(nazevSouboru(o, "IRP")).toBe("jobi-report-irp-2026-08.pdf");
    expect(nazevSouboru(o, null)).toBe("jobi-report-2026-08.pdf");
  });
});

describe("storno", () => {
  it("má stejnou definici jako aplikace", () => {
    for (const [k, n] of [["cancelled", "Zrušeno"], ["done", "Hotovo"], ["x", "Neopraveno"], ["storno", ""], ["received", "Přijato"]] as const) {
      expect(jeStornoStav(k, n)).toBe(jeStornoVAplikaci(k, n));
    }
  });
});

describe("žebříčky zákazníků", () => {
  const z = (customerName: string, prijem: number, vObdobi = true, customerId: string | null = null): ZakazkaProZebricek =>
    ({ customerId, customerName, prijem, vObdobi });

  it("hodnotní: podle obratu v období, s podílem na celku", () => {
    const v = hodnotniZakaznici([z("Jan", 100), z("Jan", 300), z("Eva", 500), z("Mimo", 9000, false), z("Nula", 0)]);
    expect(v.map((r) => [r.jmeno, r.pocet, r.obrat])).toEqual([["Eva", 1, 500], ["Jan", 2, 400]]);
    expect(v[0].podil).toBeCloseTo(55.6, 1);
  });

  it("stejné id spojí i při jiném zápisu jména, jméno spojí bez ohledu na velikost písmen", () => {
    const v = hodnotniZakaznici([z("Firma s.r.o.", 100, true, "c1"), z("FIRMA s.r.o.", 100, true, "c1"), z("petr", 50), z("Petr ", 50)]);
    expect(v.map((r) => [r.jmeno, r.pocet, r.obrat])).toEqual([["Firma s.r.o.", 2, 200], ["petr", 2, 100]]);
  });

  it("pravidelní: ≥2 v období nebo ≥3 za 12 měsíců", () => {
    const v = pravidelniZakaznici([
      z("Dva", 10), z("Dva", 10),
      z("Tri12", 5), z("Tri12", 5, false), z("Tri12", 5, false),
      z("Jeden", 100),
    ]);
    expect(v.map((r) => [r.jmeno, r.pocetVObdobi, r.pocet12m])).toEqual([["Dva", 2, 2], ["Tri12", 1, 3]]);
  });
});
