/** Import provizí z Google tabulky (list RAW jako CSV). */
import { describe, expect, it } from "vitest";
import { cisloZTabulky, datumZTabulky, radkyZCsv } from "./provizeImport";

describe("cisloZTabulky", () => {
  it("čte české i anglické zápisy", () => {
    expect(cisloZTabulky("2190")).toBe(2190);
    expect(cisloZTabulky("2 190,50")).toBe(2190.5);
    expect(cisloZTabulky("2 190,50 Kč")).toBe(2190.5);
    expect(cisloZTabulky("2,190.50")).toBe(2190.5);
    expect(cisloZTabulky("164.25")).toBe(164.25);
    expect(cisloZTabulky("")).toBe(0);
    expect(cisloZTabulky("n/a")).toBe(0);
  });
});

describe("datumZTabulky", () => {
  it("M/d/yyyy H:mm:ss z Apps Scriptu i český zápis dají stejný okamžik", () => {
    const a = datumZTabulky("9/4/2026 15:42:57");
    const b = datumZTabulky("4.9.2026 15:42:57");
    expect(a).not.toBeNull();
    expect(a).toBe(b);
    expect(new Date(a!).getMonth()).toBe(8); // září, ne duben
  });

  it("prázdné a nečitelné je null", () => {
    expect(datumZTabulky("")).toBeNull();
    expect(datumZTabulky("kdysi")).toBeNull();
  });
});

describe("radkyZCsv", () => {
  const csv = [
    "zakazka_id,cena,provize,datum,vyuctovano,priznak,status",
    'IRPAZ2600241,2190,164.25,1/20/2026 10:00:00,2026-W04,,Vydáno',
    'IRPAZ2601247,0,0,8/1/2026 9:00:00,2026-W31,,Připraveno k převzetí',
    'IRPAZ2601247-DOPLATEK,"4 890,00","366,75",8/9/2026 9:00:00,,,Připraveno k převzetí',
    "IRPAZ2600300,1500,112.5,2/1/2026 8:00:00,,a,Vydáno",
    ",,,,,,",
    "SOUČET,999,,,,,",
  ].join("\n");

  it("převede řádky listu RAW včetně doplatku, příznaku a týdne", () => {
    const { radky, preskoceno } = radkyZCsv(csv);
    expect(radky.map((r) => r.id)).toEqual(["IRPAZ2600241", "IRPAZ2601247", "IRPAZ2601247-DOPLATEK", "IRPAZ2600300"]);
    expect(radky[0]).toMatchObject({ cena: 2190, provize: 164.25, tyden: "2026-W04", status: "Vydáno" });
    expect(radky[2]).toMatchObject({ cena: 4890, provize: 366.75, tyden: "" });
    expect(radky[3].priznak).toBe("a");
    expect(preskoceno).toBe(1); // řádek SOUČET; prázdný řádek zahodí už parser
  });

  it("tabulka bez hlavičky neztratí první zakázku", () => {
    const { radky } = radkyZCsv("IRP26000002,1590,119.25,9/17/2026 0:05:12,,,Vydáno\nIRP26000013,2490,186.75,9/18/2026 11:04:00,,,Vydáno");
    expect(radky.map((r) => r.id)).toEqual(["IRP26000002", "IRP26000013"]);
  });

  it("duplicitní číslo zakázky bere jen jednou", () => {
    const { radky, preskoceno } = radkyZCsv("id,cena\nIRP26000002,1590\nIRP26000002,1590");
    expect(radky).toHaveLength(1);
    expect(preskoceno).toBe(1);
  });
});
