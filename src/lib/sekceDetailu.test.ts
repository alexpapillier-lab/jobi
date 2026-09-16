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
  it("podbarví kartu barvou sekce a nechá pod ní pozadí motivu", () => {
    const s = stylSekce("opravy");
    expect(String(s.background)).toContain(BARVA_SEKCE.opravy);
    expect(String(s.background)).toContain("var(--panel)");
    expect(String(s.border)).toContain(BARVA_SEKCE.opravy);
  });
});
