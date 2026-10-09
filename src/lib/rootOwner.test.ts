import { describe, it, expect } from "vitest";
import { jeRootOwnerId, skrytyRootOwner, bezRootOwnera, autorProOstatni, technikPrace } from "./rootOwner";

const ROOT = "f3b27eb3-7059-48e0-839f-de1eb988fe70";
const KOLEGA = "6e4e4ac0-0000-4000-8000-000000000001";

/**
 * Majitel aplikace je členem všech servisů, ale ostatní ho nikde vidět
 * nesmí – ani v týmu, ani jako autora změny. Sám sebe vidí normálně.
 */
describe("majitel aplikace je pro ostatní neviditelný", () => {
  it("pozná id majitele i s jinou velikostí písmen a mezerami", () => {
    expect(jeRootOwnerId(ROOT, ROOT)).toBe(true);
    expect(jeRootOwnerId(ROOT.toUpperCase(), ` ${ROOT} `)).toBe(true);
    expect(jeRootOwnerId(KOLEGA, ROOT)).toBe(false);
  });

  it("bez nastaveného id není majitelem nikdo – ani prázdné id", () => {
    expect(jeRootOwnerId(ROOT, null)).toBe(false);
    expect(jeRootOwnerId("", ROOT)).toBe(false);
    expect(jeRootOwnerId(null, ROOT)).toBe(false);
    expect(skrytyRootOwner(ROOT, KOLEGA, null)).toBe(false);
  });

  it("kolegovi se majitel schová, majiteli samotnému ne", () => {
    expect(skrytyRootOwner(ROOT, KOLEGA, ROOT)).toBe(true);
    expect(skrytyRootOwner(ROOT, null, ROOT)).toBe(true);
    expect(skrytyRootOwner(ROOT, ROOT, ROOT)).toBe(false);
    expect(skrytyRootOwner(KOLEGA, KOLEGA, ROOT)).toBe(false);
  });

  it("ze seznamu členů vypadne jen majitel a jen pro ostatní", () => {
    const clenove = [{ id: KOLEGA }, { id: ROOT }];
    expect(bezRootOwnera(clenove, (c) => c.id, KOLEGA, ROOT)).toEqual([{ id: KOLEGA }]);
    expect(bezRootOwnera(clenove, (c) => c.id, ROOT, ROOT)).toEqual(clenove);
  });

  it("autor změny od majitele je pro ostatní „bez autora“ (Systém)", () => {
    expect(autorProOstatni(ROOT, KOLEGA, ROOT)).toBeNull();
    expect(autorProOstatni(ROOT, ROOT, ROOT)).toBe(ROOT);
    expect(autorProOstatni(KOLEGA, KOLEGA, ROOT)).toBe(KOLEGA);
    expect(autorProOstatni(null, KOLEGA, ROOT)).toBeNull();
  });
});

describe("hodinová práce majitele aplikace", () => {
  it("na doklad ani do přehledu nejde jeho jméno", () => {
    expect(technikPrace({ technik: "Aleki", technikUserId: ROOT }, ROOT)).toBeNull();
    expect(technikPrace({ technik: " Jana ", technikUserId: KOLEGA }, ROOT)).toBe("Jana");
    expect(technikPrace({ technik: "Jana" }, ROOT)).toBe("Jana");
    expect(technikPrace({ technik: "  " }, ROOT)).toBeNull();
  });
});
