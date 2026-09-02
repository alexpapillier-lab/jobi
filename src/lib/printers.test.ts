/**
 * Parsování `lpstat -p` z JobiDocs.
 *
 * Testuje se odsud, protože testovací běh (vitest) má Jobi, ne JobiDocs.
 * Vstupy jsou doslovné výstupy `lpstat -p` z macOS.
 */
import { describe, it, expect } from "vitest";
import { parseLpstatP } from "../../jobidocs/api/printers";

// Skutečný výstup z /usr/bin/lpstat -p (macOS 26, 2. 9. 2026).
const REALNY_VYSTUP = `printer Brother_DCP_B7520DW_series is idle.  enabled since Sun Aug  9 10:41:31 2026
printer DOLNI is idle.  enabled since Fri Aug 14 23:25:04 2026
printer EPSON_M2120_Series is idle.  enabled since Sat Aug 22 21:31:38 2026`;

describe("parseLpstatP", () => {
  it("načte všechny tiskárny z reálného výstupu", () => {
    const p = parseLpstatP(REALNY_VYSTUP);
    expect(p.map((x) => x.name)).toEqual([
      "Brother_DCP_B7520DW_series",
      "DOLNI",
      "EPSON_M2120_Series",
    ]);
  });

  it("nenechá tečku ve stavu – kvůli ní hlásila každá tiskárna nedostupnost", () => {
    const p = parseLpstatP(REALNY_VYSTUP);
    expect(p.map((x) => x.status)).toEqual(["idle", "idle", "idle"]);
    expect(p.every((x) => x.available)).toBe(true);
  });

  it("bere idle, printing i ready jako dostupné", () => {
    const p = parseLpstatP(
      [
        "printer A is idle.  enabled since x",
        "printer B is printing.  enabled since x",
        "printer C is ready.  enabled since x",
      ].join("\n")
    );
    expect(p.map((x) => x.available)).toEqual([true, true, true]);
  });

  it("stav mimo seznam znamená nedostupnou tiskárnu", () => {
    const p = parseLpstatP("printer Z is stopped.  reason unknown");
    expect(p[0]).toMatchObject({ name: "Z", status: "stopped", available: false });
  });

  it("řádky, které nejsou tiskárna, ignoruje", () => {
    expect(parseLpstatP("lpstat: No destinations added.")).toEqual([]);
    expect(parseLpstatP("")).toEqual([]);
  });
});
