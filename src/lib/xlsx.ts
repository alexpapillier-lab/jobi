/**
 * Zápis sešitu .xlsx bez knihovny.
 *
 * Sešit Excelu je ZIP s pár XML soubory. Potřebujeme jen zapisovat, a to
 * jeden list s textem a čísly – na to je knihovna (SheetJS je přes megabajt
 * a dlouho bez aktualizace) zbytečná zátěž pro desktop i web. ZIP se skládá
 * ručně s metodou „stored“ (bez komprese): není potřeba deflate, Excel,
 * Numbers i LibreOffice takový soubor otevřou a ceník má pár set kB.
 *
 * Řetězce jdou do buněk přímo (`inlineStr`), ne přes sdílenou tabulku –
 * jednodušší a pro export na doplnění hodnot úplně stačí.
 */

export type Bunka = string | number | null | undefined;

export type List = {
  nazev: string;
  hlavicka: string[];
  radky: Bunka[][];
  /** Šířky sloupců ve znacích; chybějící = výchozí šířka Excelu. */
  sirky?: number[];
};

/* ---------- XML ---------- */

function xml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Znaky, které XML 1.0 nepovoluje (řídicí kromě tabulátoru a konců řádků). */
function bezRidicich(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
}

/** A, B, …, Z, AA, AB, … */
export function pismenoSloupce(index: number): string {
  let n = index + 1;
  let out = "";
  while (n > 0) {
    const z = (n - 1) % 26;
    out = String.fromCharCode(65 + z) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

function bunka(odkaz: string, hodnota: Bunka, tucne = false): string {
  const styl = tucne ? ' s="1"' : "";
  if (hodnota === null || hodnota === undefined || hodnota === "") return "";
  if (typeof hodnota === "number") {
    if (!Number.isFinite(hodnota)) return "";
    return `<c r="${odkaz}"${styl}><v>${hodnota}</v></c>`;
  }
  return `<c r="${odkaz}" t="inlineStr"${styl}><is><t xml:space="preserve">${xml(bezRidicich(String(hodnota)))}</t></is></c>`;
}

function listXml(list: List): string {
  const radek = (cislo: number, hodnoty: Bunka[], tucne: boolean) =>
    `<row r="${cislo}">${hodnoty.map((h, i) => bunka(`${pismenoSloupce(i)}${cislo}`, h, tucne)).join("")}</row>`;
  const sloupce = list.sirky && list.sirky.length > 0
    ? `<cols>${list.sirky.map((s, i) => `<col min="${i + 1}" max="${i + 1}" width="${s}" customWidth="1"/>`).join("")}</cols>`
    : "";
  const tela = [radek(1, list.hlavicka, true), ...list.radky.map((r, i) => radek(i + 2, r, false))].join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` +
    `${sloupce}<sheetData>${tela}</sheetData></worksheet>`;
}

const STYLY = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
  `<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>` +
  `<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>` +
  `<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>` +
  `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
  `<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>` +
  `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>` +
  `</styleSheet>`;

/** Název listu smí mít 31 znaků a nesmí obsahovat : \ / ? * [ ] */
function nazevListu(s: string): string {
  const cisty = s.replace(/[:\\/?*[\]]/g, " ").trim();
  return (cisty || "List1").slice(0, 31);
}

/* ---------- ZIP (stored, bez komprese) ---------- */

const CRC_TABULKA = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABULKA[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Datum v DOS formátu – ZIP jiné neumí. */
function dosCas(d: Date): { cas: number; datum: number } {
  const rok = Math.max(1980, d.getFullYear());
  return {
    cas: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    datum: ((rok - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

export function zipStored(soubory: Array<{ cesta: string; obsah: Uint8Array }>, ted = new Date()): Uint8Array {
  const enc = new TextEncoder();
  const { cas, datum } = dosCas(ted);
  const lokalni: Uint8Array[] = [];
  const centralni: Uint8Array[] = [];
  let posun = 0;

  for (const s of soubory) {
    const jmeno = enc.encode(s.cesta);
    const crc = crc32(s.obsah);
    const hlavicka = new DataView(new ArrayBuffer(30));
    hlavicka.setUint32(0, 0x04034b50, true);
    hlavicka.setUint16(4, 20, true);          // verze
    hlavicka.setUint16(6, 0x0800, true);      // UTF-8 jména
    hlavicka.setUint16(8, 0, true);           // stored
    hlavicka.setUint16(10, cas, true);
    hlavicka.setUint16(12, datum, true);
    hlavicka.setUint32(14, crc, true);
    hlavicka.setUint32(18, s.obsah.length, true);
    hlavicka.setUint32(22, s.obsah.length, true);
    hlavicka.setUint16(26, jmeno.length, true);
    hlavicka.setUint16(28, 0, true);
    lokalni.push(new Uint8Array(hlavicka.buffer), jmeno, s.obsah);

    const zaznam = new DataView(new ArrayBuffer(46));
    zaznam.setUint32(0, 0x02014b50, true);
    zaznam.setUint16(4, 20, true);
    zaznam.setUint16(6, 20, true);
    zaznam.setUint16(8, 0x0800, true);
    zaznam.setUint16(10, 0, true);
    zaznam.setUint16(12, cas, true);
    zaznam.setUint16(14, datum, true);
    zaznam.setUint32(16, crc, true);
    zaznam.setUint32(20, s.obsah.length, true);
    zaznam.setUint32(24, s.obsah.length, true);
    zaznam.setUint16(28, jmeno.length, true);
    zaznam.setUint16(30, 0, true);            // extra
    zaznam.setUint16(32, 0, true);            // komentář
    zaznam.setUint16(34, 0, true);            // disk
    zaznam.setUint16(36, 0, true);            // interní atributy
    zaznam.setUint32(38, 0, true);            // externí atributy
    zaznam.setUint32(42, posun, true);
    centralni.push(new Uint8Array(zaznam.buffer), jmeno);

    posun += 30 + jmeno.length + s.obsah.length;
  }

  const velikostCentralni = centralni.reduce((a, b) => a + b.length, 0);
  const konec = new DataView(new ArrayBuffer(22));
  konec.setUint32(0, 0x06054b50, true);
  konec.setUint16(4, 0, true);
  konec.setUint16(6, 0, true);
  konec.setUint16(8, soubory.length, true);
  konec.setUint16(10, soubory.length, true);
  konec.setUint32(12, velikostCentralni, true);
  konec.setUint32(16, posun, true);
  konec.setUint16(20, 0, true);

  const casti = [...lokalni, ...centralni, new Uint8Array(konec.buffer)];
  const out = new Uint8Array(casti.reduce((a, b) => a + b.length, 0));
  let p = 0;
  for (const c of casti) {
    out.set(c, p);
    p += c.length;
  }
  return out;
}

/* ---------- sešit ---------- */

/** Sešit s jedním listem jako bajty .xlsx. */
export function vytvorXlsx(list: List, ted = new Date()): Uint8Array {
  const enc = new TextEncoder();
  const jmeno = xml(nazevListu(list.nazev));
  const soubory = [
    {
      cesta: "[Content_Types].xml",
      obsah: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
        `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        `<Default Extension="xml" ContentType="application/xml"/>` +
        `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
        `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` +
        `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
        `</Types>`,
    },
    {
      cesta: "_rels/.rels",
      obsah: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
        `</Relationships>`,
    },
    {
      cesta: "xl/workbook.xml",
      obsah: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
        `<sheets><sheet name="${jmeno}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    },
    {
      cesta: "xl/_rels/workbook.xml.rels",
      obsah: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>` +
        `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
        `</Relationships>`,
    },
    { cesta: "xl/styles.xml", obsah: STYLY },
    { cesta: "xl/worksheets/sheet1.xml", obsah: listXml(list) },
  ];
  return zipStored(soubory.map((s) => ({ cesta: s.cesta, obsah: enc.encode(s.obsah) })), ted);
}

export const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
