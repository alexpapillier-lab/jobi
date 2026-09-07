/**
 * Syntetický hlídač produkce – co se z jeho hlášení stane za e-mail.
 *
 * JAK SE TO TESTUJE (stejný postup jako portalPayload.test.ts)
 * `npx vitest run` bere podle vite.config.ts jen `src/**`, a `index.ts` edge
 * funkce se naimportovat nedá – tahá `serve` z deno.land. Rozhodování o tom,
 * co je poplach a jaké dostane `kind`, proto sedí v
 * `supabase/functions/_shared/hlidac.ts` a testuje se tady. Co v `_shared`
 * být nemůže (samotné kontroly v Node skriptu), hlídají „pojistky ve
 * zdrojácích“ dole – čtou soubory jako text.
 *
 * Na `kind` záleží víc, než je vidět: podle něj `alerts-check` tlumí
 * opakování přes `alert_events`. Kdyby se `kind` měnil s tím, kolik kontrol
 * zrovna spadlo, tlumení by nedosáhlo a při výpadku by chodil e-mail
 * každých 15 minut, tedy 96 denně.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { KONTROLY, kontrola, podnetyZHlidace } from "../../supabase/functions/_shared/hlidac";
import {
  KONTROLY as KONTROLY_SKRIPTU,
  SERVIS_ID,
  ZAKAZANE_SERVISY,
} from "../../scripts/hlidac/kontroly.mjs";

const KOREN = join(__dirname, "..", "..");
const zdrojKontrol = readFileSync(join(KOREN, "scripts/hlidac/kontroly.mjs"), "utf8");
const zdrojBehu = readFileSync(join(KOREN, "scripts/hlidac/hlidac.mjs"), "utf8");
const zdrojWorkflow = readFileSync(join(KOREN, ".github/workflows/hlidac.yml"), "utf8");

describe("podnetyZHlidace", () => {
  it("bez selhání nic neposílá", () => {
    expect(podnetyZHlidace([])).toEqual([]);
    // Nesmysly z těla požadavku nesmí vyrobit prázdný e-mail.
    expect(podnetyZHlidace([{ id: "", zprava: "x" }])).toEqual([]);
  });

  it("jedno selhání = jeden podnět pojmenovaný podle kontroly", () => {
    const [p] = podnetyZHlidace([{ id: "portal_akce", zprava: "čekalo se 200, přišlo 500" }]);
    expect(p.druh).toBe("hlidac:portal_akce");
    expect(p.nadpis).toContain("Akce v zákaznickém portálu");
    // V podrobnostech musí být i to, co to znamená pro zákazníka – e-mail čte
    // majitel aplikace v deset večer, ne vývojář nad kódem.
    expect(p.podrobnosti[0]).toContain("Zákazník nemůže schválit nabídku");
    expect(p.podrobnosti[0]).toContain("přišlo 500");
  });

  it("víc selhání najednou = JEDEN podnět podle toho nejzávažnějšího", () => {
    const podnety = podnetyZHlidace([
      { id: "cenik", zprava: "503" },
      { id: "prihlaseni", zprava: "500" },
      { id: "rezervace", zprava: "503" },
    ]);
    expect(podnety).toHaveLength(1);
    expect(podnety[0].druh).toBe("hlidac:prihlaseni");
    // Ostatní se neztratí, jsou vypsané v těle.
    expect(podnety[0].podrobnosti.join("\n")).toContain("Veřejný ceník");
    expect(podnety[0].podrobnosti.join("\n")).toContain("Rezervační formulář");
  });

  it("kind se nemění, když k téže poruše přibude další spadlá kontrola", () => {
    // Tohle je celé jádro tlumení. Kdyby se druh skládal ze seznamu selhání,
    // stačilo by, aby při dalším běhu spadla o jednu kontrolu víc, a
    // `alert_events` by ten poplach považovalo za nový.
    const a = podnetyZHlidace([{ id: "prihlaseni", zprava: "x" }, { id: "cenik", zprava: "y" }]);
    const b = podnetyZHlidace([
      { id: "prihlaseni", zprava: "x" },
      { id: "cenik", zprava: "y" },
      { id: "rezervace", zprava: "z" },
    ]);
    expect(a[0].druh).toBe(b[0].druh);
  });

  it("neznámá kontrola nespadne a řadí se až za známé", () => {
    const [p] = podnetyZHlidace([{ id: "neco_noveho", zprava: "?" }, { id: "web", zprava: "404" }]);
    expect(p.druh).toBe("hlidac:web");
    expect(p.podrobnosti.join("\n")).toContain("neco_noveho");
  });

  it("počet pokusů a odkaz na běh jdou do e-mailu", () => {
    const [p] = podnetyZHlidace([{ id: "seznam", zprava: "500" }], {
      pokusy: 2,
      behUrl: "https://github.com/x/y/actions/runs/1",
    });
    expect(p.podrobnosti.join("\n")).toContain("2× po sobě");
    expect(p.podrobnosti.join("\n")).toContain("actions/runs/1");
  });

  it("dlouhá hláška se ořízne – do e-mailu nepatří kilobajt HTML z brány", () => {
    const [p] = podnetyZHlidace([{ id: "seznam", zprava: "x".repeat(5000) }]);
    expect(p.podrobnosti[0].length).toBeLessThan(500);
  });

  it("kontrola() zná všechna id a každé má dopad na zákazníka", () => {
    for (const k of KONTROLY) {
      expect(kontrola(k.id)).toBe(k);
      expect(k.dopad.length).toBeGreaterThan(10);
    }
    expect(kontrola("neexistuje")).toBeNull();
  });
});

describe("pojistky ve zdrojácích hlídače", () => {
  it("skript a edge funkce znají stejný seznam kontrol", () => {
    // Bez tohohle by nová kontrola ve skriptu poslala e-mail s druhem
    // `hlidac:<id>`, ke kterému nikdo nezná název ani dopad – a v e-mailu by
    // stálo jen holé id.
    const vSkriptu = KONTROLY_SKRIPTU.map((k) => k.id).sort();
    // `uklid` není samostatný krok skriptu, hlásí ho běh po sobě.
    const vFunkci = KONTROLY.map((k) => k.id).filter((id) => id !== "uklid").sort();
    expect(vSkriptu).toEqual(vFunkci);
  });

  it("závislost kontroly je vždycky dřív v pořadí", () => {
    // Kontroly se spouštějí odshora dolů a přeskočení se dědí. Závislost
    // uvedená až za kontrolou by se vyhodnocovala nad prázdným stavem.
    const poradi = new Map(KONTROLY_SKRIPTU.map((k, i) => [k.id, i]));
    KONTROLY_SKRIPTU.forEach((k, i) => {
      if (!k.zavisiNa) return;
      expect(poradi.has(k.zavisiNa), `${k.id} závisí na neznámé kontrole`).toBe(true);
      expect(poradi.get(k.zavisiNa)!, `${k.id} závisí na kontrole, která běží až po něm`).toBeLessThan(i);
    });
  });

  it("přeskočení se dědí na další kontroly", () => {
    /*
     * Když spadne přihlášení, přeskočí se „založení zakázky“ – a s ním musí
     * spadnout pod stůl i „otevření portálu“, které na založení navazuje.
     * Dokud se přeskočení nedědilo, portál se rozběhl nad zakázkou, která
     * nevznikla, spadl na „Cannot read properties of null“ a v e-mailu stálo,
     * že je rozbitý portál. Rozbitý byl hlídač.
     */
    expect(zdrojBehu).toMatch(/nedostupne\.has\(kontrola\.zavisiNa\)[\s\S]{0,200}nedostupne\.add\(kontrola\.id\)/);
  });

  it("hlídač pracuje jen v E2E servisu", () => {
    expect(SERVIS_ID).toBe("882beee7-4564-4d10-8ac6-16dc19240b57");
    expect(ZAKAZANE_SERVISY).not.toContain(SERVIS_ID);
  });

  it("id ostrých servisů jsou ve zdrojácích jen v zakázaném seznamu", () => {
    // Kdyby se ostré id objevilo kdekoli jinde, hlídač by na něj sáhl.
    for (const zakazany of ZAKAZANE_SERVISY) {
      const vyskyty = zdrojKontrol.split(zakazany).length - 1;
      expect(vyskyty, `${zakazany} je v kontroly.mjs vícekrát než v seznamu`).toBe(1);
      expect(zdrojBehu).not.toContain(zakazany);
      expect(zdrojWorkflow).not.toContain(zakazany);
    }
  });

  it("zakázka hlídače nemá kontakt na zákazníka", () => {
    // Jediná tvrdá pojistka proti tomu, aby z automatizace odešla SMS nebo
    // e-mail zákazníkovi. Bez telefonu i adresy nemá akce kam odejít.
    expect(zdrojKontrol).toContain("customer_phone: null");
    expect(zdrojKontrol).toContain("customer_email: null");
  });

  it("rezervace se jen čte, nezakládá", () => {
    // POST na public-booking má strop 10 za hodinu z adresy a v Kalendáři by
    // každých 15 minut přibyl řádek.
    const rezervace = /id: "rezervace"[\s\S]*?\n {2}\},/.exec(zdrojKontrol)?.[0] ?? "";
    expect(rezervace).toContain("public-booking");
    expect(rezervace).not.toContain('method: "POST"');
  });

  it("hlídač neposílá e-maily sám, jde přes alerts-check", () => {
    // Vlastní volání Resendu by znamenalo druhé místo s klíčem, druhou adresu
    // majitele a žádné tlumení přes alert_events.
    expect(zdrojBehu).not.toContain("api.resend.com");
    expect(zdrojKontrol).not.toContain("api.resend.com");
    expect(zdrojBehu).toContain("functions/v1/alerts-check");
  });

  it("workflow běží každých 15 minut a dá se spustit ručně", () => {
    expect(zdrojWorkflow).toContain("*/15 * * * *");
    expect(zdrojWorkflow).toContain("workflow_dispatch");
  });
});
