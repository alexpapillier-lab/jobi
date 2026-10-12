/**
 * Šablony dokumentů ve webové verzi (sablonyDokumentuWeb.ts).
 *
 * 1. Úložiště: verze, konflikt, „Přepsat“, zachování ostatních klíčů configu,
 *    obrázky značky do bucketu (nebo data: URL, když bucket není), RLS.
 * 2. Stejný výsledek: šablona uložená webem a načtená desktopovým JobiDocs
 *    (jobidocs/api/documentsStore.ts) – a naopak – dá stejné HTML z renderDocument.
 *
 * Supabase nahrazuje paměťová databáze se stejnými pravidly jako produkce:
 * trigger zvyšuje `version` při každém UPDATE, `service_id` je unikátní,
 * RLS odmítnutý UPDATE vrací 0 řádků bez chyby.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DOC_TYPES, defaultDocuments, defaultTemplate, normalizeDocuments, renderDocument, sampleData, templateFor, type DocumentsV2 } from "../../jobidocs/core/index";
import { jeKonflikt } from "../../jobidocs/src/storage/types";
import { loadDocuments, saveDocuments } from "../../jobidocs/api/documentsStore";
import { setDocumentsConfigPath } from "../../jobidocs/api/documentsConfig";
import { BUCKET_ZNACKY, configSeSablonami, dataUrlNaBlob, nactiSablony, rozmeryPoZmenseni, ulozSablony, vytvorWeboveUloziste, type DotazDb, type KlientSablon, type VysledekDb } from "./sablonyDokumentuWeb";

/* ------------------------------------------------------------------------- */
/* Paměťová „Supabase“                                                        */
/* ------------------------------------------------------------------------- */

type Radek = { service_id: string; config: Record<string, unknown>; version: number; updated_at: string };

class FalesnaDb {
  radky = new Map<string, Radek>();
  soubory = new Map<string, { typ: string }>();
  bucketExistuje = false;
  /** false = RLS: UPDATE projde bez chyby s 0 řádky, INSERT skončí 42501. */
  zapisPovolen = true;
  /** Zavolá se těsně před zápisem – simuluje souběžné uložení z jiného místa. */
  predZapisem: (() => void) | null = null;
  nahrani = 0;
  private cas = 0;

  ted(): string {
    this.cas += 1;
    return new Date(Date.UTC(2026, 9, 12, 10, 0, this.cas)).toISOString();
  }

  /** Přímý zápis „odjinud“ (jiný prohlížeč, JobiDocs, autoPrint z Jobi). */
  zapisOdjinud(serviceId: string, config: Record<string, unknown>) {
    const r = this.radky.get(serviceId);
    if (r) this.radky.set(serviceId, { ...r, config: kopie(config), version: r.version + 1, updated_at: this.ted() });
    else this.radky.set(serviceId, { service_id: serviceId, config: kopie(config), version: 1, updated_at: this.ted() });
  }

  klient(): FalesnyKlient {
    return klientPro(this);
  }
}

type FalesnyKlient = KlientSablon & { from(t: string): ReturnType<KlientSablon["from"]> & { upsert(r: Record<string, unknown>, o?: unknown): PromiseLike<VysledekDb> } };

function klientPro(db: FalesnaDb): FalesnyKlient {
  const dotaz = (op: "select" | "update" | "insert", data?: Record<string, unknown>) => {
    const filtry: [string, unknown][] = [];
    let vratit = op === "select";
    const proved = (): VysledekDb => {
      const vyhovuje = (r: Radek) => filtry.every(([k, v]) => (r as unknown as Record<string, unknown>)[k] === v);
      if (op === "select") return { data: [...db.radky.values()].filter(vyhovuje).map(kopie), error: null };
      if (op === "update") {
        if (!db.zapisPovolen) return { data: vratit ? [] : null, error: null };
        db.predZapisem?.();
        db.predZapisem = null;
        const zasazene = [...db.radky.values()].filter(vyhovuje);
        for (const r of zasazene) db.radky.set(r.service_id, { ...r, ...kopie(data!), version: r.version + 1, updated_at: db.ted() });
        return { data: vratit ? zasazene.map((r) => kopie(db.radky.get(r.service_id)!)) : null, error: null };
      }
      if (!db.zapisPovolen) return { data: null, error: { message: "new row violates row-level security policy", code: "42501" } };
      const sid = String(data!.service_id);
      if (db.radky.has(sid)) return { data: null, error: { message: "duplicate key value", code: "23505" } };
      db.radky.set(sid, { service_id: sid, config: kopie(data!.config as Record<string, unknown>), version: 1, updated_at: db.ted() });
      return { data: vratit ? [kopie(db.radky.get(sid)!)] : null, error: null };
    };
    const q: DotazDb = {
      select() {
        vratit = true;
        return q;
      },
      eq(k: string, v: unknown) {
        filtry.push([k, v]);
        return q;
      },
      maybeSingle: () => Promise.resolve(proved()).then((r) => ({ data: Array.isArray(r.data) ? (r.data[0] ?? null) : r.data, error: r.error })),
      then<A = VysledekDb, B = never>(ok?: ((v: VysledekDb) => A | PromiseLike<A>) | null, chyba?: ((e: unknown) => B | PromiseLike<B>) | null) {
        return Promise.resolve(proved()).then(ok, chyba);
      },
    };
    return q;
  };
  return {
    from: (tabulka: string) => {
      expect(tabulka).toBe("service_document_settings");
      return {
        select: () => dotaz("select"),
        update: (z: Record<string, unknown>) => dotaz("update", z),
        insert: (r: Record<string, unknown>) => dotaz("insert", r),
        // Desktop (documentsStore.ts) zapisuje přes upsert.
        upsert: (r: Record<string, unknown>) => {
          const sid = String(r.service_id);
          if (db.radky.has(sid)) return dotaz("update", { config: r.config }).eq("service_id", sid);
          return dotaz("insert", r);
        },
      };
    },
    storage: {
      from: (bucket: string) => ({
        upload: async (cesta: string, telo: unknown, volby: { contentType: string }) => {
          db.nahrani += 1;
          expect(telo).toBeTruthy();
          if (!db.bucketExistuje || bucket !== BUCKET_ZNACKY) return { error: { message: "Bucket not found" } };
          db.soubory.set(cesta, { typ: volby.contentType });
          return { error: null };
        },
        getPublicUrl: (cesta: string) => ({ data: { publicUrl: `https://projekt.supabase.co/storage/v1/object/public/${bucket}/${cesta}` } }),
      }),
    },
  };
}

function kopie<T>(x: T): T {
  return JSON.parse(JSON.stringify(x)) as T;
}

/* Desktop si klienta zakládá sám – podstrčí se mu tatáž paměťová databáze. */
const sdilene = vi.hoisted(() => ({ db: null as null | { klient(): unknown } }));
vi.mock("@supabase/supabase-js", () => ({ createClient: () => sdilene.db!.klient() }));
// JobiDocs má vlastní node_modules – jeho import míří jinam než ten z Jobi.
vi.mock("../../jobidocs/node_modules/@supabase/supabase-js", () => ({ createClient: () => sdilene.db!.klient() }));

const SID = "11111111-2222-4333-8444-555555555555";
const AUTH = { supabaseUrl: "https://projekt.supabase.co", supabaseAnonKey: "anon", supabaseAccessToken: "token" };
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

/** Šablony, které se od výchozích liší ve všem, co editor umí změnit. */
function upraveneSablony(): DocumentsV2 {
  const d = defaultDocuments();
  const zl = defaultTemplate("zakazkovy_list");
  return normalizeDocuments({
    ...d,
    brand: { ...d.brand, logoUrl: PNG, stampUrl: PNG, reviewUrl: "https://g.page/r/test/review", reviewText: "Ohodnoťte nás" },
    theme: { ...d.theme, accent: "#db2777", style: "plain", tableLines: "all" },
    templates: {
      zakazkovy_list: { ...zl, page: { ...zl.page, fontSize: 9, fit: "auto" }, blocks: zl.blocks.slice(0, -1) },
      zarucni_list: defaultTemplate("zarucni_list"),
    },
  });
}

/** HTML všech typů dokumentů – co se opravdu vytiskne. */
function htmlVsech(docs: DocumentsV2): string[] {
  return DOC_TYPES.map((t) => renderDocument({ template: templateFor(docs, t), data: sampleData(t, "long"), brand: docs.brand, theme: docs.theme, options: { mode: "print" } }));
}

let db: FalesnaDb;
let tmp: string;

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "jobidocs-sablony-"));
  setDocumentsConfigPath(tmp);
});
afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});
beforeEach(() => {
  db = new FalesnaDb();
  sdilene.db = db;
});

/* ------------------------------------------------------------------------- */
/* 1. Úložiště                                                                */
/* ------------------------------------------------------------------------- */

describe("webové úložiště šablon", () => {
  it("servis bez řádku dostane výchozí šablony s verzí 0", async () => {
    const l = await nactiSablony(db.klient(), SID, true);
    expect(l.source).toBe("default");
    expect(l.version).toBe(0);
    expect(l.documents).toEqual(normalizeDocuments(defaultDocuments()));
  });

  it("první uložení založí řádek, další zvyšují verzi", async () => {
    const k = db.klient();
    const a = await ulozSablony(k, SID, upraveneSablony(), 0);
    expect(a.version).toBe(1);
    const b = await ulozSablony(k, SID, upraveneSablony(), a.version);
    expect(b.version).toBe(2);
    const l = await nactiSablony(k, SID, true);
    expect(l.version).toBe(2);
    expect(l.source).toBe("supabase");
  });

  it("uložení ze starší verze je konflikt a nic nepřepíše", async () => {
    const k = db.klient();
    const v1 = await ulozSablony(k, SID, upraveneSablony(), 0);
    // Mezitím uložil někdo jiný (JobiDocs nebo druhý prohlížeč).
    db.zapisOdjinud(SID, { ...db.radky.get(SID)!.config, v2: normalizeDocuments(defaultDocuments()) });
    const predtim = kopie(db.radky.get(SID)!);
    const e = await ulozSablony(k, SID, upraveneSablony(), v1.version).catch((x) => x);
    expect(jeKonflikt(e)).toBe(true);
    expect(e.body.version).toBe(2);
    expect(db.radky.get(SID)).toEqual(predtim);
  });

  it("Přepsat (bez ifVersion) uloží přes cizí verzi", async () => {
    const k = db.klient();
    await ulozSablony(k, SID, upraveneSablony(), 0);
    db.zapisOdjinud(SID, { v2: normalizeDocuments(defaultDocuments()) });
    const r = await ulozSablony(k, SID, upraveneSablony());
    expect(r.version).toBe(3);
    expect((db.radky.get(SID)!.config.v2 as DocumentsV2).theme.accent).toBe("#db2777");
  });

  it("souběžné uložení mezi čtením a zápisem je konflikt, ne tiché přepsání", async () => {
    const k = db.klient();
    await ulozSablony(k, SID, upraveneSablony(), 0);
    db.predZapisem = () => db.zapisOdjinud(SID, { v2: normalizeDocuments(defaultDocuments()), autoPrint: { ticketListOnCreate: true } });
    const e = await ulozSablony(k, SID, upraveneSablony(), 1).catch((x) => x);
    expect(jeKonflikt(e)).toBe(true);
    expect(db.radky.get(SID)!.config.autoPrint).toEqual({ ticketListOnCreate: true });
  });

  it("ostatní klíče configu (autoPrint, warrantyCertificate, staré v1) zůstanou", async () => {
    db.zapisOdjinud(SID, { autoPrint: { ticketListOnCreate: true, ticketListOnStatusKey: "hotovo" }, warrantyCertificate: { includeRepairs: false }, designAccentColor: "#123456" });
    const k = db.klient();
    const l = await nactiSablony(k, SID, true);
    await ulozSablony(k, SID, upraveneSablony(), l.version);
    const c = db.radky.get(SID)!.config;
    expect(c.autoPrint).toEqual({ ticketListOnCreate: true, ticketListOnStatusKey: "hotovo" });
    expect(c.warrantyCertificate).toEqual({ includeRepairs: false });
    expect(c.designAccentColor).toBe("#123456");
    expect((c.v2 as DocumentsV2).theme.accent).toBe("#db2777");
    expect(configSeSablonami(null, upraveneSablony())).toEqual({ v2: upraveneSablony() });
  });

  it("bez bucketu zůstanou logo a razítko jako data: URL (stav produkce)", async () => {
    const r = await ulozSablony(db.klient(), SID, upraveneSablony(), 0);
    expect(r.documents.brand.logoUrl).toBe(PNG);
    expect((db.radky.get(SID)!.config.v2 as DocumentsV2).brand.stampUrl).toBe(PNG);
  });

  it("s bucketem jdou obrázky do <service_id>/logo|stamp.<přípona> a v configu je adresa", async () => {
    db.bucketExistuje = true;
    const r = await ulozSablony(db.klient(), SID, upraveneSablony(), 0);
    expect([...db.soubory.keys()].sort()).toEqual([`${SID}/logo.png`, `${SID}/stamp.png`]);
    expect(r.documents.brand.logoUrl).toMatch(new RegExp(`^https://projekt\\.supabase\\.co/storage/v1/object/public/${BUCKET_ZNACKY}/${SID}/logo\\.png\\?v=\\d+$`));
    expect((db.radky.get(SID)!.config.v2 as DocumentsV2).brand.logoUrl).toBe(r.documents.brand.logoUrl);
  });

  it("při konfliktu se obrázky nenahrávají", async () => {
    db.bucketExistuje = true;
    await ulozSablony(db.klient(), SID, normalizeDocuments(defaultDocuments()), 0);
    db.zapisOdjinud(SID, { v2: normalizeDocuments(defaultDocuments()) });
    await ulozSablony(db.klient(), SID, upraveneSablony(), 1).catch(() => {});
    expect(db.nahrani).toBe(0);
  });

  it("zápis odmítnutý RLS je chyba oprávnění, ne konflikt", async () => {
    db.zapisOdjinud(SID, { v2: normalizeDocuments(defaultDocuments()) });
    db.zapisPovolen = false;
    const e = await ulozSablony(db.klient(), SID, upraveneSablony(), 1).catch((x) => x);
    expect(jeKonflikt(e)).toBe(false);
    expect(String(e.message)).toMatch(/oprávnění/);
    const bezRadku = new FalesnaDb();
    bezRadku.zapisPovolen = false;
    const e2 = await ulozSablony(bezRadku.klient(), SID, upraveneSablony(), 0).catch((x) => x);
    expect(String(e2.message)).toMatch(/oprávnění/);
  });

  it("řádek založený mezitím někým jiným je konflikt", async () => {
    const k = db.klient();
    const l = await nactiSablony(k, SID, true);
    db.zapisOdjinud(SID, { v2: normalizeDocuments(defaultDocuments()) });
    const e = await ulozSablony(k, SID, upraveneSablony(), l.version).catch((x) => x);
    expect(jeKonflikt(e)).toBe(true);
  });

  it("úložiště editoru: bez oprávnění neukládá, po uložení zahodí cache tisku", async () => {
    const zapomenute: string[] = [];
    const zaklad = {
      klient: db.klient(),
      services: [],
      activeServiceId: SID,
      companyData: () => null,
      tiskHtml: async () => {},
      stahnout: () => {},
      hlaska: () => {},
      poUlozeni: (sid: string) => zapomenute.push(sid),
    };
    const jenCteni = vytvorWeboveUloziste({ ...zaklad, canManage: false });
    await expect(jenCteni.save(SID, upraveneSablony(), 0)).rejects.toThrow(/oprávnění/);
    expect(db.radky.size).toBe(0);
    const s = vytvorWeboveUloziste({ ...zaklad, canManage: true });
    expect(s.kind).toBe("web");
    const r = await s.save(SID, upraveneSablony(), 0);
    expect(r.savedTo).toBe("supabase");
    expect(zapomenute).toEqual([SID]);
    expect((await s.load(SID)).canManage).toBe(true);
  });

  it("zkušební tisk tiskne rozpracovanou šablonu z editoru, ne uloženou", async () => {
    const vytisknuto: { html: string; nazev: string }[] = [];
    const s = vytvorWeboveUloziste({
      klient: db.klient(),
      services: [],
      activeServiceId: SID,
      companyData: () => null,
      canManage: true,
      tiskHtml: async (html, nazev) => {
        vytisknuto.push({ html, nazev });
      },
      stahnout: () => {},
      hlaska: (t, d) => {
        if (d === "error") throw new Error(t);
      },
    });
    const docs = upraveneSablony();
    const data = sampleData("zakazkovy_list", "short");
    await s.testPrint({ serviceId: SID, docType: "zakazkovy_list", documents: docs, sample: "short", previewData: data });
    expect(vytisknuto).toHaveLength(1);
    expect(vytisknuto[0].html).toBe(renderDocument({ template: templateFor(docs, "zakazkovy_list"), data, brand: docs.brand, theme: docs.theme, options: { mode: "print", browserPrint: true } }));
    expect(vytisknuto[0].nazev).toMatch(/^zakazkovy-list.*-ukazka$/);
  });

  it("pomocné funkce: data: URL na Blob, zmenšení nikdy nezvětšuje", async () => {
    const b = dataUrlNaBlob(PNG)!;
    expect(b.mime).toBe("image/png");
    expect(b.blob.size).toBeGreaterThan(0);
    expect(dataUrlNaBlob("https://x/logo.png")).toBeNull();
    expect(rozmeryPoZmenseni(4000, 2000)).toEqual({ sirka: 1000, vyska: 500 });
    expect(rozmeryPoZmenseni(300, 120)).toEqual({ sirka: 300, vyska: 120 });
  });
});

/* ------------------------------------------------------------------------- */
/* 2. Web ↔ desktop: stejné HTML                                              */
/* ------------------------------------------------------------------------- */

describe("šablona z webu a z JobiDocs vypadá stejně", () => {
  for (const bucket of [false, true]) {
    const popis = bucket ? "obrázky v bucketu" : "obrázky jako data: URL";

    it(`uloženo webem, načteno desktopem (${popis})`, async () => {
      db.bucketExistuje = bucket;
      const ulozeno = await ulozSablony(db.klient(), SID, upraveneSablony(), 0);
      const desktop = await loadDocuments(SID, AUTH, null);
      const web = await nactiSablony(db.klient(), SID, true);
      expect(desktop.source).toBe("supabase");
      expect(desktop.version).toBe(web.version);
      expect(htmlVsech(desktop.documents)).toEqual(htmlVsech(web.documents));
      expect(htmlVsech(desktop.documents)).toEqual(htmlVsech(ulozeno.documents));
      if (!bucket) expect(htmlVsech(desktop.documents)).toEqual(htmlVsech(upraveneSablony()));
    });

    it(`uloženo desktopem, načteno webem (${popis})`, async () => {
      db.bucketExistuje = bucket;
      const r = await saveDocuments(SID, upraveneSablony(), 0, AUTH);
      expect(r.ok).toBe(true);
      const web = await nactiSablony(db.klient(), SID, true);
      const desktop = await loadDocuments(SID, AUTH, null);
      expect(web.version).toBe(desktop.version);
      expect(htmlVsech(web.documents)).toEqual(htmlVsech(desktop.documents));
      if (r.ok) expect(htmlVsech(web.documents)).toEqual(htmlVsech(r.documents));
      if (bucket) expect(web.documents.brand.logoUrl).toMatch(new RegExp(`/${SID}/logo\\.png\\?v=`));
    });
  }

  it("střídavé ukládání web → desktop → web drží verzi i konflikt", async () => {
    const w1 = await ulozSablony(db.klient(), SID, upraveneSablony(), 0);
    const d = await saveDocuments(SID, normalizeDocuments(defaultDocuments()), w1.version, AUTH);
    expect(d.ok).toBe(true);
    // Web pořád drží verzi 1 → konflikt, desktop mezitím uložil.
    const e = await ulozSablony(db.klient(), SID, upraveneSablony(), w1.version).catch((x) => x);
    expect(jeKonflikt(e)).toBe(true);
    // Desktop ze staré verze taky dostane konflikt.
    const d2 = await saveDocuments(SID, upraveneSablony(), w1.version, AUTH);
    expect(d2.ok).toBe(false);
    expect(d2.ok === false && "conflict" in d2 && d2.conflict).toBe(true);
  });
});
