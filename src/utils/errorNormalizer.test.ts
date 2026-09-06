import { describe, it, expect } from "vitest";
import { normalizeError, formatInviteEmailReason } from "./errorNormalizer";

describe("normalizeError", () => {
  it("returns 'Neznámá chyba' for falsy input", () => {
    expect(normalizeError(null)).toBe("Neznámá chyba");
    expect(normalizeError(undefined)).toBe("Neznámá chyba");
  });

  it("returns permission message for Not authorized", () => {
    expect(normalizeError(new Error("Not authorized"))).toBe("Nemáte oprávnění k této akci");
  });

  it("returns permission message for PGRST301", () => {
    const err = Object.assign(new Error("xyz"), { code: "PGRST301" });
    expect(normalizeError(err)).toBe("Nemáte oprávnění k této akci");
  });

  it("returns cloud maintenance message for 503", () => {
    expect(normalizeError(new Error("Service 503 unavailable"))).toContain("Cloud je dočasně nedostupný");
  });

  it("returns network message for fetch errors", () => {
    expect(normalizeError(new Error("Failed to fetch"))).toContain("Nelze se připojit k cloudu");
  });

  it("returns PGRST116 as 'Položka nebyla nalezena'", () => {
    const err = Object.assign(new Error("Row not found"), { code: "PGRST116" });
    expect(normalizeError(err)).toBe("Položka nebyla nalezena");
  });

  it("returns original message for unknown errors", () => {
    expect(normalizeError(new Error("Some custom error"))).toBe("Some custom error");
  });
});

describe("formatInviteEmailReason", () => {
  it("returns default for empty reason", () => {
    expect(formatInviteEmailReason("")).toBe("E-mail se nepodařilo odeslat.");
  });

  it("returns Resend domain hint for 403 + your own email", () => {
    const r = "403 - you can only send to your own email until you verify a domain";
    expect(formatInviteEmailReason(r)).toContain("onboarding@resend.dev");
    expect(formatInviteEmailReason(r)).toContain("ověř doménu");
  });

  it("returns original reason for unrelated errors", () => {
    expect(formatInviteEmailReason("Rate limit exceeded")).toBe("Rate limit exceeded");
  });
});

describe("chyby z Supabase (obyčejný objekt, ne Error)", () => {
  it("vezme message, ne [object Object]", () => {
    const chyba = { code: "P0001", message: "Neznámé oprávnění: branch_only", details: null, hint: null };
    expect(normalizeError(chyba)).toContain("Neznámé oprávnění: branch_only");
    expect(normalizeError(chyba)).not.toContain("[object Object]");
  });

  it("přidá podrobnosti, když jsou", () => {
    expect(normalizeError({ message: "Zápis selhal", details: "řádek neexistuje" })).toBe("Zápis selhal řádek neexistuje");
  });

  it("prázdný objekt nespadne", () => {
    expect(normalizeError({})).toBe("[object Object]");
  });

  it("řetězec projde beze změny", () => {
    expect(normalizeError("Něco se pokazilo")).toBe("Něco se pokazilo");
  });
});

/**
 * Hláška se ukazuje technikovi uprostřed práce. Musí z ní poznat, jestli
 * má zkusit znovu (výpadek sítě), zavolat majiteli servisu (chybí
 * oprávnění), nebo jestli je chyba v tom, co zrovna vyplnil. Špatně
 * zařazená chyba pošle člověka hledat úplně jinam.
 */
describe("zařazení chyby do správné hlášky", () => {
  it("chybějící oprávnění vyhrává nad tím, že se zrovna nepovedlo spojení", () => {
    const chyba = Object.assign(new Error("Failed to fetch"), { code: "PGRST301" });
    expect(normalizeError(chyba)).toBe("Nemáte oprávnění k této akci");
  });

  it("zamítnutí od databáze se přeloží na chybějící oprávnění", () => {
    expect(normalizeError({ message: "permission denied for table tickets" })).toBe(
      "Nemáte oprávnění k této akci"
    );
  });

  it("nedostupná cloudová funkce má vlastní návod, ne obecnou síťovou hlášku", () => {
    const text = normalizeError(new Error("Failed to send a request to the Edge Function"));
    expect(text).toContain("cloudovou funkci");
    expect(text).not.toContain("Nelze se připojit k cloudu");
  });

  it("Load failed ze Safari je výpadek sítě, ne neznámá chyba", () => {
    expect(normalizeError(new Error("Load failed"))).toContain("Nelze se připojit k cloudu");
  });

  it("vypršený časový limit se bere jako výpadek spojení", () => {
    expect(normalizeError(new Error("Request timeout after 30000ms"))).toContain("Nelze se připojit k cloudu");
  });

  it("česká hláška ze serveru se nepřepisuje, projde i s diakritikou", () => {
    expect(normalizeError({ message: "Zakázku nelze smazat, má vystavenou fakturu" })).toBe(
      "Zakázku nelze smazat, má vystavenou fakturu"
    );
  });

  it("nula a prázdný řetězec jsou taky „žádná chyba“", () => {
    expect(normalizeError(0)).toBe("Neznámá chyba");
    expect(normalizeError("")).toBe("Neznámá chyba");
    expect(normalizeError(false)).toBe("Neznámá chyba");
  });

  it("chyba, která není ani objekt, ani text, nespadne", () => {
    expect(() => normalizeError(42)).not.toThrow();
    expect(normalizeError(42)).toBe("42");
  });

  it("objekt jen s nápovědou od databáze ji ukáže místo [object Object]", () => {
    expect(normalizeError({ hint: "Zkontrolujte, že servis má aktivní modul" })).toBe(
      "Zkontrolujte, že servis má aktivní modul"
    );
  });

  it("dlouhý výpis z databáze se nezkracuje – technik ho posílá do podpory", () => {
    const dlouhy = "Zápis selhal: " + "podrobnost ".repeat(200);
    expect(normalizeError({ message: dlouhy })).toBe(dlouhy);
  });
});

describe("hláška o neodeslané pozvánce", () => {
  it("na velikosti písmen v odpovědi z Resendu nezáleží", () => {
    const r = "403 - You Can Only Send To Your Own Email Until You Verify A Domain";
    expect(formatInviteEmailReason(r)).toContain("RESEND_FROM_EMAIL");
  });

  it("chybu typu validation_error pozná i bez čísla 403", () => {
    expect(formatInviteEmailReason("validation_error: you can only send to your own email")).toContain(
      "ověř doménu"
    );
  });
});
