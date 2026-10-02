/**
 * Zapisovač .xlsx: ZIP musí být rozbalitelný a list musí nést hodnoty tak,
 * jak je Excel čte – čísla jako čísla, text jako text, bez rozbitého XML.
 * Rozbaluje se tady ručně (metoda stored), ať test nepotřebuje knihovnu.
 */
import { describe, it, expect } from "vitest";
import { crc32, pismenoSloupce, vytvorXlsx, zipStored, XLSX_MIME } from "./xlsx";

/** Projde lokální hlavičky ZIPu (stored) a vrátí soubory jako text. */
function rozbal(bajty: Uint8Array): Map<string, string> {
  const dv = new DataView(bajty.buffer, bajty.byteOffset, bajty.byteLength);
  const dec = new TextDecoder();
  const out = new Map<string, string>();
  let p = 0;
  while (p + 30 <= bajty.length && dv.getUint32(p, true) === 0x04034b50) {
    const metoda = dv.getUint16(p + 8, true);
    const crc = dv.getUint32(p + 14, true);
    const velikost = dv.getUint32(p + 18, true);
    const delkaJmena = dv.getUint16(p + 26, true);
    const delkaExtra = dv.getUint16(p + 28, true);
    const jmeno = dec.decode(bajty.subarray(p + 30, p + 30 + delkaJmena));
    const zacatek = p + 30 + delkaJmena + delkaExtra;
    const obsah = bajty.subarray(zacatek, zacatek + velikost);
    expect(metoda, `${jmeno}: metoda stored`).toBe(0);
    expect(crc32(obsah), `${jmeno}: CRC`).toBe(crc);
    out.set(jmeno, dec.decode(obsah));
    p = zacatek + velikost;
  }
  // za lokálními soubory musí následovat centrální adresář
  expect(dv.getUint32(p, true)).toBe(0x02014b50);
  return out;
}

describe("crc32", () => {
  it("sedí na známé hodnotě", () => {
    expect(crc32(new TextEncoder().encode("123456789")).toString(16)).toBe("cbf43926");
    expect(crc32(new Uint8Array())).toBe(0);
  });
});

describe("pismenoSloupce", () => {
  it("počítá A…Z, AA, AB, …", () => {
    expect(pismenoSloupce(0)).toBe("A");
    expect(pismenoSloupce(25)).toBe("Z");
    expect(pismenoSloupce(26)).toBe("AA");
    expect(pismenoSloupce(27)).toBe("AB");
    expect(pismenoSloupce(701)).toBe("ZZ");
    expect(pismenoSloupce(702)).toBe("AAA");
  });
});

describe("zipStored", () => {
  it("vytvoří rozbalitelný archiv s koncovým záznamem", () => {
    const enc = new TextEncoder();
    const z = zipStored([
      { cesta: "a.txt", obsah: enc.encode("ahoj") },
      { cesta: "slozka/b.txt", obsah: enc.encode("žluťoučký kůň") },
    ], new Date(2026, 9, 2, 10, 30, 0));
    const soubory = rozbal(z);
    expect([...soubory.keys()]).toEqual(["a.txt", "slozka/b.txt"]);
    expect(soubory.get("slozka/b.txt")).toBe("žluťoučký kůň");
    // konec centrálního adresáře: podpis a počet záznamů
    const dv = new DataView(z.buffer, z.byteOffset, z.byteLength);
    const konec = z.length - 22;
    expect(dv.getUint32(konec, true)).toBe(0x06054b50);
    expect(dv.getUint16(konec + 10, true)).toBe(2);
  });
});

describe("vytvorXlsx", () => {
  const sesit = () => vytvorXlsx({
    nazev: "Ceník: oprav / 2026",
    hlavicka: ["Oprava", "Cena", "Náklady"],
    radky: [
      ["Výměna displeje", 1490, 620],
      ["<Baterie> & \"spol\"", 990, null],
      ["Bez čísla", undefined, ""],
    ],
    sirky: [30, 10, 10],
  }, new Date(2026, 9, 2));

  it("má všechny části sešitu a list pojmenovaný bez zakázaných znaků", () => {
    const s = rozbal(sesit());
    expect([...s.keys()].sort()).toEqual([
      "[Content_Types].xml", "_rels/.rels", "xl/_rels/workbook.xml.rels", "xl/styles.xml", "xl/workbook.xml", "xl/worksheets/sheet1.xml",
    ].sort());
    expect(s.get("xl/workbook.xml")).toContain('<sheet name="Ceník  oprav   2026" sheetId="1"');
  });

  it("zapisuje čísla jako čísla a text escapovaný jako inlineStr", () => {
    const list = rozbal(sesit()).get("xl/worksheets/sheet1.xml")!;
    expect(list).toContain('<c r="B2"><v>1490</v></c>');
    expect(list).toContain('<c r="C2"><v>620</v></c>');
    expect(list).toContain('<c r="A3" t="inlineStr"><is><t xml:space="preserve">&lt;Baterie&gt; &amp; &quot;spol&quot;</t></is></c>');
    // prázdné hodnoty se vynechávají, ne zapisují jako prázdný text
    expect(list).toContain('<row r="3"><c r="A3"');
    expect(list).not.toContain('r="C3"');
    expect(list).toContain('<row r="4"><c r="A4" t="inlineStr"><is><t xml:space="preserve">Bez čísla</t></is></c></row>');
  });

  it("hlavička je tučná, ukotvená a sloupce mají šířky", () => {
    const list = rozbal(sesit()).get("xl/worksheets/sheet1.xml")!;
    expect(list).toContain('<c r="A1" t="inlineStr" s="1">');
    expect(list).toContain('<pane ySplit="1" topLeftCell="A2"');
    expect(list).toContain('<col min="1" max="1" width="30" customWidth="1"/>');
  });

  it("řídicí znaky v textu nerozbijí XML", () => {
    const s = rozbal(vytvorXlsx({ nazev: "L", hlavicka: ["A"], radky: [["x\u0001y\tz"]] }));
    expect(s.get("xl/worksheets/sheet1.xml")).toContain("<t xml:space=\"preserve\">xy\tz</t>");
  });

  it("má správný MIME", () => {
    expect(XLSX_MIME).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  });
});
