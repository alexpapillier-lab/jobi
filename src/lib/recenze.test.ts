/**
 * Žádost o recenzi po vydání zakázky.
 *
 * Tahle automatizace píše zákazníkům sama, bez kliknutí technika – a za
 * každou SMS servis platí. Chyby tu znamenají SMS ve 23:40, deset SMS
 * stálému firemnímu zákazníkovi za měsíc, prosbu o hodnocení po stornu,
 * nebo zprávu člověku, který si výslovně řekl, že je nechce.
 *
 * Testuje se sdílené rozhodování ze `supabase/functions/_shared/recenze.ts`
 * (stejný kód běží v edge funkci), koncept pravidla pro kartu v Nastavení
 * a pojistky ve zdrojácích migrace a edge funkce. Nic se neodesílá.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  RECENZE_VYCHOZI,
  dalsiCasOdeslani,
  jeVydanyStav,
  nahledRecenze,
  normalizujOdkazRecenze,
  planovanyCasZadosti,
  posudKandidata,
  pravidloZRecenze,
  recenzeZPravidla,
  sablonaSOdkazem,
  stavSpoustiRecenzi,
  validujRecenzi,
  vychoziRecenzeDraft,
  vychoziVydaneStavy,
  zvolKanal,
  zpozdeniHodin,
  type FaktaKandidata,
} from "./recenze";
import { describeRule, isReviewRule, type ReviewRule } from "./automations";
import { jeStornoStav } from "./stornoStav";

const KOREN = join(__dirname, "..", "..");

const STAVY = [
  { key: "received", label: "Přijato", isFinal: false },
  { key: "in_progress", label: "V opravě", isFinal: false },
  { key: "ready", label: "Připraveno k vyzvednutí", isFinal: false },
  { key: "completed", label: "Vydáno", isFinal: true },
  { key: "cancelled", label: "Zrušeno", isFinal: true },
  { key: "stav_7", label: "Vráceno bez opravy", isFinal: true },
  { key: "stav_8", label: "Nevyzvednuto", isFinal: true },
  { key: "stav_9", label: "Neopraveno / Neopravitelné", isFinal: true },
];

// ---------------------------------------------------------------------------

describe("recenze: který stav je vydání", () => {
  it("koncový stav Vydáno ano, rozpracovaný ne", () => {
    expect(jeVydanyStav("completed", "Vydáno", true)).toBe(true);
    expect(jeVydanyStav("ready", "Připraveno k vyzvednutí", false)).toBe(false);
  });

  it("storno, vrácení bez opravy a nevyzvednuté zařízení žádost nedostanou", () => {
    expect(jeVydanyStav("cancelled", "Zrušeno", true)).toBe(false);
    expect(jeVydanyStav("stav_7", "Vráceno bez opravy", true)).toBe(false);
    expect(jeVydanyStav("stav_8", "Nevyzvednuto", true)).toBe(false);
    expect(jeVydanyStav("stav_9", "Neopraveno / Neopravitelné", true)).toBe(false);
    expect(jeVydanyStav("returned", "Konec", true)).toBe(false);
  });

  it("co je storno podle aplikace, není nikdy vydání", () => {
    for (const s of STAVY) {
      if (jeStornoStav(s.key, s.label)) expect(jeVydanyStav(s.key, s.label, true), s.label).toBe(false);
    }
  });

  it("výchozí výběr stavů v kartě je jen Vydáno", () => {
    expect(vychoziVydaneStavy(STAVY)).toEqual(["completed"]);
  });

  it("vlastní výběr stavů v pravidle má přednost před odhadem", () => {
    expect(stavSpoustiRecenzi("ready", STAVY, ["ready"])).toBe(true);
    expect(stavSpoustiRecenzi("completed", STAVY, ["ready"])).toBe(false);
    expect(stavSpoustiRecenzi("completed", STAVY, [])).toBe(true);
    expect(stavSpoustiRecenzi("completed", STAVY, null)).toBe(true);
    expect(stavSpoustiRecenzi("neznamy", STAVY)).toBe(false);
  });

  it("stavy z databáze (is_final) se posuzují stejně jako z aplikace (isFinal)", () => {
    const db = [{ key: "completed", label: "Vydáno", is_final: true }];
    expect(stavSpoustiRecenzi("completed", db)).toBe(true);
  });
});

describe("recenze: odkaz", () => {
  it("Google, Firmy.cz i Heureka projdou", () => {
    expect(normalizujOdkazRecenze("https://g.page/r/CaBcDeF/review")).toBe("https://g.page/r/CaBcDeF/review");
    expect(normalizujOdkazRecenze("https://search.google.com/local/writereview?placeid=ChIJ123")).toContain("placeid=ChIJ123");
    expect(normalizujOdkazRecenze("https://www.firmy.cz/detail/123-servis.html#hodnoceni")).toContain("firmy.cz");
  });

  it("bez https:// se doplní", () => {
    expect(normalizujOdkazRecenze("g.page/r/abc/review")).toBe("https://g.page/r/abc/review");
  });

  it("nesmysl, mezera uvnitř a jiné schéma se odmítnou", () => {
    expect(normalizujOdkazRecenze("")).toBeNull();
    expect(normalizujOdkazRecenze("   ")).toBeNull();
    expect(normalizujOdkazRecenze("javascript:alert(1)")).toBeNull();
    expect(normalizujOdkazRecenze("data:text/html,x")).toBeNull();
    expect(normalizujOdkazRecenze("https://g.page/r/a b")).toBeNull();
    expect(normalizujOdkazRecenze("recenze")).toBeNull();
  });

  it("šablona bez odkazu ho dostane na konec – SMS bez odkazu je zbytečná", () => {
    expect(sablonaSOdkazem("Děkujeme!")).toBe("Děkujeme! {{review_url}}");
    expect(sablonaSOdkazem("Hodnocení: {{ review_url }}")).toBe("Hodnocení: {{ review_url }}");
    expect(sablonaSOdkazem("")).toBe("{{review_url}}");
  });
});

describe("recenze: denní okno a časová zóna", () => {
  const okno = { od: 9, do: 19 };
  const praha = "Europe/Prague";

  it("uvnitř okna se nic neposouvá", () => {
    const t = new Date("2026-09-27T08:00:00Z"); // 10:00 letního času
    expect(dalsiCasOdeslani(t, okno, praha).toISOString()).toBe(t.toISOString());
  });

  it("brzy ráno se čeká na devátou téhož dne", () => {
    const t = new Date("2026-09-27T04:30:00Z"); // 6:30
    expect(dalsiCasOdeslani(t, okno, praha).toISOString()).toBe("2026-09-27T07:00:00.000Z");
  });

  it("večer se čeká na devátou dalšího dne", () => {
    const t = new Date("2026-09-27T18:30:00Z"); // 20:30
    expect(dalsiCasOdeslani(t, okno, praha).toISOString()).toBe("2026-09-28T07:00:00.000Z");
  });

  it("přesně v 19:00 už je po okně, v 18:59 ještě ne", () => {
    expect(dalsiCasOdeslani(new Date("2026-09-27T17:00:00Z"), okno, praha).toISOString()).toBe("2026-09-28T07:00:00.000Z");
    const t = new Date("2026-09-27T16:59:00Z");
    expect(dalsiCasOdeslani(t, okno, praha).toISOString()).toBe(t.toISOString());
  });

  it("přes konec letního času se devátá počítá v zimním čase", () => {
    // 24. 10. 2026 22:00 CEST → 25. 10. je přechod, 9:00 CET = 8:00 UTC.
    expect(dalsiCasOdeslani(new Date("2026-10-24T20:00:00Z"), okno, praha).toISOString()).toBe("2026-10-25T08:00:00.000Z");
  });

  it("v zimě je devátá v 8:00 UTC, přes konec měsíce i roku", () => {
    expect(dalsiCasOdeslani(new Date("2026-11-30T19:00:00Z"), okno, praha).toISOString()).toBe("2026-12-01T08:00:00.000Z");
    expect(dalsiCasOdeslani(new Date("2026-12-31T20:00:00Z"), okno, praha).toISOString()).toBe("2027-01-01T08:00:00.000Z");
  });

  it("jiná časová zóna servisu se respektuje", () => {
    // 13:00 UTC = 9:00 v New Yorku (EDT)
    const t = new Date("2026-09-27T12:00:00Z"); // 8:00 v New Yorku
    expect(dalsiCasOdeslani(t, okno, "America/New_York").toISOString()).toBe("2026-09-27T13:00:00.000Z");
  });

  it("neplatná zóna spadne na Prahu, neplatné okno na 9–19", () => {
    const t = new Date("2026-09-27T18:30:00Z");
    expect(dalsiCasOdeslani(t, okno, "Mars/Olympus").toISOString()).toBe("2026-09-28T07:00:00.000Z");
    expect(dalsiCasOdeslani(t, { od: 20, do: 8 }, praha).toISOString()).toBe("2026-09-28T07:00:00.000Z");
  });

  it("vydáno v 18:50, den zpoždění → zítra v 18:50 (ještě v okně)", () => {
    const vydano = new Date("2026-09-27T16:50:00Z");
    expect(planovanyCasZadosti(vydano, 24, okno, praha).toISOString()).toBe("2026-09-28T16:50:00.000Z");
  });

  it("vydáno v 19:30, den zpoždění → pozítří v 9:00, ne v noci", () => {
    const vydano = new Date("2026-09-27T17:30:00Z");
    expect(planovanyCasZadosti(vydano, 24, okno, praha).toISOString()).toBe("2026-09-29T07:00:00.000Z");
  });
});

describe("recenze: kdo je kandidát a čím se mu napíše", () => {
  const ted = new Date("2026-09-27T10:00:00Z");
  const zaklad = (zmeny: Partial<FaktaKandidata> = {}): FaktaKandidata => ({
    ted,
    smazana: false,
    vydanyStav: true,
    odkaz: "https://g.page/r/abc/review",
    telefon: "+420777123456",
    email: "jan@example.cz",
    zakaznikNechce: false,
    odeslanoNaZakazku: false,
    posledniZadost: null,
    limitDni: 90,
    smsDostupna: true,
    ...zmeny,
  });

  it("vydaná zakázka s telefonem dostane SMS", () => {
    expect(posudKandidata(zaklad())).toEqual({ ok: true, kanal: "sms" });
  });

  it("bez telefonu, s e-mailem → e-mail", () => {
    expect(posudKandidata(zaklad({ telefon: null }))).toEqual({ ok: true, kanal: "email" });
  });

  it("servis bez SMS (modul, číslo) a zákazník s e-mailem → e-mail", () => {
    expect(posudKandidata(zaklad({ smsDostupna: false }))).toEqual({ ok: true, kanal: "email" });
  });

  it("bez telefonu i e-mailu se nepošle nic", () => {
    const p = posudKandidata(zaklad({ telefon: "", email: "neni-email" }));
    expect(p.ok).toBe(false);
    if (!p.ok) expect(p.duvod).toMatch(/telefon ani e-mail/);
  });

  it("zákazník s příznakem „Neposílat žádosti o recenzi“ se přeskočí", () => {
    const p = posudKandidata(zaklad({ zakaznikNechce: true }));
    expect(p.ok).toBe(false);
    if (!p.ok) expect(p.duvod).toMatch(/Neposílat/);
  });

  it("zakázka mimo vydaný stav (storno, reklamace) se přeskočí", () => {
    expect(posudKandidata(zaklad({ vydanyStav: false })).ok).toBe(false);
    expect(posudKandidata(zaklad({ smazana: true })).ok).toBe(false);
  });

  it("bez platného odkazu se nepošle nic", () => {
    expect(posudKandidata(zaklad({ odkaz: "" })).ok).toBe(false);
    expect(posudKandidata(zaklad({ odkaz: "javascript:x" })).ok).toBe(false);
  });

  it("druhá žádost ke stejné zakázce neodejde", () => {
    expect(posudKandidata(zaklad({ odeslanoNaZakazku: true })).ok).toBe(false);
  });

  it("žádost před 30 dny s limitem 90 → nic; před 91 dny → pošle se", () => {
    const pred30 = new Date(ted.getTime() - 30 * 86_400_000);
    const p = posudKandidata(zaklad({ posledniZadost: pred30 }));
    expect(p.ok).toBe(false);
    if (!p.ok) expect(p.duvod).toMatch(/před 30 dny \(limit 90 dní\)/);
    const pred91 = new Date(ted.getTime() - 91 * 86_400_000);
    expect(posudKandidata(zaklad({ posledniZadost: pred91 })).ok).toBe(true);
  });

  it("limit 0 = bez limitu, nesmysl = výchozích 90", () => {
    const vcera = new Date(ted.getTime() - 86_400_000);
    expect(posudKandidata(zaklad({ posledniZadost: vcera, limitDni: 0 })).ok).toBe(true);
    expect(posudKandidata(zaklad({ posledniZadost: vcera, limitDni: Number.NaN })).ok).toBe(false);
  });

  it("stálý B2B zákazník s deseti zakázkami za měsíc dostane jednu SMS, ne deset", () => {
    const odeslane: Date[] = [];
    for (let i = 0; i < 10; i++) {
      const kdy = new Date(ted.getTime() + i * 3 * 86_400_000);
      const posledni = odeslane.length ? odeslane[odeslane.length - 1] : null;
      const p = posudKandidata(zaklad({ ted: kdy, posledniZadost: posledni }));
      if (p.ok) odeslane.push(kdy);
    }
    expect(odeslane).toHaveLength(1);
  });

  it("volba kanálu: telefon má přednost, krátké číslo se nepočítá", () => {
    expect(zvolKanal("777 123 456", "a@b.cz")).toBe("sms");
    expect(zvolKanal("123", "a@b.cz")).toBe("email");
    expect(zvolKanal(null, null)).toBeNull();
  });
});

describe("recenze: karta v Nastavení", () => {
  it("výchozí koncept: 1 den, 9–19, 90 dní, vypnuto, jen Vydáno", () => {
    const d = vychoziRecenzeDraft(STAVY);
    expect(d.delayValue).toBe("1");
    expect(d.delayUnit).toBe("days");
    expect([d.fromHour, d.toHour]).toEqual([9, 19]);
    expect(d.limitDays).toBe("90");
    expect(d.active).toBe(false);
    expect(d.statusKeys).toEqual(["completed"]);
    expect(d.smsTemplate).toContain("{{review_url}}");
  });

  it("bez odkazu se pravidlo neuloží", () => {
    const d = vychoziRecenzeDraft(STAVY);
    expect(validujRecenzi(d).join(" ")).toMatch(/odkaz/);
    expect(pravidloZRecenze(d)).toBeNull();
  });

  it("špatné okno, limit, zpoždění a prázdný výběr stavů se ohlásí", () => {
    const d = { ...vychoziRecenzeDraft(STAVY), reviewUrl: "g.page/r/x/review", fromHour: 19, toHour: 9, limitDays: "-1", delayValue: "abc", statusKeys: [] };
    const chyby = validujRecenzi(d).join(" ");
    expect(chyby).toMatch(/okno/);
    expect(chyby).toMatch(/Limit/);
    expect(chyby).toMatch(/Zpoždění/);
    expect(chyby).toMatch(/stav/);
  });

  it("zpoždění: dny na hodiny, nula povolená, víc než 60 dní ne", () => {
    expect(zpozdeniHodin("1", "days")).toBe(24);
    expect(zpozdeniHodin("0", "hours")).toBe(0);
    expect(zpozdeniHodin("1,5", "days")).toBe(36);
    expect(zpozdeniHodin("61", "days")).toBeNull();
    expect(zpozdeniHodin("", "days")).toBeNull();
  });

  it("koncept → pravidlo → koncept se nezmění", () => {
    const d = { ...vychoziRecenzeDraft(STAVY), reviewUrl: "https://g.page/r/abc/review", active: true, delayValue: "6", delayUnit: "hours" as const, fromHour: 10, toHour: 18, limitDays: "60" };
    const p = pravidloZRecenze(d, "Europe/Prague")!;
    expect(p.trigger).toEqual({ type: "ticket_issued", after_hours: 6, status_keys: ["completed"] });
    expect(p.action.type).toBe("review_request");
    expect(p.conditions).toMatchObject({ send_from_hour: 10, send_to_hour: 18, customer_cooldown_days: 60, time_zone: "Europe/Prague", once_per_ticket: true, skip_final: false });
    const rule: ReviewRule = { id: "r1", service_id: "s1", sort_order: 0, ...p };
    const zpet = recenzeZPravidla(rule, STAVY);
    expect(zpet).toEqual({ ...d, id: "r1" });
    expect(isReviewRule(rule)).toBe(true);
    expect(describeRule(rule, (k) => k)).toMatch(/6 hodin po vydání/);
  });

  it("náhled dosadí skutečný odkaz a název servisu", () => {
    const text = nahledRecenze(RECENZE_VYCHOZI.sms, "g.page/r/abc/review", { name: "Servis Praha" });
    expect(text).toContain("https://g.page/r/abc/review");
    expect(text).toContain("Servis Praha");
    expect(text).not.toContain("{{");
  });
});

// ---------------------------------------------------------------------------
// Pojistky ve zdrojácích
// ---------------------------------------------------------------------------

describe("pojistky: migrace žádosti o recenzi", () => {
  const sql = readFileSync(join(KOREN, "supabase/migrations/20260927140000_zadost_o_recenzi.sql"), "utf8");
  const bezKomentaru = sql.replace(/--.*$/gm, "");

  it("plánuje se jen při změně stavu, ne při vložení – import historie nesmí rozeslat SMS", () => {
    expect(bezKomentaru).toMatch(/after update of status on public\.tickets/);
    expect(bezKomentaru).not.toMatch(/after insert[^;]*on public\.tickets/i);
    expect(bezKomentaru).toMatch(/new\.status is not distinct from old\.status/);
  });

  it("chyba v plánování neshodí uložení zakázky", () => {
    const telo = bezKomentaru.slice(bezKomentaru.indexOf("function public.automation_schedule_po_vydani"));
    expect(telo).toMatch(/exception when others then\s+raise warning/);
  });

  it("na zakázku a pravidlo čeká nejvýš jedna akce", () => {
    expect(bezKomentaru).toMatch(/unique index if not exists ux_automation_schedule_pending_rule_ticket[\s\S]{0,120}where status in \('pending', 'processing'\)/);
    expect(bezKomentaru).toMatch(/on conflict \(rule_id, ticket_id\) where status in \('pending', 'processing'\) do nothing/);
  });

  it("obě nové tabulky mají RLS a restriktivní politiku „jen viditelné zakázky“ (§5)", () => {
    for (const t of ["automation_schedule", "zadosti_o_recenzi"]) {
      expect(bezKomentaru).toMatch(new RegExp(`alter table public\\.${t} enable row level security`));
      expect(bezKomentaru).toMatch(new RegExp(`on public\\.${t}\\s+as restrictive for select to authenticated\\s+using \\(ticket_id is null or exists \\(select 1 from public\\.tickets t where t\\.id = ${t}\\.ticket_id\\)\\)`));
      expect(bezKomentaru, `${t}: klient nesmí zapisovat`).not.toMatch(new RegExp(`on public\\.${t}[\\s\\S]{0,80}for (insert|update|delete|all)`));
    }
  });

  it("je idempotentní", () => {
    expect(bezKomentaru).not.toMatch(/create table (?!if not exists)/);
    const politiky = [...bezKomentaru.matchAll(/create policy "(\w+)"/g)].map((m) => m[1]);
    expect(politiky.length).toBeGreaterThan(0);
    for (const nazev of politiky) expect(bezKomentaru, nazev).toContain(`drop policy if exists "${nazev}"`);
    expect(bezKomentaru).toMatch(/add column if not exists neposilat_zadost_o_recenzi boolean not null default false/);
    expect(bezKomentaru).toMatch(/drop trigger if exists trg_automation_schedule_po_vydani/);
  });

  it("povolené typy pravidel znají nový spouštěč i akci", () => {
    expect(bezKomentaru).toMatch(/'ticket_issued'/);
    expect(bezKomentaru).toMatch(/'review_request'/);
  });

  it("SQL pozná vydání stejně jako aplikace (storno + vrácení bez opravy)", () => {
    expect(bezKomentaru).toMatch(/public\.stav_je_storno\(p_status, v_label\)/);
    expect(bezKomentaru).toContain("(bez oprav|vrácen|vracen|nevyzved|neprevz|nepřevz)");
    expect(bezKomentaru).toContain("(return|unclaimed|no_repair|bez_oprav)");
    const sdilene = readFileSync(join(KOREN, "supabase/functions/_shared/recenze.ts"), "utf8");
    expect(sdilene).toContain("/(bez oprav|vrácen|vracen|nevyzved|neprevz|nepřevz)/iu");
    expect(sdilene).toContain("/(return|unclaimed|no_repair|bez_oprav)/iu");
  });
});

describe("pojistky: edge funkce automations-run", () => {
  const zdroj = readFileSync(join(KOREN, "supabase/functions/automations-run/index.ts"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  const usek = (odkud: string, kam: string) => zdroj.slice(zdroj.indexOf(odkud), zdroj.indexOf(kam));

  it("plánovaný běh zpracuje frontu", () => {
    expect(usek("async function handleScheduled", "async function handleImmediate")).toMatch(/runSchedule\(svc, ctxCache, now, counters\)/);
  });

  it("řádek fronty se zamyká podmíněně – dva tiky ho nepošlou dvakrát", () => {
    expect(usek("async function runSchedule", "// ----")).toMatch(
      /update\(\{ status: "processing"[\s\S]{0,120}\.eq\("id", row\.id\)\s*\.eq\("status", "pending"\)/,
    );
  });

  it("pravidlo fronty musí patřit servisu řádku a být zapnuté", () => {
    const telo = usek("async function processScheduleRow", "async function runSchedule");
    expect(telo).toMatch(/rule\.service_id !== row\.service_id/);
    expect(telo).toMatch(/!rule\.active/);
    expect(telo).toMatch(/ticket\.service_id !== row\.service_id/);
  });

  it("mimo denní okno se jen posune, nic se neodešle", () => {
    const telo = usek("async function processScheduleRow", "async function runSchedule");
    const okno = telo.indexOf("dalsiCasOdeslani(now");
    const vyhodnoceni = telo.indexOf("evaluateRule(");
    expect(okno).toBeGreaterThan(-1);
    expect(vyhodnoceni, "okno se kontroluje před vyhodnocením").toBeGreaterThan(okno);
  });

  it("žádost rozhoduje sdílené posudKandidata a zapíše se do zadosti_o_recenzi", () => {
    const telo = usek("async function actionReviewRequest", "// ----");
    expect(telo).toMatch(/posudKandidata\(/);
    expect(telo).toMatch(/neposilat_zadost_o_recenzi|findReviewCustomer/);
    expect(telo).toMatch(/\.from\("zadosti_o_recenzi"\)\.insert\(/);
    expect(zdroj).toMatch(/from "\.\.\/_shared\/recenze\.ts"/);
  });

  it("dotazy na zákazníka a předchozí žádosti jsou omezené na servis", () => {
    const zakaznik = usek("async function findReviewCustomer", "async function lastReviewRequestAt");
    expect(zakaznik.match(/\.eq\("service_id", ctx\.serviceId\)/g)?.length).toBe(2);
    const posledni = usek("async function lastReviewRequestAt", "async function actionReviewRequest");
    expect(posledni).toMatch(/\.eq\("service_id", serviceId\)/);
  });

  it("kontrakt edge funkce zná nový spouštěč a akci", () => {
    expect(zdroj).toMatch(/type: "ticket_issued"; after_hours: number; status_keys\?: string\[\]/);
    expect(zdroj).toMatch(/type: "review_request"; review_url: string; template: string; email_subject: string; email_body: string/);
  });
});
