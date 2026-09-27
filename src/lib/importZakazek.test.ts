import { describe, expect, it } from "vitest";
import { parseCsv } from "./csv";
import {
  koncovyStav,
  navrhniMapovaniStavu,
  odhadniMapovaniZakazek,
  parsujCastku,
  parsujDatum,
  parsujHistoriiStavu,
  parsujOpravy,
  pripravZakazky,
  radkyHistorie,
  zapisZakazky,
  type KlientZapisu,
  type StavServisu,
} from "./importZakazek";

/** Stavy servisu, který si je převzal ze Zakázkového listu (viz scripts/import-zakazkovylist/statuses.sql). */
const STAVY_ZL: StavServisu[] = [
  { key: "draft", label: "Zakládá se", isFinal: false },
  { key: "received", label: "Přijato", isFinal: false },
  { key: "in_repair", label: "V opravě", isFinal: false },
  { key: "waiting_customer", label: "Čeká na zákazníka", isFinal: false },
  { key: "ready_for_pickup", label: "Připraveno k převzetí", isFinal: false },
  { key: "issued", label: "Vydáno", isFinal: true },
  { key: "cancelled", label: "Stornováno", isFinal: true },
];

/** Výchozí stavy nového servisu v Jobi. */
const STAVY_JOBI: StavServisu[] = [
  { key: "received", label: "Přijato", isFinal: false },
  { key: "in_progress", label: "V opravě", isFinal: false },
  { key: "completed", label: "Hotovo", isFinal: true },
];

/** Vzorek ve tvaru exportu ze Zakázkového listu (názvy z detailu zakázky). */
const CSV_ZL = [
  "Kód;Přijetí zařízení do opravy;Zakázka vydána;Stav;Jméno a příjmení;Telefonní číslo;E-mailová adresa;Zařízení;Sériové číslo;IMEI;Požadovaná oprava;Popis stavu zařízení;Předpokládaná cena;Položky opravy;Přijal",
  "IRPAZ2200001;19.11.2022 18:34;08.12.2022 09:51;Stornováno;;;;iPhone X;;123123123;vymena displeje;;Nebyla stanovená předpokládaná cena zakázky.;;Jakub Zima",
  "IRPAZ2200002;08.12.2022 09:53;;Zakládá se;;;;iPhone 8;;;Výněnba baterie;;-;;-",
  'IRPAZ2200004;08.12.2022 14:38;15.12.2022 07:26;Vydáno;Marek Pilař;+420 722 687 902;marek.pilar@hotmail.cz;iPhone 11 Pro;F17C93F7N6Y6;;Výměna zadního skla;Škrábance na rámu;2 490,00 Kč;"Výměna baterie;200,00 Kč;950,00 Kč|Vymena baterie;300,00 Kč;300,00 Kč";Jakub Zima',
  "IRPAZ2200004;09.12.2022 10:00;;Přijato;Dvojník;;;iPhone 12;;;duplicitní kód;;;;",
  "IRPAZ2200005;nesmysl;;Přijato;Chyba;;;iPhone 13;;;špatné datum;;;;",
  ";;;;;;;;;;;;;;",
].join("\n");

describe("importZakazek – odhad sloupců", () => {
  it("předvolba Zakázkový list pozná sloupce z detailu zakázky", () => {
    const t = parseCsv(CSV_ZL);
    const m = odhadniMapovaniZakazek(t.hlavicka, "zl");
    expect(m).toEqual([
      "code", "created_at", "completed_at", "status", "customer_name", "customer_phone", "customer_email",
      "device_label", "device_serial", "device_imei", "notes", "device_condition", "estimated_price", "performed_repairs", null,
    ]);
  });

  it("u ZL má „Jméno a příjmení“ přednost před „Zákazník“ a druhý sloupec zůstane volný", () => {
    expect(odhadniMapovaniZakazek(["Zákazník", "Jméno a příjmení"], "zl")).toEqual([null, "customer_name"]);
  });

  it("předvolba MyRepair a obecné vzory bez diakritiky", () => {
    expect(odhadniMapovaniZakazek(["Cislo zakazky", "Datum prijeti", "Datum vydani", "Zakaznik", "Telefon", "Zarizeni", "Zavada", "Cena celkem", "Náklady"], "myrepair")).toEqual([
      "code", "created_at", "completed_at", "customer_name", "customer_phone", "device_label", "notes", "total_price", "repair_costs",
    ]);
    expect(odhadniMapovaniZakazek(["Order", "Created", "Delivered", "Customer", "Phone", "Device", "Serial", "Price"], "vlastni")).toEqual([
      "code", "created_at", "completed_at", "customer_name", "customer_phone", "device_label", "device_serial", "total_price",
    ]);
  });
});

describe("importZakazek – převody hodnot", () => {
  it("datum v zápisech ZL, českém, ISO i s lomítky; prázdno vs. chyba", () => {
    expect(parsujDatum("08.12.2022 09:51")).toBe(new Date(2022, 11, 8, 9, 51).toISOString());
    expect(parsujDatum("8. 12. 2022")).toBe(new Date(2022, 11, 8).toISOString());
    expect(parsujDatum("2022-12-08 09:51:30")).toBe(new Date(2022, 11, 8, 9, 51, 30).toISOString());
    expect(parsujDatum("2022-12-08T09:51:00Z")).toBe("2022-12-08T09:51:00.000Z");
    expect(parsujDatum("08/12/2022")).toBe(new Date(2022, 11, 8).toISOString());
    expect(parsujDatum("")).toBeNull();
    expect(parsujDatum("-")).toBeNull();
    expect(parsujDatum("nesmysl")).toBeUndefined();
    expect(parsujDatum("31.02.2022")).toBeUndefined();
  });

  it("částky s mezerami, Kč a desetinnou čárkou", () => {
    expect(parsujCastku("2 490,00 Kč")).toBe(2490);
    expect(parsujCastku("2 490,50 Kč")).toBe(2490.5);
    expect(parsujCastku("1.250,50")).toBe(1250.5);
    expect(parsujCastku("950")).toBe(950);
    expect(parsujCastku("Nebyla stanovená předpokládaná cena zakázky.")).toBeNull();
    expect(parsujCastku("-")).toBeNull();
    expect(parsujCastku("12a3")).toBeNaN();
  });

  it("složený sloupec oprav „název;cena;náklady|…“", () => {
    const { opravy, chyba } = parsujOpravy("Výměna baterie;950,00 Kč;200,00 Kč|Čištění;;|;100;");
    expect(chyba).toBeUndefined();
    expect(opravy.map((o) => [o.name, o.price, o.costs, o.type])).toEqual([
      ["Výměna baterie", 950, 200, "manual"],
      ["Čištění", 0, undefined, "manual"],
    ]);
    expect(new Set(opravy.map((o) => o.id)).size).toBe(2);
    // Text bez číslice je prázdná cena (ZL píše místo částky větu), chyba je až číslo, které nejde přečíst.
    expect(parsujOpravy("Oprava;xx").opravy[0].price).toBe(0);
    expect(parsujOpravy("Oprava;12a3").chyba).toMatch(/nečitelná cena/);
  });
});

describe("importZakazek – mapování stavů", () => {
  it("koncový stav je completed, jinak první koncový", () => {
    expect(koncovyStav(STAVY_JOBI)).toBe("completed");
    expect(koncovyStav(STAVY_ZL)).toBe("issued");
    expect(koncovyStav([{ key: "received", label: "Přijato", isFinal: false }])).toBeNull();
  });

  it("servis se stavy ze ZL dostane shodu 1:1 podle popisku", () => {
    expect(navrhniMapovaniStavu(["Vydáno", "Stornováno", "Čeká na zákazníka", "Zakládá se", "Něco cizího"], STAVY_ZL, "received")).toEqual({
      "Vydáno": "issued",
      "Stornováno": "cancelled",
      "Čeká na zákazníka": "waiting_customer",
      "Zakládá se": "draft",
      "Něco cizího": "received",
    });
  });

  it("výchozí stavy Jobi: vydané a stornované do koncového, v opravě podle popisku, ostatní výchozí", () => {
    expect(navrhniMapovaniStavu(["Vydáno", "Stornováno", "Vráceno bez opravy", "V opravě", "Připraveno k převzetí", "Přijato", "Nová"], STAVY_JOBI, "received")).toEqual({
      "Vydáno": "completed",
      "Stornováno": "completed",
      "Vráceno bez opravy": "completed",
      "V opravě": "in_progress",
      "Připraveno k převzetí": "received",
      "Přijato": "received",
      "Nová": "received",
    });
  });
});

describe("importZakazek – příprava řádků", () => {
  const ted = () => "2026-09-26T10:00:00.000Z";

  it("vzorek ZL: nové, duplicita podle kódu, chyba s číslem řádku, prázdný řádek", () => {
    const t = parseCsv(CSV_ZL);
    const m = odhadniMapovaniZakazek(t.hlavicka, "zl");
    const p = pripravZakazky(t, m, { existujiciKody: new Set(["IRPAZ2200002"]), stavy: STAVY_ZL, fallbackKey: "received", ted });

    // Prázdný řádek (samé středníky) zahodí už parser, proto 0.
    expect([p.novych, p.duplicit, p.chyb, p.prazdnych]).toEqual([2, 2, 1, 0]);
    expect(p.chyby).toEqual([{ radek: 6, zprava: "nečitelné datum přijetí: nesmysl" }]);
    expect(p.stavyVeVstupu).toEqual(["Stornováno", "Zakládá se", "Vydáno", "Přijato"]);

    const nove = p.zaznamy.flatMap((z) => (z.stav === "novy" ? [z.data] : []));
    const storno = nove[0];
    expect(storno.code).toBe("IRPAZ2200001");
    expect(storno.status).toBe("cancelled");
    expect(storno.created_at).toBe(new Date(2022, 10, 19, 18, 34).toISOString());
    expect(storno.completed_at).toBe(new Date(2022, 11, 8, 9, 51).toISOString());
    expect(storno.title).toBe("iPhone X");
    expect(storno.device_imei).toBe("123123123");
    expect(storno.notes).toBe("vymena displeje");
    expect(storno.estimated_price).toBeNull();
    expect(storno.customer_name).toBeNull();
    expect(storno.performed_repairs).toEqual([]);

    const vydano = nove[1];
    expect(vydano.code).toBe("IRPAZ2200004");
    expect(vydano.status).toBe("issued");
    expect(vydano.customer_name).toBe("Marek Pilař");
    expect(vydano.customer_phone).toBe("+420 722 687 902");
    expect(vydano.customer_email).toBe("marek.pilar@hotmail.cz");
    expect(vydano.device_serial).toBe("F17C93F7N6Y6");
    expect(vydano.device_condition).toBe("Škrábance na rámu");
    expect(vydano.estimated_price).toBe(2490);
    expect(vydano.performed_repairs.map((o) => [o.name, o.price, o.costs])).toEqual([
      ["Výměna baterie", 200, 950],
      ["Vymena baterie", 300, 300],
    ]);

    const duplicity = p.zaznamy.filter((z) => z.stav === "duplicita");
    expect(duplicity.map((z) => z.radek)).toEqual([3, 5]);
  });

  it("bez sloupce stavu se stav dopočítá z data vydání; ruční mapování stavů má přednost", () => {
    const t = parseCsv(["Číslo;Přijato;Vydáno;Stav;Zákazník", "A1;1.1.2024;2.1.2024;Hotovo;Jana", "A2;1.1.2024;;Hotovo;Petr", "A3;1.1.2024;;;Eva"].join("\n"));
    const m = odhadniMapovaniZakazek(t.hlavicka, "vlastni");
    expect(m).toEqual(["code", "created_at", "completed_at", "status", "customer_name"]);

    const bezMapovani = pripravZakazky(t, m, { existujiciKody: new Set(), stavy: STAVY_JOBI, fallbackKey: "received", ted });
    const stavy = bezMapovani.zaznamy.map((z) => (z.stav === "novy" ? z.data.status : z.stav));
    expect(stavy).toEqual(["completed", "completed", "received"]);

    const rucne = pripravZakazky(t, m, { existujiciKody: new Set(), stavy: STAVY_JOBI, fallbackKey: "received", ted, mapovaniStavu: { Hotovo: "in_progress" } });
    expect(rucne.zaznamy.map((z) => (z.stav === "novy" ? z.data.status : z.stav))).toEqual(["in_progress", "in_progress", "received"]);

    // Neznámý klíč v ručním mapování (stav mezitím smazaný) padá na výchozí/koncový.
    const cizi = pripravZakazky(t, m, { existujiciKody: new Set(), stavy: STAVY_JOBI, fallbackKey: "received", ted, mapovaniStavu: { Hotovo: "neexistuje" } });
    expect(cizi.zaznamy.map((z) => (z.stav === "novy" ? z.data.status : z.stav))).toEqual(["completed", "received", "received"]);
  });

  it("samostatné sloupce opravy a celková cena bez položek; bez data přijetí se bere teď", () => {
    const t = parseCsv(["Číslo;Zařízení;Oprava;Cena opravy;Náklady;Cena celkem", "B1;Galaxy S22;Výměna displeje;3990;2100;3990", "B2;Pixel 7;;;;1500", "B3;iPad;;;;", "B4;X;Něco;12a3;;"].join("\n"));
    const m = odhadniMapovaniZakazek(t.hlavicka, "myrepair");
    expect(m).toEqual(["code", "device_label", "repair_name", "repair_price", "repair_costs", "total_price"]);
    const p = pripravZakazky(t, m, { existujiciKody: new Set(), stavy: STAVY_JOBI, fallbackKey: "received", ted });
    expect(p.chyby).toEqual([{ radek: 5, zprava: "nečitelná cena opravy: 12a3" }]);
    const nove = p.zaznamy.flatMap((z) => (z.stav === "novy" ? [z.data] : []));
    expect(nove[0].created_at).toBe("2026-09-26T10:00:00.000Z");
    expect(nove[0].performed_repairs).toMatchObject([{ name: "Výměna displeje", price: 3990, costs: 2100, type: "manual" }]);
    expect(nove[1].performed_repairs).toMatchObject([{ name: "Oprava (z importu)", price: 1500 }]);
    expect(nove[2].performed_repairs).toEqual([]);
    expect(nove[2].title).toBe("iPad");
    expect(nove[2].notes).toBe("—");
  });

  it("řádek bez čísla zakázky a mapované, ale prázdné datum přijetí jsou chyby", () => {
    const t = parseCsv(["Číslo;Přijato;Zákazník", ";1.1.2024;Bez kódu", "C2;;Bez data"].join("\n"));
    const p = pripravZakazky(t, odhadniMapovaniZakazek(t.hlavicka), { existujiciKody: new Set(), stavy: STAVY_JOBI, fallbackKey: "received", ted });
    expect(p.chyby).toEqual([
      { radek: 2, zprava: "chybí číslo zakázky" },
      { radek: 3, zprava: "chybí datum přijetí" },
    ]);
  });
});

describe("importZakazek – zápis po dávkách", () => {
  function atrapa(spadniProKody: Set<string>, chybaKodu = "23505") {
    const vlozeno: Array<Record<string, unknown>> = [];
    const volani: number[] = [];
    const klient: KlientZapisu = {
      from: () => ({
        insert: async (radky: unknown) => {
          const pole = (Array.isArray(radky) ? radky : [radky]) as Array<Record<string, unknown>>;
          volani.push(pole.length);
          if (pole.some((r) => spadniProKody.has(String(r.code)))) return { error: { code: chybaKodu, message: "kolize" } };
          vlozeno.push(...pole);
          return { error: null };
        },
      }),
    };
    return { klient, vlozeno, volani };
  }

  const radek = (code: string) => ({
    code, created_at: "2024-01-01T00:00:00.000Z", completed_at: null, status: "received", title: "X", notes: "—",
    customer_name: null, customer_phone: null, customer_email: null, customer_company: null, device_label: null, device_brand: null,
    device_serial: null, device_imei: null, device_passcode: null, device_condition: null, estimated_price: null, external_id: null, performed_repairs: [],
  });

  it("dávky po 200 s doplněným service_id a průběhem", async () => {
    const { klient, vlozeno, volani } = atrapa(new Set());
    const postup: number[] = [];
    const v = await zapisZakazky(klient, "svc", Array.from({ length: 450 }, (_, i) => radek(`K${i}`)), (p) => postup.push(p));
    expect(v).toEqual({ novych: 450, preskoceno: 0, chyb: 0, chyby: [] });
    expect(volani).toEqual([200, 200, 50]);
    expect(postup).toEqual([44, 89, 100]);
    expect(vlozeno[0].service_id).toBe("svc");
  });

  it("spadlá dávka se projde po jednom: kolize kódu se přeskočí, jiná chyba se nahlásí", async () => {
    const { klient, vlozeno, volani } = atrapa(new Set(["K1"]));
    const v = await zapisZakazky(klient, "svc", [radek("K0"), radek("K1"), radek("K2")], undefined, 2);
    expect(v).toEqual({ novych: 2, preskoceno: 1, chyb: 0, chyby: [] });
    expect(volani).toEqual([2, 1, 1, 1]);
    expect(vlozeno.map((r) => r.code)).toEqual(["K0", "K2"]);

    const jina = atrapa(new Set(["K1"]), "42501");
    const v2 = await zapisZakazky(jina.klient, "svc", [radek("K0"), radek("K1")], undefined, 10);
    expect(v2).toEqual({ novych: 1, preskoceno: 0, chyb: 1, chyby: [{ kod: "K1", zprava: "kolize" }] });
  });
});

describe("importZakazek – historie stavů", () => {
  const ted = () => "2026-09-26T10:00:00.000Z";

  it("sloupec „datum;stav;kdo|…“ a chyby v něm", () => {
    expect(parsujHistoriiStavu("08.12.2022 09:53;Přijato;Jakub Zima|09.12.2022 10:00;Vydáno")).toEqual({
      zmeny: [
        { at: new Date(2022, 11, 8, 9, 53).toISOString(), stav: "Přijato", kdo: "Jakub Zima" },
        { at: new Date(2022, 11, 9, 10, 0).toISOString(), stav: "Vydáno", kdo: null },
      ],
    });
    expect(parsujHistoriiStavu("")).toEqual({ zmeny: [] });
    expect(parsujHistoriiStavu("zítra;Přijato").chyba).toMatch(/nečitelné datum/);
    expect(parsujHistoriiStavu("08.12.2022 09:53;").chyba).toMatch(/bez stavu/);
  });

  it("stavy z historie jdou do mapování; bez sloupce Stav rozhoduje poslední změna", () => {
    const t = parseCsv(["Kód;Přijato;Historie stavů", 'H1;1.1.2024;"01.01.2024 10:00;Přijato;A|02.01.2024 10:00;V opravě;B|03.01.2024 10:00;Vydáno;A"', "H2;1.1.2024;", 'H3;1.1.2024;"nesmysl;Přijato"'].join("\n"));
    const m = odhadniMapovaniZakazek(t.hlavicka, "zl");
    expect(m).toEqual(["code", "created_at", "status_history"]);
    const p = pripravZakazky(t, m, { existujiciKody: new Set(), stavy: STAVY_ZL, fallbackKey: "received", ted });
    expect(p.stavyVeVstupu).toEqual(["Přijato", "V opravě", "Vydáno"]);
    expect(p.chyby).toEqual([{ radek: 4, zprava: "nečitelné datum v historii stavů: nesmysl" }]);
    const [h1, h2] = p.zaznamy.flatMap((z) => (z.stav === "novy" ? [z] : []));
    expect(h1.data.status).toBe("issued");
    expect(h1.historie?.map((h) => h.status)).toEqual(["received", "in_repair", "issued"]);
    expect(h2.historie).toBeUndefined();

    expect(radkyHistorie("t1", "svc", [...h1.historie!, { ...h1.historie![2], created_at: "2024-01-04T00:00:00.000Z" }])).toEqual([
      { ticket_id: "t1", service_id: "svc", action: "updated", changed_by: null, created_at: new Date(2024, 0, 1, 10).toISOString(), details: { changes: { status: { old: null, new: "received" } }, import: { stav: "Přijato", kdo: "A" } } },
      { ticket_id: "t1", service_id: "svc", action: "updated", changed_by: null, created_at: new Date(2024, 0, 2, 10).toISOString(), details: { changes: { status: { old: "received", new: "in_repair" } }, import: { stav: "V opravě", kdo: "B" } } },
      { ticket_id: "t1", service_id: "svc", action: "updated", changed_by: null, created_at: new Date(2024, 0, 3, 10).toISOString(), details: { changes: { status: { old: "in_repair", new: "issued" } }, import: { stav: "Vydáno", kdo: "A" } } },
    ]);
  });

  it("zápis: id zakázek z insert…select, historie po zakázkách, chyba historie nezruší zakázky", async () => {
    const vlozeno: Record<string, unknown[]> = { tickets: [], ticket_history: [] };
    let historieSpadne = false;
    const klient: KlientZapisu = {
      from: (tabulka: string) => ({
        insert: (radky: unknown) => {
          const pole = (Array.isArray(radky) ? radky : [radky]) as Array<Record<string, unknown>>;
          const chyba = tabulka === "ticket_history" && historieSpadne ? { message: "rls" } : null;
          if (!chyba) vlozeno[tabulka].push(...pole);
          const vysledek = { error: chyba };
          return Object.assign(Promise.resolve(vysledek), {
            select: async () => ({ data: pole.map((r, i) => ({ id: `id-${String(r.code)}-${i}`, code: String(r.code) })), error: null }),
          });
        },
      }),
    };
    const radek = (code: string) => ({
      code, created_at: "2024-01-01T00:00:00.000Z", completed_at: null, status: "received", title: "X", notes: "—",
      customer_name: null, customer_phone: null, customer_email: null, customer_company: null, device_label: null, device_brand: null,
      device_serial: null, device_imei: null, device_passcode: null, device_condition: null, estimated_price: null, external_id: null, performed_repairs: [],
    });
    const historie = { A: [{ created_at: "2024-01-01T00:00:00.000Z", status: "received", stavText: "Přijato", kdo: null }, { created_at: "2024-01-02T00:00:00.000Z", status: "issued", stavText: "Vydáno", kdo: null }] };
    const v = await zapisZakazky(klient, "svc", [radek("A"), radek("B")], undefined, 200, historie);
    expect(v).toMatchObject({ novych: 2, historie: { zapsano: 2, chyb: 0 } });
    expect(vlozeno.ticket_history.map((r) => (r as { ticket_id: string }).ticket_id)).toEqual(["id-A-0", "id-A-0"]);

    historieSpadne = true;
    const v2 = await zapisZakazky(klient, "svc", [radek("C")], undefined, 200, { C: historie.A });
    expect(v2).toMatchObject({ novych: 1, historie: { zapsano: 0, chyb: 2 } });

    // Bez historie se select nevolá a výsledek je stejný jako dřív.
    const v3 = await zapisZakazky(klient, "svc", [radek("D")]);
    expect(v3).toEqual({ novych: 1, preskoceno: 0, chyb: 0, chyby: [] });
  });
});
