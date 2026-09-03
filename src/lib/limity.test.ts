/**
 * Limity čtení veřejného API.
 * Testuje se odsud, protože edge funkce běží v Denu a vlastní testy nemá.
 */
import { describe, it, expect } from "vitest";
import { vyhodnotLimit, otiskKlienta, LIMIT_NA_IP, LIMIT_NA_SERVIS } from "../../supabase/functions/_shared/limity";

describe("vyhodnotLimit", () => {
  it("pustí provoz pod limitem", () => {
    expect(vyhodnotLimit(1, 1).prekroceno).toBe(false);
    expect(vyhodnotLimit(LIMIT_NA_SERVIS, LIMIT_NA_IP).prekroceno).toBe(false);
  });

  it("zastaví, když jedna IP překročí svůj limit", () => {
    const v = vyhodnotLimit(100, LIMIT_NA_IP + 1);
    expect(v.prekroceno).toBe(true);
    expect(v.duvod).toContain(String(LIMIT_NA_IP));
  });

  it("zastaví, když servis překročí svůj limit i při rozprostření na víc IP", () => {
    const v = vyhodnotLimit(LIMIT_NA_SERVIS + 1, 2);
    expect(v.prekroceno).toBe(true);
    expect(v.duvod).toContain(String(LIMIT_NA_SERVIS));
  });
});

describe("otiskKlienta", () => {
  const req = (h: Record<string, string>) => new Request("https://x.test", { headers: h });

  it("stejná IP dá stejný otisk, jiná jiný", async () => {
    const a = await otiskKlienta(req({ "x-forwarded-for": "1.2.3.4" }));
    const b = await otiskKlienta(req({ "x-forwarded-for": "1.2.3.4" }));
    const c = await otiskKlienta(req({ "x-forwarded-for": "5.6.7.8" }));
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it("z otisku nejde IP přečíst", async () => {
    const a = await otiskKlienta(req({ "x-forwarded-for": "1.2.3.4" }));
    expect(a).not.toContain("1.2.3.4");
    expect(a).toMatch(/^[0-9a-f]{32}$/);
  });

  it("bere první adresu ze seznamu, ne celý řetězec", async () => {
    const a = await otiskKlienta(req({ "x-forwarded-for": "1.2.3.4, 9.9.9.9" }));
    const b = await otiskKlienta(req({ "x-forwarded-for": "1.2.3.4" }));
    expect(a).toBe(b);
  });

  it("poradí si s chybějící hlavičkou", async () => {
    expect(await otiskKlienta(req({}))).toMatch(/^[0-9a-f]{32}$/);
  });
});
