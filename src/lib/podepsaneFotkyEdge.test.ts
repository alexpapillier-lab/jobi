/**
 * Podepisování odkazů na fotky v edge funkcích.
 *
 * Portál a export dat běží pod `service_role`, tedy nad všemi politikami. Jsou
 * to jediná dvě místa, odkud odkaz na fotku zákazníka odchází mimo aplikaci –
 * do stránky, kterou otevře kdokoli s odkazem, a do souboru, který si majitel
 * stáhne a může ho poslat dál. Kdyby odsud odešla veřejná adresa, platila by
 * navždy a bez přihlášení: přesně stav, kvůli kterému se tohle dělalo.
 *
 * Modul `_shared/podepsaneFotky.ts` je čisté TypeScript bez Dena, takže ho
 * vitest naimportuje a otestuje NAD BĚŽÍCÍM KÓDEM (stejný postup jako
 * portalPayload.test.ts). Co v `_shared` být nemůže – vlastní volání uvnitř
 * `index.ts` – hlídají pojistky ve zdrojácích dole.
 *
 * ŽÁDNÁ SÍŤ ANI DATABÁZE.
 */

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  BUCKET_FOTEK,
  PLATNOST_EXPORT_S,
  PLATNOST_PORTAL_S,
  cestaFotky,
  podepsFotku,
  podepsFotky,
} from "../../supabase/functions/_shared/podepsaneFotky";
import { sestavPayload, type TicketRow } from "../../supabase/functions/_shared/portalPayload";

const KOREN = join(__dirname, "..", "..");
const zdroj = (cesta: string) => readFileSync(join(KOREN, cesta), "utf8");
const zdrojBezKomentaru = (cesta: string) =>
  zdroj(cesta)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

const ZAKLAD = "https://abcd.supabase.co/storage/v1/object";
const SERVIS = "882beee7-4564-4d10-8ac6-16dc19240b57";
const verejna = (cesta: string) => `${ZAKLAD}/public/diagnostic-photos/${cesta}`;

function falesnySvc(prepis?: (cesty: string[], s: number) => Promise<unknown>) {
  const volani: { cesty: string[]; platnost: number }[] = [];
  const svc = {
    storage: {
      from: (bucket: string) => ({
        createSignedUrls: async (cesty: string[], platnost: number) => {
          expect(bucket).toBe(BUCKET_FOTEK);
          volani.push({ cesty, platnost });
          if (prepis) return prepis(cesty, platnost);
          return {
            data: cesty.map((c) => ({ path: c, signedUrl: `${ZAKLAD}/sign/diagnostic-photos/${c}?token=abc`, error: null })),
            error: null,
          };
        },
      }),
    },
  };
  return { svc: svc as never, volani };
}

describe("cesta z uložené URL", () => {
  it("vytáhne cestu z veřejného i podepsaného tvaru", () => {
    const cesta = `${SERVIS}/1111/a.jpg`;
    expect(cestaFotky(verejna(cesta))).toBe(cesta);
    expect(cestaFotky(`${ZAKLAD}/sign/diagnostic-photos/${cesta}?token=x`)).toBe(cesta);
  });

  it("podpis převzetí leží mimo složku servisu a pozná se taky", () => {
    expect(cestaFotky(verejna("signatures/1111-2222.png"))).toBe("signatures/1111-2222.png");
  });

  it("co není náš bucket, se nepodepisuje", () => {
    expect(cestaFotky(`${ZAKLAD}/public/product-images/${SERVIS}/p/a.jpg`)).toBeNull();
    expect(cestaFotky("data:image/png;base64,AAAA")).toBeNull();
    expect(cestaFotky(null)).toBeNull();
    expect(cestaFotky(42)).toBeNull();
  });
});

describe("podepisování v edge funkci", () => {
  it("podepíše všechny fotky jedním voláním a zachová pořadí", async () => {
    const { svc, volani } = falesnySvc();
    const a = verejna(`${SERVIS}/t/a.jpg`);
    const b = verejna(`${SERVIS}/t/b.jpg`);
    const out = await podepsFotky(svc, [a, b], PLATNOST_PORTAL_S);
    expect(volani).toHaveLength(1);
    expect(volani[0].platnost).toBe(PLATNOST_PORTAL_S);
    expect(out[0]).toContain("t/a.jpg");
    expect(out[1]).toContain("t/b.jpg");
    expect(out.every((u) => u.includes("/object/sign/"))).toBe(true);
  });

  it("stejnou fotku dvakrát v seznamu podepíše jednou, ale vrátí ji dvakrát", async () => {
    const { svc, volani } = falesnySvc();
    const a = verejna(`${SERVIS}/t/a.jpg`);
    const out = await podepsFotky(svc, [a, a], PLATNOST_PORTAL_S);
    expect(volani[0].cesty).toEqual([`${SERVIS}/t/a.jpg`]);
    expect(out[0]).toBe(out[1]);
  });

  it("prázdný seznam nikam nechodí", async () => {
    const { svc, volani } = falesnySvc();
    expect(await podepsFotky(svc, [], PLATNOST_PORTAL_S)).toEqual([]);
    expect(volani).toHaveLength(0);
  });

  it("chyba úložiště nezhodí odpověď – zakázka se zákazníkovi ukáže i bez fotek", async () => {
    const { svc } = falesnySvc(async () => ({ data: null, error: { message: "boom" } }));
    const a = verejna(`${SERVIS}/t/a.jpg`);
    expect(await podepsFotky(svc, [a], PLATNOST_PORTAL_S)).toEqual([a]);
  });

  it("podpis: null zůstává null, jinak se podepíše", async () => {
    const { svc } = falesnySvc();
    expect(await podepsFotku(svc, null, PLATNOST_PORTAL_S)).toBeNull();
    const p = await podepsFotku(svc, verejna("signatures/1111-2222.png"), PLATNOST_PORTAL_S);
    expect(p).toContain("/object/sign/");
  });

  it("export má delší platnost než portál, ale ne nekonečnou", () => {
    // Portál si data obnovuje sám, export je soubor ke stažení – proto rozdíl.
    expect(PLATNOST_PORTAL_S).toBeLessThan(PLATNOST_EXPORT_S);
    expect(PLATNOST_EXPORT_S).toBeLessThanOrEqual(7 * 24 * 3600);
  });
});

describe("podepsání v odpovědi portálu", () => {
  /* Nad skutečným tvarem odpovědi, ne nad textem zdrojáku. Fotky a podpis
     leží v `payload.ticket`, ne nahoře – při psaní opravy se to snadno
     splete a odpověď pak vypadá správně, jen v ní jsou fotky nepodepsané
     a navíc jednou zbytečně nahoře. */
  function payload(prepis: Partial<TicketRow> = {}) {
    return sestavPayload({
      ticket: {
        id: "11111111-1111-1111-1111-111111111111",
        service_id: SERVIS,
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
        performed_repairs: [],
        diagnostic_photos: [verejna(`${SERVIS}/t/po.jpg`)],
        diagnostic_photos_before: [verejna(`${SERVIS}/t/pred.jpg`)],
        discount_type: null,
        discount_value: null,
        handoff_method: "osobne",
        handback_method: "osobne",
        quote_amount: null,
        quote_items: [],
        quote_note: null,
        quote_status: "none",
        quote_sent_at: null,
        quote_decided_at: null,
        intake_signature_url: verejna("signatures/1111-2222.png"),
        intake_signed_at: "2026-09-02T08:00:00.000Z",
        portal_last_opened_at: null,
        portal_token_expires_at: null,
        ...prepis,
      } as TicketRow,
      stav: { key: "received", label: "Přijato", bg: "#fff", fg: "#000", is_final: false },
      config: {},
      nazevServisu: "Servis",
      pobocka: null,
    });
  }

  /** Tentýž krok, jaký dělá portal-ticket po sestavení odpovědi. */
  async function podepsVOdpovedi(svc: never, p: ReturnType<typeof payload>) {
    const [photos, photosBefore, intakeSignatureUrl] = await Promise.all([
      podepsFotky(svc, p.ticket.photos ?? [], PLATNOST_PORTAL_S),
      podepsFotky(svc, p.ticket.photosBefore ?? [], PLATNOST_PORTAL_S),
      podepsFotku(svc, p.ticket.intakeSignatureUrl, PLATNOST_PORTAL_S),
    ]);
    return { ...p, ticket: { ...p.ticket, photos, photosBefore, intakeSignatureUrl } };
  }

  it("fotky a podpis jsou v odpovědi uvnitř `ticket`, ne nahoře", () => {
    const p = payload();
    expect(p.ticket.photos).toHaveLength(1);
    expect(p.ticket.photosBefore).toHaveLength(1);
    expect(p.ticket.intakeSignatureUrl).toContain("signatures/");
    expect((p as unknown as Record<string, unknown>).photos).toBeUndefined();
  });

  it("po podepsání jsou podepsané všechny tři a nikde nezůstane uložená adresa", async () => {
    const { svc } = falesnySvc();
    const out = await podepsVOdpovedi(svc, payload());
    for (const u of [...out.ticket.photos, ...out.ticket.photosBefore, out.ticket.intakeSignatureUrl!]) {
      expect(u).toContain("/object/sign/");
      expect(u).not.toContain("/object/public/");
    }
  });

  it("podepsáním se v odpovědi neobjeví žádný klíč navíc", async () => {
    // Portál kontroluje přesný seznam klíčů; jeden navíc znamená, že se ven
    // dostalo něco, co tam být nemá (e2e/portal-bezpecnost.spec.ts).
    const puvodni = payload();
    const { svc } = falesnySvc();
    const out = await podepsVOdpovedi(svc, puvodni);
    expect(Object.keys(out).sort()).toEqual(Object.keys(puvodni).sort());
    expect(Object.keys(out.ticket).sort()).toEqual(Object.keys(puvodni.ticket).sort());
  });

  it("zakázka bez fotek a bez podpisu projde beze změny", async () => {
    const { svc, volani } = falesnySvc();
    const out = await podepsVOdpovedi(
      svc,
      payload({ diagnostic_photos: [], diagnostic_photos_before: [], intake_signature_url: null }),
    );
    expect(out.ticket.photos).toEqual([]);
    expect(out.ticket.intakeSignatureUrl).toBeNull();
    expect(volani).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Pojistky ve zdrojácích: tělo edge funkce se naimportovat nedá, tak se čte
// jako text. Chrání to před tichým návratem k veřejným odkazům.

describe("pojistky ve zdrojácích", () => {
  it("portál posílá ven podepsané odkazy, ne to, co je v databázi", () => {
    const s = zdrojBezKomentaru("supabase/functions/portal-ticket/index.ts");
    expect(s).toContain("podepsFotky(svc, payload.ticket.photos");
    expect(s).toContain("podepsFotky(svc, payload.ticket.photosBefore");
    expect(s).toContain("podepsFotku(svc, payload.ticket.intakeSignatureUrl");
  });

  it("portál neukládá odkaz na podpis do události", () => {
    // Byla by to druhá kopie odkazu v databázi, která se navíc dostane do exportu.
    const s = zdrojBezKomentaru("supabase/functions/portal-ticket/index.ts");
    expect(s).toContain('insertEvent(svc, ticket, "signed", meta)');
    expect(s).not.toContain("{ ...meta, url:");
  });

  it("export dat podepisuje odkazy na fotky", () => {
    const s = zdrojBezKomentaru("supabase/functions/service-manage/index.ts");
    expect(s).toContain("PLATNOST_EXPORT_S");
    expect(s).toContain("podepsFotky(");
  });

  it("aplikace nikde nevykresluje fotku syrovou URL z databáze", () => {
    // Náhledy jdou přes FotkaZakazky (podepíše a obnovuje), lightbox přes hook.
    const s = zdrojBezKomentaru("src/pages/Orders.tsx");
    expect(s).not.toMatch(/<img\s+src=\{photoUrl\}/);
    expect(s).toContain("<FotkaZakazky");
    expect(s).toContain("usePodepsaneFotky(supabase, photoLightbox?.urls");
  });

  it("do dokumentu se fotky vkládají, ne odkazují", () => {
    // Uložené PDF si obsah odkazu nedotáhne a JobiDocs nemá naši relaci.
    const s = zdrojBezKomentaru("src/pages/Orders.tsx");
    expect(s).toContain("fotkyDoDokumentu(supabase, data.photos)");
    const t = zdrojBezKomentaru("src/lib/tiskDokumentu.ts");
    expect(t).toContain("pripravFotky");
  });

  it("přepnutí bucketu není mezi migracemi – pouští se až úplně nakonec", () => {
    // Kdyby to byla migrace, `db push` by fotky zhasl dřív, než se nasadí
    // funkce, které je umí podepsat.
    const seznam = readdirSync(join(KOREN, "supabase/migrations"));
    for (const m of seznam) {
      const s = readFileSync(join(KOREN, "supabase/migrations", m), "utf8");
      expect(s).not.toMatch(/update\s+storage\.buckets[\s\S]*?public\s*=\s*false/i);
    }
    expect(zdroj("scripts/fotky-neverejny-bucket.sql")).toMatch(/set public = false/);
  });

  it("obrázky produktů zůstávají veřejné – ukazují se ve veřejném ceníku", () => {
    const s = zdroj("supabase/migrations/20260903210000_storage_product_images_bucket.sql");
    expect(s).toMatch(/'product-images',\s*\n\s*'product-images',\s*\n\s*true/);
    // Ve skriptu je jediný `update` a míří na diagnostic-photos.
    // V SQL jsou komentáře za `--`; rollback v komentáři se počítat nemá.
    const skript = zdroj("scripts/fotky-neverejny-bucket.sql").replace(/^\s*--.*$/gm, "");
    const zapisy = skript.match(/update\s+storage\.buckets[\s\S]*?;/gi) ?? [];
    expect(zapisy).toHaveLength(1);
    expect(zapisy[0]).toContain("'diagnostic-photos'");
    expect(zapisy[0]).not.toContain("product-images");
  });
});
