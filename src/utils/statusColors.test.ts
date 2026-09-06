import { describe, it, expect } from "vitest";
import { STATUS_COLOR_PALETTE, getContrastText } from "./statusColors";

describe("STATUS_COLOR_PALETTE", () => {
  it("has 75 colors", () => {
    expect(STATUS_COLOR_PALETTE).toHaveLength(75);
  });

  it("each color has bg, fg, name", () => {
    for (const c of STATUS_COLOR_PALETTE) {
      expect(c.bg).toMatch(/^#[0-9A-Fa-f]{6}$/);
      expect(c.fg).toMatch(/^#[0-9A-Fa-f]{6}$/);
      expect(typeof c.name).toBe("string");
      expect(c.name.length).toBeGreaterThan(0);
    }
  });
});

describe("getContrastText", () => {
  it("returns dark text for light background", () => {
    expect(getContrastText("#FFFFFF")).toBe("#111827");
    expect(getContrastText("#F9FAFB")).toBe("#111827");
    expect(getContrastText("#FCD34D")).toBe("#111827");
  });

  it("returns light text for dark background", () => {
    expect(getContrastText("#000000")).toBe("#F9FAFB");
    expect(getContrastText("#111827")).toBe("#F9FAFB");
    expect(getContrastText("#1E3A8A")).toBe("#F9FAFB");
  });

  it("handles hex with or without #", () => {
    expect(getContrastText("FFFFFF")).toBe("#111827");
  });
});

/**
 * Barvu stavu si servis vybírá sám a text v odznaku se k ní dopočítá.
 * Když vyjde světlý text na světlém pozadí, odznak na kartě zakázky nikdo
 * u pultu nepřečte – a stav zakázky je to první, co technik hledá.
 */
describe("čitelnost textu na barvě stavu", () => {
  it("barva zapsaná malými písmeny se vyhodnotí stejně jako velkými", () => {
    expect(getContrastText("#ffffff")).toBe(getContrastText("#FFFFFF"));
    expect(getContrastText("#1e3a8a")).toBe(getContrastText("#1E3A8A"));
  });

  it("počítá se s tím, jak barvu vidí oko: zelená je světlá, modrá tmavá", () => {
    // Průměr složek by u obou vyšel stejně, přesto zelená září a modrá ne.
    expect(getContrastText("#00FF00")).toBe("#111827");
    expect(getContrastText("#0000FF")).toBe("#F9FAFB");
  });

  it("sytá červená se bere jako tmavá – světlý text na ní je čitelnější", () => {
    expect(getContrastText("#FF0000")).toBe("#F9FAFB");
  });

  it("šedé kolem poloviny se rozdělí, ne že by všechny spadly na jednu stranu", () => {
    expect(getContrastText("#777777")).toBe("#F9FAFB");
    expect(getContrastText("#888888")).toBe("#111827");
  });

  it("každá barva z nabídky dostane jeden ze dvou čitelných odstínů textu", () => {
    for (const c of STATUS_COLOR_PALETTE) {
      expect(["#111827", "#F9FAFB"]).toContain(getContrastText(c.bg));
    }
  });

  it("nabídka barev neobsahuje dvě stejná pozadí – v seznamu by nešly rozlišit", () => {
    const pozadi = STATUS_COLOR_PALETTE.map((c) => c.bg.toUpperCase());
    expect(new Set(pozadi).size).toBe(pozadi.length);
  });
});
