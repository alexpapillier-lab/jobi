/**
 * Automatizace: kdy se pravidlo spustí, co udělá a kde se to zapíše.
 *
 * Pravidla sahají zákazníkovi na zakázku i na telefon: umí přepnout stav,
 * připsat poplatek a poslat SMS nebo e-mail. Když se spustí nad cizí
 * zakázkou, nad smazanou zakázkou nebo dvakrát, pozná to zákazník dřív než
 * my. A když se dvě pravidla přepínají navzájem, protočí se do nekonečna –
 * s SMS u každého kola.
 *
 * PROČ TO ŽIJE V src/lib A NE U EDGE FUNKCE
 * Stejný důvod jako u billingWebhook.test.ts a apiVerejne.test.ts:
 * `npx vitest run` bere jen `src/**` a `automations-run/index.ts` se
 * naimportovat nedá (deno.land + esm.sh). Testuje se proto ve třech
 * vrstvách: skutečný sdílený kód ze `src/lib/automations.ts`, referenční
 * implementace rozhodování (`vyhodnotPravidlo`, `spustZmenuStavu`) nad
 * pamětovými daty, a pojistky čtoucí zdroják edge funkce a migraci.
 *
 * V testu se nikdy nic neodesílá: akce `sms` a `email` mají místo Twilia
 * a Resendu záznamník, který jen zapíše, že by se poslalo.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  substituteTemplate,
  describeRule,
  formatHours,
  type Action,
  type AutomationRule,
  type Conditions,
  type Trigger,
} from "./automations";

const KOREN = join(__dirname, "..", "..");

// ---------------------------------------------------------------------------
// Pamětová data
// ---------------------------------------------------------------------------

const NAS = "11111111-1111-4111-8111-111111111111";
const CIZI = "22222222-2222-4222-8222-222222222222";
const HODINA = 3_600_000;

type Zakazka = {
  id: string;
  service_id: string;
  code: string;
  status: string;
  deleted_at: string | null;
  customer_phone: string | null;
  customer_email: string | null;
  performed_repairs: Array<{ name: string; price: number }>;
  /** Od kdy je zakázka ve svém stavu – u status_age se z toho počítají hodiny. */
  status_od: number;
};

type Beh = {
  rule_id: string;
  service_id: string;
  ticket_id: string | null;
  result: "ok" | "skipped" | "error";
  detail: string | null;
  ran_at: number;
};

type Odeslane = { druh: "sms" | "email"; komu: string; text: string };

type Svet = {
  ted: number;
  statusy: Record<string, Record<string, { label: string; is_final: boolean }>>;
  zakazky: Zakazka[];
  pravidla: AutomationRule[];
  behy: Beh[];
  odeslane: Odeslane[];
  poznamky: Array<{ ticket_id: string; service_id: string; text: string }>;
  /** Má servis zaplacený modul SMS? */
  smsModul: Record<string, boolean>;
};

function pravidlo(
  id: string,
  service_id: string,
  trigger: Trigger,
  action: Action,
  conditions: Conditions = {},
  poradi = 0,
): AutomationRule {
  return { id, service_id, name: id, active: true, trigger, action, conditions, sort_order: poradi };
}

// ---------------------------------------------------------------------------
// Referenční implementace rozhodování z automations-run/index.ts
// ---------------------------------------------------------------------------

type Vysledek = ["ok" | "skipped" | "error", string | null];

/** Zrcadlo `logRun()`. Zapisuje vždy pod servisem PRAVIDLA, ne zakázky. */
function zapisBeh(s: Svet, r: AutomationRule, ticketId: string | null, v: Vysledek, prefix = ""): void {
  s.behy.push({
    rule_id: r.id,
    service_id: r.service_id,
    ticket_id: ticketId,
    result: v[0],
    detail: v[1] ? `${prefix}${v[1]}` : prefix || null,
    ran_at: s.ted,
  });
}

function maUspesnyBeh(s: Svet, ruleId: string, ticketId: string): boolean {
  return s.behy.some((b) => b.rule_id === ruleId && b.ticket_id === ticketId && b.result === "ok");
}

/** Zrcadlo `actionSetStatus()`. */
function akceStav(s: Svet, r: AutomationRule, z: Zakazka, klic: string): Vysledek {
  const statusy = s.statusy[z.service_id] ?? {};
  if (!statusy[klic]) return ["error", `Stav „${klic}“ v servisu neexistuje`];
  if (z.status === klic) return ["skipped", `Zakázka už je ve stavu „${statusy[klic].label}“`];
  const zPuvodni = statusy[z.status]?.label ?? z.status;
  z.status = klic;
  z.status_od = s.ted;
  void r;
  return ["ok", `Stav „${zPuvodni}“ → „${statusy[klic].label}“`];
}

/** Zrcadlo `actionAddFee()`. Poplatek vždy jen jednou na zakázku. */
function akcePoplatek(s: Svet, r: AutomationRule, z: Zakazka, nazev: string, castka: number, zaDen: boolean, dny: number): Vysledek {
  if (maUspesnyBeh(s, r.id, z.id)) return ["skipped", "Poplatek už byl připsán"];
  const nasobek = zaDen ? Math.max(0, dny) : 1;
  const cena = Math.round(castka * nasobek * 100) / 100;
  if (!Number.isFinite(cena) || cena <= 0) return ["skipped", `Poplatek vyšel na ${cena} Kč – nepřipisuje se`];
  z.performed_repairs = [...z.performed_repairs, { name: nazev, price: cena }];
  return ["ok", `Připsáno „${nazev}“ ${cena} Kč`];
}

/** Zrcadlo `actionSms()` – místo Twilia záznamník. */
function akceSms(s: Svet, z: Zakazka, sablona: string, vars: Record<string, string>): Vysledek {
  if (!z.customer_phone) return ["skipped", "Zákazník nemá telefon"];
  if (!s.smsModul[z.service_id]) return ["skipped", "Modul SMS není pro servis aktivní"];
  const text = substituteTemplate(sablona, vars).trim();
  if (!text) return ["skipped", "Prázdná zpráva po dosazení proměnných"];
  s.odeslane.push({ druh: "sms", komu: z.customer_phone, text });
  return ["ok", `SMS na ${z.customer_phone}`];
}

/** Zrcadlo `actionEmail()` – místo Resendu záznamník. */
function akceEmail(s: Svet, z: Zakazka, predmet: string, telo: string, vars: Record<string, string>): Vysledek {
  if (!z.customer_email || !z.customer_email.includes("@")) return ["skipped", "Zákazník nemá e-mail"];
  const text = substituteTemplate(telo, vars).trim();
  if (!text) return ["skipped", "Prázdný text e-mailu po dosazení proměnných"];
  s.odeslane.push({ druh: "email", komu: z.customer_email, text: `${substituteTemplate(predmet, vars)}|${text}` });
  return ["ok", `E-mail na ${z.customer_email}`];
}

function akcePoznamka(s: Svet, z: Zakazka, sablona: string, vars: Record<string, string>): Vysledek {
  const text = substituteTemplate(sablona, vars).trim();
  if (!text) return ["skipped", "Prázdná poznámka po dosazení proměnných"];
  s.poznamky.push({ ticket_id: z.id, service_id: z.service_id, text });
  return ["ok", `Poznámka: ${text}`];
}

type Navic = { dny?: number; eventId?: string; depth?: number };

/** Zrcadlo `evaluateRule()`. Nikdy nevyhazuje – chyba jednoho pravidla nesmí shodit ostatní. */
async function vyhodnotPravidlo(s: Svet, r: AutomationRule, z: Zakazka, navic: Navic = {}): Promise<void> {
  const dny = navic.dny ?? 0;
  const depth = navic.depth ?? 0;
  const prefix = navic.eventId ? `event:${navic.eventId} ` : "";
  const statusy = s.statusy[r.service_id] ?? {};

  try {
    const c = r.conditions ?? {};

    if (z.deleted_at) {
      zapisBeh(s, r, z.id, ["skipped", "Zakázka je smazaná"], prefix);
      return;
    }
    // skip_final se netýká stavu, na který pravidlo samo míří.
    const miriNaAktualni =
      (r.trigger.type === "status_change" || r.trigger.type === "status_age") && r.trigger.status_key === z.status;
    if (c.skip_final !== false && !miriNaAktualni && statusy[z.status]?.is_final) {
      zapisBeh(s, r, z.id, ["skipped", `Zakázka je v koncovém stavu „${statusy[z.status].label}“`], prefix);
      return;
    }
    const opakujici = r.trigger.type === "status_age" && !!r.trigger.repeat_hours;
    if (c.once_per_ticket !== false && !opakujici && maUspesnyBeh(s, r.id, z.id)) {
      zapisBeh(s, r, z.id, ["skipped", "Pravidlo už na této zakázce proběhlo"], prefix);
      return;
    }
    if (c.require_phone && !z.customer_phone) {
      zapisBeh(s, r, z.id, ["skipped", "Zákazník nemá telefon"], prefix);
      return;
    }
    if (c.require_email && !z.customer_email?.includes("@")) {
      zapisBeh(s, r, z.id, ["skipped", "Zákazník nemá e-mail"], prefix);
      return;
    }

    const vars: Record<string, string> = {
      code: z.code,
      status: statusy[z.status]?.label ?? z.status,
      days: String(dny),
    };

    const a = r.action;
    let v: Vysledek;
    switch (a.type) {
      case "sms": v = akceSms(s, z, a.template, vars); break;
      case "email": v = akceEmail(s, z, a.subject, a.body, vars); break;
      case "set_status": v = akceStav(s, r, z, a.status_key); break;
      case "add_fee": v = akcePoplatek(s, r, z, a.name, a.amount, a.per_day === true, dny); break;
      case "notify": v = akcePoznamka(s, z, a.message, vars); break;
      default: v = ["error", `Neznámá akce „${(a as { type?: string }).type}“`];
    }

    zapisBeh(s, r, z.id, v, prefix);

    // Přepnutí stavu spustí pravidla „při stavu“ pro nový stav – jen o jednu
    // úroveň, ať se dvě vzájemně přepínající pravidla netočí donekonečna.
    if (a.type === "set_status" && v[0] === "ok" && depth === 0) {
      await spustZmenuStavu(s, z, z.status, depth + 1);
    }
  } catch (e) {
    zapisBeh(s, r, z.id, ["error", e instanceof Error ? e.message : String(e)], prefix);
  }
}

/** Zrcadlo `runStatusChange()`. */
async function spustZmenuStavu(s: Svet, z: Zakazka, statusKey: string, depth: number): Promise<void> {
  const pravidla = s.pravidla
    .filter((r) => r.active && r.service_id === z.service_id)
    .filter((r) => r.trigger.type === "status_change" && r.trigger.status_key === statusKey)
    .sort((a, b) => a.sort_order - b.sort_order);
  for (const r of pravidla) await vyhodnotPravidlo(s, r, z, { depth });
}

/** Zrcadlo `handleImmediate()` – bez HTTP, jen rozhodování. */
async function spustOkamzite(
  s: Svet,
  vstup: { service_id: string; ticket_id: string; event: string; status_key?: string; clenstvi: string[] },
): Promise<{ stav: number; chyba?: string }> {
  if (!vstup.clenstvi.includes(vstup.service_id)) return { stav: 403, chyba: "Nejste členem tohoto servisu" };
  if (vstup.event !== "status_change" && vstup.event !== "ticket_created") {
    return { stav: 400, chyba: "event musí být status_change nebo ticket_created" };
  }
  const z = s.zakazky.find((x) => x.id === vstup.ticket_id);
  if (!z || z.service_id !== vstup.service_id) return { stav: 404, chyba: "Zakázka nenalezena" };

  if (vstup.event === "ticket_created") {
    for (const r of s.pravidla.filter((x) => x.active && x.service_id === z.service_id && x.trigger.type === "ticket_created")) {
      await vyhodnotPravidlo(s, r, z, { depth: 0 });
    }
    return { stav: 200 };
  }
  // Stav se bere ze zakázky, ne z těla požadavku – status_key se ignoruje.
  await spustZmenuStavu(s, z, z.status, 0);
  return { stav: 200 };
}

/** Zrcadlo `runStatusAgeRule()` – včetně tichého dedupe. */
const RETRY_SKIPPED_HOURS = 24;

async function spustStari(s: Svet, r: AutomationRule): Promise<void> {
  const t = r.trigger as Extract<Trigger, { type: "status_age" }>;
  if (!t.status_key || !(t.after_hours > 0)) return;
  const zakazky = s.zakazky.filter(
    (z) => z.service_id === r.service_id && z.status === t.status_key && !z.deleted_at,
  );
  for (const z of zakazky) {
    const hodinVeStavu = (s.ted - z.status_od) / HODINA;
    if (hodinVeStavu < t.after_hours) continue;
    const posledni = [...s.behy].reverse().find((b) => b.rule_id === r.id && b.ticket_id === z.id);
    if (posledni) {
      const odBehu = (s.ted - posledni.ran_at) / HODINA;
      if (posledni.result === "ok") {
        if (!t.repeat_hours || t.repeat_hours <= 0) continue;
        if (odBehu < t.repeat_hours) continue;
      } else {
        const znovuPo = t.repeat_hours && t.repeat_hours > 0
          ? Math.min(t.repeat_hours, RETRY_SKIPPED_HOURS)
          : RETRY_SKIPPED_HOURS;
        if (odBehu < znovuPo) continue;
      }
    }
    await vyhodnotPravidlo(s, r, z, { dny: Math.floor(hodinVeStavu / 24) });
  }
}

/** Zrcadlo `handleScheduled()` – pravidla se seskupí po servisech. */
async function spustPlanovane(s: Svet, tajemstvi: string, ocekavane: string): Promise<{ stav: number }> {
  if (!tajemstvi || tajemstvi !== ocekavane) return { stav: 403 };
  const podleServisu = new Map<string, AutomationRule[]>();
  for (const r of s.pravidla.filter((x) => x.active && x.trigger.type === "status_age")) {
    podleServisu.set(r.service_id, [...(podleServisu.get(r.service_id) ?? []), r]);
  }
  for (const [, pravidla] of podleServisu) {
    for (const r of pravidla) {
      try {
        await spustStari(s, r);
      } catch (e) {
        zapisBeh(s, r, null, ["error", e instanceof Error ? e.message : String(e)]);
      }
    }
  }
  return { stav: 200 };
}

// ---------------------------------------------------------------------------
// Příprava
// ---------------------------------------------------------------------------

let s: Svet;

function zakazka(id: string, service_id: string, zmeny: Partial<Zakazka> = {}): Zakazka {
  return {
    id,
    service_id,
    code: `KOD-${id}`,
    status: "received",
    deleted_at: null,
    customer_phone: "+420777123456",
    customer_email: "zakaznik@example.test",
    performed_repairs: [],
    status_od: s.ted,
    ...zmeny,
  };
}

beforeEach(() => {
  s = {
    ted: new Date("2026-09-06T12:00:00.000Z").getTime(),
    statusy: {},
    zakazky: [],
    pravidla: [],
    behy: [],
    odeslane: [],
    poznamky: [],
    smsModul: { [NAS]: true, [CIZI]: true },
  };
  for (const sid of [NAS, CIZI]) {
    s.statusy[sid] = {
      received: { label: "Přijato", is_final: false },
      repair: { label: "Oprava", is_final: false },
      ready: { label: "Připraveno", is_final: false },
      completed: { label: "Dokončeno", is_final: true },
    };
  }
  s.zakazky.push(zakazka("z1", NAS), zakazka("z2", CIZI));
});

// ---------------------------------------------------------------------------
// 1. Servis a oprávnění
// ---------------------------------------------------------------------------

describe("automatizace: pravidlo běží jen na svém servisu", () => {
  it("pravidlo cizího servisu se na naši zakázku nepustí, i když míří na stejný stav", async () => {
    s.pravidla.push(pravidlo("cizi", CIZI, { type: "status_change", status_key: "ready" }, { type: "notify", message: "Cizí" }));
    s.pravidla.push(pravidlo("nase", NAS, { type: "status_change", status_key: "ready" }, { type: "notify", message: "Naše" }));
    s.zakazky[0].status = "ready";
    await spustOkamzite(s, { service_id: NAS, ticket_id: "z1", event: "status_change", clenstvi: [NAS] });
    expect(s.poznamky.map((p) => p.text)).toEqual(["Naše"]);
    expect(s.behy.map((b) => b.rule_id)).toEqual(["nase"]);
  });

  it("kdo není členem servisu, pravidla nespustí", async () => {
    s.pravidla.push(pravidlo("nase", NAS, { type: "status_change", status_key: "received" }, { type: "notify", message: "X" }));
    const r = await spustOkamzite(s, { service_id: NAS, ticket_id: "z1", event: "status_change", clenstvi: [CIZI] });
    expect(r.stav).toBe(403);
    expect(s.behy).toHaveLength(0);
  });

  it("zakázka z jiného servisu skončí jako nenalezená, ne jako cizí", async () => {
    // Rozdílná hláška by prozradila, že zakázka s tímhle id někde existuje.
    const r = await spustOkamzite(s, { service_id: NAS, ticket_id: "z2", event: "status_change", clenstvi: [NAS, CIZI] });
    expect(r.stav).toBe(404);
    expect(s.behy).toHaveLength(0);
  });

  it("běh se zapíše pod servis pravidla", async () => {
    s.pravidla.push(pravidlo("nase", NAS, { type: "status_change", status_key: "received" }, { type: "notify", message: "X" }));
    await spustOkamzite(s, { service_id: NAS, ticket_id: "z1", event: "status_change", clenstvi: [NAS] });
    expect(s.behy).toHaveLength(1);
    expect(s.behy[0]).toMatchObject({ service_id: NAS, ticket_id: "z1", result: "ok" });
  });

  it("stav se bere ze zakázky, ne z těla požadavku", async () => {
    // Dřív si volající mohl zvolit libovolný stav a spustit tím pravidla pro
    // stav, ve kterém zakázka vůbec není – tedy poslat „zařízení je hotové“.
    s.pravidla.push(pravidlo("hotovo", NAS, { type: "status_change", status_key: "ready" }, { type: "sms", template: "Hotovo" }));
    await spustOkamzite(s, { service_id: NAS, ticket_id: "z1", event: "status_change", status_key: "ready", clenstvi: [NAS] });
    expect(s.odeslane).toHaveLength(0);
    expect(s.behy).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 2. Chyba jednoho pravidla
// ---------------------------------------------------------------------------

describe("automatizace: chyba jednoho pravidla nezastaví ostatní", () => {
  it("pravidlo mířící na neexistující stav skončí chybou, další pravidla proběhnou", async () => {
    s.pravidla.push(
      pravidlo("chybne", NAS, { type: "status_change", status_key: "received" }, { type: "set_status", status_key: "NENI" }, {}, 1),
      pravidlo("poznamka", NAS, { type: "status_change", status_key: "received" }, { type: "notify", message: "Přesto" }, {}, 2),
    );
    await spustOkamzite(s, { service_id: NAS, ticket_id: "z1", event: "status_change", clenstvi: [NAS] });
    expect(s.behy.map((b) => [b.rule_id, b.result])).toEqual([["chybne", "error"], ["poznamka", "ok"]]);
    expect(s.poznamky).toHaveLength(1);
  });

  it("výjimka uvnitř akce se zapíše jako error, ne jako pád celého běhu", async () => {
    const vybuchni = pravidlo("vybuch", NAS, { type: "status_change", status_key: "received" }, { type: "notify", message: "X" }, {}, 1);
    // Podstrčená akce, která vyhodí – jako když spadne spojení do databáze.
    Object.defineProperty(vybuchni, "action", {
      get() { throw new Error("spadlo spojení"); },
    });
    s.pravidla.push(vybuchni, pravidlo("dalsi", NAS, { type: "status_change", status_key: "received" }, { type: "notify", message: "Další" }, {}, 2));
    await spustOkamzite(s, { service_id: NAS, ticket_id: "z1", event: "status_change", clenstvi: [NAS] });
    expect(s.behy.find((b) => b.rule_id === "vybuch")).toMatchObject({ result: "error", detail: "spadlo spojení" });
    expect(s.poznamky.map((p) => p.text)).toEqual(["Další"]);
  });

  it("v plánovaném běhu chyba u jednoho servisu nezastaví druhý", async () => {
    const rozbite = pravidlo("rozbite", NAS, { type: "status_age", status_key: "received", after_hours: 1 }, { type: "notify", message: "A" });
    // Spouštěč vypadá zvenčí normálně, ale při čtení podrobností vybuchne –
    // jako když se v tiku rozpadne dotaz do databáze.
    Object.defineProperty(rozbite.trigger, "after_hours", { get() { throw new Error("rozbitý spouštěč"); } });
    s.pravidla.push(
      rozbite,
      pravidlo("cizi", CIZI, { type: "status_age", status_key: "received", after_hours: 1 }, { type: "notify", message: "B" }),
    );
    s.zakazky[1].status_od = s.ted - 5 * HODINA;
    await spustPlanovane(s, "tajne", "tajne");
    expect(s.poznamky.map((p) => p.text)).toEqual(["B"]);
    expect(s.behy.some((b) => b.rule_id === "rozbite" && b.result === "error")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3. Smyčka
// ---------------------------------------------------------------------------

describe("automatizace: smyčka se zastaví", () => {
  it("dvě pravidla, která se přepínají navzájem, udělají jedno kolo a dost", async () => {
    s.pravidla.push(
      pravidlo("A", NAS, { type: "status_change", status_key: "received" }, { type: "set_status", status_key: "repair" }, { once_per_ticket: false }),
      pravidlo("B", NAS, { type: "status_change", status_key: "repair" }, { type: "set_status", status_key: "received" }, { once_per_ticket: false }),
    );
    await spustOkamzite(s, { service_id: NAS, ticket_id: "z1", event: "status_change", clenstvi: [NAS] });
    expect(s.behy.map((b) => b.rule_id)).toEqual(["A", "B"]);
    expect(s.zakazky[0].status).toBe("received");
  });

  it("pravidlo, které přepíná do stavu, ve kterém zakázka je, se přeskočí", async () => {
    s.pravidla.push(
      pravidlo("samo", NAS, { type: "status_change", status_key: "received" }, { type: "set_status", status_key: "received" }, { once_per_ticket: false }),
    );
    await spustOkamzite(s, { service_id: NAS, ticket_id: "z1", event: "status_change", clenstvi: [NAS] });
    expect(s.behy).toHaveLength(1);
    expect(s.behy[0].result).toBe("skipped");
  });

  it("řetěz tří pravidel se utne po prvním přepnutí, ne až u třetího", async () => {
    s.pravidla.push(
      pravidlo("A", NAS, { type: "status_change", status_key: "received" }, { type: "set_status", status_key: "repair" }, { once_per_ticket: false }),
      pravidlo("B", NAS, { type: "status_change", status_key: "repair" }, { type: "set_status", status_key: "ready" }, { once_per_ticket: false }),
      pravidlo("C", NAS, { type: "status_change", status_key: "ready" }, { type: "sms", template: "Vyzvedněte si" }, { once_per_ticket: false }),
    );
    await spustOkamzite(s, { service_id: NAS, ticket_id: "z1", event: "status_change", clenstvi: [NAS] });
    expect(s.behy.map((b) => b.rule_id)).toEqual(["A", "B"]);
    // Zakázka je ve stavu „ready“, ale SMS z pravidla C se neposlala –
    // to je záměr: hloubka 1 je strop. Zbytek dojede až při dalším podnětu.
    expect(s.zakazky[0].status).toBe("ready");
    expect(s.odeslane).toHaveLength(0);
  });

  it("výchozí once_per_ticket smyčku zastaví i bez hloubky", async () => {
    s.pravidla.push(
      pravidlo("A", NAS, { type: "status_change", status_key: "received" }, { type: "set_status", status_key: "repair" }),
      pravidlo("B", NAS, { type: "status_change", status_key: "repair" }, { type: "set_status", status_key: "received" }),
    );
    await spustOkamzite(s, { service_id: NAS, ticket_id: "z1", event: "status_change", clenstvi: [NAS] });
    await spustOkamzite(s, { service_id: NAS, ticket_id: "z1", event: "status_change", clenstvi: [NAS] });
    const uspesne = s.behy.filter((b) => b.result === "ok");
    expect(uspesne).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// 4. Podmínky
// ---------------------------------------------------------------------------

describe("automatizace: podmínky", () => {
  it("smazaná zakázka se přeskočí, ať je pravidlo jakékoli", async () => {
    s.zakazky[0].deleted_at = new Date().toISOString();
    s.pravidla.push(pravidlo("r", NAS, { type: "status_change", status_key: "received" }, { type: "sms", template: "Ahoj" }, { skip_final: false }));
    await spustOkamzite(s, { service_id: NAS, ticket_id: "z1", event: "status_change", clenstvi: [NAS] });
    expect(s.odeslane).toHaveLength(0);
    expect(s.behy[0]).toMatchObject({ result: "skipped", detail: "Zakázka je smazaná" });
  });

  it("koncový stav se přeskočí, ale ne u pravidla, které na něj samo míří", async () => {
    s.zakazky[0].status = "completed";
    s.pravidla.push(
      pravidlo("jine", NAS, { type: "status_change", status_key: "ready" }, { type: "notify", message: "Jiné" }, {}, 1),
      pravidlo("cilene", NAS, { type: "status_change", status_key: "completed" }, { type: "notify", message: "Cílené" }, {}, 2),
    );
    await spustOkamzite(s, { service_id: NAS, ticket_id: "z1", event: "status_change", clenstvi: [NAS] });
    // Pro stav completed se vybere jen „cilene“ a to se nesmí přeskočit.
    expect(s.poznamky.map((p) => p.text)).toEqual(["Cílené"]);
  });

  it("once_per_ticket pustí pravidlo na zakázku jednou, podruhé ho zapíše jako přeskočené", async () => {
    s.pravidla.push(pravidlo("r", NAS, { type: "status_change", status_key: "received" }, { type: "notify", message: "Jednou" }));
    await spustOkamzite(s, { service_id: NAS, ticket_id: "z1", event: "status_change", clenstvi: [NAS] });
    await spustOkamzite(s, { service_id: NAS, ticket_id: "z1", event: "status_change", clenstvi: [NAS] });
    expect(s.poznamky).toHaveLength(1);
    expect(s.behy.map((b) => b.result)).toEqual(["ok", "skipped"]);
  });

  it("once_per_ticket se počítá na zakázku, ne na servis", async () => {
    s.zakazky.push(zakazka("z3", NAS));
    s.pravidla.push(pravidlo("r", NAS, { type: "status_change", status_key: "received" }, { type: "notify", message: "Pro každou" }));
    await spustOkamzite(s, { service_id: NAS, ticket_id: "z1", event: "status_change", clenstvi: [NAS] });
    await spustOkamzite(s, { service_id: NAS, ticket_id: "z3", event: "status_change", clenstvi: [NAS] });
    expect(s.poznamky).toHaveLength(2);
  });

  it("bez telefonu se SMS pravidlo přeskočí, neposílá se nikam jinam", async () => {
    s.zakazky[0].customer_phone = null;
    s.pravidla.push(pravidlo("r", NAS, { type: "status_change", status_key: "received" }, { type: "sms", template: "Ahoj" }, { require_phone: true }));
    await spustOkamzite(s, { service_id: NAS, ticket_id: "z1", event: "status_change", clenstvi: [NAS] });
    expect(s.odeslane).toHaveLength(0);
    expect(s.behy[0].result).toBe("skipped");
  });

  it("bez zaplaceného modulu SMS se nic neodešle", async () => {
    s.smsModul[NAS] = false;
    s.pravidla.push(pravidlo("r", NAS, { type: "status_change", status_key: "received" }, { type: "sms", template: "Ahoj" }));
    await spustOkamzite(s, { service_id: NAS, ticket_id: "z1", event: "status_change", clenstvi: [NAS] });
    expect(s.odeslane).toHaveLength(0);
    expect(s.behy[0]).toMatchObject({ result: "skipped", detail: "Modul SMS není pro servis aktivní" });
  });

  it("prázdná zpráva po dosazení proměnných se neodešle", async () => {
    s.pravidla.push(pravidlo("r", NAS, { type: "status_change", status_key: "received" }, { type: "sms", template: "{{neznama}}" }));
    await spustOkamzite(s, { service_id: NAS, ticket_id: "z1", event: "status_change", clenstvi: [NAS] });
    expect(s.odeslane).toHaveLength(0);
    expect(s.behy[0].result).toBe("skipped");
  });

  it("poplatek se připíše jen jednou, i když se once_per_ticket vypne", async () => {
    s.pravidla.push(
      pravidlo("fee", NAS, { type: "status_change", status_key: "received" }, { type: "add_fee", name: "Skladné", amount: 50 }, { once_per_ticket: false }),
    );
    await spustOkamzite(s, { service_id: NAS, ticket_id: "z1", event: "status_change", clenstvi: [NAS] });
    await spustOkamzite(s, { service_id: NAS, ticket_id: "z1", event: "status_change", clenstvi: [NAS] });
    expect(s.zakazky[0].performed_repairs).toHaveLength(1);
    expect(s.zakazky[0].performed_repairs[0].price).toBe(50);
  });
});

// ---------------------------------------------------------------------------
// 5. Plánovaný běh
// ---------------------------------------------------------------------------

describe("automatizace: plánovaný běh", () => {
  it("bez správného tajemství se nespustí nic", async () => {
    s.pravidla.push(pravidlo("r", NAS, { type: "status_age", status_key: "received", after_hours: 1 }, { type: "notify", message: "X" }));
    s.zakazky[0].status_od = s.ted - 5 * HODINA;
    expect((await spustPlanovane(s, "", "tajne")).stav).toBe(403);
    expect((await spustPlanovane(s, "spatne", "tajne")).stav).toBe(403);
    expect(s.behy).toHaveLength(0);
  });

  it("zakázka, která ve stavu ještě není dost dlouho, se nespustí ani nezaloguje", async () => {
    s.pravidla.push(pravidlo("r", NAS, { type: "status_age", status_key: "received", after_hours: 48 }, { type: "notify", message: "X" }));
    s.zakazky[0].status_od = s.ted - 5 * HODINA;
    await spustPlanovane(s, "tajne", "tajne");
    expect(s.behy).toHaveLength(0);
  });

  it("bez repeat_hours proběhne pravidlo na zakázku jednou, další tiky mlčí", async () => {
    // Ticho je záměr: s řádkem v logu při každém tiku by historie rostla
    // každých 15 minut donekonečna.
    s.pravidla.push(pravidlo("r", NAS, { type: "status_age", status_key: "received", after_hours: 1 }, { type: "notify", message: "X" }));
    s.zakazky[0].status_od = s.ted - 5 * HODINA;
    await spustPlanovane(s, "t", "t");
    s.ted += HODINA;
    await spustPlanovane(s, "t", "t");
    expect(s.behy).toHaveLength(1);
    expect(s.poznamky).toHaveLength(1);
  });

  it("s repeat_hours se pravidlo zopakuje až po uplynutí odstupu", async () => {
    s.pravidla.push(
      pravidlo("r", NAS, { type: "status_age", status_key: "received", after_hours: 1, repeat_hours: 24 }, { type: "notify", message: "X" }, { once_per_ticket: false }),
    );
    s.zakazky[0].status_od = s.ted - 5 * HODINA;
    await spustPlanovane(s, "t", "t");
    s.ted += 10 * HODINA;
    await spustPlanovane(s, "t", "t");
    expect(s.poznamky).toHaveLength(1);
    s.ted += 20 * HODINA;
    await spustPlanovane(s, "t", "t");
    expect(s.poznamky).toHaveLength(2);
  });

  it("přeskočené pravidlo se zkusí znovu nejdřív za den", async () => {
    s.zakazky[0].customer_phone = null;
    s.pravidla.push(
      pravidlo("r", NAS, { type: "status_age", status_key: "received", after_hours: 1 }, { type: "sms", template: "X" }, { require_phone: true }),
    );
    s.zakazky[0].status_od = s.ted - 5 * HODINA;
    await spustPlanovane(s, "t", "t");
    expect(s.behy).toHaveLength(1);
    s.ted += 5 * HODINA;
    await spustPlanovane(s, "t", "t");
    expect(s.behy).toHaveLength(1);
    s.ted += 20 * HODINA;
    await spustPlanovane(s, "t", "t");
    expect(s.behy).toHaveLength(2);
  });

  it("plánovaný běh nesáhne na zakázky jiného servisu, než je servis pravidla", async () => {
    s.pravidla.push(pravidlo("r", NAS, { type: "status_age", status_key: "received", after_hours: 1 }, { type: "notify", message: "Jen naše" }));
    s.zakazky[0].status_od = s.ted - 5 * HODINA;
    s.zakazky[1].status_od = s.ted - 5 * HODINA;
    await spustPlanovane(s, "t", "t");
    expect(s.poznamky.map((p) => p.ticket_id)).toEqual(["z1"]);
  });

  it("dny do šablony se počítají z doby ve stavu", async () => {
    s.pravidla.push(
      pravidlo("r", NAS, { type: "status_age", status_key: "received", after_hours: 24 }, { type: "notify", message: "Čeká {{days}} dní" }),
    );
    s.zakazky[0].status_od = s.ted - 74 * HODINA;
    await spustPlanovane(s, "t", "t");
    expect(s.poznamky[0].text).toBe("Čeká 3 dní");
  });

  it("poplatek za den se počítá z počtu dní, ne z počtu tiků", async () => {
    s.pravidla.push(
      pravidlo("r", NAS, { type: "status_age", status_key: "received", after_hours: 24 }, { type: "add_fee", name: "Skladné", amount: 30, per_day: true }),
    );
    s.zakazky[0].status_od = s.ted - 100 * HODINA;
    await spustPlanovane(s, "t", "t");
    expect(s.zakazky[0].performed_repairs[0].price).toBe(120);
  });
});

// ---------------------------------------------------------------------------
// 6. Šablony (skutečná funkce ze sdíleného kontraktu)
// ---------------------------------------------------------------------------

describe("automatizace: šablony a popisky", () => {
  it("neznámá proměnná se dosadí prázdnou, ne názvem proměnné", () => {
    expect(substituteTemplate("Ahoj {{jmeno}}, {{neznama}}!", { jmeno: "Jano" })).toBe("Ahoj Jano, !");
  });

  it("mezery uvnitř složených závorek nevadí", () => {
    expect(substituteTemplate("{{ code }}", { code: "A1" })).toBe("A1");
  });

  it("dosazená hodnota se dál nedosazuje – text od zákazníka nesmí vyrobit další proměnnou", () => {
    expect(substituteTemplate("{{a}}", { a: "{{b}}", b: "TAJNÉ" })).toBe("{{b}}");
  });

  it("hodiny se do věty píšou česky", () => {
    expect(formatHours(1)).toBe("1 hodinu");
    expect(formatHours(3)).toBe("3 hodiny");
    expect(formatHours(10)).toBe("10 hodin");
    expect(formatHours(24)).toBe("1 den");
    expect(formatHours(72)).toBe("3 dny");
  });

  it("popis pravidla řekne, co se stane, i pro stav bez názvu", () => {
    const r = pravidlo("x", NAS, { type: "status_age", status_key: "ready", after_hours: 72, repeat_hours: 24 }, { type: "add_fee", name: "Skladné", amount: 30, per_day: true });
    const veta = describeRule(r, (k) => ({ ready: "Připraveno" })[k] ?? k);
    expect(veta).toContain("3 dny");
    expect(veta).toContain("Připraveno");
    expect(veta).toContain("Skladné");
    expect(veta).toContain("za den");
  });
});

// ---------------------------------------------------------------------------
// 7. Pojistky ve zdrojácích
// ---------------------------------------------------------------------------

describe("pojistky ve zdrojácích automatizací", () => {
  const bezKomentaru = (cesta: string) =>
    readFileSync(join(KOREN, cesta), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
  const beh = () => bezKomentaru("supabase/functions/automations-run/index.ts");

  it("řetězení set_status má strop – jinak se dvě pravidla točí donekonečna", () => {
    const zdroj = beh();
    expect(zdroj).toMatch(/depth === 0[\s\S]{0,160}runStatusChange\([^)]*depth \+ 1/);
  });

  it("vyhodnocení jednoho pravidla je celé v try/catch", () => {
    // Bez toho by jedna výjimka zastavila zpracování ostatních pravidel
    // i ostatních zakázek v tiku.
    const zdroj = beh();
    const zacatek = zdroj.indexOf("async function evaluateRule");
    const konec = zdroj.indexOf("async function runStatusChange");
    const telo = zdroj.slice(zacatek, konec);
    expect(telo).toMatch(/try \{/);
    expect(telo).toMatch(/\} catch \(e\) \{[\s\S]{0,120}log\("error"/);
  });

  it("stav se bere ze zakázky, ne z těla požadavku", () => {
    const zdroj = beh();
    expect(zdroj).toMatch(/runStatusChange\(svc, ctx, ticket, ticket\.status/);
    expect(zdroj, "status_key z těla se nesmí předávat dál").not.toMatch(/runStatusChange\([^)]*body\.status_key/);
  });

  it("okamžitý běh ověří členství i pobočku, než něco pošle", () => {
    const zdroj = beh();
    const clenstvi = zdroj.indexOf("service_memberships");
    const pobocka = zdroj.indexOf("pobocka_povolena");
    const pravidla = zdroj.indexOf("loadActiveRules(svc, serviceId)");
    expect(clenstvi).toBeGreaterThan(-1);
    expect(pobocka).toBeGreaterThan(-1);
    expect(pravidla, "pravidla se načítají až po kontrolách").toBeGreaterThan(pobocka);
  });

  it("plánovaný běh porovnává tajemství v konstantním čase", () => {
    const zdroj = beh();
    expect(zdroj).toMatch(/function secretsEqual/);
    expect(zdroj, "porovnání po znacích přes XOR").toMatch(/diff \|=/);
    expect(zdroj, "žádné porovnání celých řetězců").not.toMatch(/secret === expected|expected === secret/);
  });

  it("dotazy plánovaného běhu jsou omezené na servis kontextu", () => {
    // Bez tohohle filtru by pravidlo jednoho servisu vzalo zakázky všech –
    // a rozeslalo cizím zákazníkům SMS z cizího servisu.
    const zdroj = beh();
    const usek = (odkud: string, kam: string) =>
      zdroj.slice(zdroj.indexOf(odkud), zdroj.indexOf(kam));
    const stari = usek("async function runStatusAgeRule", "async function runEventRules");
    expect(stari, "výběr zakázek bez filtru na servis").toMatch(
      /\.from\("tickets"\)[\s\S]{0,200}\.eq\("service_id", ctx\.serviceId\)/,
    );
    const udalosti = usek("async function runEventRules", "async function handleScheduled");
    expect(udalosti, "výběr událostí portálu bez filtru na servis").toMatch(
      /\.from\("ticket_portal_events"\)[\s\S]{0,200}\.eq\("service_id", ctx\.serviceId\)/,
    );
  });

  it("do automation_runs se zapisuje servis pravidla, ne zakázky", () => {
    const zdroj = beh();
    expect(zdroj).toMatch(/automation_runs"\)\.insert\(\{[\s\S]{0,200}service_id: rule\.service_id/);
  });

  it("odesílání SMS se ptá na nárok na modul, ne jen na telefon", () => {
    const zdroj = beh();
    expect(zdroj).toMatch(/has_entitlement[\s\S]{0,120}p_module: "sms"/);
  });

  it("trigger stavu pouští server – jinak akce „přepnout stav“ nikdy neproběhne", () => {
    // Chyba, kterou tenhle test hlídá: edge funkce mění stav pod service_role,
    // takže auth.uid() je NULL. Trigger to bral jako „není členem servisu“
    // a každé pravidlo se set_status skončilo chybou.
    const zdroj = readFileSync(
      join(KOREN, "supabase/migrations/20260911120000_automatizace_stav_service_role.sql"),
      "utf8",
    );
    expect(zdroj).toMatch(/CREATE OR REPLACE FUNCTION public\.enforce_ticket_status_change_permissions/);
    expect(zdroj).toMatch(/IF v_uid IS NULL THEN\s*RETURN NEW;/);
  });

  it("zakázka bez čísla nebo bez zákazníka šablonu nerozbije", () => {
    // buildVars dosazuje prázdné řetězce, ne „undefined“ – to by zákazník
    // dostal v SMS.
    const zdroj = beh();
    expect(zdroj).toMatch(/code: ticket\.code \?\? ""/);
    expect(zdroj).toMatch(/customer_name: ticket\.customer_name \?\? ""/);
  });
});
