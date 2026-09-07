/**
 * Peníze napříč aplikací: aplikace, doklad a server musí říkat totéž.
 *
 * Cenu zakázky, slevu, DPH a součet faktury počítá aplikace (`invoiceMath.ts`,
 * `slevaZakazky.ts`), jádro dokladů (`jobidocs/core/variables.ts`) a server
 * (`supabase/functions/_shared/penize.ts`). Jsou to tři samostatné
 * implementace téhož vzorce – jádro dokladů běží i v JobiDocs bez Jobi,
 * server v Denu bez obojího – takže se nedají sloučit do jednoho souboru
 * a musí je držet u sebe test. Rozdíl o haléř znamená, že zákazník má na
 * papíře jiné číslo než na obrazovce a v portálu třetí.
 *
 * Testy jsou z větší části vlastnostní (property): místo pár ručně vybraných
 * čísel se vygeneruje několik set dokladů a ověří se pravidla, která musí
 * platit pro každý z nich. Generátor má pevný seed, takže když něco spadne,
 * dá se pád zopakovat – hláška vždycky vypíše doklad, na kterém se to stalo.
 */
import { describe, expect, it } from "vitest";
import { computeLine, computeTotals, castkaBezMeny, formatCurrency, naHalere, rezimProMenu, type InvoiceLineItem } from "./invoiceMath";
import { castkaSlevy, hrubaCena, konecnaCena, korunami } from "./slevaZakazky";
import { invoiceDocumentData } from "./documentData";
import {
  DEFAULT_BRAND,
  DEFAULT_THEME,
  defaultTemplate,
  discountAmount,
  formatMoney,
  itemsSubtotal,
  itemsTotal,
  naHalere as naHalereDoklad,
  renderDocument,
  vatRozpis,
  type DocumentData,
} from "../../jobidocs/core/index";
import { castkaBezMeny as castkaBezMenyServer, cenaZakazky, castkaSlevy as castkaSlevyServer, formatujCastku, konecnaCena as konecnaCenaServer, naHalere as naHalereServer } from "../../supabase/functions/_shared/penize";
import { cenoveVarianty } from "../../supabase/functions/_shared/ceny";

// ---------------------------------------------------------------------------
// Generátor se seedem

/**
 * Malý deterministický generátor (mulberry32).
 *
 * `Math.random()` by dělal testy, které jednou za čas spadnou a nikdo je
 * nedokáže zopakovat. Se seedem stačí do hlášky napsat, který doklad
 * neprošel, a pád se dá vyvolat znovu na kterémkoli stroji.
 */
function generator(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Sazby, které servis reálně namíchá na jeden doklad. */
const SAZBY = [21, 12, 0];

type Nahoda = () => number;

const vyber = <T,>(r: Nahoda, z: readonly T[]): T => z[Math.floor(r() * z.length)];

/**
 * Částka na haléře v rozsahu, který se v servisu opravdu vyskytuje.
 *
 * Záměrně sem patří i drobné (1,50 Kč za šroubek) a ceny končící na půl
 * haléře – právě tam se zaokrouhlení rozchází.
 */
function castka(r: Nahoda, max = 20000): number {
  const hala = Math.floor(r() * max * 100) + 1;
  return hala / 100;
}

/** Množství: kusy i půlhodiny práce, databáze drží tři desetinná místa. */
function mnozstvi(r: Nahoda): number {
  const t = r();
  if (t < 0.55) return Math.floor(r() * 9) + 1;
  if (t < 0.85) return Math.round(r() * 20) / 2 || 0.5;
  return Math.max(0.001, Math.round(r() * 5000) / 1000);
}

function polozka(r: Nahoda, platce: boolean): InvoiceLineItem {
  return {
    name: `Položka ${Math.floor(r() * 1000)}`,
    qty: mnozstvi(r),
    unit: vyber(r, ["ks", "h", "sada"]),
    unit_price: castka(r),
    // Neplátce DPH má na všech řádcích nulu – jinou sazbu ani nabídnout nesmí.
    vat_rate: platce ? vyber(r, SAZBY) : 0,
  };
}

type Doklad = { items: InvoiceLineItem[]; mena: string; platce: boolean };

function doklad(r: Nahoda): Doklad {
  const platce = r() < 0.8;
  const pocet = 1 + Math.floor(r() * 6);
  return {
    items: Array.from({ length: pocet }, () => polozka(r, platce)),
    // Eura jsou tu kvůli zaokrouhlení: na celé jednotky se zaokrouhlují jen koruny.
    mena: r() < 0.85 ? "CZK" : "EUR",
    platce,
  };
}

/** Doklad do hlášky, aby šel pád zopakovat i bez debuggeru. */
const popis = (d: Doklad) =>
  `${d.mena}, ${d.platce ? "plátce" : "neplátce"}: ` + d.items.map((i) => `${i.qty}×${i.unit_price}@${i.vat_rate}%`).join(" + ");

const SEED = 20260907;
const KOL = 400;

/** Projede `KOL` náhodných dokladů se stejným seedem pro každou vlastnost. */
function proKazdyDoklad(nazev: string, kontrola: (d: Doklad) => void) {
  it(nazev, () => {
    const r = generator(SEED);
    for (let i = 0; i < KOL; i++) {
      const d = doklad(r);
      try {
        kontrola(d);
      } catch (e) {
        throw new Error(`${(e as Error).message}\n  doklad #${i} (seed ${SEED}): ${popis(d)}`);
      }
    }
  });
}

// ---------------------------------------------------------------------------
// Jeden vzorec na třech místech

describe("tři implementace jednoho zaokrouhlení", () => {
  it("naHalere v aplikaci, na dokladu i na serveru dává na každé částce totéž", () => {
    const r = generator(SEED);
    for (let i = 0; i < 5000; i++) {
      // Celý rozsah včetně záporných (dobropis) a hodnot přesně na půl haléři.
      const n = (Math.floor(r() * 4000001) - 2000000) / 200;
      expect(naHalereDoklad(n), `doklad se rozešel na ${n}`).toBe(naHalere(n));
      expect(naHalereServer(n), `server se rozešel na ${n}`).toBe(naHalere(n));
    }
  });

  it("půlka se zaokrouhluje od nuly, aby dobropis vrátil přesně to, co faktura vzala", () => {
    expect(naHalere(0.125)).toBe(0.13);
    expect(naHalere(-0.125)).toBe(-0.13);
    expect(naHalere(2.675)).toBe(2.68); // 2,675 × 100 je ve floatu 267,49999999999997
    expect(naHalere(-2.675)).toBe(-2.68);
  });

  it("záporná nula se nikde nepropíše na doklad", () => {
    expect(Object.is(naHalere(-0.0001), 0)).toBe(true);
    expect(formatCurrency(-0.004)).toBe(formatMoney(-0.004));
    expect(formatMoney(-0.004)).not.toContain("−");
    expect(formatMoney(-0.004)).not.toContain("-");
  });

  it("sleva se počítá stejně v aplikaci i na serveru", () => {
    const r = generator(SEED);
    for (let i = 0; i < 2000; i++) {
      const hruba = castka(r, 50000);
      const typ = vyber(r, ["percentage", "amount", null] as const);
      const hodnota = r() < 0.5 ? Math.floor(r() * 120) : castka(r, 60000);
      expect(castkaSlevyServer(hruba, typ, hodnota), `sleva ${typ} ${hodnota} z ${hruba}`).toBe(castkaSlevy(hruba, typ, hodnota));
      expect(konecnaCenaServer(hruba, typ, hodnota), `konečná ${typ} ${hodnota} z ${hruba}`).toBe(konecnaCena(hruba, typ, hodnota));
    }
  });

  it("cena zakázky ze serveru se rovná ceně na kartě zakázky", () => {
    const r = generator(SEED);
    for (let i = 0; i < 1000; i++) {
      const opravy = Array.from({ length: 1 + Math.floor(r() * 8) }, () => ({ price: castka(r) }));
      const typ = vyber(r, ["percentage", "amount", null] as const);
      const hodnota = Math.floor(r() * 100);
      expect(cenaZakazky(opravy, typ, hodnota)).toBe(konecnaCena(hrubaCena(opravy), typ, hodnota));
    }
  });
});

describe("formát částky je všude stejný", () => {
  it("aplikace, doklad, server i karta zakázky napíšou „1 234,50 Kč“", () => {
    const r = generator(SEED);
    for (let i = 0; i < 3000; i++) {
      const n = (Math.floor(r() * 2000001) - 1000000) / 100;
      const app = formatCurrency(n, "CZK");
      expect(formatMoney(n, "CZK"), `doklad se rozešel na ${n}`).toBe(app);
      expect(formatujCastku(n, "CZK"), `server se rozešel na ${n}`).toBe(app);
      expect(korunami(n), `karta zakázky se rozešla na ${n}`).toBe(app);
      expect(castkaBezMenyServer(n), `SMS se rozešla na ${n}`).toBe(castkaBezMeny(n));
    }
  });

  it("1 234,50 Kč má nedělitelnou mezeru a desetinnou čárku, ne tečku", () => {
    const s = formatCurrency(1234.5);
    expect(s).toMatch(/^1[\u00a0\u202f ]234,50[\u00a0\u202f ]Kč$/);
    expect(formatMoney(1234.5)).toBe(s);
    expect(formatujCastku(1234.5)).toBe(s);
    expect(korunami(1234.5)).toBe(s);
    // Celá koruna se píše s haléři taky: „1 234 Kč“ vedle „1 234,50 Kč“ mate.
    expect(formatCurrency(1234)).toMatch(/1[\u00a0\u202f ]234,00/);
  });

  it("neznámá měna nesmí shodit tisk a zůstane česká i v náhradním formátu", () => {
    // Vymyšlený kód měny projde Intl.NumberFormat jen jako obyčejné číslo.
    const app = formatCurrency(1234.5, "XYZ_NEEXISTUJE");
    expect(app).toContain("1");
    expect(formatMoney(1234.5, "XYZ_NEEXISTUJE")).toBe(app);
    expect(formatujCastku(1234.5, "XYZ_NEEXISTUJE")).toBe(app);
  });
});

// ---------------------------------------------------------------------------
// Součty dokladu

describe("součet dokladu", () => {
  proKazdyDoklad("položky se vždycky sečtou na celek dokladu", (d) => {
    const t = computeTotals(d.items, d.mena);
    const soucetRadku = d.items.reduce((s, i) => naHalere(s + computeLine(i).line_total), 0);
    expect(t.subtotal, "základ neodpovídá součtu řádků").toBe(soucetRadku);
    // Tohle je celé jádro věci: co je na dokladu vypsané, musí dát dohromady
    // to, co je pod čarou. Sčítá se přesně, ne „přibližně“.
    expect(naHalere(t.subtotal + t.vat_amount), "základ + DPH ≠ celkem").toBe(t.total);
    expect(naHalere(t.total + t.rounding), "celkem + zaokrouhlení ≠ k úhradě").toBe(t.total_rounded);
  });

  proKazdyDoklad("rozpad DPH po sazbách sedí na základ i na daň", (d) => {
    const t = computeTotals(d.items, d.mena);
    const zaklady = naHalere(t.vat_breakdown.reduce((s, v) => s + v.base, 0));
    const dane = naHalere(t.vat_breakdown.reduce((s, v) => s + v.vat, 0));
    expect(zaklady, "součet základů po sazbách ≠ základ dokladu").toBe(t.subtotal);
    expect(dane, "součet daní po sazbách ≠ DPH dokladu").toBe(t.vat_amount);

    // Každá sazba jednou a vzestupně – účetní čte rekapitulaci shora dolů.
    const sazby = t.vat_breakdown.map((v) => v.rate);
    expect(new Set(sazby).size, "sazba je v rekapitulaci dvakrát").toBe(sazby.length);
    expect([...sazby].sort((a, b) => a - b), "sazby nejsou seřazené").toEqual(sazby);
    for (const v of t.vat_breakdown) {
      const radky = d.items.map(computeLine).filter((l) => l.vat_rate === v.rate);
      expect(v.base, `základ sazby ${v.rate} %`).toBe(radky.reduce((s, l) => naHalere(s + l.line_total), 0));
      expect(v.vat, `daň sazby ${v.rate} %`).toBe(radky.reduce((s, l) => naHalere(s + l.line_vat), 0));
    }
    // Nulová sazba nesmí zmizet: doklad musí ukázat i osvobozený základ.
    if (d.items.some((i) => i.vat_rate === 0)) expect(sazby, "nulová sazba se z rekapitulace ztratila").toContain(0);
  });

  proKazdyDoklad("neplátce nemá na dokladu ani korunu DPH", (d) => {
    if (d.platce) return;
    const t = computeTotals(d.items, d.mena);
    expect(t.vat_amount, "neplátci se spočítalo DPH").toBe(0);
    expect(t.subtotal, "neplátci se základ liší od celku").toBe(t.total);
  });

  proKazdyDoklad("zaokrouhlení na koruny je vidět jako samostatný řádek a nikdy se neztratí", (d) => {
    const t = computeTotals(d.items, d.mena);
    if (d.mena === "CZK") {
      expect(Number.isInteger(t.total_rounded), "koruny se nezaokrouhlily na celé").toBe(true);
      // Zaokrouhlit se smí nejvýš o půl koruny – větší rozdíl je chyba výpočtu.
      expect(Math.abs(t.rounding), "zaokrouhlení přeskočilo půl koruny").toBeLessThanOrEqual(0.5);
    } else {
      // V eurech se platí na centy; „zaokrouhlení 0,10 €“ by byl doklad na jinou částku.
      expect(t.rounding, "v cizí měně se zaokrouhlovalo na jednotky").toBe(0);
      expect(t.total_rounded).toBe(t.total);
    }
    // Rozdíl mezi spočítaným a účtovaným celkem musí být na dokladu pojmenovaný,
    // jinak řádky nedají součet a účetní hledá chybějící korunu.
    expect(naHalere(t.total + t.rounding), "zaokrouhlení nesedí na celek").toBe(t.total_rounded);
    if (t.rounding !== 0) expect(t.total_rounded).not.toBe(t.total);
  });

  it("koruny se zaokrouhlují, eura ne – režim se bere z měny dokladu", () => {
    expect(rezimProMenu("CZK")).toBe("koruny");
    expect(rezimProMenu("EUR")).toBe("halere");
    expect(rezimProMenu(null)).toBe("koruny");
    const eura = computeTotals([{ name: "x", qty: 1, unit: "ks", unit_price: 82.56, vat_rate: 21 }], "EUR");
    expect(eura.total_rounded).toBe(99.9);
    expect(eura.rounding).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Klasika: haléřové rozdíly při rozpadu na položky

describe("haléřové rozdíly na položkách", () => {
  it("3× 333,33 s DPH 21 % – jedna položka i tři řádky dají tentýž doklad", () => {
    const jedna = computeTotals([{ name: "Oprava", qty: 3, unit: "ks", unit_price: 333.33, vat_rate: 21 }]);
    const tri = computeTotals(Array.from({ length: 3 }, () => ({ name: "Oprava", qty: 1, unit: "ks", unit_price: 333.33, vat_rate: 21 })));
    expect(jedna.subtotal).toBe(999.99);
    expect(jedna.vat_amount).toBe(210);
    expect(jedna.total).toBe(1209.99);
    // Celkem 1 209,99 → účtuje se 1 210 Kč a chybějící haléř má na dokladu jméno.
    expect(jedna.rounding).toBe(0.01);
    expect(jedna.total_rounded).toBe(1210);
    expect(tri).toEqual(jedna);
  });

  it("součet DPH po řádcích se smí lišit od daně ze základu – doklad ukazuje ten po řádcích", () => {
    // Tři drobné po 1 haléři: daň z každého řádku je 0,00, ale ze základu 0,01.
    const t = computeTotals(Array.from({ length: 3 }, () => ({ name: "Šroubek", qty: 1, unit: "ks", unit_price: 0.01, vat_rate: 21 })));
    expect(t.subtotal).toBe(0.03);
    expect(naHalere(t.subtotal * 0.21)).toBe(0.01);
    expect(t.vat_amount, "DPH se sečetlo jinak, než co je na řádcích").toBe(0);
    // I tak musí doklad sednout sám se sebou.
    expect(naHalere(t.subtotal + t.vat_amount)).toBe(t.total);
  });

  it("sazby 21 / 12 / 0 na jednom dokladu se rozpadnou po sazbách a sečtou na celek", () => {
    const t = computeTotals([
      { name: "Displej", qty: 1, unit: "ks", unit_price: 5990, vat_rate: 21 },
      { name: "Kniha návodů", qty: 1, unit: "ks", unit_price: 250, vat_rate: 12 },
      { name: "Poštovné (osvobozeno)", qty: 1, unit: "ks", unit_price: 99, vat_rate: 0 },
    ]);
    expect(t.vat_breakdown).toEqual([
      { rate: 0, base: 99, vat: 0 },
      { rate: 12, base: 250, vat: 30 },
      { rate: 21, base: 5990, vat: 1257.9 },
    ]);
    expect(t.subtotal).toBe(6339);
    expect(t.vat_amount).toBe(1287.9);
    expect(t.total).toBe(7626.9);
    expect(t.total_rounded).toBe(7627);
    expect(t.rounding).toBe(0.1);
  });

  it("ceny zadané s DPH i bez dají tentýž doklad", () => {
    // Ceník servisu drží 2 420 Kč s DPH; faktura se počítá ze základu.
    const varianty = cenoveVarianty(2420, 21, true, true);
    expect(varianty.price_excl_vat).toBe(2000);
    const t = computeTotals([{ name: "Oprava", qty: 1, unit: "ks", unit_price: varianty.price_excl_vat, vat_rate: 21 }]);
    expect(t.total_rounded).toBe(2420);
    // A opačně: cena zadaná bez DPH se na doklad dostane se stejnou daní.
    expect(cenoveVarianty(2000, 21, false, true).price_incl_vat).toBe(2420);
  });

  it("ceník počítá DPH stejným zaokrouhlením jako faktura", () => {
    const r = generator(SEED);
    for (let i = 0; i < 2000; i++) {
      const cena = castka(r, 5000);
      for (const sazba of [21, 12]) {
        const zCeniku = cenoveVarianty(cena, sazba, false, true).price_incl_vat;
        const zFaktury = computeTotals([{ name: "x", qty: 1, unit: "ks", unit_price: cena, vat_rate: sazba }]);
        expect(zCeniku, `ceník a faktura se rozešly na ${cena} Kč / ${sazba} %`).toBe(naHalere(zFaktury.subtotal + zFaktury.vat_amount));
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Sleva

describe("sleva", () => {
  it("sleva nikdy nedá zápornou cenu a nikdy nestrhne víc, než kolik je cena", () => {
    const r = generator(SEED);
    for (let i = 0; i < 5000; i++) {
      const hruba = r() < 0.1 ? 0 : castka(r, 50000);
      const typ = vyber(r, ["percentage", "amount", null] as const);
      // Schválně i nesmysly z ruky: záporné, obří i procenta nad sto.
      const hodnota = vyber(r, [Math.floor(r() * 400) - 50, castka(r, 100000), -castka(r, 1000), 0]);
      const sleva = castkaSlevy(hruba, typ, hodnota);
      const konecna = konecnaCena(hruba, typ, hodnota);
      const zprava = `hrubá ${hruba}, sleva ${typ} ${hodnota}`;
      expect(sleva, `sleva vyšla záporná (${zprava})`).toBeGreaterThanOrEqual(0);
      expect(sleva, `sleva je vyšší než cena (${zprava})`).toBeLessThanOrEqual(Math.max(0, hruba));
      expect(konecna, `konečná cena je záporná (${zprava})`).toBeGreaterThanOrEqual(0);
      expect(konecna, `konečná cena je vyšší než hrubá (${zprava})`).toBeLessThanOrEqual(Math.max(0, hruba));
      expect(naHalere(sleva + konecna), `sleva + konečná ≠ hrubá (${zprava})`).toBe(naHalere(Math.max(0, hruba)));
    }
  });

  it("sleva na dokladu se rovná slevě v aplikaci – jinak řádky nesečtou celek", () => {
    const r = generator(SEED);
    for (let i = 0; i < 2000; i++) {
      const ceny = Array.from({ length: 1 + Math.floor(r() * 5) }, () => castka(r));
      const typ = vyber(r, ["percentage", "amount"] as const);
      const hodnota = typ === "percentage" ? 1 + Math.floor(r() * 60) : castka(r, 5000);
      const hruba = hrubaCena(ceny.map((p) => ({ price: p })));
      const data: DocumentData = {
        service: { name: "Servis Novák" },
        items: ceny.map((p) => ({ name: "Oprava", qty: 1, unit: "ks", total: p })),
        discount: { type: typ, value: hodnota },
        totals: { total: konecnaCena(hruba, typ, hodnota), currency: "CZK" },
      };
      const zprava = `ceny ${ceny.join("+")}, sleva ${typ} ${hodnota}`;
      expect(itemsSubtotal(data), `součet položek na dokladu (${zprava})`).toBe(hruba);
      expect(discountAmount(data), `sleva na dokladu (${zprava})`).toBe(castkaSlevy(hruba, typ, hodnota));
      // Na papíře musí vyjít odčítání: součet položek − sleva = Celkem k úhradě.
      expect(naHalere(itemsSubtotal(data)! - discountAmount(data)!), `řádky dokladu nesečtou celek (${zprava})`).toBe(itemsTotal(data));
    }
  });

  it("zakázka za 100,75 Kč se slevou 10 % má na dokladu tutéž slevu jako v aplikaci", () => {
    // Konkrétní případ, kvůli kterému test vznikl: jádro dokladů dřív
    // zaokrouhlovalo holým Math.round a vytisklo „Sleva −10,07 Kč“,
    // zatímco Jobi počítalo 10,08 Kč – řádky pak nesečetly „Celkem“.
    const hruba = 100.75;
    expect(castkaSlevy(hruba, "percentage", 10)).toBe(10.08);
    const data: DocumentData = {
      service: { name: "Servis Novák" },
      items: [{ name: "Oprava", qty: 1, unit: "ks", total: hruba }],
      discount: { type: "percentage" as const, value: 10 },
      totals: { total: konecnaCena(hruba, "percentage", 10), currency: "CZK" },
    };
    expect(discountAmount(data)).toBe(10.08);
    expect(itemsTotal(data)).toBe(90.67);
  });
});

// ---------------------------------------------------------------------------
// Dobropis

/** Faktura z položek tak, jak ji uloží editor (viz persistEditor v Invoices.tsx). */
function ulozenaFaktura(items: InvoiceLineItem[], mena: string, kind: "invoice" | "credit_note" = "invoice") {
  const t = computeTotals(items, mena);
  return {
    hlavicka: {
      number: kind === "credit_note" ? "DB2026-0001" : "FV2026-0001",
      kind,
      currency: mena,
      issue_date: "2026-09-07",
      due_date: "2026-09-21",
      taxable_date: "2026-09-07",
      subtotal: t.subtotal,
      vat_amount: t.vat_amount,
      total: t.total_rounded,
      rounding: t.rounding,
      variable_symbol: "20260001",
    },
    // Řádky se ukládají stejným výpočtem jako hlavička – to je celý smysl.
    polozky: items.map((it, idx) => ({ ...it, line_total: computeLine(it).line_total, sort_order: idx })),
    totals: t,
  };
}

describe("dobropis", () => {
  proKazdyDoklad("dobropis je přesně zápornou fakturou a nikdy nevrátí víc, než faktura vzala", (d) => {
    const f = computeTotals(d.items, d.mena);
    // Dobropis vzniká ze stejných položek se záporným množstvím (vystavitDobropis).
    const db = computeTotals(d.items.map((i) => ({ ...i, qty: -i.qty })), d.mena);
    // `naHalere` kolem otočeného znaménka srovná zápornou nulu na nulu –
    // doklad na 0 Kč se nesmí lišit podle toho, ze které strany se k němu jde.
    expect(db.subtotal, "základ dobropisu není zrcadlem faktury").toBe(naHalere(-f.subtotal));
    expect(db.vat_amount, "DPH dobropisu není zrcadlem faktury").toBe(naHalere(-f.vat_amount));
    expect(db.total, "celek dobropisu není zrcadlem faktury").toBe(naHalere(-f.total));
    expect(db.rounding, "zaokrouhlení dobropisu není zrcadlem faktury").toBe(naHalere(-f.rounding));
    expect(db.total_rounded, "k úhradě na dobropisu není zrcadlem faktury").toBe(naHalere(-f.total_rounded));
    // A hlavně: dobropis nesmí vrátit víc peněz, než kolik faktura naúčtovala.
    expect(Math.abs(db.total_rounded), "dobropis přesáhl původní fakturu").toBeLessThanOrEqual(Math.abs(f.total_rounded));
    for (const v of db.vat_breakdown) {
      const puvodni = f.vat_breakdown.find((x) => x.rate === v.rate)!;
      expect(v.vat, `daň sazby ${v.rate} % na dobropisu`).toBe(naHalere(-puvodni.vat));
    }
  });

  it("uložené řádky dobropisu se sečtou na jeho hlavičku – i u půlhodin na haléři", () => {
    // 0,5 h × 100,01 Kč: holé Math.round dalo −50,00, hlavička ale −50,01,
    // takže položky na dokladu nesečetly svůj vlastní součet.
    const polozky: InvoiceLineItem[] = [{ name: "Práce", qty: -0.5, unit: "h", unit_price: 100.01, vat_rate: 21 }];
    const db = ulozenaFaktura(polozky, "CZK", "credit_note");
    expect(db.polozky[0].line_total).toBe(-50.01);
    expect(db.hlavicka.subtotal).toBe(-50.01);
    const soucet = db.polozky.reduce((s, p) => naHalere(s + p.line_total), 0);
    expect(soucet, "uložené řádky nesečtou základ v hlavičce").toBe(db.hlavicka.subtotal);
  });

  it("dobropis na drobné se netiskne jako „−0,00 Kč“", () => {
    // Nula se porovnává s vyrobenou nulou, ne s napsaným řetězcem –
    // před „Kč“ je nedělitelná mezera, kterou v editoru nikdo nerozezná.
    expect(formatCurrency(-0.004)).toBe(formatCurrency(0));
    expect(formatMoney(-0.004)).toBe(formatCurrency(0));
    expect(formatujCastku(-0.004)).toBe(formatCurrency(0));
  });
});

// ---------------------------------------------------------------------------
// Aplikace vs. vytištěný doklad

describe("aplikace a vytištěný doklad ukazují totéž", () => {
  proKazdyDoklad("podklady dokladu nesou přesně ta čísla, která byla v editoru", (d) => {
    const f = ulozenaFaktura(d.items, d.mena);
    const data = invoiceDocumentData(f.hlavicka as never, f.polozky as never, { name: "Servis Novák" } as never, d.platce);

    // Celkem k úhradě na dokladu = Celkem v editoru.
    expect(itemsTotal(data), "Celkem na dokladu ≠ Celkem v editoru").toBe(f.totals.total_rounded);
    expect(data.totals?.subtotal, "Základ na dokladu ≠ Základ v editoru").toBe(f.totals.subtotal);
    expect(data.totals?.vat, "DPH na dokladu ≠ DPH v editoru").toBe(f.totals.vat_amount);
    // Zaokrouhlení má na dokladu vlastní řádek – nulové se netiskne.
    expect(data.totals?.rounding ?? 0, "Zaokrouhlení na dokladu ≠ v editoru").toBe(f.totals.rounding);

    // Rekapitulace DPH: doklad ji odvozuje z uložených řádků, editor
    // z rozepsaných položek. Musí vyjít stejně, jinak si účetní daň
    // z dokladu zpětně nerozpočítá.
    if (d.platce) {
      expect(vatRozpis(data), "rekapitulace DPH na dokladu ≠ v editoru").toEqual(f.totals.vat_breakdown);
    } else {
      expect(data.totals?.vatBreakdown, "neplátci se na doklad dostala rekapitulace DPH").toBeUndefined();
    }

    // A součet vytištěných řádků musí dát vytištěný základ.
    const radky = (data.items ?? []).reduce((s, i) => naHalere(s + (i.total ?? 0)), 0);
    expect(radky, "řádky na dokladu nesečtou základ").toBe(f.totals.subtotal);
  });

  it("vytištěná faktura obsahuje tytéž částky jako editor, na haléř a ve stejném formátu", () => {
    const items: InvoiceLineItem[] = [
      { name: "Výměna displeje", qty: 3, unit: "ks", unit_price: 333.33, vat_rate: 21 },
      { name: "Kniha návodů", qty: 1, unit: "ks", unit_price: 250, vat_rate: 12 },
      { name: "Poštovné", qty: 1, unit: "ks", unit_price: 99, vat_rate: 0 },
    ];
    const f = ulozenaFaktura(items, "CZK");
    const data = invoiceDocumentData(f.hlavicka as never, f.polozky as never, { name: "Servis Novák" } as never, true);
    const html = renderDocument({ template: defaultTemplate("faktura"), data, brand: DEFAULT_BRAND, theme: DEFAULT_THEME, options: { mode: "print" } });
    const text = html.replace(/<[^>]+>/g, " ");

    // Přesně to, co uživatel vidí v panelu součtů před vystavením.
    expect(f.totals.subtotal).toBe(1348.99);
    expect(f.totals.vat_amount).toBe(240);
    expect(f.totals.rounding).toBe(0.01);
    expect(f.totals.total_rounded).toBe(1589);

    for (const castka of [f.totals.subtotal, f.totals.vat_amount, f.totals.total_rounded]) {
      expect(text, `na dokladu chybí ${formatCurrency(castka)}`).toContain(formatCurrency(castka));
    }
    // Rekapitulace po sazbách patří na daňový doklad ke každé sazbě zvlášť.
    expect(text).toContain("DPH 21 %");
    expect(text).toContain("DPH 12 %");
    expect(text).toContain("Zaokrouhlení");
    expect(text).toContain(formatCurrency(0.01));
    // Strojový zápis částky se na český doklad nesmí dostat.
    expect(text).not.toMatch(/\d\.\d\d\s*Kč/);
    expect(text).not.toContain("NaN");
  });

  it("neplátce DPH nemá na vytištěné faktuře žádný daňový řádek", () => {
    const f = ulozenaFaktura([{ name: "Oprava", qty: 1, unit: "ks", unit_price: 1500, vat_rate: 0 }], "CZK");
    const data = invoiceDocumentData(f.hlavicka as never, f.polozky as never, { name: "Servis Novák" } as never, false);
    const html = renderDocument({ template: defaultTemplate("faktura"), data, brand: DEFAULT_BRAND, theme: DEFAULT_THEME, options: { mode: "print" } });
    const text = html.replace(/<[^>]+>/g, " ");
    expect(data.title).toBe("Faktura");
    expect(text).toContain("Nejsme plátci DPH.");
    expect(text).toContain(formatCurrency(1500));
  });
});
