import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { odhadniMapovani, parseCsv } from "../../src/lib/csv";
import { odhadniMapovaniCeniku, pripravCenik } from "../../src/lib/importCeniku";
import { odhadniMapovaniKomentaru, pripravKomentare } from "../../src/lib/importKomentaru";
import { odhadniMapovaniZakazek, pripravZakazky, radkyHistorie, type StavServisu } from "../../src/lib/importZakazek";
import {
  castka,
  cenikZKatalogu,
  cenikZeZakazek,
  csv,
  hodnota,
  kratkyStav,
  minuty,
  polozkyOprav,
  posledniPodleKodu,
  preved,
  slozeneOpravy,
  zakaznici,
  znackaKategorie,
  type ZlZaznam,
} from "./prevod";

/**
 * Převodník se testuje proti fixture vyrobené podle struktury z kódu bota
 * (umělá jména a čísla). Hlavní test pouští výstup přímo přes funkce importu
 * v Jobi – když se změní předvolba sloupců nebo parser, spadne tady.
 */
const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
const ndjson = (f: string): ZlZaznam[] => fs.readFileSync(path.join(DIR, f), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as ZlZaznam);
const ZAKAZKY = ndjson("zakazky.ndjson");
const REKLAMACE = ndjson("reklamace.ndjson");
const KATALOG = JSON.parse(fs.readFileSync(path.join(DIR, "katalog.json"), "utf8")) as Record<string, unknown>;
const EXPORT = fs.readFileSync(path.join(DIR, "zakaznici-export.csv"), "utf8");

/** Servis se stavy převzatými ze ZL (scripts/import-zakazkovylist/statuses.sql, výběr). */
const STAVY_ZL: StavServisu[] = [
  { key: "draft", label: "Zakládá se", isFinal: false },
  { key: "received", label: "Přijato", isFinal: false },
  { key: "in_repair", label: "V opravě", isFinal: false },
  { key: "waiting_part", label: "Čeká na díl", isFinal: false },
  { key: "issued", label: "Vydáno", isFinal: true },
  { key: "cancelled", label: "Stornováno", isFinal: true },
];
/** Výchozí stavy nového servisu v Jobi. */
const STAVY_JOBI: StavServisu[] = [
  { key: "received", label: "Přijato", isFinal: false },
  { key: "in_progress", label: "V opravě", isFinal: false },
  { key: "completed", label: "Hotovo", isFinal: true },
];
const ted = () => "2026-09-27T10:00:00.000Z";

describe("migrace-zl – převody hodnot", () => {
  it("prázdné hodnoty a věty ZL místo hodnoty", () => {
    expect(hodnota("-")).toBeNull();
    expect(hodnota("Nevyplněno")).toBeNull();
    expect(hodnota("Popis závady pro průvodní dopis nebyl vyplněn.")).toBeNull();
    expect(hodnota("U této zakázky nebyl zvolen zákazník.")).toBeNull();
    expect(hodnota("Anonymní zákazník")).toBeNull();
    expect(hodnota("  Jana   Testová ")).toBe("Jana Testová");
  });

  it("částky včetně věty přilepené za částkou", () => {
    expect(castka("2 600,00 Kč")).toBe(2600);
    expect(castka("3 500,00 Kč Cena zakázky je vyšší než předpokládaná cena.")).toBe(3500);
    expect(castka("-200,00 Kč")).toBe(-200);
    expect(castka("Nebyla stanovená předpokládaná cena zakázky.")).toBeNull();
    expect(castka("-")).toBeNull();
    expect(castka("12a3")).toBeNaN();
  });

  it("krátký stav a minuty z volného textu ceníku", () => {
    expect(kratkyStav("Vydáno - Zakázka dokončena")).toBe("Vydáno");
    expect(kratkyStav("Stornováno - Reklamace dokončena")).toBe("Stornováno");
    expect(kratkyStav("Oprava desky - Vasil")).toBe("Oprava desky - Vasil");
    expect([minuty("60 min."), minuty("60 mion."), minuty("2 hod"), minuty("1 den."), minuty("2- 3 dny"), minuty("1 - 10 dnů"), minuty(""), minuty("brzy")]).toEqual([60, 60, 120, 1440, 4320, 14400, null, Number.NaN]);
  });

  it("položky oprav: pořadí sloupců z hlavičky, bez Celkem a prázdného rozpisu, oddělovače z názvu pryč", () => {
    const { polozky, varovani } = polozkyOprav(ZAKAZKY[0]);
    expect(varovani).toEqual([]);
    expect(polozky).toEqual([
      { nazev: "Výměna displeje (originální)", cena: 3990, naklady: 2100 },
      { nazev: "Sleva , věrnostní", cena: -200, naklady: null },
    ]);
    expect(slozeneOpravy(polozky)).toBe("Výměna displeje (originální);3990;2100|Sleva , věrnostní;-200");
    expect(polozkyOprav(ZAKAZKY[1]).polozky).toEqual([]);
    // U reklamace jen vlastní řešení, ne kopie položek původní zakázky.
    expect(polozkyOprav(REKLAMACE[0], true).polozky).toEqual([{ nazev: "Výměna displeje (originální)", cena: 0, naklady: 0 }]);
  });

  it("CSV: uvozovky jen kde je potřeba, BOM a CRLF", () => {
    expect(csv(["a", "b"], [["x;y", 'řekl "ne"'], ["", null]])).toBe('﻿a;b\r\n"x;y";"řekl ""ne"""\r\n;\r\n');
  });

  it("opakovaně stažený kód: vyhrává poslední úspěšný záznam", () => {
    const p = posledniPodleKodu(ZAKAZKY);
    expect(p.map((z) => z.code)).toEqual(["TSTZ2400001", "TSTZ2400002", "TSTZ2400003", "TSTZ2400004"]);
    expect(p.find((z) => z.code === "TSTZ2400003")?.error).toBeUndefined();
    expect(posledniPodleKodu([ZAKAZKY[3], ZAKAZKY[2]]).find((z) => z.code === "TSTZ2400003")?.error).toBeUndefined();
  });
});

describe("migrace-zl – zakazky.csv projde importem zakázek v Jobi", () => {
  const v = preved({ zakazky: ZAKAZKY, reklamace: REKLAMACE, ted: new Date("2026-09-27T10:00:00Z") });
  const t = parseCsv(v.soubory["zakazky.csv"]);
  const m = odhadniMapovaniZakazek(t.hlavicka, "zl");

  it("předvolba Zakázkový list přiřadí každý sloupec sama", () => {
    expect(t.oddelovac).toBe(";");
    expect(m).toEqual([
      "code", "created_at", "completed_at", "status", "customer_name", "customer_phone", "customer_email", "customer_company",
      "device_label", "device_serial", "device_imei", "notes", "device_condition", "estimated_price", "external_id", "performed_repairs", "status_history",
    ]);
  });

  it("bez chyb, s mapováním stavů 1:1 na stavy převzaté ze ZL", () => {
    const p = pripravZakazky(t, m, { existujiciKody: new Set(), stavy: STAVY_ZL, fallbackKey: "received", ted });
    expect(p.chyby).toEqual([]);
    expect(p.novych).toBe(4);
    expect(p.stavyVeVstupu).toEqual(["Vydáno", "Stornováno", "Čeká na díl", "Zakládá se", "Přijato", "V opravě"]);
    const nove = p.zaznamy.flatMap((z) => (z.stav === "novy" ? [z] : []));
    const [a, b, c] = nove;

    expect(a.data).toMatchObject({
      code: "TSTZ2400001",
      created_at: new Date(2024, 0, 3, 9, 15).toISOString(),
      completed_at: new Date(2024, 0, 6, 10, 30).toISOString(),
      status: "issued",
      title: "iPhone 13",
      notes: "Výměna displeje; prasklé sklo",
      customer_name: "Jana Testová",
      customer_phone: "+420 777 000 111",
      customer_email: "jana@example.cz",
      device_serial: "F2LTEST0001",
      device_imei: "350000000000001",
      device_passcode: null,
      device_condition: "Škrábance na rámu · Nefunkční Face ID",
      estimated_price: 3500,
      external_id: "EXT-1",
    });
    expect(a.data.performed_repairs.map((o) => [o.name, o.price, o.costs])).toEqual([
      ["Výměna displeje (originální)", 3990, 2100],
      ["Sleva , věrnostní", -200, undefined],
    ]);
    expect(a.historie?.map((h) => [h.status, h.stavText, h.kdo])).toEqual([
      ["draft", "Zakládá se", "Technik A"],
      ["received", "Přijato", "Technik A"],
      ["in_repair", "V opravě", "Technik B"],
      ["issued", "Vydáno", "Technik A"],
    ]);
    expect(a.historie?.[0].created_at).toBe(new Date(2024, 0, 3, 9, 15).toISOString());

    // Anonymní stornovaná zakázka: bez zákazníka, bez oprav, bez odhadu ceny.
    expect(b.data).toMatchObject({ code: "TSTZ2400002", status: "cancelled", customer_name: null, estimated_price: null, performed_repairs: [] });
    // Firma bez jména: zákazníkem je text odkazu, firma se přenese.
    expect(c.data).toMatchObject({ code: "TSTZ2400003", status: "waiting_part", completed_at: null, customer_company: "Testovací s.r.o.", estimated_price: 2600 });
  });

  it("výchozí stavy Jobi: vydané do koncového, rozpracované podle názvu", () => {
    const p = pripravZakazky(t, m, { existujiciKody: new Set(["TSTZ2400004"]), stavy: STAVY_JOBI, fallbackKey: "received", ted });
    expect(p.chyby).toEqual([]);
    expect([p.novych, p.duplicit]).toEqual([3, 1]);
    expect(p.zaznamy.flatMap((z) => (z.stav === "novy" ? [z.data.status] : []))).toEqual(["completed", "completed", "received"]);
  });

  it("historie stavů → řádky ticket_history se změnou stavu a datem ze ZL", () => {
    const p = pripravZakazky(t, m, { existujiciKody: new Set(), stavy: STAVY_ZL, fallbackKey: "received", ted });
    const a = p.zaznamy.find((z) => z.stav === "novy" && z.data.code === "TSTZ2400002");
    const radky = radkyHistorie("t-1", "svc", a && a.stav === "novy" ? a.historie ?? [] : []);
    expect(radky.map((r) => [r.action, r.changed_by, (r.details.changes as { status: unknown }).status])).toEqual([
      ["updated", null, { old: null, new: "draft" }],
      ["updated", null, { old: "draft", new: "received" }],
      ["updated", null, { old: "received", new: "cancelled" }],
    ]);
    expect(radky[2].created_at).toBe(new Date(2022, 11, 8, 9, 51).toISOString());
  });

  it("hesla jen na vyžádání", () => {
    expect(t.hlavicka).not.toContain("Heslo zařízení / Kód obrazovky");
    const sHesly = parseCsv(preved({ zakazky: ZAKAZKY, reklamace: [], sHesly: true }).soubory["zakazky.csv"]);
    const mh = odhadniMapovaniZakazek(sHesly.hlavicka, "zl");
    const p = pripravZakazky(sHesly, mh, { existujiciKody: new Set(), stavy: STAVY_ZL, fallbackKey: "received", ted });
    expect(p.zaznamy.flatMap((z) => (z.stav === "novy" ? [z.data.device_passcode] : []))).toEqual(["1234", "Pro tento typ opravy není heslo požadováno.", null, null]);
  });
});

describe("migrace-zl – zákazníci", () => {
  it("sloučení podle kódu ZL a telefonu, doplnění z exportu zákazníků", () => {
    const z = zakaznici([...ZAKAZKY, ...REKLAMACE], EXPORT);
    expect(z.map((x) => [x.jmeno, x.telefon, x.kod, x.ico, x.zakazek, x.zExportu])).toEqual([
      // Jana: dvě zakázky (jedna bez kódu, telefon jinak zapsaný) + reklamace.
      ["Jana Testová", "+420 777 000 111", "TSTC2400001", null, 3, false],
      ["Testovací s.r.o. (B2B)", "777 000 222", "TSTC2400002", "12345678", 1, true],
      ["Petr Bezzakázkový", "+420 603 000 333", "TSTC2400009", null, 0, true],
    ]);
  });

  it("zakaznici.csv se v importu zákazníků přiřadí sám", () => {
    const v = preved({ zakazky: ZAKAZKY, reklamace: REKLAMACE, exportZakazniku: EXPORT });
    const t = parseCsv(v.soubory["zakaznici.csv"]);
    expect(odhadniMapovani(t.hlavicka)).toEqual(["name", "phone", "email", "company", "ico", "dic", "note"]);
    expect(t.radky[1]).toEqual(["Testovací s.r.o. (B2B)", "777 000 222", "fakturace@example.cz", "Testovací s.r.o.", "12345678", "CZ12345678", "Zakázkový list: TSTC2400002"]);
  });
});

describe("migrace-zl – komentare.csv projde importem komentářů v Jobi", () => {
  it("komentáře zakázek na zakázku, komentáře reklamací na zakázku reklamace", () => {
    const v = preved({ zakazky: ZAKAZKY, reklamace: REKLAMACE });
    const t = parseCsv(v.soubory["komentare.csv"]);
    const m = odhadniMapovaniKomentaru(t.hlavicka);
    expect(m).toEqual(["code", "kind", "author", "date", "text"]);
    const plan = pripravKomentare(t, m, {
      zakazky: new Map(ZAKAZKY.map((z) => [z.code, `t-${z.code}`])),
      reklamace: new Map(REKLAMACE.map((r) => [r.code, { id: `r-${r.code}`, sourceTicketId: r.sourceOrderCode ? `t-${r.sourceOrderCode}` : null }])),
      existujici: new Set(),
    });
    expect(plan.chyby).toEqual([]);
    expect(plan.radky.length).toBe(t.radky.length);
    expect([plan.zakazek, plan.reklamaci]).toEqual([1, 1]);
    const rek = plan.radky.find((r) => r.content.startsWith("[Reklamace "));
    expect(rek).toMatchObject({ ticket_id: "t-TSTZ2400001", author: "Technik B", content: "[Reklamace TSTR2400001] Uznáno, výměna zdarma.", created_at: new Date(2024, 1, 2, 9, 0).toISOString() });
  });
});

describe("migrace-zl – ceník", () => {
  it("značka podle řady nebo názvů modelů", () => {
    expect(znackaKategorie("iPhone", ["iPhone 13"])).toBe("Apple");
    expect(znackaKategorie("Watch", ["Apple Watch Series 6"])).toBe("Apple");
    expect(znackaKategorie("Ostatní", ["Ostatní", "Jiný model Dyson", "Dyson WashG1"])).toBe("Dyson");
    expect(znackaKategorie("Tiskárny", ["LaserJet"])).toBe("Tiskárny");
  });

  it("cenik.csv z API: duplicitní model se sloučí, projde importem ceníku bez chyb", () => {
    const { radky, souhrn } = cenikZKatalogu(KATALOG);
    expect(souhrn).toMatchObject({ znacek: 2, modelu: 7, oprav: 6, modeluBezCeniku: 2, slouceno: 1 });
    const v = preved({ zakazky: [], reklamace: [], katalog: KATALOG });
    const t = parseCsv(v.soubory["cenik.csv"]);
    const m = odhadniMapovaniCeniku(t.hlavicka);
    expect(m).toEqual(["brand", "category", "model", "repair", "price", "costs", "time", "details"]);
    const plan = pripravCenik(t, m, { brands: [], categories: [], models: [], repairs: [] });
    expect(plan.chyby).toEqual([]);
    expect(plan.brands.map((b) => b.name)).toEqual(["Apple", "Dyson"]);
    expect(plan.categories.map((c) => c.name).sort()).toEqual(["Ostatní", "Vysavače", "Watch", "iPhone"]);
    // Baterie za stejnou cenu a čas u dvou iPhonů = jedna oprava se dvěma modely.
    const baterie = plan.repairs.find((r) => r.name === "Výměna baterie");
    expect(baterie?.modelIds).toHaveLength(2);
    expect(baterie?.estimatedTime).toBe(60);
    expect(plan.repairs.find((r) => r.name === "Výměna skla")?.estimatedTime).toBe(4320);
    expect(plan.repairs.find((r) => r.name === "Výměna displeje (originální)")?.details).toBe("Originální díl; záruka 6 měsíců.");
    expect(radky.length).toBe(8);
  });

  it("náhradní ceník ze zakázek: nejčastější cena u modelu", () => {
    const { radky } = cenikZeZakazek(ZAKAZKY);
    expect(radky).toEqual([
      ["Apple", "iPhone", "iPhone 13", "Výměna baterie", "1490", "600", "", ""],
      ["Apple", "iPhone", "iPhone 13", "Výměna displeje (originální)", "3990", "2100", "", ""],
      ["Dyson", "Ostatní", "Dyson V15", "Nová originální baterie", "3300", "2600", "", ""],
    ]);
  });
});

describe("migrace-zl – report", () => {
  it("počty, co se nepřeneslo a nestažené detaily", () => {
    const v = preved({
      zakazky: [...ZAKAZKY, { code: "TSTZ2400005", kind: "order", error: "net::ERR_TIMED_OUT" }],
      reklamace: REKLAMACE,
      kodyVSeznamu: { zakazky: 5, reklamace: 1 },
    });
    expect(v.pocty).toMatchObject({ zakazek: 4, reklamaci: 1, zakazniku: 2, chyb: 1, cenikRadku: 0, komentaru: 2 });
    expect(v.report).toContain("V seznamu ZL bylo **5** zakázek, staženo **4**.");
    expect(v.report).toContain("TSTZ2400005: net::ERR_TIMED_OUT");
    expect(v.report).toContain("**Hesla / kódy obrazovky** (1 zakázek)");
    expect(v.report).toContain("Ceník se nestáhl");
    expect(Object.keys(v.soubory).sort()).toEqual(["komentare.csv", "reklamace.csv", "zakazky.csv", "zakaznici.csv"]);
  });
});

/**
 * Volitelně nad skutečně staženými daty (nic z nich se necommituje):
 *   MIGRACE_ZL_DATA=/cesta/k/vystupu npx vitest run scripts/migrace-zl
 * Ověří, že každý řádek zakazky.csv a cenik.csv projde importem Jobi.
 */
const DATA = process.env.MIGRACE_ZL_DATA;
describe.skipIf(!DATA)("migrace-zl – skutečná data", () => {
  it("zakazky.csv bez chybných řádků", () => {
    const t = parseCsv(fs.readFileSync(path.join(DATA!, "zakazky.csv"), "utf8"));
    const m = odhadniMapovaniZakazek(t.hlavicka, "zl");
    expect(m).not.toContain(null);
    const p = pripravZakazky(t, m, { existujiciKody: new Set(), stavy: STAVY_ZL, fallbackKey: "received", ted });
    expect(p.chyby.slice(0, 5)).toEqual([]);
    expect(p.novych).toBe(t.radky.length);
  });
  it("cenik.csv bez chybných řádků", () => {
    const f = path.join(DATA!, "cenik.csv");
    if (!fs.existsSync(f)) return;
    const t = parseCsv(fs.readFileSync(f, "utf8"));
    const plan = pripravCenik(t, odhadniMapovaniCeniku(t.hlavicka), { brands: [], categories: [], models: [], repairs: [] });
    expect(plan.chyby.slice(0, 5)).toEqual([]);
  });
});
