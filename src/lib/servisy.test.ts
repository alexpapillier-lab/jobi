import { describe, it, expect } from "vitest";
import { normalizujZkratku, odvodZkratku, zkratkaZConfigu } from "./servisy";

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

/**
 * Zkratka leží v nastavení servisu na dvou místech (`abbreviation` na vrcholu
 * a `companyData.abbreviation`) a čte ji generátor čísel zakázek i ukázková
 * data. Kdyby se každý díval jinam, měl by servis v jednom seznamu čísla
 * „ASB26…“ a v druhém „SRV26…“ – a přečíslovat je zpětně nejde.
 */
describe("zkratkaZConfigu", () => {
  it("bere zkratku z vrcholu configu", () => {
    expect(zkratkaZConfigu({ abbreviation: "ASB" })).toBe("ASB");
  });

  it("když nahoře není, vezme ji z firemních údajů", () => {
    expect(zkratkaZConfigu({ companyData: { abbreviation: "ASB" } })).toBe("ASB");
  });

  it("vrchol má přednost – odtud ji čte generátor čísel", () => {
    expect(zkratkaZConfigu({ abbreviation: "AAA", companyData: { abbreviation: "BBB" } })).toBe("AAA");
  });

  it("bez zkratky ji odvodí z názvu firmy, ne SRV", () => {
    expect(zkratkaZConfigu({ companyData: { name: "Auto Servis Brno" } })).toBe("ASB");
  });

  it("prázdná zkratka se přeskočí jako by tam nebyla", () => {
    expect(zkratkaZConfigu({ abbreviation: "   ", companyData: { abbreviation: "ASB" } })).toBe("ASB");
  });

  it("očistí, co by v čísle zakázky nemělo co dělat", () => {
    expect(zkratkaZConfigu({ abbreviation: "a-s b!" })).toBe("ASB");
    expect(zkratkaZConfigu({ abbreviation: "ABCDEFGHIJ" })).toBe("ABCDEF");
  });

  it("servis, o kterém se neví nic, dostane nouzové SRV", () => {
    expect(zkratkaZConfigu({})).toBe("SRV");
    expect(zkratkaZConfigu(null)).toBe("SRV");
    expect(zkratkaZConfigu(undefined)).toBe("SRV");
  });

  it("nesmyslné typy v configu nespadnou – config píše i starší verze appky", () => {
    expect(zkratkaZConfigu({ abbreviation: 42 as unknown as string })).toBe("SRV");
    expect(zkratkaZConfigu({ companyData: null })).toBe("SRV");
  });
});

describe("normalizujZkratku", () => {
  it("nechá jen A–Z a číslice a zkrátí na šest znaků", () => {
    expect(normalizujZkratku(" auto-servis 1 ")).toBe("AUTOSE");
    expect(normalizujZkratku("e2e")).toBe("E2E");
  });

  it("z prázdného vstupu je nouzové SRV, ne prázdná předpona", () => {
    // Prázdná předpona by udělala zakázku s číslem „26000001“, které
    // vypadá jako datum a mezi servisy se nedá rozlišit.
    expect(normalizujZkratku("")).toBe("SRV");
    expect(normalizujZkratku("–––")).toBe("SRV");
  });
});
