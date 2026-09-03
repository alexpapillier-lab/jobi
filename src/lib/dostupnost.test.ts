/**
 * Dostupnost skladu ve veřejném API.
 *
 * Testuje se odsud, protože edge funkce běží v Denu a vlastní testy nemá.
 * Soubor _shared/dostupnost.ts je proto záměrně bez Deno API.
 */
import { describe, it, expect } from "vitest";
import { dostupnost, rezimDostupnosti } from "../../supabase/functions/_shared/dostupnost";

describe("rezimDostupnosti", () => {
  it("bere jen povolené režimy", () => {
    expect(rezimDostupnosti("hidden")).toBe("hidden");
    expect(rezimDostupnosti("exact")).toBe("exact");
    expect(rezimDostupnosti("boolean")).toBe("boolean");
  });

  it("nesmysl z databáze spadne na boolean, ne na výjimku", () => {
    expect(rezimDostupnosti(null)).toBe("boolean");
    expect(rezimDostupnosti(undefined)).toBe("boolean");
    expect(rezimDostupnosti("EXACT")).toBe("boolean");
    expect(rezimDostupnosti(7)).toBe("boolean");
  });
});

describe("dostupnost", () => {
  it("v režimu hidden neposílá nic", () => {
    expect(dostupnost(5, "hidden")).toBeUndefined();
    expect(dostupnost(0, "hidden")).toBeUndefined();
  });

  it("v režimu boolean rozlišuje jen skladem / není", () => {
    expect(dostupnost(1, "boolean")).toBe("in_stock");
    expect(dostupnost(99, "boolean")).toBe("in_stock");
    expect(dostupnost(0, "boolean")).toBe("out_of_stock");
  });

  it("v režimu exact vrací číslo", () => {
    expect(dostupnost(12, "exact")).toBe(12);
    expect(dostupnost(0, "exact")).toBe(0);
  });

  // Záporný sklad vzniká ruční korekcí nebo rozdělanou zakázkou.
  it("záporný sklad ven nepustí", () => {
    expect(dostupnost(-3, "exact")).toBe(0);
    expect(dostupnost(-3, "boolean")).toBe("out_of_stock");
  });

  it("poradí si s hodnotou, která není číslo", () => {
    expect(dostupnost(null, "exact")).toBe(0);
    expect(dostupnost("8", "exact")).toBe(8);
    expect(dostupnost("nesmysl", "boolean")).toBe("out_of_stock");
    expect(dostupnost(2.7, "exact")).toBe(2);
  });
});
