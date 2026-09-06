/**
 * Doklady, které zákazník odnáší od pultu.
 *
 * Renderer je poslední místo před papírem: co projde tudy, to si zákazník
 * přečte. Testy níž proto nekoukají na to, jak je renderer napsaný, ale na
 * to, co po vytištění zbude na papíře – jestli tam nesvítí „undefined“,
 * jestli částky vypadají česky a jestli text od zákazníka nemůže doklad
 * rozhodit.
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_BRAND,
  DEFAULT_THEME,
  DOC_TYPES,
  defaultTemplate,
  formatDate,
  formatMoney,
  itemsTotal,
  renderDocument,
  type DocType,
  type DocumentData,
} from "./index.js";

const tisk = (docType: DocType, data: DocumentData): string =>
  renderDocument({ template: defaultTemplate(docType), data, brand: DEFAULT_BRAND, theme: DEFAULT_THEME, options: { mode: "print" } });

/**
 * Co je vidět na papíře – tělo dokumentu bez stylů a bez měřicího skriptu.
 * Styly a skript obsahují technické texty, které zákazník nikdy neuvidí.
 */
function naPapire(html: string): string {
  const od = html.indexOf("<body");
  const konec = html.indexOf("<script", od);
  return html.slice(od, konec === -1 ? undefined : konec);
}

/** Řádek „Celkem“ z tabulky položek. */
function radekCelkem(html: string): string {
  const i = html.indexOf('<tr class="total">');
  return i === -1 ? "" : html.slice(i, html.indexOf("</tr>", i));
}

/** Zakázka, ze které vypadla skoro všechna data – servis ji stejně musí vytisknout. */
const derava: DocumentData = {
  service: {},
  customer: {},
  device: {},
  dates: {},
  items: [{ name: "Oprava" }],
  totals: { currency: "CZK" },
};

const NBSP = " ";

// Servisák tiskne i zakázku, kde chybí půlka údajů: zákazník přišel bez
// jména, telefon nediktoval, sériové číslo se nedalo přečíst. Na papíře
// se to smí projevit jen tím, že řádek chybí – ne slovem „undefined“.
describe("doklad z neúplných dat", () => {
  it("žádný ze sedmi dokladů nevytiskne undefined, NaN ani null", () => {
    for (const docType of DOC_TYPES) {
      for (const data of [{ service: {} } as DocumentData, derava]) {
        const papir = naPapire(tisk(docType, data));
        expect(papir, docType).not.toContain("undefined");
        expect(papir, docType).not.toContain("NaN");
        expect(papir, docType).not.toContain("null");
      }
    }
  });

  it("zakázka bez cen nikde nenechá osamocené „Kč“", () => {
    for (const docType of DOC_TYPES) {
      const papir = naPapire(tisk(docType, derava));
      // Skutečná částka má před „Kč“ nezlomitelnou mezeru a před ní číslici.
      // (Legální text mluví o skladném „20 Kč“, ten sem nepatří.)
      expect(papir, docType).not.toMatch(/>\s*Kč/);
      expect(papir, docType).not.toMatch(/[^0-9] Kč/);
    }
  });

  it("zakázkový list bez zákazníka a bez sériového čísla vynechá celé řádky", () => {
    const papir = naPapire(tisk("zakazkovy_list", derava));
    expect(papir).not.toContain("Sériové číslo");
    expect(papir).not.toContain("Telefon");
    // Blok „Zařízení“ ale zmizet nesmí – požadovaná oprava se doplňuje ručně.
    expect(papir).toContain("Zakázkový list");
  });

  it("nevyplněné firemní údaje nevytisknou hlavičku s prázdným IČO a odrážkami", () => {
    const papir = naPapire(tisk("zakazkovy_list", derava));
    expect(papir).not.toContain("IČO");
    expect(papir).not.toContain("DIČ");
  });

  it("zakázka bez jediné opravy nevytiskne prázdnou tabulku položek", () => {
    const papir = naPapire(tisk("zarucni_list", { service: { name: "Servis" }, items: [] }));
    expect(papir).not.toContain("Provedené práce");
    expect(papir).not.toContain("<table class=\"items\"");
  });
});

// Doklad je účetní papír. „1234.5 Kč“ nebo „NaN.NaN.NaN“ na něm znamená,
// že zákazník volá do servisu a ptá se, kolik má vlastně zaplatit.
describe("české částky a datumy", () => {
  it("částka má nezlomitelnou mezeru v tisících, desetinnou čárku a dva halíře", () => {
    expect(formatMoney(1234.5)).toBe(`1${NBSP}234,50${NBSP}Kč`);
    expect(formatMoney(0)).toBe(`0,00${NBSP}Kč`);
    expect(formatMoney(1234567)).toBe(`1${NBSP}234${NBSP}567,00${NBSP}Kč`);
  });

  it("chybějící nebo nečíselná částka se netiskne vůbec, ne jako NaN", () => {
    expect(formatMoney(undefined)).toBe("");
    expect(formatMoney(null)).toBe("");
    expect(formatMoney(Number.NaN)).toBe("");
    expect(formatMoney(Number.POSITIVE_INFINITY)).toBe("");
  });

  it("nečitelné datum se vytiskne tak, jak přišlo, ne jako NaN.NaN.NaN", () => {
    expect(formatDate("2026-13-01")).toBe("2026-13-01");
    expect(formatDate("do pátku")).toBe("do pátku");
    expect(formatDate(undefined)).toBe("");
    expect(formatDate(null)).toBe("");
    const papir = naPapire(tisk("zakazkovy_list", { service: { name: "Servis" }, dates: { received: "do pátku" } }));
    expect(papir).toContain("do pátku");
    expect(papir).not.toContain("NaN");
  });

  it("z ISO data s časem zbude na dokladu jen datum", () => {
    expect(formatDate("2026-09-01T08:15:00.000Z")).toBe("1. 9. 2026");
    expect(formatDate("2026-09-01")).toBe("1. 9. 2026");
  });
});

// Když se řádek Sleva a řádek Celkem rozejdou, zákazník to u pultu spočítá
// dřív než servis. A záporná konečná cena znamená, že servis dluží jemu.
describe("sleva na dokladu", () => {
  const seSlevou = (discount: DocumentData["discount"]): DocumentData => ({
    service: { name: "Servis" },
    items: [
      { name: "Výměna displeje", qty: 1, unit: "ks", total: 1000 },
      { name: "Výměna baterie", qty: 1, unit: "ks", total: 500 },
    ],
    totals: { currency: "CZK" },
    discount,
  });

  it("řádek Celkem odpovídá součtu položek po odečtení slevy", () => {
    const data = seSlevou({ type: "percentage", value: 10 });
    expect(itemsTotal(data)).toBe(1350);
    const papir = naPapire(tisk("zarucni_list", data));
    expect(papir).toContain("Sleva");
    expect(radekCelkem(papir)).toContain(`1${NBSP}350,00${NBSP}Kč`);
  });

  it("sleva v korunách se odečte na haléř přesně", () => {
    const data = seSlevou({ type: "amount", value: 249.5 });
    expect(itemsTotal(data)).toBe(1250.5);
    expect(radekCelkem(naPapire(tisk("zarucni_list", data)))).toContain(`1${NBSP}250,50${NBSP}Kč`);
  });

  it("sleva vyšší než cena nevytiskne zápornou částku", () => {
    const data = seSlevou({ type: "amount", value: 5000 });
    expect(itemsTotal(data)).toBe(0);
    const celkem = radekCelkem(naPapire(tisk("zarucni_list", data)));
    expect(celkem).toContain(`0,00${NBSP}Kč`);
    expect(celkem).not.toContain("−");
    expect(celkem).not.toMatch(/>-/);
  });

  it("stoprocentní sleva dá nulu, ne prázdné místo", () => {
    const data = seSlevou({ type: "percentage", value: 100 });
    expect(itemsTotal(data)).toBe(0);
    expect(radekCelkem(naPapire(tisk("zarucni_list", data)))).toContain(`0,00${NBSP}Kč`);
  });

  it("u oprav bez cen se řádek Celkem netiskne vůbec, místo nuly", () => {
    const papir = naPapire(tisk("zarucni_list", { service: { name: "Servis" }, items: [{ name: "Výměna displeje" }], totals: { currency: "CZK" } }));
    expect(papir).toContain("Výměna displeje");
    expect(radekCelkem(papir)).toBe("");
  });
});

// Záruční list bez data „do kdy“ je pro zákazníka bezcenný papír.
describe("záruka na záručním listu", () => {
  it("vytiskne délku záruky i den, do kterého platí", () => {
    const papir = naPapire(tisk("zarucni_list", { service: { name: "Servis" }, warranty: { months: 12, until: "2027-09-03" } }));
    expect(papir).toContain("12 měsíců");
    expect(papir).toContain("3. 9. 2027");
  });

  it("bez počtu měsíců se vytiskne aspoň datum, do kdy záruka platí", () => {
    const papir = naPapire(tisk("zarucni_list", { service: { name: "Servis" }, warranty: { until: "2027-09-03" } }));
    expect(papir).toContain("3. 9. 2027");
  });

  it("bez jakéhokoli údaje o záruce se blok Záruka na doklad nedostane", () => {
    const papir = naPapire(tisk("zarucni_list", { service: { name: "Servis" } }));
    expect(papir).not.toContain('data-type="warranty"');
  });
});

// Jméno zákazníka i název opravy píše člověk. Když do nich napíše „<“,
// nesmí se z dokladu stát rozsypaný čaj ani se do něj nesmí propašovat
// značka, kterou tam servis nechtěl.
describe("text od zákazníka na dokladu", () => {
  it("špičaté závorky ve jméně zákazníka se vytisknou jako text", () => {
    const html = tisk("zakazkovy_list", { service: { name: "Servis" }, customer: { name: "<Jan> Novák & syn" } });
    expect(html).toContain("&lt;Jan&gt; Novák &amp; syn");
    expect(html).not.toContain("<Jan>");
  });

  it("název opravy se skriptem nepropašuje skript do dokladu", () => {
    const html = tisk("zarucni_list", { service: { name: "Servis" }, items: [{ name: "<script>alert(1)</script>", total: 100 }], totals: { currency: "CZK" } });
    expect(html).not.toContain("<script>alert(1)");
    expect(html).toContain("&lt;script&gt;");
  });

  it("uvozovky v poznámce nerozbijí atributy dokumentu", () => {
    const html = tisk("vydejka_reklamace", { service: { name: "Servis" }, note: '" onload="alert(1)' });
    expect(html).not.toContain('onload="alert(1)"');
    expect(html).toContain("&quot;");
  });

  it("adresa fotky se nedá zneužít k vlastnímu atributu", () => {
    const html = tisk("diagnosticky_protokol", {
      service: { name: "Servis" },
      photos: ['https://example.com/a.jpg" onerror="alert(1)'],
    });
    expect(html).not.toContain('onerror="alert(1)"');
    expect(html).toContain("&quot;");
  });

  it("emoji v názvu opravy projde na doklad beze změny", () => {
    const html = tisk("zarucni_list", { service: { name: "Servis" }, items: [{ name: "Výměna displeje 📱 (originál)", total: 5990 }], totals: { currency: "CZK" } });
    expect(html).toContain("Výměna displeje 📱 (originál)");
  });
});

// Zakázka s dvaceti opravami a poznámkou na půl stránky je běžná
// u firemních zákazníků. Doklad se má poskládat, ne spadnout.
describe("dlouhé zakázky", () => {
  const ctyricetOprav = Array.from({ length: 40 }, (_, i) => ({ name: `Oprava číslo ${i + 1}`, qty: 1, unit: "ks", total: 100 }));

  it("čtyřicet oprav se vytiskne do jedné tabulky a sečte se správně", () => {
    const data: DocumentData = { service: { name: "Servis" }, items: ctyricetOprav, totals: { currency: "CZK" } };
    expect(itemsTotal(data)).toBe(4000);
    const papir = naPapire(tisk("zarucni_list", data));
    expect(papir).toContain("Oprava číslo 1<");
    expect(papir).toContain("Oprava číslo 40<");
    expect(radekCelkem(papir)).toContain(`4${NBSP}000,00${NBSP}Kč`);
  });

  it("dvousetznakový název opravy a tisícznaková poznámka doklad nerozbijí", () => {
    const dlouhyNazev = "Výměna displeje ".repeat(13).slice(0, 200);
    const poznamka = "Zákazník žádá zavolat před opravou. ".repeat(30).slice(0, 1000);
    const papir = naPapire(
      tisk("zarucni_list", { service: { name: "Servis" }, items: [{ name: dlouhyNazev, total: 100 }], note: poznamka, totals: { currency: "CZK" } }),
    );
    expect(papir).toContain(dlouhyNazev);
    // Pořád jedna strana dokumentu, ne čtyřicet oříznutých kusů.
    expect(papir.match(/<section class="page"/g)?.length).toBe(1);
  });
});

// Faktura je jediný doklad, kde se rozdíl mezi plátcem a neplátcem DPH
// projeví přímo na papíře – a špatně vytištěná DPH je problém pro účetní.
describe("faktura", () => {
  const faktura = (totals: DocumentData["totals"]): DocumentData => ({
    service: { name: "Servis" },
    number: "FV2026-0042",
    items: [{ name: "Výměna displeje", qty: 1, unit: "ks", unitPrice: 1000, total: 1000 }],
    totals,
    dates: { issued: "2026-09-03", due: "2026-09-17" },
  });

  it("plátce DPH má na faktuře základ daně i daň", () => {
    const papir = naPapire(tisk("faktura", faktura({ subtotal: 1000, vat: 210, total: 1210, currency: "CZK", vatPayer: true })));
    expect(papir).toContain("Základ daně");
    expect(papir).toContain("DPH");
    expect(papir).toContain(`1${NBSP}210,00${NBSP}Kč`);
  });

  it("neplátce DPH nemá řádek DPH, ale má na dokladu napsáno proč", () => {
    const papir = naPapire(tisk("faktura", faktura({ total: 1000, subtotal: 1000, vat: 0, currency: "CZK", vatPayer: false })));
    expect(papir).toContain("Nejsme plátci DPH.");
    expect(papir).not.toContain("Základ daně");
  });

  it("faktura bez platebních údajů netiskne prázdný blok s číslem účtu", () => {
    const papir = naPapire(tisk("faktura", { service: { name: "Servis" }, number: "FV1", totals: { currency: "CZK" } }));
    expect(papir).not.toContain("Číslo účtu");
    expect(papir).not.toContain("IBAN");
  });

  it("v eurech se netiskne Kč", () => {
    const papir = naPapire(tisk("faktura", faktura({ subtotal: 100, vat: 21, total: 121, currency: "EUR", vatPayer: true })));
    expect(papir).toContain("€");
    expect(papir).not.toContain("Kč");
  });
});
