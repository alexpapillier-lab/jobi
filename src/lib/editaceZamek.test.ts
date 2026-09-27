import { describe, it, expect } from "vitest";
import {
  POLE_ZAKAZKY,
  autorZmen,
  casHodiny,
  drzeneKlice,
  jeCiziZmena,
  jeNasZapis,
  konfliktniPole,
  kratkeJmeno,
  normalizuj,
  ostatniVDetailu,
  poleZFormulare,
  popisKolegu,
  sloucSRozepsanym,
  vyctiPole,
  zmenenaPole,
  zmenilaSeVerze,
  type ZaznamHistorieZmeny,
} from "./editaceZamek";
import type { EvidenceZapisu } from "./slouceniZakazky";

/**
 * Dva lidé upravují stejnou zakázku. Dřív vyhrál poslední zápis: realtime
 * dorovnal `version`, zámek verze prošel a formulář přepsal kolegův telefon
 * hodnotou z chvíle, kdy se kliklo na Upravit.
 */

const zaklad = {
  id: "z1",
  version: 3,
  updatedAt: "2026-09-27T12:00:00.000Z",
  status: "received",
  customerPhone: "777111222",
  customerName: "Jan Novák",
  deviceNote: undefined as string | undefined,
  performedRepairs: [{ id: "r1", name: "Displej", price: 1500 }],
  diagnosticText: "",
};

describe("verze zakázky", () => {
  it("stejná version = nic se nezměnilo, jiná = změnilo", () => {
    expect(zmenilaSeVerze({ version: 3 }, { version: 3 })).toBe(false);
    expect(zmenilaSeVerze({ version: 3 }, { version: 4 })).toBe(true);
  });

  it("bez version rozhoduje updated_at, bez obou se porovnávají pole", () => {
    expect(zmenilaSeVerze({ updatedAt: "a" }, { updatedAt: "a" })).toBe(false);
    expect(zmenilaSeVerze({ updatedAt: "a" }, { updatedAt: "b" })).toBe(true);
    expect(zmenilaSeVerze({}, {})).toBe(true);
  });

  it("řádek, který jsme sami uložili, se pozná podle updated_at z odpovědi", () => {
    expect(jeNasZapis({ updatedAt: "t1" }, new Set(["t1"]))).toBe(true);
    expect(jeNasZapis({ updatedAt: "t2" }, new Set(["t1"]))).toBe(false);
    expect(jeNasZapis({ updatedAt: null }, new Set(["t1"]))).toBe(false);
  });
});

describe("porovnání hodnot", () => {
  it("prázdný text, null a undefined jsou totéž, text se ořízne", () => {
    expect(normalizuj("")).toBe(null);
    expect(normalizuj(undefined)).toBe(null);
    expect(normalizuj("  abc ")).toBe("abc");
    expect(normalizuj(false)).toBe(false);
  });

  it("objekty z jsonb s přeskládanými klíči se berou jako stejné", () => {
    expect(normalizuj([{ price: 1500, name: "Displej", id: "r1" }])).toBe(
      normalizuj([{ id: "r1", name: "Displej", price: 1500, note: undefined }]),
    );
    expect(normalizuj([{ id: "r1", price: 1500 }])).not.toBe(normalizuj([{ id: "r1", price: 1900 }]));
  });
});

describe("konflikt při uložení", () => {
  it("kolega změnil telefon a formulář by ho přepsal starou hodnotou → konflikt", () => {
    const zDb = { ...zaklad, version: 4, customerPhone: "608000000" };
    const zapisujeme = { ...zDb, customerPhone: "777111222" };
    const pole = konfliktniPole(zaklad, zDb, zapisujeme);
    expect(pole.map((p) => p.popisek)).toEqual(["telefon"]);
  });

  it("kolega změnil stav a my zapisujeme totéž (dorazilo realtime) → konflikt není", () => {
    const zDb = { ...zaklad, version: 4, status: "in_progress" };
    const zapisujeme = { ...zDb, deviceNote: "prasklé sklo" };
    expect(konfliktniPole(zaklad, zDb, zapisujeme)).toEqual([]);
    expect(zmenenaPole(zaklad, zDb).map((p) => p.popisek)).toEqual(["stav"]);
  });

  it("naše vlastní úprava pole, které nikdo jiný neměnil, konflikt není", () => {
    const zDb = { ...zaklad, version: 4 };
    const zapisujeme = { ...zDb, customerPhone: "777999999" };
    expect(konfliktniPole(zaklad, zDb, zapisujeme)).toEqual([]);
  });

  it("cena opravy od kolegy se pozná i uvnitř provedených oprav", () => {
    const zDb = { ...zaklad, version: 5, performedRepairs: [{ id: "r1", name: "Displej", price: 1900 }] };
    const zapisujeme = { ...zDb, performedRepairs: zaklad.performedRepairs };
    expect(konfliktniPole(zaklad, zDb, zapisujeme).map((p) => p.popisek)).toEqual(["provedené opravy a ceny"]);
  });

  it("rozepsaná diagnostika a neuložené opravy drží paměť – v porovnání se vynechají", () => {
    const mistni = { ...zaklad, diagnosticText: "rozepsáno", performedRepairs: [{ id: "r2", name: "Baterie", price: 900 }] };
    const zDb = { ...zaklad, version: 4 };
    const zapisujeme = { ...zDb, diagnosticText: mistni.diagnosticText, performedRepairs: mistni.performedRepairs };
    const vynechat = drzeneKlice({ diagnosticText: true, diagnosticPhotos: false, performedRepairs: false }, true);
    expect([...vynechat].sort()).toEqual(["diagnosticText", "performedRepairs"]);
    expect(konfliktniPole(mistni, zDb, zapisujeme, vynechat)).toEqual([]);
  });

  it("přepíše se jen to, co jde z formuláře; stav mimo formulář ne", () => {
    const zDb = { ...zaklad, version: 4, customerPhone: "608000000", status: "ready" };
    const zapisujeme = { ...zaklad, version: 4 };
    const pole = konfliktniPole(zaklad, zDb, zapisujeme);
    expect(pole.map((p) => p.popisek)).toEqual(["stav", "telefon"]);
    const formular = { customerPhone: "777111222", customerName: "Jan Novák", expectedCompletionAt: null };
    expect(poleZFormulare(pole, formular).map((p) => p.popisek)).toEqual(["telefon"]);
  });

  it("předpokládané dokončení se ve formuláři jmenuje jinak než v paměti", () => {
    const zDb = { ...zaklad, version: 4, expected_completion_at: "2026-10-01" };
    const pole = konfliktniPole({ ...zaklad, expected_completion_at: null }, zDb, { ...zDb, expected_completion_at: null });
    expect(poleZFormulare(pole, { expectedCompletionAt: null }).map((p) => p.popisek)).toEqual(["předpokládané dokončení"]);
  });

  it("výčet polí česky, adresa ze tří sloupců jen jednou", () => {
    const adresa = POLE_ZAKAZKY.find((p) => p.popisek === "adresa")!;
    const stav = POLE_ZAKAZKY.find((p) => p.popisek === "stav")!;
    const telefon = POLE_ZAKAZKY.find((p) => p.popisek === "telefon")!;
    expect(vyctiPole([stav])).toBe("stav");
    expect(vyctiPole([stav, telefon])).toBe("stav a telefon");
    expect(vyctiPole([stav, telefon, adresa, adresa])).toBe("stav, telefon a adresa");
  });

  it("seznam polí pokrývá celé uložení zakázky (payload v useOrderActions)", () => {
    const klice = new Set(POLE_ZAKAZKY.flatMap((p) => p.klice));
    for (const k of [
      "status", "deviceLabel", "requestedRepair", "customerId", "customerName", "customerPhone", "customerEmail",
      "customerAddressStreet", "customerAddressCity", "customerAddressZip", "customerCompany", "customerIco",
      "customerInfo", "serialOrImei", "devicePasscode", "deviceCondition", "deviceAccessories", "deviceNote",
      "warrantyClaim", "purchaseDate", "purchaseProof", "findMyOff", "externalId", "handoffMethod", "handbackMethod",
      "estimatedPrice", "performedRepairs", "diagnosticText", "diagnosticPhotos", "diagnosticPhotosBefore",
      "discountType", "discountValue", "expected_completion_at",
    ]) {
      expect(klice.has(k), `chybí ${k}`).toBe(true);
    }
  });
});

describe("autor změny z historie", () => {
  const h = (changed_by: string | null, created_at: string, sloupce: string[], action = "updated"): ZaznamHistorieZmeny => ({
    changed_by,
    created_at,
    action,
    details: { changes: Object.fromEntries(sloupce.map((s) => [s, { old: 1, new: 2 }])) },
  });
  const od = "2026-09-27T12:00:00.000Z";

  it("kolega po začátku úprav → kolega, nejnovější první", () => {
    const a = autorZmen(
      [h("jana", "2026-09-27T12:05:00Z", ["customer_phone"]), h("petr", "2026-09-27T12:07:00Z", ["customer_phone"])],
      { mojeId: "ja", od, sloupce: ["customer_phone"] },
    );
    expect(a).toEqual({ typ: "kolega", autori: ["petr", "jana"], cas: "2026-09-27T12:07:00Z" });
    expect(jeCiziZmena(a)).toBe(true);
  });

  it("záznamy před začátkem úprav a jiné sloupce se nepočítají", () => {
    const a = autorZmen(
      [h("jana", "2026-09-27T11:59:00Z", ["customer_phone"]), h("petr", "2026-09-27T12:03:00Z", ["assigned_to"])],
      { mojeId: "ja", od, sloupce: ["customer_phone"] },
    );
    expect(a).toEqual({ typ: "neznamy" });
    expect(jeCiziZmena(a)).toBe(true);
  });

  it("jen moje změny (jiné okno) → já, není cizí", () => {
    const a = autorZmen([h("ja", "2026-09-27T12:05:00Z", ["notes"])], { mojeId: "ja", od, sloupce: ["notes"] });
    expect(a).toEqual({ typ: "ja", cas: "2026-09-27T12:05:00Z" });
    expect(jeCiziZmena(a)).toBe(false);
  });

  it("změna bez přihlášeného uživatele (portál) je cizí s autorem null", () => {
    const a = autorZmen([h(null, "2026-09-27T12:05:00Z", ["status"])], { mojeId: "ja", od, sloupce: ["status"] });
    expect(a).toEqual({ typ: "kolega", autori: [null], cas: "2026-09-27T12:05:00Z" });
  });

  it("smazání a vytvoření nejsou úprava polí", () => {
    expect(autorZmen([h("jana", "2026-09-27T12:05:00Z", [], "deleted")], { mojeId: "ja", od, sloupce: [] })).toEqual({ typ: "neznamy" });
  });
});

describe("přítomnost v detailu", () => {
  it("vynechá mě, víc oken kolegy sloučí, upravující první", () => {
    const ostatni = ostatniVDetailu(
      {
        ja: [{ userId: "ja", jmeno: "Já", od: "2026-09-27T12:00:00Z", upravuje: true }],
        petr: [{ userId: "petr", jmeno: "Petr", od: "2026-09-27T11:00:00Z", upravuje: false }],
        jana: [
          { userId: "jana", jmeno: "Jana Nováková", od: "2026-09-27T12:10:00Z", upravuje: false },
          { userId: "jana", jmeno: "Jana Nováková", od: "2026-09-27T12:02:00Z", upravuje: true },
        ],
      },
      "ja",
    );
    expect(ostatni).toEqual([
      { userId: "jana", jmeno: "Jana Nováková", od: "2026-09-27T12:02:00Z", upravuje: true },
      { userId: "petr", jmeno: "Petr", od: "2026-09-27T11:00:00Z", upravuje: false },
    ]);
  });

  it("štítek: upravuje oranžově s časem, jinak otevřeno", () => {
    const od = new Date(2026, 8, 27, 14, 2).toISOString();
    expect(popisKolegu([{ userId: "a", jmeno: "Jana Nováková", od, upravuje: true }])).toEqual({ text: "Upravuje: Jana N. (od 14:02)", upravuje: true });
    expect(
      popisKolegu([
        { userId: "a", jmeno: "Jana Nováková", od, upravuje: false },
        { userId: "b", jmeno: "Petr", od, upravuje: false },
      ]),
    ).toEqual({ text: "Otevřeno: Jana N. a 1 další", upravuje: false });
    expect(popisKolegu([])).toBe(null);
  });

  it("krátké jméno a čas", () => {
    expect(kratkeJmeno("Jana Nováková")).toBe("Jana N.");
    expect(kratkeJmeno("  servis ")).toBe("servis");
    expect(kratkeJmeno("")).toBe("Kolega");
    expect(casHodiny(new Date(2026, 8, 27, 9, 5).toISOString())).toBe("9:05");
    expect(casHodiny(null)).toBe("");
  });
});

describe("čerstvá verze po konfliktu neztratí rozdělané", () => {
  const evidence = (neulozene: string[] = []): EvidenceZapisu => ({ bezici: new Map(), odlozene: new Set(), neulozene: new Set(neulozene) });
  const mistni = { ...zaklad, diagnosticText: "rozepsáno", performedRepairs: [{ id: "r2", name: "Baterie", price: 900 }] };
  const zDb = { ...zaklad, version: 4, customerPhone: "608000000" };

  it("neuložené opravy z fronty zůstanou (evidence neulozene)", () => {
    const s = sloucSRozepsanym(mistni, zDb, evidence(["z1"]), "z1", { diagnosticText: false, diagnosticPhotos: false, performedRepairs: false });
    expect(s.performedRepairs).toBe(mistni.performedRepairs);
    expect(s.customerPhone).toBe("608000000");
    expect(s.diagnosticText).toBe("");
  });

  it("rozepsaná diagnostika zůstane, zbytek z databáze", () => {
    const s = sloucSRozepsanym(mistni, zDb, evidence(), "z1", { diagnosticText: true, diagnosticPhotos: false, performedRepairs: false });
    expect(s.diagnosticText).toBe("rozepsáno");
    expect(s.performedRepairs).toBe(zDb.performedRepairs);
  });
});
