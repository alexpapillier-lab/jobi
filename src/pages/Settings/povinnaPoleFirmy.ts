/**
 * Povinná pole firemních údajů – po sekcích, ne všechna najednou.
 *
 * Firemní údaje jsou rozdělené na dvě obrazovky (Údaje firmy, Kontakty), ale
 * ukládají se jedním zápisem. Když se kontrolovalo všechno naráz, nový servis
 * se nedal vyplnit vůbec: v Údajích firmy hláška chtěla telefon a e-mail
 * (které jsou na druhé obrazovce), v Kontaktech zkratku a IČO – a mezi
 * přepnutím se rozdělaná polovina ztratila. Uživatel tak dokola dostával
 * hlášku o polích, která před sebou ani neviděl.
 *
 * Logika je zvlášť, aby šla otestovat bez vykreslení celé stránky Nastavení.
 */

/** Jen to, co kontrola potřebuje – ne celý tvar firemních údajů. */
export type PolePovinna = {
  abbreviation?: string;
  name?: string;
  ico?: string;
  defaultPhonePrefix?: string;
  addressStreet?: string;
  addressCity?: string;
  addressZip?: string;
  phone?: string;
  email?: string;
};

export type SekceFirmy = "service_basic" | "service_contact" | "vse";

/** Která obrazovka hlídá která pole. Pořadí = pořadí v hlášce. */
export const POLE_SEKCE: Record<"service_basic" | "service_contact", Array<[keyof PolePovinna, string]>> = {
  service_basic: [
    ["abbreviation", "Zkratka"],
    ["name", "Název"],
    ["ico", "IČO"],
    ["defaultPhonePrefix", "Výchozí tel. předvolba"],
    ["addressStreet", "Ulice"],
    ["addressCity", "Město"],
    ["addressZip", "PSČ"],
  ],
  service_contact: [
    ["phone", "Telefonní číslo"],
    ["email", "E-mailová adresa"],
  ],
};

/**
 * Vrací hlášku pro uživatele, nebo `null`, když je vše v pořádku.
 *
 * Formát e-mailu a předvolby se kontroluje jen tam, kde se to pole zadává –
 * jinak by uložení Údajů firmy padalo na e-mailu z Kontaktů.
 */
export function zkontrolujFiremniUdaje(d: PolePovinna, kde: SekceFirmy = "vse"): string | null {
  const req = kde === "vse" ? [...POLE_SEKCE.service_basic, ...POLE_SEKCE.service_contact] : POLE_SEKCE[kde];
  const chybi = req.filter(([k]) => !String(d[k] ?? "").trim()).map(([, popisek]) => popisek);
  if (chybi.length) return `Vyplňte povinná pole: ${chybi.join(", ")}`;

  const hlida = (k: keyof PolePovinna) => req.some(([pole]) => pole === k);
  if (hlida("email") && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(d.email ?? "").trim())) {
    return "E-mailová adresa nemá platný tvar";
  }
  if (hlida("defaultPhonePrefix") && !/^\+?\d{1,4}$/.test(String(d.defaultPhonePrefix ?? "").trim())) {
    return "Výchozí předvolba má být např. +420";
  }
  return null;
}
