import { describe, expect, it } from "vitest";
import { BARVA_SEKCE, SKRYTELNE_SEKCE, normalizujSkryteSekce, stylSekce } from "./sekceDetailu";

describe("normalizujSkryteSekce", () => {
  it("bez configu nic neskrývá", () => {
    expect(normalizujSkryteSekce(undefined).size).toBe(0);
    expect(normalizujSkryteSekce("portal").size).toBe(0);
  });

  it("vezme jen známé klíče", () => {
    const s = normalizujSkryteSekce(["portal", "kontrola", "zakaznik", 42, null, "opravy"]);
    expect([...s].sort()).toEqual(["kontrola", "portal"]);
  });

  it("každá skrytelná sekce má název a barvu", () => {
    for (const s of SKRYTELNE_SEKCE) {
      expect(s.nazev).toBeTruthy();
      expect(BARVA_SEKCE[s.klic]).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});

describe("stylSekce", () => {
  it("dá proužek v barvě sekce", () => {
    expect(stylSekce("opravy").borderLeft).toBe(`4px solid ${BARVA_SEKCE.opravy}`);
  });
});
