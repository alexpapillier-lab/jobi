import { describe, expect, it } from "vitest";
import { jeMesicPripsan, kodMesicni, poznamkaPrepoctu, prepocetNaKc } from "./provizeMesicni";

describe("měsíční připomínka provizí", () => {
  it("kód podle měsíce", () => {
    expect(kodMesicni(new Date(2026, 10, 4))).toBe("MESICNI-2026-11");
    expect(kodMesicni(new Date(2027, 0, 31))).toBe("MESICNI-2027-01");
  });

  it("připsáno = existuje řádek s kódem měsíce", () => {
    const d = new Date(2026, 10, 15);
    expect(jeMesicPripsan([{ kod: "IRP26000001" }], d)).toBe(false);
    expect(jeMesicPripsan([{ kod: "MESICNI-2026-11" }], d)).toBe(true);
    expect(jeMesicPripsan([{ kod: "MESICNI-2026-10" }], d)).toBe(false);
  });

  it("přepočet na haléře a poznámka", () => {
    expect(prepocetNaKc(15, 21.762)).toBe(326.43);
    expect(poznamkaPrepoctu(15, "USD", 21.762, "2026-11-03")).toBe("15 USD × 21,762 Kč (ČNB 3. 11. 2026)");
    expect(poznamkaPrepoctu(15, "USD", 21.762, null)).toBe("15 USD × 21,762 Kč");
  });
});
