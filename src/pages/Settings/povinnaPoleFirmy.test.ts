import { describe, it, expect } from "vitest";
import { zkontrolujFiremniUdaje, POLE_SEKCE } from "./povinnaPoleFirmy";

/**
 * Chyba, kterou to řeší, vypadala takhle: v novém servisu uživatel vyplnil
 * Údaje firmy, dal Uložit a dostal „Vyplňte povinná pole: Telefonní číslo,
 * E-mailová adresa“ – tedy pole ze sousední obrazovky. Přešel do Kontaktů,
 * vyplnil je, dal Uložit a dostal „Vyplňte povinná pole: Zkratka, IČO, Ulice,
 * Město, PSČ“. Dokola, a firemní údaje nešly uložit vůbec.
 */
const UDAJE_FIRMY = {
  abbreviation: "DZS",
  name: "Druhý zkušební servis",
  ico: "827388273",
  defaultPhonePrefix: "+420",
  addressStreet: "Na Příkopě 1",
  addressCity: "Praha",
  addressZip: "16000",
};
const KONTAKTY = { phone: "777666333", email: "servis@example.com" };

describe("povinná pole firemních údajů", () => {
  it("Údaje firmy jdou uložit, i když Kontakty ještě prázdné jsou", () => {
    expect(zkontrolujFiremniUdaje(UDAJE_FIRMY, "service_basic")).toBeNull();
  });

  it("Kontakty jdou uložit, i když Údaje firmy ještě prázdné jsou", () => {
    expect(zkontrolujFiremniUdaje(KONTAKTY, "service_contact")).toBeNull();
  });

  it("hláška jmenuje jen pole té obrazovky, na které uživatel je", () => {
    const chyba = zkontrolujFiremniUdaje({ ...KONTAKTY, phone: "" }, "service_contact");
    expect(chyba).toBe("Vyplňte povinná pole: Telefonní číslo");
    expect(chyba).not.toContain("Zkratka");
  });

  it("prázdná zkratka se neuloží – jsou z ní čísla zakázek", () => {
    expect(zkontrolujFiremniUdaje({ ...UDAJE_FIRMY, abbreviation: "  " }, "service_basic"))
      .toBe("Vyplňte povinná pole: Zkratka");
  });

  it("tvar e-mailu se hlídá jen v Kontaktech, kde se zadává", () => {
    expect(zkontrolujFiremniUdaje({ ...KONTAKTY, email: "neplatny" }, "service_contact"))
      .toBe("E-mailová adresa nemá platný tvar");
    // Uložení Údajů firmy nesmí spadnout na e-mailu ze sousední obrazovky.
    expect(zkontrolujFiremniUdaje({ ...UDAJE_FIRMY, email: "neplatny" }, "service_basic")).toBeNull();
  });

  it("předvolba se hlídá jen v Údajích firmy", () => {
    expect(zkontrolujFiremniUdaje({ ...UDAJE_FIRMY, defaultPhonePrefix: "abc" }, "service_basic"))
      .toBe("Výchozí předvolba má být např. +420");
    expect(zkontrolujFiremniUdaje(KONTAKTY, "service_contact")).toBeNull();
  });

  it("celý formulář dohromady chce všechno", () => {
    expect(zkontrolujFiremniUdaje({ ...UDAJE_FIRMY, ...KONTAKTY })).toBeNull();
    expect(zkontrolujFiremniUdaje(UDAJE_FIRMY)).toBe("Vyplňte povinná pole: Telefonní číslo, E-mailová adresa");
  });

  it("žádné pole není ve dvou sekcích zároveň", () => {
    // Kdyby bylo, hlásilo by se dvakrát a nikdo by nevěděl, kam ho psát.
    const zaklad = POLE_SEKCE.service_basic.map(([k]) => k);
    const kontakt = POLE_SEKCE.service_contact.map(([k]) => k);
    expect(zaklad.filter((k) => kontakt.includes(k))).toEqual([]);
  });
});
