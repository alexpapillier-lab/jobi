/**
 * PDF reportu statistik – vykreslení přes pdf-lib.
 *
 * Proč pdf-lib a ne JobiDocs: faktury e-mailem renderuje JobiDocs, což je
 * Electron na počítači zákazníka – plánovaný report o sedmé ráno 1. v měsíci
 * ale musí vzniknout na serveru, ať je počítač zapnutý nebo ne. pdf-lib běží
 * v Deno bez prohlížeče; rozvržení se kreslí ručně (obdélníky, text, pruhy),
 * proto je tenhle soubor delší, než by byla HTML šablona.
 *
 * Písmo: Liberation Sans (metricky shodné s Arialem, licence SIL OFL) se
 * přibaluje k funkci jako statický soubor – vestavěná Helvetica neumí
 * české znaky. Když se písmo nepodaří načíst, kreslí se Helveticou
 * s odstraněnou diakritikou, ať report přijde vždycky.
 */
import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb, type RGB } from "https://esm.sh/pdf-lib@1.17.1";
import fontkit from "https://esm.sh/@pdf-lib/fontkit@1.1.1";
import { korunyCele, procenta, procentniZmena, type HodnotnyZakaznik, type PravidelnyZakaznik } from "../_shared/statistikyReport.ts";

export type KpiReportu = {
  obrat: number;
  zisk: number;
  naklady: number;
  slevy: number;
  marzePct: number;
  prumernaCena: number;
  pocet: number;
  dokonceno: number;
  reklamace: number;
  prumernaDobaDny: number;
  /** Položky bez nákladů – marže je pak nadhodnocená; report to napíše. */
  bezNakladu: number;
};

export type ReportData = {
  frekvence: "mesicne" | "tydne";
  nazevObdobi: string;
  rozsah: string;
  predchoziNazev: string;
  servis: { nazev: string; ico: string; email: string; telefon: string };
  vygenerovano: string;
  kpi: KpiReportu;
  kpiPredchozi: KpiReportu;
  mesice: { popisek: string; obrat: number; zisk: number; pocet: number }[];
  stavy: { nazev: string; pocet: number; barva: string | null; konecny: boolean }[];
  topOpravy: { nazev: string; pocet: number }[];
  topZarizeni: { nazev: string; pocet: number }[];
  hodnotni: HodnotnyZakaznik[];
  pravidelni: PravidelnyZakaznik[];
  technici: { jmeno: string; prijato: number; dokonceno: number; hodiny: number }[];
  pobocky: { nazev: string; pocet: number; obrat: number; marze: number; marzePct: number }[];
};

export type Pisma = { regular: Uint8Array | null; bold: Uint8Array | null };

// --- barvy ------------------------------------------------------------------
const hex = (h: string): RGB => {
  const m = h.replace("#", "");
  return rgb(parseInt(m.slice(0, 2), 16) / 255, parseInt(m.slice(2, 4), 16) / 255, parseInt(m.slice(4, 6), 16) / 255);
};
const B = {
  tmava: hex("#0F172A"),
  text: hex("#0F172A"),
  tlumena: hex("#64748B"),
  jemna: hex("#94A3B8"),
  akcent: hex("#2563EB"),
  akcentSvetly: hex("#DBEAFE"),
  zelena: hex("#15803D"),
  zelenaSvetla: hex("#DCFCE7"),
  cervena: hex("#B91C1C"),
  cervenaSvetla: hex("#FEE2E2"),
  pozadi: hex("#F8FAFC"),
  pozadi2: hex("#F1F5F9"),
  ramecek: hex("#E2E8F0"),
  bila: rgb(1, 1, 1),
};

const A4 = { w: 595.28, h: 841.89 };
const OKRAJ = 40;
const SIRKA = A4.w - 2 * OKRAJ;

/**
 * Bez diakritiky a symbolů mimo WinAnsi – pro Helveticu, když se nepodařilo
 * načíst písmo. Cokoli, co ani po přepisu není v Latin-1, nahradí otazník;
 * vestavěné písmo by na neznámém znaku vyhodilo výjimku a report by nevznikl.
 */
function bezDiakritiky(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[–—]/g, "-")
    .replace(/[„“”]/g, '"')
    .replace(/…/g, "...")
    .replace(/▲/g, "+")
    .replace(/▼/g, "-")
    .replace(/≥/g, ">=")
    .replace(/[^\x00-\xff]/g, "?");
}

class Platno {
  doc: PDFDocument;
  page!: PDFPage;
  y = 0;
  private strany: PDFPage[] = [];
  constructor(doc: PDFDocument, private reg: PDFFont, private bold: PDFFont, private unicode: boolean) {
    this.doc = doc;
  }

  private t(s: string): string {
    return this.unicode ? s : bezDiakritiky(s);
  }
  font(tucne = false): PDFFont {
    return tucne ? this.bold : this.reg;
  }
  sirkaTextu(s: string, size: number, tucne = false): number {
    try {
      return this.font(tucne).widthOfTextAtSize(this.t(s), size);
    } catch {
      return this.font(tucne).widthOfTextAtSize(bezDiakritiky(s), size);
    }
  }
  /** Zkrátí text třemi tečkami, ať se vejde do šířky. */
  orez(s: string, max: number, size: number, tucne = false): string {
    if (this.sirkaTextu(s, size, tucne) <= max) return s;
    let t = s;
    while (t.length > 1 && this.sirkaTextu(`${t}…`, size, tucne) > max) t = t.slice(0, -1);
    return `${t.trimEnd()}…`;
  }
  text(s: string, x: number, y: number, size: number, o: { tucne?: boolean; barva?: RGB; zarovnat?: "left" | "right" | "center"; max?: number } = {}) {
    const f = this.font(o.tucne);
    let txt = o.max ? this.orez(s, o.max, size, o.tucne) : s;
    let w = this.sirkaTextu(txt, size, o.tucne);
    let px = x;
    if (o.zarovnat === "right") px = x - w;
    else if (o.zarovnat === "center") px = x - w / 2;
    try {
      this.page.drawText(this.t(txt), { x: px, y, size, font: f, color: o.barva ?? B.text });
    } catch {
      // Glyf, který v písmu není (emoji, exotický znak) – radši bez diakritiky než spadnout.
      txt = bezDiakritiky(txt);
      w = f.widthOfTextAtSize(txt, size);
      if (o.zarovnat === "right") px = x - w;
      else if (o.zarovnat === "center") px = x - w / 2;
      this.page.drawText(txt, { x: px, y, size, font: f, color: o.barva ?? B.text });
    }
  }
  obdelnik(x: number, y: number, w: number, h: number, barva: RGB, o: { ramecek?: RGB; radius?: number } = {}) {
    this.page.drawRectangle({ x, y, width: w, height: h, color: barva, borderColor: o.ramecek, borderWidth: o.ramecek ? 0.75 : 0 });
  }
  linka(x1: number, y1: number, x2: number, y2: number, barva = B.ramecek, tloustka = 0.75) {
    this.page.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, color: barva, thickness: tloustka });
  }

  novaStranka(nadpis?: string) {
    this.page = this.doc.addPage([A4.w, A4.h]);
    this.strany.push(this.page);
    this.y = A4.h - OKRAJ;
    if (nadpis) {
      this.text(nadpis, OKRAJ, this.y - 10, 9, { barva: B.tlumena });
      this.linka(OKRAJ, this.y - 18, OKRAJ + SIRKA, this.y - 18);
      this.y -= 32;
    }
  }
  /** Když se blok nevejde, začne novou stránku. */
  zajisti(vyska: number, nadpisPokracovani: string) {
    if (this.y - vyska < OKRAJ + 24) this.novaStranka(nadpisPokracovani);
  }
  nadpisSekce(s: string, podtitul?: string) {
    this.zajisti(34, s);
    this.text(s.toUpperCase(), OKRAJ, this.y - 10, 9, { tucne: true, barva: B.tlumena });
    if (podtitul) this.text(podtitul, OKRAJ + this.sirkaTextu(s.toUpperCase(), 9, true) + 8, this.y - 10, 8, { barva: B.jemna });
    this.linka(OKRAJ, this.y - 16, OKRAJ + SIRKA, this.y - 16);
    this.y -= 26;
  }
  paticky(popisek: string) {
    const n = this.strany.length;
    this.strany.forEach((p, i) => {
      this.page = p;
      this.linka(OKRAJ, OKRAJ - 6, OKRAJ + SIRKA, OKRAJ - 6);
      this.text(popisek, OKRAJ, OKRAJ - 18, 7.5, { barva: B.jemna });
      this.text(`Strana ${i + 1} / ${n}`, OKRAJ + SIRKA, OKRAJ - 18, 7.5, { barva: B.jemna, zarovnat: "right" });
    });
  }
}

// --- dílčí bloky --------------------------------------------------------------

function sipkaZmeny(akt: number, pred: number, opacne = false): { text: string; barva: RGB; pozadi: RGB } {
  const z = procentniZmena(akt, pred);
  if (z === null || Math.abs(z) < 0.05) {
    return { text: z === null ? "bez srovnání" : "beze změny", barva: B.tlumena, pozadi: B.pozadi2 };
  }
  const nahoru = z > 0;
  const dobra = opacne ? !nahoru : nahoru;
  return {
    text: `${nahoru ? "▲" : "▼"} ${procenta(Math.abs(z), Math.abs(z) < 10 ? 1 : 0)}`,
    barva: dobra ? B.zelena : B.cervena,
    pozadi: dobra ? B.zelenaSvetla : B.cervenaSvetla,
  };
}

function hlavicka(p: Platno, d: ReportData) {
  const vyska = 104;
  const top = A4.h;
  p.obdelnik(0, top - vyska, A4.w, vyska, B.tmava);
  const druh = d.frekvence === "tydne" ? "TÝDENNÍ REPORT" : "MĚSÍČNÍ REPORT";
  p.text(druh, OKRAJ, top - 34, 9, { tucne: true, barva: hex("#93C5FD") });
  p.text(d.nazevObdobi, OKRAJ, top - 60, 24, { tucne: true, barva: B.bila, max: 320 });
  p.text(d.rozsah, OKRAJ, top - 80, 10, { barva: hex("#CBD5E1") });

  const px = OKRAJ + SIRKA;
  p.text(d.servis.nazev || "Servis", px, top - 34, 12, { tucne: true, barva: B.bila, zarovnat: "right", max: 220 });
  const radky = [d.servis.ico ? `IČO ${d.servis.ico}` : "", d.servis.email, d.servis.telefon].filter(Boolean);
  radky.forEach((r, i) => p.text(r, px, top - 52 - i * 13, 9, { barva: hex("#CBD5E1"), zarovnat: "right", max: 220 }));

  p.y = top - vyska - 22;
}

function velkeDlazdice(p: Platno, d: ReportData) {
  const mezera = 12;
  const w = (SIRKA - 2 * mezera) / 3;
  const h = 92;
  p.zajisti(h + 10, d.nazevObdobi);
  const k = d.kpi;
  const kp = d.kpiPredchozi;
  const bezNakladu = k.bezNakladu > 0;
  const dlazdice = [
    { nadpis: "OBRAT", hodnota: korunyCele(k.obrat), zmena: sipkaZmeny(k.obrat, kp.obrat), pod: `Průměrná cena zakázky ${korunyCele(k.prumernaCena)}` },
    { nadpis: "ZISK", hodnota: korunyCele(k.zisk), zmena: sipkaZmeny(k.zisk, kp.zisk), pod: `Marže ${procenta(k.marzePct)}${bezNakladu ? " · část položek bez nákladů" : ""}` },
    { nadpis: "ZAKÁZKY", hodnota: `${new Intl.NumberFormat("cs-CZ").format(k.pocet)}`, zmena: sipkaZmeny(k.pocet, kp.pocet), pod: `Dokončeno ${k.dokonceno} · Reklamace ${k.reklamace}` },
  ];
  dlazdice.forEach((t, i) => {
    const x = OKRAJ + i * (w + mezera);
    const y = p.y - h;
    p.obdelnik(x, y, w, h, B.pozadi, { ramecek: B.ramecek });
    p.obdelnik(x, y + h - 4, w, 4, i === 0 ? B.akcent : i === 1 ? B.zelena : hex("#7C3AED"));
    p.text(t.nadpis, x + 12, y + h - 22, 8, { tucne: true, barva: B.tlumena });
    p.text(t.hodnota, x + 12, y + h - 48, 20, { tucne: true, max: w - 24 });
    // Odznak změny
    const sz = p.sirkaTextu(t.zmena.text, 8, true) + 12;
    p.obdelnik(x + 12, y + 22, sz, 14, t.zmena.pozadi);
    p.text(t.zmena.text, x + 18, y + 26, 8, { tucne: true, barva: t.zmena.barva });
    p.text(`vs. ${d.predchoziNazev}`, x + 12 + sz + 6, y + 26, 7.5, { barva: B.jemna, max: w - sz - 30 });
    p.text(t.pod, x + 12, y + 9, 7.5, { barva: B.tlumena, max: w - 24 });
  });
  p.y -= h + 12;
}

function maleDlazdice(p: Platno, d: ReportData) {
  const k = d.kpi;
  const kp = d.kpiPredchozi;
  const dokoncenost = k.pocet > 0 ? (k.dokonceno / k.pocet) * 100 : 0;
  const podilReklamaci = k.pocet > 0 ? (k.reklamace / k.pocet) * 100 : 0;
  const polozky = [
    { n: "NÁKLADY", v: korunyCele(k.naklady), z: sipkaZmeny(k.naklady, kp.naklady, true) },
    { n: "SLEVY", v: korunyCele(k.slevy), z: sipkaZmeny(k.slevy, kp.slevy, true) },
    { n: "DOKONČENOST", v: procenta(dokoncenost, 0), z: null },
    { n: "PODÍL REKLAMACÍ", v: procenta(podilReklamaci), z: null },
    { n: "PRŮMĚRNÁ DOBA", v: k.prumernaDobaDny > 0 ? `${new Intl.NumberFormat("cs-CZ", { maximumFractionDigits: 1 }).format(k.prumernaDobaDny)} dne` : "—", z: sipkaZmeny(k.prumernaDobaDny, kp.prumernaDobaDny, true) },
  ];
  const mezera = 8;
  const w = (SIRKA - (polozky.length - 1) * mezera) / polozky.length;
  const h = 54;
  p.zajisti(h + 10, d.nazevObdobi);
  polozky.forEach((t, i) => {
    const x = OKRAJ + i * (w + mezera);
    const y = p.y - h;
    p.obdelnik(x, y, w, h, B.bila, { ramecek: B.ramecek });
    p.text(t.n, x + 10, y + h - 16, 7, { tucne: true, barva: B.tlumena, max: w - 20 });
    p.text(t.v, x + 10, y + h - 36, 13, { tucne: true, max: w - 20 });
    if (t.z) p.text(t.z.text, x + 10, y + 7, 7, { tucne: true, barva: t.z.barva });
  });
  p.y -= h + 18;
}

function grafMesicu(p: Platno, d: ReportData) {
  if (d.mesice.length === 0) return;
  p.nadpisSekce("Vývoj obratu", "posledních 6 měsíců, zisk tmavší barvou");
  const h = 120;
  p.zajisti(h + 30, d.nazevObdobi);
  const top = p.y;
  const spodek = top - h + 22;
  const max = Math.max(1, ...d.mesice.map((m) => m.obrat));
  // Popisky osy vlevo v odsazeném pruhu, ať nepřekrývají poslední sloupec.
  const osa = 56;
  const slot = (SIRKA - osa) / d.mesice.length;
  const sirkaSloupce = Math.min(46, slot * 0.55);
  // Vodicí linky
  for (let i = 0; i <= 3; i++) {
    const y = spodek + ((h - 40) * i) / 3;
    p.linka(OKRAJ + osa, y, OKRAJ + SIRKA, y, B.pozadi2);
    p.text(korunyCele((max * i) / 3), OKRAJ + osa - 6, y - 2, 6.5, { barva: B.jemna, zarovnat: "right" });
  }
  d.mesice.forEach((m, i) => {
    const cx = OKRAJ + osa + slot * i + slot / 2;
    const x = cx - sirkaSloupce / 2;
    const vyska = ((h - 40) * m.obrat) / max;
    const vyskaZisku = ((h - 40) * Math.max(0, m.zisk)) / max;
    const posledni = i === d.mesice.length - 1;
    p.obdelnik(x, spodek, sirkaSloupce, Math.max(vyska, 0.5), posledni ? B.akcent : hex("#BFDBFE"));
    if (vyskaZisku > 0) p.obdelnik(x, spodek, sirkaSloupce, vyskaZisku, posledni ? hex("#1E3A8A") : hex("#93C5FD"));
    if (m.obrat > 0) p.text(korunyCele(m.obrat), cx, spodek + vyska + 4, 6.5, { barva: B.tlumena, zarovnat: "center" });
    p.text(m.popisek, cx, spodek - 11, 8, { tucne: posledni, barva: posledni ? B.text : B.tlumena, zarovnat: "center" });
    p.text(`${m.pocet} zak.`, cx, spodek - 20, 6.5, { barva: B.jemna, zarovnat: "center" });
  });
  p.y = spodek - 34;
}

/** Dva sloupce vedle sebe: seznam s vodorovnými pruhy. */
function dvaSloupce(
  p: Platno,
  d: ReportData,
  levy: { nadpis: string; podtitul?: string; radky: { nazev: string; hodnota: string; podil: number; barva?: RGB }[] },
  pravy: { nadpis: string; podtitul?: string; radky: { nazev: string; hodnota: string; podil: number; barva?: RGB }[] },
) {
  const mezera = 20;
  const w = (SIRKA - mezera) / 2;
  const radekH = 18;
  const n = Math.max(levy.radky.length, pravy.radky.length, 1);
  p.zajisti(30 + n * radekH + 10, d.nazevObdobi);
  const top = p.y;
  [levy, pravy].forEach((s, si) => {
    const x = OKRAJ + si * (w + mezera);
    p.text(s.nadpis.toUpperCase(), x, top - 10, 9, { tucne: true, barva: B.tlumena });
    if (s.podtitul) p.text(s.podtitul, x + p.sirkaTextu(s.nadpis.toUpperCase(), 9, true) + 8, top - 10, 8, { barva: B.jemna });
    p.linka(x, top - 16, x + w, top - 16);
    if (s.radky.length === 0) p.text("Žádná data v období.", x, top - 32, 8, { barva: B.jemna });
    // Pruh končí před nejširší hodnotou ve sloupci – jinak přes něj text přetéká.
    const sirkaHodnot = Math.max(30, ...s.radky.map((r) => p.sirkaTextu(r.hodnota, 8, true)));
    const sirkaPruhu = Math.max(20, w - 100 - sirkaHodnot - 8);
    s.radky.forEach((r, i) => {
      const y = top - 26 - i * radekH;
      p.obdelnik(x + 100, y - 10, sirkaPruhu, 8, B.pozadi2);
      p.obdelnik(x + 100, y - 10, Math.max(1, sirkaPruhu * Math.min(1, r.podil)), 8, r.barva ?? B.akcent);
      p.text(r.nazev, x, y - 8, 8, { max: 96 });
      p.text(r.hodnota, x + w, y - 8, 8, { tucne: true, zarovnat: "right" });
    });
  });
  p.y = top - 26 - n * radekH - 6;
}

function tabulka(
  p: Platno,
  d: ReportData,
  nadpis: string,
  podtitul: string | undefined,
  sloupce: { n: string; w: number; zarovnat?: "left" | "right" }[],
  radky: string[][],
  prazdne = "Žádná data v období.",
) {
  const radekH = 18;
  // Nadpis nesmí zůstat sám na konci stránky – drží se s hlavičkou a prvními řádky.
  p.zajisti(34 + radekH * (Math.min(radky.length, 4) + 1) + 6, `${d.nazevObdobi} · ${nadpis}`);
  p.nadpisSekce(nadpis, podtitul);
  if (radky.length === 0) {
    p.text(prazdne, OKRAJ, p.y - 8, 8, { barva: B.jemna });
    p.y -= 22;
    return;
  }
  p.zajisti(radekH * (radky.length + 1) + 6, `${d.nazevObdobi} · ${nadpis}`);
  const celkem = sloupce.reduce((s, c) => s + c.w, 0);
  const meritko = SIRKA / celkem;
  let x = OKRAJ;
  const yh = p.y - 12;
  sloupce.forEach((c) => {
    const w = c.w * meritko;
    p.text(c.n, c.zarovnat === "right" ? x + w - 6 : x + 6, yh, 7.5, { tucne: true, barva: B.tlumena, zarovnat: c.zarovnat === "right" ? "right" : "left" });
    x += w;
  });
  p.y -= radekH;
  radky.forEach((r, ri) => {
    if (p.y - radekH < OKRAJ + 24) {
      p.novaStranka(`${d.nazevObdobi} · ${nadpis}`);
    }
    const y = p.y - radekH;
    if (ri % 2 === 0) p.obdelnik(OKRAJ, y, SIRKA, radekH, B.pozadi);
    let cx = OKRAJ;
    sloupce.forEach((c, ci) => {
      const w = c.w * meritko;
      p.text(r[ci] ?? "", c.zarovnat === "right" ? cx + w - 6 : cx + 6, y + 5.5, 8, { max: w - 12, zarovnat: c.zarovnat === "right" ? "right" : "left", tucne: ci === 1 && ri < 3 && nadpis.startsWith("Hodnotní") });
      cx += w;
    });
    p.y = y;
  });
  p.y -= 14;
}

// --- vstup ----------------------------------------------------------------------

export async function vykresliReportPdf(d: ReportData, pisma: Pisma): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`${d.frekvence === "tydne" ? "Týdenní" : "Měsíční"} report – ${d.nazevObdobi} – ${d.servis.nazev}`);
  doc.setAuthor("Jobi");
  doc.setCreator("Jobi · statistics-report-send");
  doc.setLanguage("cs");

  let reg: PDFFont;
  let bold: PDFFont;
  let unicode = true;
  try {
    if (!pisma.regular || !pisma.bold) throw new Error("bez písma");
    doc.registerFontkit(fontkit);
    reg = await doc.embedFont(pisma.regular, { subset: true });
    bold = await doc.embedFont(pisma.bold, { subset: true });
  } catch (e) {
    console.warn("[statistics-report-send] písmo se nepodařilo vložit, kreslím Helveticou bez diakritiky:", e);
    reg = await doc.embedFont(StandardFonts.Helvetica);
    bold = await doc.embedFont(StandardFonts.HelveticaBold);
    unicode = false;
  }

  const p = new Platno(doc, reg, bold, unicode);
  p.novaStranka();
  hlavicka(p, d);
  velkeDlazdice(p, d);
  maleDlazdice(p, d);
  grafMesicu(p, d);

  // Stavy a opravy vedle sebe
  const celkemStavy = Math.max(1, d.stavy.reduce((s, x) => s + x.pocet, 0));
  const maxOpravy = Math.max(1, ...d.topOpravy.map((o) => o.pocet));
  p.zajisti(40, d.nazevObdobi);
  dvaSloupce(
    p,
    d,
    {
      nadpis: "Stavy zakázek",
      podtitul: "k poslednímu dni období",
      radky: d.stavy.slice(0, 8).map((s) => ({
        nazev: s.nazev,
        hodnota: `${s.pocet} · ${procenta((s.pocet / celkemStavy) * 100, 0)}`,
        podil: s.pocet / celkemStavy,
        barva: s.barva && /^#[0-9a-f]{6}$/i.test(s.barva) ? hex(s.barva) : s.konecny ? B.zelena : B.akcent,
      })),
    },
    {
      nadpis: "Nejčastější opravy",
      radky: d.topOpravy.slice(0, 8).map((o) => ({ nazev: o.nazev, hodnota: `${o.pocet}×`, podil: o.pocet / maxOpravy })),
    },
  );

  // Zařízení
  const celkemZarizeni = Math.max(1, d.kpi.pocet);
  const maxZar = Math.max(1, ...d.topZarizeni.map((z) => z.pocet));
  const maxTech = Math.max(1, ...d.technici.map((t) => t.dokonceno + t.prijato));
  dvaSloupce(
    p,
    d,
    {
      nadpis: "Typy zařízení",
      podtitul: "podíl na zakázkách",
      radky: d.topZarizeni.slice(0, 8).map((z) => ({ nazev: z.nazev, hodnota: `${z.pocet} ks · ${procenta((z.pocet / celkemZarizeni) * 100, 0)}`, podil: z.pocet / maxZar, barva: hex("#7C3AED") })),
    },
    {
      nadpis: "Technici",
      podtitul: "přijal / dokončil",
      radky: d.technici.slice(0, 8).map((t) => ({
        nazev: t.jmeno,
        hodnota: `${t.prijato} / ${t.dokonceno}${t.hodiny > 0 ? ` · ${new Intl.NumberFormat("cs-CZ", { maximumFractionDigits: 1 }).format(t.hodiny)} h` : ""}`,
        podil: (t.prijato + t.dokonceno) / maxTech,
        barva: hex("#0D9488"),
      })),
    },
  );

  tabulka(
    p,
    d,
    "Hodnotní zákazníci",
    "podle obratu v období",
    [{ n: "#", w: 5 }, { n: "Zákazník", w: 40 }, { n: "Zakázek", w: 15, zarovnat: "right" }, { n: "Obrat", w: 22, zarovnat: "right" }, { n: "Podíl", w: 18, zarovnat: "right" }],
    d.hodnotni.map((z, i) => [String(i + 1), z.jmeno, String(z.pocet), korunyCele(z.obrat), procenta(z.podil)]),
  );

  tabulka(
    p,
    d,
    "Pravidelní zákazníci",
    "≥ 2 zakázky v období nebo ≥ 3 za posledních 12 měsíců",
    [{ n: "#", w: 5 }, { n: "Zákazník", w: 40 }, { n: "V období", w: 15, zarovnat: "right" }, { n: "12 měsíců", w: 18, zarovnat: "right" }, { n: "Obrat v období", w: 22, zarovnat: "right" }],
    d.pravidelni.map((z, i) => [String(i + 1), z.jmeno, String(z.pocetVObdobi), String(z.pocet12m), korunyCele(z.obrat)]),
  );

  if (d.pobocky.length > 1) {
    tabulka(
      p,
      d,
      "Pobočky",
      "srovnání v období",
      [{ n: "Pobočka", w: 40 }, { n: "Zakázek", w: 15, zarovnat: "right" }, { n: "Obrat", w: 20, zarovnat: "right" }, { n: "Zisk", w: 20, zarovnat: "right" }, { n: "Marže", w: 15, zarovnat: "right" }],
      d.pobocky.map((b) => [b.nazev, String(b.pocet), korunyCele(b.obrat), korunyCele(b.marze), procenta(b.marzePct)]),
    );
  }

  // Poznámka k metodice – ať čísla nikdo nečte jinak, než jak vznikla.
  p.zajisti(48, d.nazevObdobi);
  p.text("Jak se počítá", OKRAJ, p.y - 8, 7.5, { tucne: true, barva: B.tlumena });
  const pozn = [
    "Obrat = konečné ceny provedených oprav po slevě; stornované zakázky se do peněz nepočítají, do počtů ano.",
    "Zisk = obrat − náklady (náklady z ceníku oprav a nákupní ceny dílů ze skladu). Položky bez nákladů zisk nadhodnocují.",
    "Období se počítá podle data přijetí zakázky v čase Europe/Prague. Srovnání je s bezprostředně předchozím obdobím.",
  ];
  pozn.forEach((t, i) => p.text(t, OKRAJ, p.y - 20 - i * 10, 7, { barva: B.jemna, max: SIRKA }));
  p.y -= 50;

  p.paticky(`Jobi · ${d.servis.nazev} · vygenerováno ${d.vygenerovano}`);
  return doc.save();
}
