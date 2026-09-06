import { describe, expect, it } from "vitest";
import { odhadniMapovani, parseCsv, poznejOddelovac } from "./csv";

describe("csv", () => {
  it("pozná oddělovač a zvládne uvozovky, BOM i CRLF", () => {
    const text = '\uFEFFJméno;Telefon;Poznámka\r\n"Novák, Jan";777 123 456;"řekl ""dobrý den"""\r\nPetra;;\r\n';
    const t = parseCsv(text);
    expect(t.oddelovac).toBe(";");
    expect(t.hlavicka).toEqual(["Jméno", "Telefon", "Poznámka"]);
    expect(t.radky).toEqual([["Novák, Jan", "777 123 456", 'řekl "dobrý den"'], ["Petra", "", ""]]);
    expect(poznejOddelovac("a,b,c")).toBe(",");
    expect(poznejOddelovac("a\tb")).toBe("\t");
  });

  it("odhadne mapování sloupců podle názvů", () => {
    expect(odhadniMapovani(["Zákazník", "Mobil", "E-mail", "IČO", "Ulice", "Město", "PSČ", "Firma", "Poznámka", "Cokoliv"])).toEqual([
      "name", "phone", "email", "ico", "address_street", "address_city", "address_zip", "company", "note", null,
    ]);
    // Druhý sloupec se stejným významem už se nepřiřadí.
    expect(odhadniMapovani(["Telefon", "Telefon 2"])).toEqual(["phone", null]);
  });
});
