/**
 * Úseky práce – co se počítá jako odvedený čas.
 *
 * Podle těchhle hodin se v KPI techniků porovnávají lidi. Dva způsoby, jak
 * z nich udělat nesmysl, jsou v provozu doložené: zapomenuté stopky (jediný
 * neuzavřený úsek udělal z 2,5 hodiny za leden 282,5) a práce přes hranici
 * období (úsek 23:30–00:30 zmizel z obou měsíců).
 *
 * Stejné pravidlo má `public.statistiky_technici` v databázi.
 */
import { describe, it, expect } from "vitest";
import {
  MAX_OTEVRENY_USEK_HODIN,
  MAX_OTEVRENY_USEK_SEKUND,
  jeZapomenuty,
  sekundyCelkem,
  sekundyVObdobi,
} from "./usekyPrace";

const H = 3600;
/** Pomocník: pražský čas jako ISO s posunem, ať je v testu vidět, o co jde. */
const usek = (od: string, do_: string | null) => ({ started_at: od, ended_at: do_ });

describe("uzavřený úsek", () => {
  it("se počítá přesně", () => {
    expect(sekundyVObdobi(usek("2026-01-10T08:00:00+01:00", "2026-01-10T10:30:00+01:00"))).toBe(2.5 * H);
  });

  it("se ořízne na hranici období – práce přes půlnoc patří oběma dnům", () => {
    const noc = usek("2026-01-15T23:30:00+01:00", "2026-01-16T00:30:00+01:00");
    const patnacteho = { od: new Date("2026-01-15T00:00:00+01:00"), do: new Date("2026-01-15T23:59:59.999+01:00") };
    const sestnacteho = { od: new Date("2026-01-16T00:00:00+01:00"), do: new Date("2026-01-16T23:59:59.999+01:00") };
    const ted = Date.parse("2026-02-01T12:00:00+01:00");

    expect(sekundyVObdobi(noc, patnacteho.od, patnacteho.do, ted)).toBe(30 * 60);
    expect(sekundyVObdobi(noc, sestnacteho.od, sestnacteho.do, ted)).toBe(30 * 60);
  });

  it("který začal před obdobím a skončil v něm, se nezahazuje celý", () => {
    // Dřív se filtrovalo podle `started_at`, takže tenhle úsek nepatřil nikam.
    const silvestr = usek("2025-12-31T22:00:00+01:00", "2026-01-01T02:00:00+01:00");
    const leden = { od: new Date("2026-01-01T00:00:00+01:00"), do: new Date("2026-01-31T23:59:59.999+01:00") };
    expect(sekundyVObdobi(silvestr, leden.od, leden.do, Date.parse("2026-02-01T12:00:00+01:00"))).toBe(2 * H);
  });

  it("mimo období nedá nic (a nikdy zápor)", () => {
    const u = usek("2026-03-01T08:00:00+01:00", "2026-03-01T09:00:00+01:00");
    const leden = { od: new Date("2026-01-01T00:00:00+01:00"), do: new Date("2026-01-31T23:59:59.999+01:00") };
    expect(sekundyVObdobi(u, leden.od, leden.do, Date.parse("2026-06-01T00:00:00+01:00"))).toBe(0);
  });
});

describe("běžící úsek", () => {
  it("se počítá do teď, dokud je to věrohodná směna", () => {
    const bezi = usek("2026-01-20T08:00:00+01:00", null);
    expect(sekundyVObdobi(bezi, null, null, Date.parse("2026-01-20T11:00:00+01:00"))).toBe(3 * H);
  });

  it("zapomenutý se počítá nejvýš jednu směnu, ne do konce období", () => {
    // Přesně tohle udělalo z 2,5 h za leden 282,5 h: stopky spuštěné 20. 1.,
    // které nikdo nezastavil, „dorostly“ do 31. 1.
    const zapomenuty = usek("2026-01-20T08:00:00+01:00", null);
    const leden = { od: new Date("2026-01-01T00:00:00+01:00"), do: new Date("2026-01-31T23:59:59.999+01:00") };
    const hodin = sekundyVObdobi(zapomenuty, leden.od, leden.do, Date.parse("2026-09-07T05:00:00+02:00")) / H;
    expect(hodin).toBe(MAX_OTEVRENY_USEK_HODIN);
    expect(hodin).toBeLessThan(280);
  });

  it("se nepočítá dopředu za dnešek, i když období sahá dál", () => {
    const bezi = usek("2026-09-07T08:00:00+02:00", null);
    const zari = { od: new Date("2026-09-01T00:00:00+02:00"), do: new Date("2026-09-30T23:59:59.999+02:00") };
    expect(sekundyVObdobi(bezi, zari.od, zari.do, Date.parse("2026-09-07T10:00:00+02:00"))).toBe(2 * H);
  });

  it("jeZapomenuty pozná jen ten, co běží přes strop", () => {
    const ted = Date.parse("2026-01-20T12:00:00+01:00");
    expect(jeZapomenuty(usek("2026-01-20T08:00:00+01:00", null), ted)).toBe(false);
    expect(jeZapomenuty(usek("2026-01-18T08:00:00+01:00", null), ted)).toBe(true);
    expect(jeZapomenuty(usek("2026-01-01T08:00:00+01:00", "2026-01-19T08:00:00+01:00"), ted)).toBe(false);
  });
});

describe("součet za víc úseků", () => {
  it("sečte uzavřené přesně a otevřený se stropem", () => {
    const ted = Date.parse("2026-09-07T05:00:00+02:00");
    const leden = { od: new Date("2026-01-01T00:00:00+01:00"), do: new Date("2026-01-31T23:59:59.999+01:00") };
    const useky = [
      usek("2026-01-10T08:00:00+01:00", "2026-01-10T10:30:00+01:00"), // 2,5 h
      usek("2026-01-20T08:00:00+01:00", null), // zapomenuté → strop
    ];
    expect(sekundyCelkem(useky, leden.od, leden.do, ted)).toBe(2.5 * H + MAX_OTEVRENY_USEK_SEKUND);
  });

  it("nesmyslné datum nic nerozbije", () => {
    expect(sekundyVObdobi(usek("nesmysl", null))).toBe(0);
    expect(sekundyCelkem([])).toBe(0);
  });
});
