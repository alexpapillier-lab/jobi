/**
 * Čtečka .xlsx musí přečíst jak náš vlastní export (stored, inlineStr),
 * tak sešit, který prošel Excelem (deflate, sdílené řetězce). Druhý tvar
 * se tu skládá ručně z XML tak, jak ho Excel zapisuje.
 */
import { describe, it, expect } from "vitest";
import { deflateRawSync } from "node:zlib";
import { crc32, vytvorXlsx } from "./xlsx";
import { indexSloupce, prectiXlsx, rozbalZip } from "./xlsxCteni";

/** ZIP s metodou deflate – jako od Excelu. */
function zipDeflate(soubory: Array<{ cesta: string; obsah: string }>): Uint8Array {
  const enc = new TextEncoder();
  const lokalni: Uint8Array[] = [];
  const centralni: Uint8Array[] = [];
  let posun = 0;
  for (const s of soubory) {
    const jmeno = enc.encode(s.cesta);
    const puvodni = enc.encode(s.obsah);
    const data = new Uint8Array(deflateRawSync(puvodni));
    const crc = crc32(puvodni);
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(8, 8, true);
    h.setUint32(14, crc, true); h.setUint32(18, data.length, true); h.setUint32(22, puvodni.length, true);
    h.setUint16(26, jmeno.length, true);
    lokalni.push(new Uint8Array(h.buffer), jmeno, data);
    const z = new DataView(new ArrayBuffer(46));
    z.setUint32(0, 0x02014b50, true); z.setUint16(10, 8, true);
    z.setUint32(16, crc, true); z.setUint32(20, data.length, true); z.setUint32(24, puvodni.length, true);
    z.setUint16(28, jmeno.length, true); z.setUint32(42, posun, true);
    centralni.push(new Uint8Array(z.buffer), jmeno);
    posun += 30 + jmeno.length + data.length;
  }
  const velikost = centralni.reduce((a, b) => a + b.length, 0);
  const k = new DataView(new ArrayBuffer(22));
  k.setUint32(0, 0x06054b50, true); k.setUint16(8, soubory.length, true); k.setUint16(10, soubory.length, true);
  k.setUint32(12, velikost, true); k.setUint32(16, posun, true);
  const casti = [...lokalni, ...centralni, new Uint8Array(k.buffer)];
  const out = new Uint8Array(casti.reduce((a, b) => a + b.length, 0));
  let p = 0;
  for (const c of casti) { out.set(c, p); p += c.length; }
  return out;
}

describe("indexSloupce", () => {
  it("převádí odkaz buňky na index sloupce", () => {
    expect(indexSloupce("A1")).toBe(0);
    expect(indexSloupce("Z9")).toBe(25);
    expect(indexSloupce("AA10")).toBe(26);
    expect(indexSloupce("AB1")).toBe(27);
  });
});

describe("prectiXlsx – vlastní export", () => {
  it("přečte zpět, co vytvorXlsx zapsal, včetně čísel a prázdných buněk", async () => {
    const sesit = vytvorXlsx({
      nazev: "Ceník",
      hlavicka: ["ID", "Oprava", "Cena", "Náklady"],
      radky: [["r1", "Výměna <displeje> & co", 1490.5, null], ["r2", "Baterie", 990, 300]],
    });
    const radky = await prectiXlsx(sesit);
    expect(radky).toEqual([
      ["ID", "Oprava", "Cena", "Náklady"],
      ["r1", "Výměna <displeje> & co", 1490.5],
      ["r2", "Baterie", 990, 300],
    ]);
  });
});

describe("prectiXlsx – sešit po uložení v Excelu", () => {
  const excel = () => zipDeflate([
    { cesta: "[Content_Types].xml", obsah: `<?xml version="1.0"?><Types/>` },
    { cesta: "xl/workbook.xml", obsah: `<?xml version="1.0"?><workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Ceník oprav" sheetId="1" r:id="rId3"/><sheet name="Druhý" sheetId="2" r:id="rId4"/></sheets></workbook>` },
    { cesta: "xl/_rels/workbook.xml.rels", obsah: `<Relationships><Relationship Id="rId4" Type="x" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="x" Target="/xl/worksheets/sheet7.xml"/></Relationships>` },
    { cesta: "xl/sharedStrings.xml", obsah: `<sst count="4" uniqueCount="4"><si><t>ID opravy</t></si><si><r><rPr><b/></rPr><t>Výměna </t></r><r><t xml:space="preserve">displeje &amp; rámu</t></r></si><si><t>ano</t></si><si><t>r-1</t></si></sst>` },
    { cesta: "xl/worksheets/sheet7.xml", obsah: `<worksheet><sheetData>` +
      `<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="inlineStr"><is><t>Oprava</t></is></c><c r="C1" t="str"><v>Cena</v></c></row>` +
      `<row r="3"><c r="A3" t="s"><v>3</v></c><c r="B3" t="s"><v>1</v></c><c r="C3" s="2"><v>1490</v></c><c r="D3"/><c r="E3" t="b"><v>1</v></c><c r="F3" t="s"><v>2</v></c></row>` +
      `</sheetData></worksheet>` },
    { cesta: "xl/worksheets/sheet2.xml", obsah: `<worksheet><sheetData><row r="1"><c r="A1"><v>999</v></c></row></sheetData></worksheet>` },
  ]);

  it("rozbalí deflate, vezme první list podle rId a sdílené řetězce i s běhy formátování", async () => {
    const radky = await prectiXlsx(excel());
    expect(radky[0]).toEqual(["ID opravy", "Oprava", "Cena"]);
    // vynechaný řádek 2 je prázdný, ne přeskočený – čísla řádků musí sedět s Excelem
    expect(radky[1]).toEqual([]);
    expect(radky[2]).toEqual(["r-1", "Výměna displeje & rámu", 1490, "", "ano", "ano"]);
  });

  it("rozbalZip vrátí všechny soubory", async () => {
    const s = await rozbalZip(excel());
    expect([...s.keys()]).toContain("xl/sharedStrings.xml");
    expect(new TextDecoder().decode(s.get("[Content_Types].xml"))).toContain("<Types/>");
  });
});

describe("prectiXlsx – špatný vstup", () => {
  it("odmítne soubor, který není ZIP", async () => {
    await expect(prectiXlsx(new TextEncoder().encode("tohle je text, ne sešit"))).rejects.toThrow(/není sešit/);
  });

  it("odmítne ZIP bez sešitu", async () => {
    await expect(prectiXlsx(zipDeflate([{ cesta: "a.txt", obsah: "x" }]))).rejects.toThrow(/není sešit/);
  });
});
