import { describe, it, expect } from "vitest";
import { sloucZakazkuZDb, zapisZakazkyBezi, zacniZapis, ukonciZapis, type EvidenceZapisu } from "./slouceniZakazky";

/**
 * Chyba z 5. 9.: majitel přidal opravu (rezervace dílu vznikla hned), technik
 * mezitím změnil stav, realtime přinesl řádek s opravami o krok pozadu a
 * přepsal je. Rezervace zůstala bez opravy a při Dokončeno se odečetl díl
 * za opravu, kterou zakázka neměla. Tohle je jediné místo, které rozhoduje,
 * kdy se řádek z databáze převezme celý a kdy se opravy podrží místní.
 */

type Z = { id: string; status: string; performedRepairs?: string[]; testChecklist?: string; loaner?: string };

const mistni: Z = { id: "z1", status: "received", performedRepairs: ["displej"], testChecklist: "ok", loaner: "iPhone" };
const zDb: Z = { id: "z1", status: "in_progress", performedRepairs: [], testChecklist: undefined, loaner: undefined };

function evidence(cast: Partial<{ bezici: [string, number][]; odlozene: string[]; neulozene: string[] }> = {}): EvidenceZapisu {
  return {
    bezici: new Map(cast.bezici ?? []),
    odlozene: new Set(cast.odlozene ?? []),
    neulozene: new Set(cast.neulozene ?? []),
  };
}

describe("sloučení zakázky z databáze s místním stavem", () => {
  it("bez rozpracovaného zápisu se řádek z databáze převezme celý", () => {
    expect(sloucZakazkuZDb(mistni, zDb, evidence(), "z1")).toBe(zDb);
  });

  it("dokud zápis oprav běží, změna stavu od kolegy nepřepíše místní opravy", () => {
    const v = sloucZakazkuZDb(mistni, zDb, evidence({ bezici: [["z1", 1]] }), "z1");
    expect(v.status).toBe("in_progress");
    expect(v.performedRepairs).toEqual(["displej"]);
    expect(v.testChecklist).toBe("ok");
    expect(v.loaner).toBe("iPhone");
  });

  it("odložený zápis (úprava ceny čeká 400 ms) drží místní opravy stejně", () => {
    expect(sloucZakazkuZDb(mistni, zDb, evidence({ odlozene: ["z1"] }), "z1").performedRepairs).toEqual(["displej"]);
  });

  it("opravy po neúspěšném zápisu čekají na zavření detailu a realtime je nesmí zahodit", () => {
    expect(sloucZakazkuZDb(mistni, zDb, evidence({ neulozene: ["z1"] }), "z1").performedRepairs).toEqual(["displej"]);
  });

  it("evidence je podle zakázky – zápis jiné zakázky nic nedrží", () => {
    expect(sloucZakazkuZDb(mistni, zDb, evidence({ bezici: [["z2", 1]], odlozene: ["z2"], neulozene: ["z2"] }), "z1")).toBe(zDb);
  });

  it("při dotažení detailu se drží jen opravy – řádek seznamu kontrolu ani zápůjčku nenese", () => {
    const radekSeznamu: Z = { id: "z1", status: "received", performedRepairs: ["displej"] };
    const plna: Z = { ...zDb, testChecklist: "z databáze", loaner: "Galaxy" };
    const v = sloucZakazkuZDb(radekSeznamu, plna, evidence({ bezici: [["z1", 1]] }), "z1", ["performedRepairs"]);
    expect(v.performedRepairs).toEqual(["displej"]);
    expect(v.testChecklist).toBe("z databáze");
    expect(v.loaner).toBe("Galaxy");
  });

  it("bez místní verze se vrátí řádek z databáze, i když je zápis v evidenci", () => {
    expect(sloucZakazkuZDb(undefined, zDb, evidence({ bezici: [["z1", 1]] }), "z1")).toBe(zDb);
  });

  it("počítadlo přežije několik kliknutí za sebou a vyřadí zakázku až s posledním", () => {
    const bezici = new Map<string, number>();
    const ev: EvidenceZapisu = { bezici, odlozene: new Set(), neulozene: new Set() };
    zacniZapis(bezici, "z1");
    zacniZapis(bezici, "z1");
    ukonciZapis(bezici, "z1");
    expect(zapisZakazkyBezi("z1", ev)).toBe(true);
    ukonciZapis(bezici, "z1");
    expect(zapisZakazkyBezi("z1", ev)).toBe(false);
    expect(bezici.has("z1")).toBe(false);
  });

  it("odečet bez předchozího přičtení nezanechá záporné počítadlo", () => {
    const bezici = new Map<string, number>();
    ukonciZapis(bezici, "z1");
    expect(bezici.has("z1")).toBe(false);
  });
});
