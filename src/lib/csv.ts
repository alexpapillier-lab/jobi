/**
 * CSV pro import zákazníků z jiného systému (export z MyRepair, Zakázkového
 * listu, Excelu…). Oddělovač se pozná sám (středník, čárka, tabulátor),
 * uvozovky podle RFC 4180, BOM z Excelu se zahodí.
 */
export type CsvTabulka = { hlavicka: string[]; radky: string[][]; oddelovac: string };

export function poznejOddelovac(prvniRadek: string): string {
  const kandidati = [";", ",", "\t", "|"];
  let nej = ";";
  let max = -1;
  for (const k of kandidati) {
    const n = prvniRadek.split(k).length - 1;
    if (n > max) {
      max = n;
      nej = k;
    }
  }
  return nej;
}

export function parseCsv(text: string, oddelovac?: string): CsvTabulka {
  const bezBom = text.replace(/^\uFEFF/, "");
  const prvniRadek = bezBom.split(/\r?\n/, 1)[0] ?? "";
  const sep = oddelovac ?? poznejOddelovac(prvniRadek);
  const radky: string[][] = [];
  let radek: string[] = [];
  let bunka = "";
  let vUvozovkach = false;
  for (let i = 0; i < bezBom.length; i++) {
    const c = bezBom[i];
    if (vUvozovkach) {
      if (c === '"') {
        if (bezBom[i + 1] === '"') {
          bunka += '"';
          i++;
        } else {
          vUvozovkach = false;
        }
      } else {
        bunka += c;
      }
      continue;
    }
    if (c === '"' && bunka === "") {
      // Uvozovkový režim jen na začátku buňky – „displej 5"“ uprostřed je obyčejný znak.
      vUvozovkach = true;
    } else if (c === sep) {
      radek.push(bunka);
      bunka = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && bezBom[i + 1] === "\n") i++;
      radek.push(bunka);
      bunka = "";
      if (radek.some((b) => b.trim() !== "")) radky.push(radek);
      radek = [];
    } else {
      bunka += c;
    }
  }
  radek.push(bunka);
  if (radek.some((b) => b.trim() !== "")) radky.push(radek);
  const hlavicka = (radky.shift() ?? []).map((h) => h.trim());
  return { hlavicka, radky: radky.map((r) => r.map((b) => b.trim())), oddelovac: sep };
}

/** Pole zákazníka, do kterých se sloupce mapují. */
export type PoleZakaznika = "name" | "phone" | "email" | "company" | "ico" | "dic" | "address_street" | "address_city" | "address_zip" | "note";

export const POPIS_POLE: Record<PoleZakaznika, string> = {
  name: "Jméno",
  phone: "Telefon",
  email: "E-mail",
  company: "Firma",
  ico: "IČO",
  dic: "DIČ",
  address_street: "Ulice",
  address_city: "Město",
  address_zip: "PSČ",
  note: "Poznámka",
};

const VZORY: Array<[PoleZakaznika, RegExp]> = [
  ["phone", /^(tel|telefon|phone|mobil|mobile)|^(číslo|cislo)\s*(tel|mobil)/i],
  ["email", /mail/i],
  ["ico", /^(ičo|ico|ič$|ic$)/i],
  ["dic", /^(dič|dic)/i],
  ["address_zip", /^(psč|psc|zip|postal)/i],
  ["address_city", /^(město|mesto|obec|city)/i],
  ["address_street", /^(ulice|adresa|street|address)/i],
  ["company", /^(firma|společnost|spolecnost|company|název firmy)/i],
  ["note", /^(pozn|note|komentář|komentar)/i],
  ["name", /^(jméno|jmeno|zákazník|zakaznik|name|customer|příjmení|prijmeni|kontakt)/i],
];

/** Odhadne, který sloupec je které pole; nepoznané sloupce zůstanou nepřiřazené. */
export function odhadniMapovani(hlavicka: string[]): Array<PoleZakaznika | null> {
  const pouzito = new Set<PoleZakaznika>();
  return hlavicka.map((h) => {
    const nazev = h.trim();
    for (const [pole, re] of VZORY) {
      if (!pouzito.has(pole) && re.test(nazev)) {
        pouzito.add(pole);
        return pole;
      }
    }
    return null;
  });
}
