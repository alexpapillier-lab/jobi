/**
 * Čísla ze serverové agregace Statistik.
 *
 * Databáze posílá součty přes JSON a peněžní hodnoty (`numeric`) přitom
 * často dorazí jako text. Kdyby se s nimi zacházelo jako s čísly rovnou,
 * ukázaly by se majiteli tržby jako „NaN Kč“ nebo by se sečetly jako
 * řetězce („1000“ + „500“ = 1000500).
 *
 * Když agregace selže, Statistiky se umí spočítat postaru v prohlížeči –
 * ale jen tehdy, když se sem chyba opravdu vyhodí. Tichá nula by majiteli
 * ukázala prázdný měsíc místo skutečných tržeb.
 */
import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { nactiStatistiky, nactiTechnici, type StatistikyDotaz } from "./statistikyServer";

const zaznamenane: Array<{ fn: string; args: Record<string, unknown> }> = [];

const klient = (odpoved: { data: unknown; error: unknown }) =>
  ({
    rpc: (fn: string, args: Record<string, unknown>) => {
      zaznamenane.push({ fn, args });
      return Promise.resolve(odpoved);
    },
  }) as unknown as SupabaseClient;

const dotaz = (o: Partial<StatistikyDotaz> = {}): StatistikyDotaz => ({
  serviceIds: ["servis-1"],
  od: null,
  do: null,
  branchId: null,
  drill: null,
  prevOd: null,
  prevDo: null,
  ...o,
});

describe("převod čísel z agregace", () => {
  it("peněžní hodnoty poslané jako text jsou po převodu čísla, ne řetězce", async () => {
    const p = await nactiStatistiky(
      klient({ data: { kpi: { totalRevenue: "125000.50", totalCosts: "40000", marginPct: "68.2" } }, error: null }),
      dotaz(),
    );
    expect(p.kpi.totalRevenue).toBe(125000.5);
    expect(p.kpi.totalCosts).toBe(40000);
    expect(p.kpi.marginPct).toBe(68.2);
  });

  it("chybějící nebo nesmyslná hodnota je nula, ne NaN na obrazovce", async () => {
    const p = await nactiStatistiky(klient({ data: { kpi: { totalRevenue: null, profit: "nic" } }, error: null }), dotaz());
    expect(p.kpi.totalRevenue).toBe(0);
    expect(p.kpi.profit).toBe(0);
    expect(p.kpi.totalTickets).toBe(0);
  });

  it("úplně prázdná odpověď dá nulová KPI, ne chybějící pole", async () => {
    const p = await nactiStatistiky(klient({ data: {}, error: null }), dotaz());
    expect(p.kpi.totalRevenue).toBe(0);
    expect(p.stavy).toEqual([]);
    expect(p.marzeOpravy).toEqual([]);
    expect(p.mesice).toEqual([]);
  });

  it("řádky marží se převedou i s příznakem chybějících nákladů", async () => {
    const p = await nactiStatistiky(
      klient({
        data: { marzeOpravy: [{ key: "r1", name: "Displej", count: "3", revenue: "6000", cost: "1800", margin: "4200", marginPct: "70", noCostData: false }] },
        error: null,
      }),
      dotaz(),
    );
    expect(p.marzeOpravy[0]).toEqual({
      key: "r1",
      name: "Displej",
      count: 3,
      revenue: 6000,
      cost: 1800,
      margin: 4200,
      marginPct: 70,
      noCostData: false,
    });
  });

  it("řádek, který nemá odkud vzít náklady, je označený", async () => {
    const p = await nactiStatistiky(klient({ data: { marzeOpravy: [{ key: "r1", noCostData: true }] }, error: null }), dotaz());
    expect(p.marzeOpravy[0].noCostData).toBe(true);
    expect(p.marzeOpravy[0].revenue).toBe(0);
  });

  it("hranice měsíců přijdou jako čas, nesmyslné datum jako „nevíme“", async () => {
    const s = await nactiStatistiky(klient({ data: { mesicOd: "2026-01-01T00:00:00Z" }, error: null }), dotaz());
    expect(s.mesicOd).toBe(Date.parse("2026-01-01T00:00:00Z"));
    const n = await nactiStatistiky(klient({ data: { mesicOd: "včera", mesicDo: 12345 }, error: null }), dotaz());
    expect(n.mesicOd).toBeNull();
    expect(n.mesicDo).toBeNull();
  });
});

describe("selhání agregace", () => {
  it("chybu z databáze vyhodí, aby Statistiky přešly na výpočet v prohlížeči", async () => {
    await expect(nactiStatistiky(klient({ data: null, error: { message: "funkce neexistuje" } }), dotaz())).rejects.toBeTruthy();
  });

  it("odpověď, která není objekt se součty, se nebere jako prázdné statistiky", async () => {
    await expect(nactiStatistiky(klient({ data: null, error: null }), dotaz())).rejects.toThrow();
    await expect(nactiStatistiky(klient({ data: [], error: null }), dotaz())).rejects.toThrow();
    await expect(nactiStatistiky(klient({ data: "hotovo", error: null }), dotaz())).rejects.toThrow();
  });
});

describe("parametry dotazu na agregaci", () => {
  it("posílá časové pásmo, jinak by zakázka z 1. ledna po půlnoci spadla do prosince", async () => {
    zaznamenane.length = 0;
    await nactiStatistiky(klient({ data: {}, error: null }), dotaz());
    expect(zaznamenane[0].args.p_tz).toBeTruthy();
  });

  it("rozsah období se posílá jako čas, prázdný rozsah jako nic", async () => {
    zaznamenane.length = 0;
    const od = new Date("2026-01-01T00:00:00Z");
    await nactiStatistiky(klient({ data: {}, error: null }), dotaz({ od, do: null }));
    expect(zaznamenane[0].args.p_od).toBe(od.toISOString());
    expect(zaznamenane[0].args.p_do).toBeNull();
  });

  it("rozpad na měsíc posílá rok a měsíc, jiný rozpad hodnotu", async () => {
    zaznamenane.length = 0;
    await nactiStatistiky(klient({ data: {}, error: null }), dotaz({ drill: { type: "month", year: 2026, month: 3 } }));
    expect(zaznamenane[0].args).toMatchObject({ p_drill_typ: "month", p_drill_rok: 2026, p_drill_mesic: 3, p_drill_hodnota: null });

    zaznamenane.length = 0;
    await nactiStatistiky(klient({ data: {}, error: null }), dotaz({ drill: { type: "status", value: "done" } }));
    expect(zaznamenane[0].args).toMatchObject({ p_drill_typ: "status", p_drill_hodnota: "done", p_drill_rok: null, p_drill_mesic: null });
  });

  it("bez rozpadu se neposílá ani typ, ani hodnota", async () => {
    zaznamenane.length = 0;
    await nactiStatistiky(klient({ data: {}, error: null }), dotaz());
    expect(zaznamenane[0].args).toMatchObject({ p_drill_typ: null, p_drill_hodnota: null, p_drill_rok: null, p_drill_mesic: null });
  });
});

describe("žebříček techniků", () => {
  const filtr = { serviceIds: ["servis-1"], od: null, do: null, branchId: null };

  it("odpracované hodiny a tržby přijaté jako text jsou čísla", async () => {
    const t = await nactiTechnici(
      klient({ data: [{ userId: "u1", name: "Petr", prijato: "12", dokonceno: "9", odpracovanoHodin: "37.5", hodiny: "40", trzbaHodin: "48000.5" }], error: null }),
      filtr,
    );
    expect(t[0]).toEqual({ userId: "u1", name: "Petr", prijato: 12, dokonceno: 9, odpracovanoHodin: 37.5, hodiny: 40, trzbaHodin: 48000.5 });
  });

  it("technik bez jména se v žebříčku pozná pomlčkou, ne slovem undefined", async () => {
    const t = await nactiTechnici(klient({ data: [{ userId: null }], error: null }), filtr);
    expect(t[0].name).toBe("—");
    expect(t[0].userId).toBeNull();
    expect(t[0].prijato).toBe(0);
  });

  it("neočekávaná odpověď dá prázdný žebříček, ne pád obrazovky", async () => {
    expect(await nactiTechnici(klient({ data: null, error: null }), filtr)).toEqual([]);
    expect(await nactiTechnici(klient({ data: { technici: [] }, error: null }), filtr)).toEqual([]);
  });

  it("chybu z databáze vyhodí, ať se nezobrazí prázdný žebříček místo výpadku", async () => {
    await expect(nactiTechnici(klient({ data: null, error: { message: "nemáte oprávnění" } }), filtr)).rejects.toBeTruthy();
  });
});
