/**
 * Tokeny veřejného API.
 *
 * Testuje se odsud, protože edge funkce běží v Denu a vlastní testy nemá.
 * Soubor _shared/tokeny.ts je proto záměrně bez Deno API.
 */
import { describe, it, expect } from "vitest";
import { novyToken, otisk, nahled, ocistiRozsahy, jeRozsah, modulProRozsah, PREFIX } from "../../supabase/functions/_shared/tokeny";

describe("novyToken", () => {
  it("má poznatelný prefix a plnou délku", () => {
    const t = novyToken();
    expect(t.startsWith(PREFIX)).toBe(true);
    expect(t.length).toBe(PREFIX.length + 64); // 32 bajtů v hex
  });

  it("dva tokeny po sobě nejsou stejné", () => {
    const a = new Set(Array.from({ length: 50 }, () => novyToken()));
    expect(a.size).toBe(50);
  });
});

describe("otisk", () => {
  it("je stabilní pro stejný vstup", async () => {
    expect(await otisk("jobi_abc")).toBe(await otisk("jobi_abc"));
  });

  it("se liší pro jiný vstup a nikdy neobsahuje samotný token", async () => {
    const t = novyToken();
    const h = await otisk(t);
    expect(h).not.toBe(await otisk(novyToken()));
    expect(h).not.toContain(t);
    expect(h).toHaveLength(64);
  });
});

describe("nahled", () => {
  it("ukáže jen začátek a konec", () => {
    const n = nahled(PREFIX + "1234567890abcdef");
    expect(n).toBe("jobi_1234…cdef");
    expect(n).not.toContain("567890ab");
  });
});

describe("ocistiRozsahy", () => {
  it("nechá jen známé rozsahy", () => {
    expect(ocistiRozsahy(["catalog:read", "vymyslene", "inventory:write"]))
      .toEqual(["catalog:read", "inventory:write"]);
  });

  it("zahodí duplicity a poradí si s nesmyslem", () => {
    expect(ocistiRozsahy(["catalog:read", "catalog:read"])).toEqual(["catalog:read"]);
    expect(ocistiRozsahy(null)).toEqual([]);
    expect(ocistiRozsahy("catalog:read")).toEqual([]);
  });

  it("nepustí pokus o eskalaci přes podobný řetězec", () => {
    expect(ocistiRozsahy(["catalog:write "])).toEqual([]);
    expect(ocistiRozsahy(["CATALOG:WRITE"])).toEqual([]);
    expect(jeRozsah("catalog:*")).toBe(false);
  });
});

describe("modulProRozsah", () => {
  it("mapuje rozsah na modul, který si servis platí", () => {
    expect(modulProRozsah("catalog:read")).toBe("api_catalog");
    expect(modulProRozsah("catalog:write")).toBe("api_catalog");
    expect(modulProRozsah("inventory:read")).toBe("api_inventory");
    expect(modulProRozsah("inventory:write")).toBe("api_inventory");
  });
});
