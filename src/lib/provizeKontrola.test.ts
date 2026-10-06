import { describe, it, expect } from "vitest";
import { maNejasneOpravy, prectiCastku, rozhodnuti } from "./provizeKontrola";

const zaklad = { ke_kontrole: false, nejasne_opravy: ["Výměna baterie + servisní čištění"], rucni_zaklad: null, pocitat_vse: false, zkontrolovano_at: null };

describe("rozhodnuti", () => {
  it("ke kontrole čeká, i kdyby tam zůstalo staré rozhodnutí", () => {
    expect(rozhodnuti({ ...zaklad, ke_kontrole: true, pocitat_vse: true })).toBe("ceka");
  });

  it("ruční částka má přednost před plnou cenou, jako v synchronizaci", () => {
    expect(rozhodnuti({ ...zaklad, rucni_zaklad: "500.00", pocitat_vse: true })).toBe("castka");
    expect(rozhodnuti({ ...zaklad, rucni_zaklad: 0 })).toBe("castka");
  });

  it("plně a bez vyloučených", () => {
    expect(rozhodnuti({ ...zaklad, pocitat_vse: true })).toBe("plne");
    expect(rozhodnuti({ ...zaklad, zkontrolovano_at: "2026-10-05T10:00:00Z" })).toBe("bez");
  });
});

describe("maNejasneOpravy", () => {
  it("pozná prázdný seznam i null", () => {
    expect(maNejasneOpravy(zaklad)).toBe(true);
    expect(maNejasneOpravy({ nejasne_opravy: [] })).toBe(false);
    expect(maNejasneOpravy({ nejasne_opravy: null })).toBe(false);
  });
});

describe("prectiCastku", () => {
  it("bere české i ručně psané tvary", () => {
    expect(prectiCastku("1 490,50 Kč", null)).toEqual({ ok: true, castka: 1490.5 });
    expect(prectiCastku("500", 2000)).toEqual({ ok: true, castka: 500 });
    expect(prectiCastku("0", 2000)).toEqual({ ok: true, castka: 0 });
  });

  it("odmítne prázdné, nečíslo, záporné a víc než cena zakázky", () => {
    expect(prectiCastku("", 100)).toEqual({ ok: false, chyba: "Zadejte částku." });
    expect(prectiCastku("hodně", 100)).toEqual({ ok: false, chyba: "„hodně“ není číslo." });
    expect(prectiCastku("-5", 100)).toEqual({ ok: false, chyba: "Částka nesmí být záporná." });
    expect(prectiCastku("101", 100)).toEqual({ ok: false, chyba: "Částka je vyšší než cena celé zakázky." });
  });
});
