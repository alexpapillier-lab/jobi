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

describe("csv – hraniční případy", () => {
  it("prázdný vstup, jen BOM, jen hlavička", () => {
    expect(parseCsv("")).toEqual({ hlavicka: [], radky: [], oddelovac: ";" });
    expect(parseCsv("﻿")).toEqual({ hlavicka: [], radky: [], oddelovac: ";" });
    expect(parseCsv("Jméno;Telefon\n")).toEqual({ hlavicka: ["Jméno", "Telefon"], radky: [], oddelovac: ";" });
  });

  it("prázdné řádky a řádky ze samých oddělovačů se vynechají; kratší řádek se nedoplňuje", () => {
    expect(parseCsv("A;B;C\n\n;;\nx;y\n  \n").radky).toEqual([["x", "y"]]);
  });

  it("CR bez LF (starý Mac), LF i CRLF uvnitř uvozovek", () => {
    expect(parseCsv("A;B\rx;y\rz;w").radky).toEqual([["x", "y"], ["z", "w"]]);
    expect(parseCsv('A;B\n"více\r\nřádků";y').radky).toEqual([["více\r\nřádků", "y"]]);
    expect(parseCsv('A;B\n"a\nb";y\nc;d').radky).toEqual([["a\nb", "y"], ["c", "d"]]);
  });

  it("čísla s desetinnou čárkou zůstávají text; v čárkovém CSV je drží jen uvozovky; nuly na začátku zůstanou", () => {
    expect(parseCsv("Jméno;Kauce\nNovák;1,5").radky).toEqual([["Novák", "1,5"]]);
    expect(parseCsv('Jméno,Kauce\nNovák,"1,5"').radky).toEqual([["Novák", "1,5"]]);
    expect(parseCsv("Jméno,Kauce\nNovák,1,5").radky).toEqual([["Novák", "1", "5"]]);
    expect(parseCsv("PSČ;Jméno\n01234;x").radky[0][0]).toBe("01234");
  });

  it("oddělovač: při shodě vyhraje středník, jediný sloupec je středník, hlavička s čárkou v uvozovkách, vynucený oddělovač", () => {
    expect(poznejOddelovac('"Novák, Jan";Telefon')).toBe(";");
    expect(poznejOddelovac("a|b|c")).toBe("|");
    expect(poznejOddelovac("jediný sloupec")).toBe(";");
    expect(parseCsv('"Jméno, příjmení";Telefon\n"Novák, Jan";777').hlavicka).toEqual(["Jméno, příjmení", "Telefon"]);
    expect(parseCsv("A,B\nx;y,z", ";").radky).toEqual([["x", "y,z"]]);
    expect(parseCsv("A\tB\nx\ty").radky).toEqual([["x", "y"]]);
  });

  it("uvozovka uprostřed nezauvozovkované buňky (displej 5\") – nález: pohltí zbytek souboru do jedné buňky", () => {
    const t = parseCsv('Jméno;Poznámka;Telefon\nNovák;displej 5" černý;777\nPetra;;888');
    expect(t.radky).toEqual([["Novák", 'displej 5" černý', "777"], ["Petra", "", "888"]]);
  });

  it("mapování: „Číslo zákazníka“ není telefon (nález), Příjmení vedle Jména zůstane bez mapování, prázdné hlavičky nic", () => {
    expect(odhadniMapovani(["Číslo zákazníka", "Telefon"])).toEqual([null, "phone"]);
    expect(odhadniMapovani(["Jméno", "Příjmení"])).toEqual(["name", null]);
    expect(odhadniMapovani(["", "  ", "Cokoliv"])).toEqual([null, null, null]);
    expect(odhadniMapovani(["E-mailová adresa", "IČ", "DIČ", "Adresa"])).toEqual(["email", "ico", "dic", "address_street"]);
  });
});
