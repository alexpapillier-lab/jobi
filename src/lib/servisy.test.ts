import { describe, it, expect } from "vitest";
import { odvodZkratku } from "./servisy";

/**
 * Zkratka servisu není kosmetika: je z ní číslo zakázky (ASB26000001), které
 * pak zákazník drží vytištěné na příjemce. Servis, který si ji nenastavil,
 * dřív dostal nouzové „SRV“ a přečíslovat už to nešlo – proto se odvozuje
 * hned při zakládání a proto na ni je test.
 */
describe("odvodZkratku", () => {
  it("z víceslovného názvu vezme počáteční písmena", () => {
    expect(odvodZkratku("Auto Servis Brno")).toBe("ASB");
  });

  it("z jednoho slova vezme první tři znaky", () => {
    expect(odvodZkratku("Mobilservis")).toBe("MOB");
  });

  it("zahodí diakritiku – čísla zakázek jsou jen A–Z a číslice", () => {
    expect(odvodZkratku("Šimon Ženíšek")).toBe("SZ");
    expect(odvodZkratku("Řízení")).toBe("RIZ");
  });

  it("čísla v názvu zůstávají", () => {
    expect(odvodZkratku("E2E servisy m1x2")).toBe("ESM");
    expect(odvodZkratku("2Opravy")).toBe("2OP");
  });

  it("nikdy nevrátí víc než šest znaků", () => {
    expect(odvodZkratku("a b c d e f g h").length).toBeLessThanOrEqual(6);
  });

  it("na název bez písmen a číslic zbývá nouzové SRV", () => {
    expect(odvodZkratku("–––")).toBe("SRV");
    expect(odvodZkratku("   ")).toBe("SRV");
  });
});
