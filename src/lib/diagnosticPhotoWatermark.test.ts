import { describe, it, expect } from "vitest";
import { MAX_STRANA_FOTKY, popisDoOdkazu, radkyVodoznaku, rozmerPoZmenseni } from "./diagnosticPhotoWatermark";

/**
 * Kreslení na plátno se v testech bez prohlížeče ověřit nedá; hlídá se
 * aspoň to, co na štítku bude, jak se fotka zmenší a co dostane stránka
 * pro focení z telefonu.
 */
describe("vodoznak – text štítku", () => {
  const kdy = new Date(2026, 8, 8, 14, 5, 9);

  it("s číslem a servisem má dva řádky a datum dole", () => {
    const radky = radkyVodoznaku({ cislo: "SN26000012", servis: "Servis Novák" }, kdy);
    expect(radky).toEqual(["SN26000012 · Servis Novák", "08. 09. 2026 14:05:09"]);
  });

  it("bez čísla (fotky před založením zakázky) nechá jen servis", () => {
    expect(radkyVodoznaku({ servis: "Servis Novák" }, kdy)[0]).toBe("Servis Novák");
  });

  it("bez čehokoli zůstane datum a jobi jako dřív", () => {
    expect(radkyVodoznaku(undefined, kdy)).toEqual(["08. 09. 2026 14:05:09 · jobi"]);
    expect(radkyVodoznaku({ cislo: "  ", servis: null }, kdy)).toEqual(["08. 09. 2026 14:05:09 · jobi"]);
  });
});

describe("vodoznak – zmenšení", () => {
  it("fotku z telefonu zmenší na delší stranu 2560 a zachová poměr", () => {
    expect(rozmerPoZmenseni(4032, 3024)).toEqual({ sirka: MAX_STRANA_FOTKY, vyska: 1920 });
    expect(rozmerPoZmenseni(3024, 4032)).toEqual({ sirka: 1920, vyska: MAX_STRANA_FOTKY });
  });

  it("menší fotku nezvětšuje", () => {
    expect(rozmerPoZmenseni(1200, 800)).toEqual({ sirka: 1200, vyska: 800 });
  });
});

describe("vodoznak – odkaz pro QR", () => {
  const url = "https://capture.example/?ticket=abc&token=xyz";

  it("připojí číslo a servis jako parametry", () => {
    expect(popisDoOdkazu(url, { cislo: "SN26000012", servis: "Servis Novák" })).toBe(
      `${url}&c=SN26000012&s=Servis%20Nov%C3%A1k`
    );
  });

  it("bez popisu nechá odkaz beze změny", () => {
    expect(popisDoOdkazu(url)).toBe(url);
    expect(popisDoOdkazu(url, { cislo: "", servis: " " })).toBe(url);
  });
});
