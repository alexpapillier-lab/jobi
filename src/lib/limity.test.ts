/**
 * Limity čtení veřejného API.
 * Testuje se odsud, protože edge funkce běží v Denu a vlastní testy nemá.
 */
import { describe, it, expect } from "vitest";
import { vyhodnotLimit, otiskKlienta, klientskaIp, LIMIT_NA_IP, LIMIT_NA_SERVIS } from "../../supabase/functions/_shared/limity";

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

  it("poradí si s chybějící hlavičkou", async () => {
    expect(await otiskKlienta(req({}))).toMatch(/^[0-9a-f]{32}$/);
  });

  /**
   * Tady se dřív bral první záznam z x-forwarded-for. Ten ale pošle klient a
   * proxy své adresy připojují za něj, takže si každý mohl vyrobit nový otisk
   * a limit „na klienta" nic neznamenal.
   */
  it("podvržená první položka x-forwarded-for otisk nezmění", async () => {
    const skutecny = await otiskKlienta(req({ "x-forwarded-for": "9.9.9.9" }));
    const podvrzeny = await otiskKlienta(req({ "x-forwarded-for": "1.2.3.4, 9.9.9.9" }));
    expect(podvrzeny).toBe(skutecny);
  });

  it("dvě různé podvržené hlavičky od stejného klienta dají stejný otisk", async () => {
    const a = await otiskKlienta(req({ "x-forwarded-for": "1.1.1.1, 9.9.9.9" }));
    const b = await otiskKlienta(req({ "x-forwarded-for": "2.2.2.2, 9.9.9.9" }));
    expect(a).toBe(b);
  });
});

describe("klientskaIp", () => {
  const req = (h: Record<string, string>) => new Request("https://x.test", { headers: h });

  it("dá přednost cf-connecting-ip, kterou Cloudflare přepisuje", () => {
    expect(klientskaIp(req({ "cf-connecting-ip": "9.9.9.9", "x-forwarded-for": "1.2.3.4" }))).toBe("9.9.9.9");
  });

  it("z x-forwarded-for bere poslední položku, tu připojila poslední proxy", () => {
    expect(klientskaIp(req({ "x-forwarded-for": "1.2.3.4, 5.6.7.8, 9.9.9.9" }))).toBe("9.9.9.9");
  });

  it("jedinou adresu vezme tak, jak je, a ořízne mezery", () => {
    expect(klientskaIp(req({ "x-forwarded-for": "  1.2.3.4  " }))).toBe("1.2.3.4");
  });

  it("prázdný nebo chybějící seznam neshodí limit", () => {
    expect(klientskaIp(req({}))).toBe("neznama");
    expect(klientskaIp(req({ "x-forwarded-for": " , " }))).toBe("neznama");
  });
});
