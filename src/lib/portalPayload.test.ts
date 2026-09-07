/**
 * Zákaznický portál: co smí ven a komu se ještě smí odpovědět.
 *
 * `web/z/?t=<token>` je jediná stránka Jobi, kterou otevře kdokoli s odkazem
 * a bez přihlášení. Token je jediné oprávnění. V `tickets` přitom vedle
 * zákazníkových dat leží telefon, e-mail, IMEI, kód zámku, interní
 * diagnostika, u položek oprav nákupní cena (`costs`) a jméno technika.
 * Jediný sloupec navíc v `TICKET_COLUMNS` nebo jediné pole navíc v odpovědi
 * znamená, že to všechno čte kdokoli, komu se odkaz dostane do ruky.
 *
 * JAK SE TO TESTUJE (stejný postup jako sms.test.ts)
 * `npx vitest run` bere podle vite.config.ts jen `src/**`, a `index.ts` edge
 * funkce se naimportovat nedá – tahá `serve` z deno.land a `createClient`
 * z esm.sh. Proto je skládání odpovědi v `_shared/portalPayload.ts`, kde nad
 * NÍM BĚŽÍCÍM kódem testuje vitest přesný seznam klíčů. Co v `_shared` být
 * nemůže (tělo `serve`), hlídají „pojistky ve zdrojácích“ dole – čtou
 * `portal-ticket/index.ts` jako text.
 *
 * ŽÁDNÁ SÍŤ ANI DATABÁZE. Všechno jsou čisté funkce nad vymyšlenými řádky.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  MAX_USER_AGENT,
  TICKET_COLUMNS,
  TICKET_COLUMNS_ZAKLAD,
  computeFinalPrice,
  deviceLabel,
  odkazVyprsel,
  otiskAkce,
  parseRepairs,
  sestavPayload,
  smiVydatZakazku,
  stringArray,
  strOrNull,
  toNumber,
  type PobockaRow,
  type TicketRow,
  type Zdroje,
} from "../../supabase/functions/_shared/portalPayload";

const KOREN = join(__dirname, "..", "..");
const PORTAL = "supabase/functions/portal-ticket/index.ts";
const zdroj = (cesta: string) => readFileSync(join(KOREN, cesta), "utf8");
/** Zdroják bez komentářů – ať pojistky nereagují na text v komentáři. */
const zdrojBezKomentaru = (cesta: string) =>
  zdroj(cesta).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

// ---------------------------------------------------------------------------
// Vymyšlená data
// ---------------------------------------------------------------------------

/**
 * Řádek zakázky, do kterého je schválně přimíchané všechno, co zákazník
 * vidět nesmí. Kdyby se do odpovědi dostalo cokoli z toho, test to najde
 * i tehdy, když si nikdo nevšimne nového klíče – hledá se totiž i hodnota.
 */
const TAJNE = {
  customer_name: "TAJNE-jmeno",
  customer_phone: "TAJNE-telefon",
  customer_email: "TAJNE-mail",
  customer_ico: "TAJNE-ico",
  device_imei: "TAJNE-imei",
  device_passcode: "TAJNE-kod-zamku",
  device_serial: "TAJNE-seriove",
  diagnostic_text: "TAJNE-diagnostika",
  device_note: "TAJNE-poznamka",
  customer_info: "TAJNE-info",
  title: "TAJNE-nazev",
  portal_token: "TAJNE-token",
  quote_decision_meta: { ip: "TAJNE-ip" },
  external_id: "TAJNE-externi",
};

function zakazka(prepis: Partial<TicketRow> = {}): TicketRow {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    service_id: "22222222-2222-2222-2222-222222222222",
    branch_id: null,
    code: "E2E26000001",
    status: "received",
    notes: "Rozbitý displej",
    created_at: "2026-09-01T08:00:00.000Z",
    expected_completion_at: null,
    device_label: "iPhone 13",
    device_brand: null,
    device_model: null,
    estimated_price: 1000,
    // Nákupní cena, technik i sazba – přesně to, co se nesmí dostat ven.
    performed_repairs: [{ name: "Výměna displeje", price: 3500, costs: 1200, technik: "TAJNE-technik", sazba: 21 }],
    diagnostic_photos: ["https://foto/po.png"],
    diagnostic_photos_before: ["https://foto/pred.png"],
    discount_type: null,
    discount_value: null,
    handoff_method: "osobne",
    handback_method: "osobne",
    quote_amount: 3500,
    quote_items: [{ name: "Displej", price: 3500, costs: 1200, technik: "TAJNE-technik" }],
    quote_note: "Nabídka",
    quote_status: "sent",
    quote_sent_at: "2026-09-02T08:00:00.000Z",
    quote_decided_at: null,
    intake_signature_url: null,
    intake_signed_at: null,
    portal_last_opened_at: null,
    portal_token_expires_at: null,
    ...prepis,
  };
}

function zdroje(prepis: Partial<Zdroje> = {}): Zdroje {
  return {
    ticket: zakazka(),
    stav: { key: "received", label: "TAJNE-nazev-stavu", bg: "#fff", fg: "#000", is_final: false },
    config: { companyData: { name: "Servis Novák", phone: "+420111222333", bankAccount: "123456789/0100" } },
    nazevServisu: "Servis Novák",
    pobocka: null,
    ...prepis,
  };
}

// ---------------------------------------------------------------------------
// Co se vůbec načítá z databáze
// ---------------------------------------------------------------------------

describe("TICKET_COLUMNS – co portál z tickets čte", () => {
  const sloupce = TICKET_COLUMNS.split(",").map((s) => s.trim());

  it("nečte nic, co zákazník vidět nesmí", () => {
    // Seznam je schválně vypsaný, ne odvozený: nový citlivý sloupec v tabulce
    // se sem musí dopsat ručně a to je ta chvíle, kdy si toho někdo všimne.
    const zakazane = [
      "customer_name",
      "customer_phone",
      "customer_email",
      "customer_ico",
      "customer_company",
      "customer_id",
      "customer_info",
      "customer_address_street",
      "customer_address_city",
      "customer_address_zip",
      "customer_address_country",
      "device_imei",
      "device_passcode",
      "device_serial",
      "device_note",
      "device_condition",
      "device_accessories",
      "diagnostic_text",
      "test_checklist",
      "loaner",
      "external_id",
      "title",
      "portal_token",
      "quote_decision_meta",
    ];
    for (const s of zakazane) {
      expect(sloupce, `portál nesmí číst ${s}`).not.toContain(s);
    }
  });

  it("záložní seznam je ten hlavní bez platnosti odkazu", () => {
    // `loadTicket` na něj přepne, když migrace s platností ještě není
    // nasazená. Nesmí přitom povolit nic navíc.
    expect(TICKET_COLUMNS).toBe(`${TICKET_COLUMNS_ZAKLAD}, portal_token_expires_at`);
    expect(TICKET_COLUMNS_ZAKLAD).not.toMatch(/portal_token_expires_at/);
  });

  it("čte portal_token_expires_at, jinak by platnost odkazu nefungovala", () => {
    expect(sloupce).toContain("portal_token_expires_at");
  });
});

// ---------------------------------------------------------------------------
// Co jde ven
// ---------------------------------------------------------------------------

describe("sestavPayload – přesný obsah odpovědi", () => {
  it("má jen tři větve: ok, ticket, service, payment", () => {
    expect(Object.keys(sestavPayload(zdroje())).sort()).toEqual(["ok", "payment", "service", "ticket"]);
  });

  it("zakázka má přesně tenhle seznam polí", () => {
    // Kdo přidá pole, srazí se tady. To je smysl testu: nové pole v odpovědi
    // je rozhodnutí o tom, co uvidí kdokoli s odkazem, ne detail.
    expect(Object.keys(sestavPayload(zdroje()).ticket).sort()).toEqual([
      "code",
      "createdAt",
      "deviceLabel",
      "discount",
      "estimatedPrice",
      "expectedCompletionAt",
      "handbackMethod",
      "handoffMethod",
      "intakeSignatureUrl",
      "intakeSignedAt",
      "performedRepairs",
      "photos",
      "photosBefore",
      "quote",
      "requestedRepair",
      "status",
      "totalPrice",
    ]);
  });

  it("servis má přesně tenhle seznam polí", () => {
    expect(Object.keys(sestavPayload(zdroje()).service).sort()).toEqual([
      "addressCity",
      "addressStreet",
      "addressZip",
      "bankAccount",
      "branch",
      "email",
      "iban",
      "name",
      "openingHours",
      "phone",
      "website",
    ]);
  });

  it("odpověď neobsahuje NIC z citlivých sloupců, ani jako hodnotu", () => {
    // Řádek dostane citlivé sloupce navíc – kdyby se odpověď někdy skládala
    // rozprostřením (`...t`), tenhle test to chytí.
    const t = { ...zakazka(), ...TAJNE } as unknown as TicketRow;
    const text = JSON.stringify(sestavPayload(zdroje({ ticket: t })));
    expect(text).not.toMatch(/TAJNE/);
  });

  it("u položek oprav pustí jen název a cenu", () => {
    const { ticket } = sestavPayload(zdroje());
    expect(ticket.performedRepairs).toEqual([{ name: "Výměna displeje", price: 3500 }]);
    // Rozpis nabídky zákazník vidět má – ale taky bez nákupní ceny.
    expect(ticket.quote.items).toEqual([{ name: "Displej", price: 3500 }]);
  });

  it("ze stavu jde ven jen „uzavřeno / neuzavřeno“, ne interní název a barva", () => {
    const { ticket } = sestavPayload(zdroje());
    expect(ticket.status).toEqual({ isFinal: false });
    const uzavrena = sestavPayload(
      zdroje({ stav: { key: "done", label: "Hotovo", bg: null, fg: null, is_final: true } }),
    );
    expect(uzavrena.ticket.status).toEqual({ isFinal: true });
  });

  it("neznámý stav neznamená „uzavřeno“", () => {
    // `stav === null` nastane, když servis stav přejmenoval. Kdyby se to
    // překlopilo na true, portál by zákazníkovi tvrdil, že je hotovo.
    expect(sestavPayload(zdroje({ stav: null })).ticket.status).toEqual({ isFinal: false });
  });

  it("z pobočky pustí kontakt a adresu, ne IČO", () => {
    const pobocka: PobockaRow = {
      name: "Pobočka Brno",
      phone: "+420999888777",
      email: "brno@servis.test",
      address_street: "Nádražní 1",
      address_city: "Brno",
      address_zip: "602 00",
      opening_hours: "Po–Pá 9–17",
      is_default: false,
      company_name: "Servis Novák s.r.o.",
      ico: "TAJNE-ico-pobocky",
      bank_account: "999888/0300",
      iban: null,
    };
    const { service } = sestavPayload(zdroje({ pobocka }));
    expect(service.branch).toBe("Pobočka Brno");
    expect(service.phone).toBe("+420999888777");
    expect(JSON.stringify(service)).not.toMatch(/TAJNE/);
  });

  it("u výchozí pobočky se název pobočky neposílá", () => {
    const pobocka = {
      name: "Hlavní pobočka",
      phone: null,
      email: null,
      address_street: null,
      address_city: null,
      address_zip: null,
      opening_hours: null,
      is_default: true,
      company_name: null,
      ico: null,
      bank_account: null,
      iban: null,
    } as PobockaRow;
    expect(sestavPayload(zdroje({ pobocka })).service.branch).toBeNull();
  });
});

describe("cena a platba", () => {
  it("konečná cena se počítá sdíleným vzorcem", () => {
    expect(computeFinalPrice([{ name: "a", price: 1000 }], "percentage", 10)).toBe(900);
    expect(computeFinalPrice([{ name: "a", price: 1000 }], "amount", 250)).toBe(750);
    // Sleva nikdy nesmí cenu zvýšit ani poslat pod nulu.
    expect(computeFinalPrice([{ name: "a", price: 100 }], "amount", 500)).toBe(0);
    expect(computeFinalPrice([{ name: "a", price: 100 }], "percentage", -50)).toBe(100);
  });

  it("součet floatů se zaokrouhlí – zákazník nesmí vidět 666,6700000000001", () => {
    const cena = computeFinalPrice([{ name: "a", price: 333.33 }, { name: "b", price: 333.34 }], null, null);
    expect(cena).toBe(666.67);
  });

  it("schválená nabídka má u platby přednost před cenou oprav", () => {
    const t = zakazka({ quote_status: "approved", quote_amount: 5000 });
    expect(sestavPayload(zdroje({ ticket: t })).payment?.amount).toBe(5000);
  });

  it("bez účtu i IBANu se QR platba neposílá", () => {
    const z = zdroje({ config: { companyData: { name: "Servis" } } });
    expect(sestavPayload(z).payment).toBeNull();
  });

  it("nulová cena znamená žádnou platbu", () => {
    const t = zakazka({ performed_repairs: [], quote_status: "none", quote_amount: null });
    expect(sestavPayload(zdroje({ ticket: t })).payment).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Odvolání přístupu
// ---------------------------------------------------------------------------

describe("odkazVyprsel", () => {
  const ted = new Date("2026-09-07T12:00:00.000Z");

  it("bez data platnosti odkaz platí dál", () => {
    // Odkazy z doby před zavedením platnosti. Zákazník s rozdělanou zakázkou
    // nesmí ze dne na den přijít o jedinou cestu k ní.
    expect(odkazVyprsel({ portal_token_expires_at: null }, ted)).toBe(false);
    expect(odkazVyprsel({ portal_token_expires_at: undefined }, ted)).toBe(false);
  });

  it("po uplynutí platnosti neplatí", () => {
    expect(odkazVyprsel({ portal_token_expires_at: "2026-09-07T11:59:59.000Z" }, ted)).toBe(true);
    expect(odkazVyprsel({ portal_token_expires_at: "2026-09-07T12:00:00.000Z" }, ted)).toBe(true);
    expect(odkazVyprsel({ portal_token_expires_at: "2026-09-07T12:00:01.000Z" }, ted)).toBe(false);
  });

  it("nesmyslné datum odkaz nezavře", () => {
    // Rozbitá hodnota nesmí zákazníkovi zavřít portál – to je chyba u nás.
    expect(odkazVyprsel({ portal_token_expires_at: "tohle není datum" }, ted)).toBe(false);
  });
});

describe("smiVydatZakazku – tři důvody odvolání přístupu", () => {
  it("neznámý token ani zakázka v koši nic nevydá", () => {
    expect(smiVydatZakazku(null, true)).toBe(false);
    expect(smiVydatZakazku(undefined, true)).toBe(false);
  });

  it("vypršelý odkaz nic nevydá", () => {
    const ted = new Date("2026-09-07T12:00:00.000Z");
    expect(smiVydatZakazku({ portal_token_expires_at: "2026-09-01T00:00:00.000Z" }, true, ted)).toBe(false);
  });

  it("vypnutý servis nic nevydá", () => {
    // Edge funkce běží pod service_role, takže databázová hradba na ni
    // neplatí a tohle je jediné místo, kde se vypnutý servis zastaví.
    expect(smiVydatZakazku({ portal_token_expires_at: null }, false)).toBe(false);
  });

  it("když se stav servisu nepodařilo zjistit, zakázka se vydá", () => {
    // Výpadek dotazu na `services` nesmí zákazníkovi sebrat jedinou cestu
    // k zakázce; vypnutí servisu je stav účtování, ne hradba proti útočníkovi.
    expect(smiVydatZakazku({ portal_token_expires_at: null }, null)).toBe(true);
    expect(smiVydatZakazku({ portal_token_expires_at: null }, undefined)).toBe(true);
  });

  it("aktivní servis s platným odkazem projde", () => {
    expect(smiVydatZakazku({ portal_token_expires_at: null }, true)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Otisk akce
// ---------------------------------------------------------------------------

describe("otiskAkce", () => {
  it("ořízne User-Agent – hlavička chodí od klienta a brána pustí kilobajty", () => {
    const o = otiskAkce("1.2.3.4", "U".repeat(20_000), null);
    expect(o.userAgent).toHaveLength(MAX_USER_AGENT);
  });

  it("chybějící hodnoty jsou null, ne prázdný řetězec ani undefined", () => {
    // Otisk se ukládá do jsonb a vykresluje se v zakázce.
    expect(otiskAkce(null, null, "")).toEqual({ ip: null, userAgent: null, note: null });
  });

  it("poznámku nechá být – ořezává ji volající na 2 000 znaků", () => {
    expect(otiskAkce(null, null, "text").note).toBe("text");
  });
});

// ---------------------------------------------------------------------------
// Drobné převody
// ---------------------------------------------------------------------------

describe("převody hodnot z databáze", () => {
  it("toNumber zvládne numeric jako řetězec i nesmysly", () => {
    expect(toNumber("3500.50")).toBe(3500.5);
    expect(toNumber(null)).toBeNull();
    expect(toNumber("")).toBeNull();
    expect(toNumber("abc")).toBeNull();
    expect(toNumber(Infinity)).toBeNull();
  });

  it("stringArray pustí jen neprázdné řetězce", () => {
    expect(stringArray(["a", "", null, 1, { x: 1 }, "b"])).toEqual(["a", "b"]);
    expect(stringArray("tohle není pole")).toEqual([]);
    expect(stringArray(null)).toEqual([]);
  });

  it("parseRepairs přeskočí nesmysly místo pádu", () => {
    expect(parseRepairs([null, "text", 1, { name: 1, price: "x" }])).toEqual([{ name: "", price: 0 }]);
    expect(parseRepairs({ neni: "pole" })).toEqual([]);
  });

  it("deviceLabel spojí značku a model, když chybí popis", () => {
    expect(deviceLabel(zakazka({ device_label: null, device_brand: "Apple", device_model: "iPhone 13" }))).toBe(
      "Apple iPhone 13",
    );
    expect(deviceLabel(zakazka({ device_label: "  ", device_brand: null, device_model: null }))).toBe("");
  });

  it("strOrNull ořeže a z prázdna udělá null", () => {
    expect(strOrNull("  a  ")).toBe("a");
    expect(strOrNull("   ")).toBeNull();
    expect(strOrNull(42)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Pojistky ve zdrojáku edge funkce
//
// Tělo `serve` se naimportovat nedá (deno.land, esm.sh), a přitom právě tam
// jsou rozhodnutí, která stojí zákazníka soukromí nebo servis peníze.
// Čte se proto jako text.
// ---------------------------------------------------------------------------

describe("pojistky ve zdrojáku portal-ticket", () => {
  it("nevolá funkci, která ve zdrojáku neexistuje", () => {
    // Přesun pomocných funkcí do `_shared` odstranil `clientIp`, ale volání
    // zůstalo: každé schválení, zamítnutí, podpis i vyzvednutí spadlo na
    // 500 „clientIp is not defined“. Portál nemá jak tuhle chybu ohlásit
    // dřív než zákazníkovi, proto ji hlídá test.
    const s = zdrojBezKomentaru(PORTAL);

    // Co se do souboru dostane zvenčí: `import { a, b as c } from "..."`.
    const naimportovane = new Set<string>();
    for (const blok of s.matchAll(/import\s*\{([^}]*)\}\s*from/g)) {
      for (const kus of blok[1].split(",")) {
        const jmeno = kus.trim().replace(/^type\s+/, "").split(/\s+as\s+/).pop()?.trim();
        if (jmeno) naimportovane.add(jmeno);
      }
    }
    // Co v souboru vzniká.
    const vlastni = new Set(
      [...s.matchAll(/(?:function|const|let|var)\s+([a-zA-Z_$][\w$]*)/g)].map((m) => m[1]),
    );
    // Klíčová slova a to, co dává běhové prostředí.
    const znama = new Set([
      "if", "for", "while", "switch", "catch", "return", "function", "typeof", "await", "new", "async",
      "JSON", "Number", "String", "Object", "Array", "Date", "Math", "atob", "isNaN", "parseInt",
      "parseFloat", "console", "decodeURIComponent", "encodeURIComponent", "Promise", "Response",
      "Request", "URL", "Error", "Boolean", "Uint8Array", "Deno", "crypto", "TextEncoder",
    ]);

    // Bez tečky před jménem – metody (`JSON.stringify`, `.slice`) se neřeší,
    // hledá se holý identifikátor, který někdo volá a nikde ho nezavedl.
    const chybejici = new Set<string>();
    for (const volani of s.matchAll(/(?<![.\w$])([a-zA-Z_$][\w$]*)\s*\(/g)) {
      const jmeno = volani[1];
      if (znama.has(jmeno) || vlastni.has(jmeno) || naimportovane.has(jmeno)) continue;
      chybejici.add(jmeno);
    }
    expect([...chybejici], "portal-ticket volá něco, co nikde nevzniklo").toEqual([]);
  });

  it("text výjimky se neposílá ven", () => {
    // Portál je otevřený komukoli s odkazem. Hláška z databáze prozradí
    // názvy sloupců i vnitřek aplikace.
    const s = zdrojBezKomentaru(PORTAL);
    expect(s).not.toMatch(/error:\s*\(error as Error\)\?\.message/);
    expect(s).toMatch(/catch \(error\)[\s\S]{0,400}?console\.error/);
  });

  it("neplatný odkaz, koš, vypršení i vypnutý servis mají JEDNU odpověď", () => {
    // Kdyby se lišily, dal by se portál použít na zjišťování, co existuje
    // a který servis je vypnutý.
    const s = zdrojBezKomentaru(PORTAL);
    expect(s).toMatch(/const neplatnyOdkaz = \(\) => json\(\{ error: "Odkaz není platný\." \}, 404\)/);
    // Jiná 404 hláška ve funkci není.
    const ctyristaCtyri = [...s.matchAll(/json\([^;]*?,\s*404\)/g)].map((m) => m[0]);
    expect(ctyristaCtyri.every((h) => h.includes("Odkaz není platný"))).toBe(true);
  });

  it("o vydání zakázky rozhoduje sdílená smiVydatZakazku", () => {
    const s = zdrojBezKomentaru(PORTAL);
    expect(s).toMatch(/if \(!smiVydatZakazku\(/);
    expect(s).toMatch(/\.select\("active"\)/);
  });

  it("limit na volajícího se počítá dřív, než se čte tělo požadavku", () => {
    // Rozbitý JSON dřív skončil na 400 ještě před počítadlem, takže se dal
    // limit obejít posíláním nesmyslů – a každý takový požadavek se přitom
    // celý načetl do paměti.
    const s = zdrojBezKomentaru(PORTAL);
    const limit = s.indexOf("LIMIT_NA_KLIENTA_AKCE");
    const parse = s.indexOf("await req.json()");
    expect(limit).toBeGreaterThan(-1);
    expect(parse).toBeGreaterThan(-1);
    expect(limit, "limit akcí se musí započítat před req.json()").toBeLessThan(parse);
  });

  it("limit na čtení se počítá dřív než kontrola tvaru tokenu", () => {
    const s = zdrojBezKomentaru(PORTAL);
    const limit = s.indexOf("LIMIT_NA_KLIENTA_CTENI");
    const tvar = s.indexOf("token.length > 64");
    expect(limit).toBeGreaterThan(-1);
    expect(limit, "prázdné ani přes 64 znaků dlouhé `t` nesmí být zadarmo").toBeLessThan(tvar);
  });

  it("nabídku nejde schválit dvakrát", () => {
    // Podmíněný UPDATE, který nechytil žádný řádek, vrací error === null.
    // Bez kontroly počtu řádků by portál odpověděl „ok“ na rozhodnutí,
    // které se neuložilo – a při dvojím odeslání by vznikly quote_approved
    // i quote_rejected zároveň.
    const s = zdrojBezKomentaru(PORTAL);
    expect(s).toMatch(/\.eq\("quote_status", "sent"\)/);
    expect(s).toMatch(/if \(!updated \|\| updated\.length === 0\)/);
  });

  it("podpis se rezervuje dřív, než se nahraje soubor", () => {
    // Opačné pořadí nechá v úložišti podpis zákazníka, na který se
    // v zakázce nikdo neodkáže.
    const s = zdrojBezKomentaru(PORTAL);
    const rezervace = s.indexOf('.is("intake_signed_at", null)');
    const nahrani = s.indexOf(".upload(path, bytes");
    expect(rezervace).toBeGreaterThan(-1);
    expect(nahrani).toBeGreaterThan(-1);
    expect(rezervace, "rezervace musí být před nahráním").toBeLessThan(nahrani);
    expect(s).toMatch(/if \(!reserved \|\| reserved\.length === 0\)/);
  });

  it("vyzvednutí se nepotvrdí dvakrát", () => {
    const s = zdrojBezKomentaru(PORTAL);
    expect(s).toMatch(/\.eq\("type", "pickup_confirmed"\)/);
    expect(s).toMatch(/jizPotvrzeno && jizPotvrzeno\.length > 0/);
  });

  it("z těla požadavku se čte JEN token, akce, poznámka a podpis", () => {
    // Portál běží pod service_role, takže databázový trigger
    // `enforce_ticket_basic_update_permissions` se na něj nevztahuje
    // (auth.uid() je null) – co portál zapíše, hlídá jen tenhle kód.
    const s = zdrojBezKomentaru(PORTAL);
    const pouzita = new Set([...s.matchAll(/\bbody[?]?\.(\w+)/g)].map((m) => m[1]));
    expect([...pouzita].sort()).toEqual(["action", "note", "signature", "t"]);
  });

  it("do tickets se zapisují jen sloupce, které portál smí měnit", () => {
    const s = zdrojBezKomentaru(PORTAL);
    const povolene = new Set([
      "portal_last_opened_at",
      "quote_status",
      "quote_decided_at",
      "quote_decision_meta",
      "intake_signed_at",
      "intake_signature_url",
    ]);
    const bloky = [...s.matchAll(/\.update\(\{([\s\S]*?)\}\)/g)].map((m) => m[1]);
    expect(bloky.length).toBeGreaterThan(0);
    for (const blok of bloky) {
      for (const klic of blok.matchAll(/(\w+):/g)) {
        expect(povolene, `portál nesmí zapisovat ${klic[1]}`).toContain(klic[1]);
      }
    }
  });

  it("poznámka se ořezává, ať jsonb v zakázce nespolkne megabajt", () => {
    const s = zdrojBezKomentaru(PORTAL);
    expect(s).toMatch(/body\.note[\s\S]{0,80}?\.slice\(0, 2000\)/);
  });

  it("podpis musí být PNG do 300 kB a kontroluje se signatura souboru", () => {
    const s = zdrojBezKomentaru(PORTAL);
    expect(s).toMatch(/MAX_SIGNATURE_BYTES = 300 \* 1024/);
    // 0x89 'P' 'N' 'G' – bez toho by šlo do úložiště nahrát cokoli s příponou png.
    expect(s).toMatch(/0x89/);
    expect(s).toMatch(/\^data:image\\\/png;base64,/);
  });

  it("odpovědi se nekešují", () => {
    // Za tokenem jsou osobní údaje; proxy ani prohlížeč je nemá držet.
    expect(zdrojBezKomentaru(PORTAL)).toMatch(/"Cache-Control": "no-store"/);
  });

  it("povolené jsou jen GET, POST a OPTIONS", () => {
    const s = zdrojBezKomentaru(PORTAL);
    expect(s).toMatch(/req\.method !== "GET" && req\.method !== "POST"/);
    expect(s).toMatch(/Method not allowed/);
  });
});
