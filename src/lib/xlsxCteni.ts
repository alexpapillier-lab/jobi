/**
 * Čtení sešitu .xlsx bez knihovny – protějšek k xlsx.ts.
 *
 * Potřebujeme jen hodnoty buněk prvního listu: uživatel si stáhne ceník,
 * doplní v Excelu náklady a nahraje ho zpátky. Excel sešit při uložení
 * zkomprimuje (deflate) a texty přesune do sdílené tabulky řetězců, takže
 * se čte oboje. Rozbaluje se přes DecompressionStream prohlížeče – žádná
 * knihovna, jen novější prohlížeč (Safari 16.4, Chrome 103, Firefox 113).
 *
 * XML se neparsuje DOMParserem (v testech pod Node není), ale jednoduchým
 * průchodem – sešit z Excelu, Numbers i LibreOffice je dost pravidelný.
 */

export type HodnotaBunky = string | number;

/* ---------- ZIP ---------- */

async function inflate(data: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === "undefined") {
    throw new Error("Prohlížeč neumí rozbalit komprimovaný sešit. Zkuste novější prohlížeč nebo soubor uložte bez komprese.");
  }
  const proud = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(proud).arrayBuffer());
}

/** Soubory archivu podle cesty. Čte se centrální adresář, ne lokální hlavičky – ty mohou mít velikosti až za daty. */
export async function rozbalZip(bajty: Uint8Array): Promise<Map<string, Uint8Array>> {
  const dv = new DataView(bajty.buffer, bajty.byteOffset, bajty.byteLength);
  const dec = new TextDecoder();

  // Koncový záznam je na konci, před ním může být komentář (max 64 kB).
  let konec = -1;
  for (let p = bajty.length - 22; p >= Math.max(0, bajty.length - 22 - 65535); p--) {
    if (dv.getUint32(p, true) === 0x06054b50) { konec = p; break; }
  }
  if (konec < 0) throw new Error("Soubor není sešit .xlsx (chybí konec ZIP archivu).");
  const pocet = dv.getUint16(konec + 10, true);
  let p = dv.getUint32(konec + 16, true);

  const out = new Map<string, Uint8Array>();
  for (let i = 0; i < pocet; i++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error("Poškozený ZIP archiv (centrální adresář).");
    const metoda = dv.getUint16(p + 10, true);
    const komprimovano = dv.getUint32(p + 20, true);
    const delkaJmena = dv.getUint16(p + 28, true);
    const delkaExtra = dv.getUint16(p + 30, true);
    const delkaKomentare = dv.getUint16(p + 32, true);
    const posunLokalni = dv.getUint32(p + 42, true);
    const jmeno = dec.decode(bajty.subarray(p + 46, p + 46 + delkaJmena));

    if (dv.getUint32(posunLokalni, true) !== 0x04034b50) throw new Error("Poškozený ZIP archiv (lokální hlavička).");
    const zacatek = posunLokalni + 30 + dv.getUint16(posunLokalni + 26, true) + dv.getUint16(posunLokalni + 28, true);
    const data = bajty.subarray(zacatek, zacatek + komprimovano);
    if (metoda === 0) out.set(jmeno, data);
    else if (metoda === 8) out.set(jmeno, await inflate(data));
    else throw new Error(`Nepodporovaná komprese v ZIP archivu (metoda ${metoda}).`);

    p += 46 + delkaJmena + delkaExtra + delkaKomentare;
  }
  return out;
}

/* ---------- XML ---------- */

function odEntit(s: string): string {
  return s.replace(/&(amp|lt|gt|quot|apos|#x[0-9a-fA-F]+|#[0-9]+);/g, (_, e: string) => {
    if (e === "amp") return "&";
    if (e === "lt") return "<";
    if (e === "gt") return ">";
    if (e === "quot") return '"';
    if (e === "apos") return "'";
    const kod = e.startsWith("#x") ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return Number.isFinite(kod) ? String.fromCodePoint(kod) : "";
  });
}

function atribut(znacka: string, jmeno: string): string | null {
  const m = new RegExp(`(?:^|\\s)${jmeno}="([^"]*)"`).exec(znacka);
  return m ? odEntit(m[1]) : null;
}

/** Spojí všechny <t>…</t> uvnitř (sdílený řetězec může mít víc běhů formátování). */
function textyT(xmlCast: string): string {
  let out = "";
  const re = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xmlCast))) out += odEntit(m[1]);
  return out;
}

function sdileneRetezce(xml: string | undefined): string[] {
  if (!xml) return [];
  const out: string[] = [];
  const re = /<si>([\s\S]*?)<\/si>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) out.push(textyT(m[1]));
  return out;
}

/** „B12“ → 1 (index sloupce). */
export function indexSloupce(odkaz: string): number {
  const pismena = /^[A-Z]+/.exec(odkaz)?.[0] ?? "A";
  let n = 0;
  for (const z of pismena) n = n * 26 + (z.charCodeAt(0) - 64);
  return n - 1;
}

function cestaPrvnihoListu(soubory: Map<string, Uint8Array>): string {
  const dec = new TextDecoder();
  const workbook = dec.decode(soubory.get("xl/workbook.xml") ?? new Uint8Array());
  const prvni = /<sheet\s[^>]*\/?>/.exec(workbook)?.[0];
  if (!prvni) throw new Error("Sešit nemá žádný list.");
  const rId = atribut(prvni, "r:id");
  const rels = dec.decode(soubory.get("xl/_rels/workbook.xml.rels") ?? new Uint8Array());
  let cil: string | null = null;
  const re = /<Relationship\s[^>]*\/?>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(rels))) {
    if (atribut(m[0], "Id") === rId) { cil = atribut(m[0], "Target"); break; }
  }
  if (!cil) cil = "worksheets/sheet1.xml";
  return cil.startsWith("/") ? cil.slice(1) : `xl/${cil}`;
}

function hodnotyListu(xml: string, sdilene: string[]): HodnotaBunky[][] {
  const radky: HodnotaBunky[][] = [];
  const reRadek = /<row\b[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g;
  const reBunka = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
  let r: RegExpExecArray | null;
  while ((r = reRadek.exec(xml))) {
    const cisloRadku = Number(atribut(r[0].slice(0, r[0].indexOf(">") + 1), "r") ?? radky.length + 1);
    const radek: HodnotaBunky[] = [];
    let c: RegExpExecArray | null;
    let dalsiSloupec = 0;
    while ((c = reBunka.exec(r[1] ?? ""))) {
      const atributy = c[1];
      const telo = c[2] ?? "";
      const odkaz = atribut(atributy, "r");
      const sloupec = odkaz ? indexSloupce(odkaz) : dalsiSloupec;
      dalsiSloupec = sloupec + 1;
      const typ = atribut(atributy, "t");
      const v = /<v>([\s\S]*?)<\/v>/.exec(telo)?.[1];
      let hodnota: HodnotaBunky = "";
      if (typ === "s") hodnota = sdilene[Number(v)] ?? "";
      else if (typ === "inlineStr") hodnota = textyT(telo);
      else if (typ === "str" || typ === "e") hodnota = odEntit(v ?? "");
      else if (typ === "b") hodnota = v === "1" ? "ano" : "ne";
      else if (v !== undefined && v !== "") {
        const n = Number(v);
        hodnota = Number.isFinite(n) ? n : odEntit(v);
      }
      while (radek.length < sloupec) radek.push("");
      radek[sloupec] = hodnota;
    }
    while (radky.length < cisloRadku - 1) radky.push([]);
    radky[cisloRadku - 1] = radek;
  }
  return radky;
}

/** Hodnoty prvního listu po řádcích; prázdné buňky jsou "". */
export async function prectiXlsx(bajty: Uint8Array): Promise<HodnotaBunky[][]> {
  const soubory = await rozbalZip(bajty);
  if (!soubory.has("xl/workbook.xml")) throw new Error("Soubor není sešit .xlsx.");
  const dec = new TextDecoder();
  const sdilene = sdileneRetezce(soubory.has("xl/sharedStrings.xml") ? dec.decode(soubory.get("xl/sharedStrings.xml")) : undefined);
  const list = soubory.get(cestaPrvnihoListu(soubory));
  if (!list) throw new Error("V sešitu chybí první list.");
  return hodnotyListu(dec.decode(list), sdilene);
}
