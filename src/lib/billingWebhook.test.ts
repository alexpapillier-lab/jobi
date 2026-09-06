/**
 * Předplatné Stripe: podpis webhooku, tarify a nároky na moduly.
 *
 * Tohle je jediné místo v aplikaci, kde se z peněz stává přístup. Když se
 * splete, buď servis zaplatí a nedostane nic (a napíše nám), nebo nezaplatí
 * a dostane všechno (a nenapíše nám nikdy).
 *
 * PROČ TO CELÉ ŽIJE V src/lib A NE U EDGE FUNKCÍ
 * `npx vitest run` bere podle vite.config.ts jen `src/**` a `jobidocs/core/**`,
 * takže test vedle edge funkce by se nikdy nespustil. A `billing-webhook/index.ts`
 * se stejně naimportovat nedá – tahá `serve` z deno.land a `createClient`
 * z esm.sh. Testuje se proto ve třech vrstvách, od nejcennější:
 *
 *  1. Co jde importovat doopravdy, se importuje doopravdy. `overitPodpis`,
 *     `PLANS`, `ADDONS`, `GRACE_DAYS` a `addonKey` z `_shared/stripe.ts` jsou
 *     tady ta samá funkce a ta samá tabulka, jakou používá běžící webhook –
 *     stejná cesta, jakou už chodí src/lib/tokeny.test.ts a limity.test.ts.
 *  2. Obsluha událostí je přepsaná jako referenční implementace (`naroky`,
 *     `zruseni`, `vetev`). Je to zrcadlo, ne originál: kdyby někdo přepsal
 *     index.ts, test o tom neví. Proto se drží co nejblíž předloze a všechno,
 *     co se dá, počítá ze skutečných `PLANS`/`ADDONS`/`GRACE_DAYS` – rozejít
 *     se tak může jen ten kus, který je tu doslova opsaný.
 *  3. Dvě místa, kde se chyba za peníze opravdu stala, hlídá test přímo ve
 *     zdrojáku edge funkce (viz „pojistky ve zdrojácích edge funkcí“).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { overitPodpis, PLANS, ADDONS, GRACE_DAYS, addonKey } from "../../supabase/functions/_shared/stripe";

/**
 * `_shared/stripe.ts` sahá na `Deno.env` – jen uvnitř `stripeKey()`, který se
 * odsud nikdy nevolá, takže za běhu to nevadí. `tsc` ale soubor projde celý a
 * o globálním `Deno` v projektu nic neví. Tohle je jediná taková deklarace
 * v celém projektu; druhá by skončila na „Cannot redeclare“, proto všechny
 * testy, které potřebují `_shared/stripe.ts`, jsou v tomhle souboru.
 */
declare global {
  const Deno: { env: { get(name: string): string | undefined } };
}

vi.mock("./supabaseClient", () => ({
  supabase: null,
  supabaseUrl: "",
  supabaseFetch: async () => {
    throw new Error("v testu se na síť nechodí");
  },
}));

const { TARIFY, MODUL_POPIS } = await import("./billing");

const KOREN = join(__dirname, "..", "..");

// ---------------------------------------------------------------------------
// 1. Ověření podpisu – skutečná funkce z _shared/stripe.ts
// ---------------------------------------------------------------------------

const TAJEMSTVI = "whsec_testovaci_tajemstvi_neni_ze_stripe";

/** Podepíše tělo stejným postupem jako Stripe: HMAC-SHA256 nad `t.payload`. */
async function podepsat(payload: string, opts: { secret?: string; t?: number } = {}): Promise<string> {
  const secret = opts.secret ?? TAJEMSTVI;
  const t = opts.t ?? Math.floor(Date.now() / 1000);
  const klic = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const podpis = await crypto.subtle.sign("HMAC", klic, new TextEncoder().encode(`${t}.${payload}`));
  const hex = Array.from(new Uint8Array(podpis)).map((b) => b.toString(16).padStart(2, "0")).join("");
  return `t=${t},v1=${hex}`;
}

/**
 * Podpis je jediná zábrana mezi cizím POSTem a odemčenou aplikací. Kdyby
 * neplatil, stačí komukoli poslat na veřejnou adresu funkce vymyšlené
 * „předplatné aktivní“ a má Enterprise zadarmo – nebo naopak poslat cizímu
 * servisu „zrušeno“ a odstřihnout ho od zakázek uprostřed dne.
 */
describe("ověření podpisu webhooku Stripe", () => {
  const telo = JSON.stringify({ type: "customer.subscription.updated", data: { object: { id: "sub_1" } } });

  it("podpis spočítaný naším tajemstvím projde", async () => {
    expect(await overitPodpis(telo, await podepsat(telo), TAJEMSTVI)).toBe(true);
  });

  it("změněné tělo neprojde, i když je podpis jinak platný", async () => {
    const hlavicka = await podepsat(telo);
    const podvrzene = telo.replace("sub_1", "sub_cizi");
    expect(await overitPodpis(podvrzene, hlavicka, TAJEMSTVI)).toBe(false);
  });

  it("i změna jediného znaku v těle podpis shodí", async () => {
    const hlavicka = await podepsat(telo);
    expect(await overitPodpis(telo + " ", hlavicka, TAJEMSTVI)).toBe(false);
  });

  it("podpis cizím tajemstvím neprojde", async () => {
    const hlavicka = await podepsat(telo, { secret: "whsec_cizi" });
    expect(await overitPodpis(telo, hlavicka, TAJEMSTVI)).toBe(false);
  });

  it("podpis starší než pět minut neprojde – přehrání staré zprávy nesmí nic zapnout", async () => {
    const t = Math.floor(Date.now() / 1000) - 301;
    expect(await overitPodpis(telo, await podepsat(telo, { t }), TAJEMSTVI)).toBe(false);
  });

  it("podpis těsně pod pěti minutami ještě projde – pomalá síť není útok", async () => {
    const t = Math.floor(Date.now() / 1000) - 290;
    expect(await overitPodpis(telo, await podepsat(telo, { t }), TAJEMSTVI)).toBe(true);
  });

  it("podpis z daleké budoucnosti neprojde – posunuté hodiny útočníka nepomůžou", async () => {
    const t = Math.floor(Date.now() / 1000) + 301;
    expect(await overitPodpis(telo, await podepsat(telo, { t }), TAJEMSTVI)).toBe(false);
  });

  it("chybějící hlavička neprojde", async () => {
    expect(await overitPodpis(telo, null, TAJEMSTVI)).toBe(false);
    expect(await overitPodpis(telo, "", TAJEMSTVI)).toBe(false);
  });

  it("hlavička bez času nebo bez podpisu neprojde", async () => {
    const hlavicka = await podepsat(telo);
    const v1 = hlavicka.split(",")[1];
    const t = hlavicka.split(",")[0];
    expect(await overitPodpis(telo, v1, TAJEMSTVI)).toBe(false);
    expect(await overitPodpis(telo, t, TAJEMSTVI)).toBe(false);
    expect(await overitPodpis(telo, "nesmysl", TAJEMSTVI)).toBe(false);
  });

  it("nečíselný čas neprojde, i kdyby podpis nad ním seděl", async () => {
    // Kdyby se stáří nekontrolovalo přes Number.isFinite, vyšlo by NaN
    // z porovnání jako „není starší než 300“ a hlavička by prošla.
    const klic = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(TAJEMSTVI),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const podpis = await crypto.subtle.sign("HMAC", klic, new TextEncoder().encode(`kdysi.${telo}`));
    const hex = Array.from(new Uint8Array(podpis)).map((b) => b.toString(16).padStart(2, "0")).join("");
    expect(await overitPodpis(telo, `t=kdysi,v1=${hex}`, TAJEMSTVI)).toBe(false);
  });

  it("zkrácený ani prodloužený podpis neprojde", async () => {
    const hlavicka = await podepsat(telo);
    const [cast, v1] = [hlavicka.split(",")[0], hlavicka.split("v1=")[1]];
    expect(await overitPodpis(telo, `${cast},v1=${v1.slice(0, -2)}`, TAJEMSTVI)).toBe(false);
    expect(await overitPodpis(telo, `${cast},v1=${v1}00`, TAJEMSTVI)).toBe(false);
  });

  it("neprojde rozdíl na prvním ani na posledním znaku podpisu", async () => {
    const hlavicka = await podepsat(telo);
    const [cast, v1] = [hlavicka.split(",")[0], hlavicka.split("v1=")[1]];
    const jiny = (z: string) => (z === "0" ? "1" : "0");
    expect(await overitPodpis(telo, `${cast},v1=${jiny(v1[0])}${v1.slice(1)}`, TAJEMSTVI)).toBe(false);
    expect(await overitPodpis(telo, `${cast},v1=${v1.slice(0, -1)}${jiny(v1[v1.length - 1])}`, TAJEMSTVI)).toBe(false);
  });

  it("porovnává podpisy v konstantním čase, ne rychlou zkratkou", () => {
    // Čas se v jednotkovém testu měřit nedá bez plaňácích výsledků, takže se
    // kontroluje tvar kódu: sčítání rozdílů přes XOR přes celý řetězec.
    // Kdyby se porovnávalo `===` nebo se z cyklu vyskakovalo při první
    // neshodě, dal by se podpis uhodnout znak po znaku podle doby odpovědi.
    const zdroj = overitPodpis.toString();
    expect(zdroj, "podpisy se musí porovnávat po znacích přes XOR").toMatch(/\|=/);
    expect(zdroj, "XOR přes kódy znaků").toMatch(/charCodeAt/);
    expect(zdroj, "žádné porovnání celých řetězců na rovnost").not.toMatch(/===\s*v1|v1\s*===/);
    expect(zdroj, "z porovnávacího cyklu se nesmí vyskakovat").not.toMatch(/for\s*\([^)]*\)\s*\{?[^\n]*return/);
  });

  it("při rotaci tajemství projde platný podpis na kterémkoli místě hlavičky", async () => {
    // Stripe při výměně tajemství posílá `t=…,v1=staré,v1=nové`. Dokud se
    // četl jen poslední podpis, propadaly v okně rotace platné události.
    const hlavicka = await podepsat(telo);
    const [cast, v1] = [hlavicka.split(",")[0], hlavicka.split("v1=")[1]];
    const smetak = "0".repeat(v1.length);
    expect(await overitPodpis(telo, `${cast},v1=${v1},v1=${smetak}`, TAJEMSTVI)).toBe(true);
    expect(await overitPodpis(telo, `${cast},v1=${smetak},v1=${v1}`, TAJEMSTVI)).toBe(true);
    // Samé nesmysly ale neprojdou ani ve větším počtu.
    expect(await overitPodpis(telo, `${cast},v1=${smetak},v1=${smetak}`, TAJEMSTVI)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 2. Referenční implementace obsluhy událostí (zrcadlo billing-webhook/index.ts)
// ---------------------------------------------------------------------------

type Polozka = { quantity?: number; price?: { lookup_key?: string | null } };

type Predplatne = {
  id: string;
  status: string;
  customer: string;
  current_period_end: number;
  cancel_at_period_end?: boolean;
  metadata?: Record<string, string>;
  items?: { data?: Polozka[] };
};

/** Zápis do databáze, který by webhook provedl. Místo klienta se vrací data. */
type Zapis =
  | { tabulka: "service_billing"; op: "upsert"; radek: Record<string, unknown> }
  | { tabulka: "service_entitlements"; op: "upsert"; radek: Record<string, unknown> }
  | { tabulka: "service_entitlements"; op: "update"; zmena: Record<string, unknown>; filtry: string[] };

/** Která větev index.ts se pro danou událost použije. */
type Vetev = "naroky" | "zruseni" | "past_due" | "ignorovano";

function vetev(typ: string): Vetev {
  if (typ.startsWith("customer.subscription.")) {
    return typ === "customer.subscription.deleted" ? "zruseni" : "naroky";
  }
  if (typ === "invoice.payment_failed") return "past_due";
  return "ignorovano";
}

/** Zrcadlo `zapsatNaroky()` z billing-webhook/index.ts. */
function naroky(serviceId: string, sub: Predplatne): Zapis[] {
  const polozky = sub.items?.data ?? [];
  const planKey = polozky.map((i) => i.price?.lookup_key).find((k): k is string => !!k && k in PLANS);
  const plan = planKey ? PLANS[planKey] : null;

  const moduly = new Set<string>(plan?.modules ?? []);
  let pobocekNavic = 0;
  let smsNavic = 0;
  for (const i of polozky) {
    const key = i.price?.lookup_key;
    if (!key || !(key in ADDONS)) continue;
    // Množství 0 = příplatek na předplatném je, ale nic za něj neplatí.
    const mnozstvi = i.quantity ?? 1;
    if (mnozstvi <= 0) continue;
    const addon = ADDONS[key];
    for (const m of addon.modules ?? []) moduly.add(m);
    if (addon.branches) {
      pobocekNavic += addon.branches * mnozstvi;
      moduly.add("branches");
    }
    if (addon.sms) smsNavic += addon.sms * mnozstvi;
  }
  const pobocekCelkem = (plan?.branchesIncluded ?? 0) + pobocekNavic;
  const smsCelkem = (plan?.smsIncluded ?? 0) + smsNavic;

  const plati = sub.status === "active" || sub.status === "trialing" || sub.status === "past_due";
  const konec = new Date((sub.current_period_end || 0) * 1000);
  const platiDo = plati && sub.current_period_end
    ? new Date(konec.getTime() + GRACE_DAYS * 86_400_000).toISOString()
    : new Date().toISOString();

  const zapisy: Zapis[] = [{
    tabulka: "service_billing",
    op: "upsert",
    radek: {
      service_id: serviceId,
      stripe_customer_id: sub.customer,
      stripe_subscription_id: sub.id,
      status: sub.status,
      plan: planKey ?? null,
      branches_quantity: pobocekNavic,
      current_period_end: sub.current_period_end ? konec.toISOString() : null,
      cancel_at_period_end: sub.cancel_at_period_end === true,
    },
  }];

  for (const modul of moduly) {
    const radek: Record<string, unknown> = {
      service_id: serviceId,
      module: modul,
      active: plati,
      valid_until: platiDo,
      note: `${plan?.label ?? "Předplatné"} (${sub.status})`,
      updated_at: new Date().toISOString(),
    };
    if (modul === "branches") radek.quota = Math.max(1, pobocekCelkem);
    // Vždycky číslo: `quota: null` čte sms-send jako „bez omezení“.
    if (modul === "sms") radek.quota = smsCelkem;
    zapisy.push({ tabulka: "service_entitlements", op: "upsert", radek });
  }

  // Úklid: co předplatné nedává, se vypne (přechod na nižší tarif). Ručně
  // udělené nároky bez `valid_until` zůstávají. Neznámý tarif u platícího
  // předplatného neuklízí – nevíme, co má zůstat.
  if (plan || !plati) {
    const nechat = plati ? [...moduly] : [];
    const filtry = [`eq:service_id=${serviceId}`, "not:valid_until is null"];
    if (nechat.length > 0) filtry.push(`not:module in (${nechat.join(",")})`);
    zapisy.push({ tabulka: "service_entitlements", op: "update", zmena: { active: false, updated_at: new Date().toISOString() }, filtry });
  }
  return zapisy;
}

/** Zrcadlo větve `customer.subscription.deleted` z billing-webhook/index.ts. */
function zruseni(serviceId: string, sub: Predplatne): Zapis[] {
  return [
    {
      tabulka: "service_billing",
      op: "upsert",
      radek: {
        service_id: serviceId,
        status: "canceled",
        stripe_subscription_id: sub.id,
        stripe_customer_id: sub.customer,
        plan: null,
        branches_quantity: 0,
        cancel_at_period_end: false,
        current_period_end: sub.current_period_end ? new Date(sub.current_period_end * 1000).toISOString() : null,
      },
    },
    {
      tabulka: "service_entitlements",
      op: "update",
      zmena: { active: false, updated_at: new Date().toISOString() },
      filtry: [`eq:service_id=${serviceId}`, "not:valid_until is null"],
    },
  ];
}

const SERVIS = "11111111-1111-1111-1111-111111111111";
const TED = new Date("2026-03-01T10:00:00.000Z");
const ZA_MESIC = Math.floor(new Date("2026-04-01T10:00:00.000Z").getTime() / 1000);
const ZA_ROK = Math.floor(new Date("2027-03-01T10:00:00.000Z").getTime() / 1000);

function polozka(lookupKey: string, quantity = 1): Polozka {
  return { quantity, price: { lookup_key: lookupKey } };
}

function predplatne(polozky: Polozka[], zmeny: Partial<Predplatne> = {}): Predplatne {
  return {
    id: "sub_test",
    status: "active",
    customer: "cus_test",
    current_period_end: ZA_MESIC,
    metadata: { service_id: SERVIS },
    items: { data: polozky },
    ...zmeny,
  };
}

/** Nároky ze zápisů podle názvu modulu. */
function narokyPodleModulu(zapisy: Zapis[]): Map<string, Record<string, unknown>> {
  const out = new Map<string, Record<string, unknown>>();
  for (const z of zapisy) {
    if (z.tabulka === "service_entitlements" && z.op === "upsert") out.set(String(z.radek.module), z.radek);
  }
  return out;
}

function moduly(zapisy: Zapis[]): Set<string> {
  return new Set(narokyPodleModulu(zapisy).keys());
}

function billingRadek(zapisy: Zapis[]): Record<string, unknown> {
  const z = zapisy.find((x) => x.tabulka === "service_billing");
  expect(z, "webhook musí vždycky zapsat stav předplatného").toBeTruthy();
  return (z as { radek: Record<string, unknown> }).radek;
}

// ---------------------------------------------------------------------------
// 3. Události předplatného
// ---------------------------------------------------------------------------

/**
 * Špatně směrovaná událost znamená peníze bez protihodnoty na jednu stranu
 * nebo protihodnotu bez peněz na druhou. Nejtišší varianta je ta první:
 * zákazník zaplatí, nic se nestane a on si myslí, že je to naše chyba.
 */
describe("směrování událostí ze Stripe", () => {
  it("zaplacení v Checkoutu samo o sobě nároky nezapíná – přístup vzniká až z předplatného", () => {
    // Současné chování: `checkout.session.completed` webhook ignoruje a
    // spoléhá na `customer.subscription.created`, který Stripe pošle taky.
    // Kdyby byl endpoint ve Stripe nastavený jen na Checkout, servis by
    // zaplatil a nedostal nic – viz nález ve zprávě.
    expect(vetev("checkout.session.completed")).toBe("ignorovano");
    expect(vetev("customer.subscription.created")).toBe("naroky");
  });

  it("založení i změna předplatného přepisují nároky", () => {
    expect(vetev("customer.subscription.created")).toBe("naroky");
    expect(vetev("customer.subscription.updated")).toBe("naroky");
    expect(vetev("customer.subscription.paused")).toBe("naroky");
  });

  it("zrušení jde do vlastní větve, ne do přepisu nároků", () => {
    expect(vetev("customer.subscription.deleted")).toBe("zruseni");
  });

  it("neuhrazená faktura překlopí stav na po splatnosti", () => {
    expect(vetev("invoice.payment_failed")).toBe("past_due");
  });

  it("události, které se nás netýkají, se mlčky přeskočí", () => {
    for (const typ of ["ping", "invoice.paid", "customer.created", "payment_intent.succeeded"]) {
      expect(vetev(typ)).toBe("ignorovano");
    }
  });
});

/**
 * Tady se ze zaplacené faktury stává přístup do aplikace. Když se splete
 * seznam modulů, zákazník platí Business a nemá SMS; když se splete platnost,
 * zamkne se mu aplikace v den, kdy mu Stripe teprve strhává další období.
 */
describe("zaplacené předplatné zapíná moduly", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(TED);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("Business zapne přesně moduly svého tarifu, nic navíc", () => {
    const z = naroky(SERVIS, predplatne([polozka("jobi_business_monthly")]));
    expect(moduly(z)).toEqual(new Set(PLANS.jobi_business_monthly.modules));
    expect(moduly(z).has("api_catalog")).toBe(false);
  });

  it("Starter dostane zakázky a faktury, ale ne SMS ani pobočky", () => {
    const z = naroky(SERVIS, predplatne([polozka("jobi_starter_monthly")]));
    expect(moduly(z)).toEqual(new Set(["access", "invoices"]));
  });

  it("Enterprise zapne i veřejné API a přehled přes servisy", () => {
    const z = naroky(SERVIS, predplatne([polozka("jobi_enterprise_yearly")], { current_period_end: ZA_ROK }));
    for (const m of ["api_catalog", "api_inventory", "consolidated"]) expect(moduly(z).has(m)).toBe(true);
  });

  it("nároky platí do konce zaplaceného období a ještě tři dny hájení", () => {
    const z = naroky(SERVIS, predplatne([polozka("jobi_business_monthly")]));
    const ocekavano = new Date(ZA_MESIC * 1000 + GRACE_DAYS * 86_400_000).toISOString();
    for (const radek of narokyPodleModulu(z).values()) {
      expect(radek.valid_until).toBe(ocekavano);
      expect(radek.active).toBe(true);
    }
  });

  it("zkušební období platí stejně jako zaplacené", () => {
    const z = naroky(SERVIS, predplatne([polozka("jobi_business_monthly")], { status: "trialing" }));
    expect(narokyPodleModulu(z).get("access")?.active).toBe(true);
  });

  it("po splatnosti se přístup hned nebere – opožděná platba není důvod zavřít dílnu", () => {
    const z = naroky(SERVIS, predplatne([polozka("jobi_business_monthly")], { status: "past_due" }));
    expect(narokyPodleModulu(z).get("access")?.active).toBe(true);
    expect(billingRadek(z).status).toBe("past_due");
  });

  it("nezaplacené předplatné přístup vypne k dnešku, ne až za tři dny", () => {
    const z = naroky(SERVIS, predplatne([polozka("jobi_business_monthly")], { status: "unpaid" }));
    for (const radek of narokyPodleModulu(z).values()) {
      expect(radek.active).toBe(false);
      expect(radek.valid_until).toBe(TED.toISOString());
    }
  });

  it("nedokončená platba nezapne nic", () => {
    for (const stav of ["incomplete", "incomplete_expired", "canceled"]) {
      const z = naroky(SERVIS, predplatne([polozka("jobi_business_monthly")], { status: stav }));
      for (const radek of narokyPodleModulu(z).values()) expect(radek.active).toBe(false);
    }
  });

  it("stav předplatného se uloží i s příznakem „na konci období skončí“", () => {
    const z = naroky(SERVIS, predplatne([polozka("jobi_business_monthly")], { cancel_at_period_end: true }));
    const b = billingRadek(z);
    expect(b.plan).toBe("jobi_business_monthly");
    expect(b.cancel_at_period_end).toBe(true);
    expect(b.current_period_end).toBe(new Date(ZA_MESIC * 1000).toISOString());
  });

  it("předplatné s neznámou cenou nechá platícího na pokoji, ale nic mu nepřidá", () => {
    // Když někdo ve Stripe přejmenuje lookup key, tarif se nenajde. Zapisovat
    // by se nemělo co (nevíme co), ale ani se nesmí nic vypnout – dílna platí.
    const z = naroky(SERVIS, predplatne([polozka("jobi_neznamy_tarif")]));
    expect(moduly(z).size).toBe(0);
    expect(billingRadek(z).plan).toBe(null);
    expect(z.some((x) => x.op === "update"), "platícímu se přístup nebere").toBe(false);
  });

  it("neznámá cena a neplatící předplatné přístup přesto odeberou", () => {
    // Nejvážnější z nálezů testů plateb: dřív se u neznámého tarifu skončilo
    // před zápisem nároků, takže přechod na `unpaid` přístup nechal zapnutý.
    for (const stav of ["unpaid", "canceled", "incomplete_expired"]) {
      const z = naroky(SERVIS, predplatne([polozka("jobi_neznamy_tarif")], { status: stav }));
      const uklid = z.find((x) => x.tabulka === "service_entitlements" && x.op === "update") as { filtry: string[] } | undefined;
      expect(uklid, `stav ${stav} musí nároky vypnout`).toBeTruthy();
      expect(uklid!.filtry).toContain("not:valid_until is null");
      // Bez seznamu modulů k ponechání = vypne se všechno z předplatného.
      expect(uklid!.filtry.some((f) => f.startsWith("not:module in"))).toBe(false);
    }
  });
});

/**
 * Zrušení je ta strana, kde se chybou ztrácí peníze: kdo si předplatné
 * zruší a dál používá aplikaci zadarmo, už nikdy nezaplatí. Přesně tohle se
 * při revizi našlo – filtr `neq("valid_until", null)` nesedl na žádný řádek
 * a zrušené předplatné nevyplo vůbec nic.
 */
describe("zrušené předplatné", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(TED);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("zrušené předplatné odebere přístup k modulům", () => {
    const z = zruseni(SERVIS, predplatne([polozka("jobi_business_monthly")]));
    const update = z.find((x) => x.tabulka === "service_entitlements" && x.op === "update");
    expect(update, "zrušení musí vypnout nároky").toBeTruthy();
    expect((update as { zmena: Record<string, unknown> }).zmena.active).toBe(false);
  });

  it("vypne jen nároky z předplatného, ručně udělené nechá být", () => {
    // Řádky bez `valid_until` uděluje majitel aplikace přes entitlements-manage
    // (ukázkové servisy, kompenzace). Zrušené předplatné jimi nesmí hýbat.
    const z = zruseni(SERVIS, predplatne([polozka("jobi_business_monthly")]));
    const update = z.find((x) => x.tabulka === "service_entitlements" && x.op === "update") as { filtry: string[] };
    expect(update.filtry).toContain(`eq:service_id=${SERVIS}`);
    expect(update.filtry).toContain("not:valid_until is null");
  });

  it("vypnutí se týká jen toho jednoho servisu", () => {
    const z = zruseni(SERVIS, predplatne([polozka("jobi_business_monthly")]));
    const update = z.find((x) => x.tabulka === "service_entitlements" && x.op === "update") as { filtry: string[] };
    expect(update.filtry.some((f) => f.startsWith("eq:service_id="))).toBe(true);
  });

  it("stav předplatného se přepíše na zrušeno", () => {
    const z = zruseni(SERVIS, predplatne([polozka("jobi_business_monthly")]));
    expect(billingRadek(z).status).toBe("canceled");
  });

  it("zrušení nemaže data – jen odebírá přístup", () => {
    const z = zruseni(SERVIS, predplatne([polozka("jobi_business_monthly")]));
    expect(z.every((x) => x.op === "upsert" || x.op === "update")).toBe(true);
  });
});

/**
 * Přechod na nižší tarif byl jediné místo, kde zákazník dostal víc, než za co
 * platí: zapsaly se moduly nového tarifu a ty vyšší běžely dál až do konce
 * původního (klidně ročního) období. Webhook proto po každém přepisu vypne
 * nároky, které nový stav předplatného nedává.
 */
describe("přechod na nižší tarif", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(TED);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /** Filtry úklidového update z `naroky()` – tím se vypínají moduly navíc. */
  const uklid = (z: Zapis[]) =>
    z.find((x) => x.tabulka === "service_entitlements" && x.op === "update") as { zmena: Record<string, unknown>; filtry: string[] } | undefined;

  it("downgrade zapíše nároky nového tarifu a moduly navíc vypne", () => {
    const pred = naroky(SERVIS, predplatne([polozka("jobi_enterprise_monthly")]));
    const po = naroky(SERVIS, predplatne([polozka("jobi_starter_monthly")]));
    expect(moduly(po)).toEqual(new Set(["access", "invoices"]));
    const u = uklid(po);
    expect(u, "downgrade musí moduly navíc vypnout").toBeTruthy();
    expect(u!.zmena.active).toBe(false);
    for (const m of ["sms", "branches", "accounting", "api_catalog", "api_inventory", "consolidated"]) {
      expect(moduly(pred).has(m), `Enterprise musí zapnout ${m}`).toBe(true);
      // Modul není mezi ponechanými, takže spadne do úklidu.
      expect(u!.filtry.join(" ").includes(m), `${m} nesmí zůstat mezi ponechanými`).toBe(false);
    }
  });

  it("úklid nechá běžet moduly, které nový tarif dává", () => {
    const po = naroky(SERVIS, predplatne([polozka("jobi_starter_monthly")]));
    const seznam = uklid(po)!.filtry.find((f) => f.startsWith("not:module in")) as string;
    for (const m of PLANS.jobi_starter_monthly.modules) expect(seznam).toContain(m);
  });

  it("úklid se nikdy nedotkne ručně udělených nároků", () => {
    // Řádky bez `valid_until` uděluje majitel aplikace (ukázkové servisy,
    // kompenzace). Přechod na nižší tarif je vypnout nesmí.
    for (const tarif of ["jobi_starter_monthly", "jobi_business_yearly", "jobi_enterprise_monthly"]) {
      const u = uklid(naroky(SERVIS, predplatne([polozka(tarif)])))!;
      expect(u.filtry).toContain("not:valid_until is null");
      expect(u.filtry).toContain(`eq:service_id=${SERVIS}`);
    }
  });

  it("roční Enterprise po přechodu na měsíční Starter moduly navíc nedoběhnou", () => {
    // Nejdražší podoba téhle díry: rok Enterprise se zaplatí, druhý den se
    // přejde na Starter a moduly navíc dřív běžely do konce roční platnosti.
    const rocni = naroky(SERVIS, predplatne([polozka("jobi_enterprise_yearly")], { current_period_end: ZA_ROK }));
    const platnostApi = narokyPodleModulu(rocni).get("api_catalog")?.valid_until as string;
    expect(new Date(platnostApi).getTime()).toBe(ZA_ROK * 1000 + GRACE_DAYS * 86_400_000);

    const mesicni = naroky(SERVIS, predplatne([polozka("jobi_starter_monthly")]));
    expect(narokyPodleModulu(mesicni).has("api_catalog")).toBe(false);
    const seznam = uklid(mesicni)!.filtry.find((f) => f.startsWith("not:module in")) as string;
    expect(seznam).not.toContain("api_catalog");
  });

  it("přechod na vyšší tarif naopak funguje hned – nic se neztratí", () => {
    const po = naroky(SERVIS, predplatne([polozka("jobi_business_monthly")]));
    for (const m of PLANS.jobi_starter_monthly.modules) expect(moduly(po).has(m)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 4. Kvóty
// ---------------------------------------------------------------------------

/**
 * Kvóta je číslo, podle kterého databáze pustí nebo nepustí další pobočku
 * (branches_allowed) a podle kterého sms-send odešle nebo neodešle zprávu.
 * O jedno míň znamená zaplacenou pobočku, kterou nejde založit; o jedno víc
 * znamená pobočku zadarmo. Přesně tohle se při revizi našlo u Starteru.
 */
describe("kvóta poboček", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(TED);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const kvota = (z: Zapis[], modul: string) => narokyPodleModulu(z).get(modul)?.quota;

  it("Business bez příplatku má právě jednu pobočku", () => {
    const z = naroky(SERVIS, predplatne([polozka("jobi_business_monthly")]));
    expect(kvota(z, "branches")).toBe(1);
    expect(billingRadek(z).branches_quantity).toBe(0);
  });

  it("Enterprise má v ceně dvě pobočky", () => {
    const z = naroky(SERVIS, predplatne([polozka("jobi_enterprise_monthly")]));
    expect(kvota(z, "branches")).toBe(2);
  });

  it("každá dokoupená pobočka zvedne kvótu o jednu", () => {
    const z = naroky(SERVIS, predplatne([
      polozka("jobi_business_monthly"),
      polozka("jobi_branch_addon_monthly", 2),
    ]));
    expect(kvota(z, "branches")).toBe(3);
    expect(billingRadek(z).branches_quantity).toBe(2);
  });

  it("dvě pobočky navíc u Enterprise dají dohromady čtyři", () => {
    const z = naroky(SERVIS, predplatne([
      polozka("jobi_enterprise_yearly", 1),
      polozka("jobi_branch_addon_yearly", 2),
    ], { current_period_end: ZA_ROK }));
    expect(kvota(z, "branches")).toBe(4);
  });

  it("zaplacená pobočka navíc zapne modul poboček i tarifu, který ho v ceně nemá", () => {
    // Přes Checkout to dnes nejde (billing-checkout to odmítne), ale v portálu
    // Stripe se příplatek přidat dá. Kdyby modul nevznikl, servis by za
    // pobočku platil a databáze by mu ji dál odmítala založit.
    const z = naroky(SERVIS, predplatne([
      polozka("jobi_starter_monthly"),
      polozka("jobi_branch_addon_monthly", 1),
    ]));
    expect(moduly(z).has("branches")).toBe(true);
    expect(kvota(z, "branches")).toBe(2);
  });

  it("kvóta poboček nikdy neklesne pod jednu, i když tarif chybí", () => {
    // Samotný příplatek bez tarifu (ručně přidaná položka ve Stripe): pobočka
    // je zaplacená, tak musí jít založit.
    const z = naroky(SERVIS, predplatne([polozka("jobi_branch_addon_monthly", 1)]));
    expect(kvota(z, "branches")).toBe(1);
  });

  it("příplatek s nulovým množstvím pobočku navíc nedává", () => {
    // Množství 0 = nic se za něj neplatí. Dřív se z takové položky vzal modul
    // `branches` s kvótou 1 – pobočka zadarmo.
    const z = naroky(SERVIS, predplatne([polozka("jobi_branch_addon_monthly", 0)]));
    expect(moduly(z).has("branches")).toBe(false);
  });

  it("tarif bez poboček žádnou kvótu nezakládá", () => {
    const z = naroky(SERVIS, predplatne([polozka("jobi_starter_monthly")]));
    expect(moduly(z).has("branches")).toBe(false);
  });
});

/**
 * Balíček SMS je strop na měsíc – co je nad, sms-send neodešle (nedoúčtovává
 * se). Nižší číslo než zaplacené znamená zákazníka, který nemůže dát vědět,
 * že je oprava hotová; `null` znamená neomezené odesílání za naše peníze,
 * protože SMS platíme operátorovi my.
 */
describe("balíček SMS", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(TED);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const kvota = (z: Zapis[], modul: string) => narokyPodleModulu(z).get(modul)?.quota;

  it("Business má v ceně tři sta SMS měsíčně", () => {
    const z = naroky(SERVIS, predplatne([polozka("jobi_business_monthly")]));
    expect(kvota(z, "sms")).toBe(300);
  });

  it("Enterprise má v ceně šest set SMS měsíčně", () => {
    const z = naroky(SERVIS, predplatne([polozka("jobi_enterprise_monthly")]));
    expect(kvota(z, "sms")).toBe(600);
  });

  it("Starter bez příplatku modul SMS vůbec nedostane", () => {
    const z = naroky(SERVIS, predplatne([polozka("jobi_starter_monthly")]));
    expect(moduly(z).has("sms")).toBe(false);
  });

  it("Starter s dokoupeným balíčkem dostane modul i strop sto zpráv", () => {
    const z = naroky(SERVIS, predplatne([
      polozka("jobi_starter_monthly"),
      polozka("jobi_sms_addon_monthly", 1),
    ]));
    expect(moduly(z).has("sms")).toBe(true);
    expect(kvota(z, "sms")).toBe(100);
  });

  it("tři balíčky navíc k Business dají šest set zpráv", () => {
    const z = naroky(SERVIS, predplatne([
      polozka("jobi_business_monthly"),
      polozka("jobi_sms_addon_monthly", 3),
    ]));
    expect(kvota(z, "sms")).toBe(600);
  });

  it("balíček SMS s nulovým množstvím odesílání nezapne", () => {
    // Položka s množstvím 0 ve Stripe vzniknout může (ručně přidaná a hned
    // vynulovaná). Dřív z ní vznikl modul `sms` s `quota: null`, což sms-send
    // čte jako „bez omezení“ – neomezené SMS na náš účet.
    const z = naroky(SERVIS, predplatne([polozka("jobi_sms_addon_monthly", 0)]));
    expect(moduly(z).has("sms")).toBe(false);
  });

  it("kvóta SMS je vždycky číslo, nikdy „bez omezení“", () => {
    // `quota: null` smí vzniknout jen ruční správou nároků, ne z předplatného.
    for (const tarif of ["jobi_business_monthly", "jobi_enterprise_yearly"]) {
      const z = naroky(SERVIS, predplatne([polozka(tarif)]));
      expect(typeof kvota(z, "sms")).toBe("number");
    }
  });

  it("příplatek se kupuje ve stejném období jako tarif", () => {
    // Měsíční příplatek k roční platbě by ve Stripe skončil chybou a zákazník
    // by z Checkoutu odešel s prázdnou.
    expect(addonKey("jobi_sms_addon", "month")).toBe("jobi_sms_addon_monthly");
    expect(addonKey("jobi_sms_addon", "year")).toBe("jobi_sms_addon_yearly");
    expect(addonKey("jobi_branch_addon", "month")).toBe("jobi_branch_addon_monthly");
    expect(addonKey("jobi_branch_addon", "year")).toBe("jobi_branch_addon_yearly");
    for (const klic of [addonKey("jobi_sms_addon", "month"), addonKey("jobi_branch_addon", "year")]) {
      expect(klic in ADDONS, `příplatek ${klic} musí být v tabulce ADDONS`).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// 5. Ceník v aplikaci proti tabulce ve Stripe
// ---------------------------------------------------------------------------

/**
 * Obsah tarifů je opsaný dvakrát: v `_shared/stripe.ts` (podle toho se
 * zapisují nároky) a v `src/lib/billing.ts` (podle toho se kreslí obrazovka
 * Předplatné). Když se rozejdou, zákazník si koupí, co viděl na obrazovce, a
 * dostane, co je ve Stripe – a rozdíl zjistí až v provozu.
 */
describe("ceník v aplikaci sedí s tarify ve Stripe", () => {
  for (const tarif of ["starter", "business", "enterprise"] as const) {
    it(`tarif ${tarif} slibuje na obrazovce totéž, co zapíše webhook`, () => {
      const vApp = TARIFY.find((t) => t.tier === tarif);
      expect(vApp, `tarif ${tarif} chybí v ceníku aplikace`).toBeTruthy();
      const veStripe = Object.values(PLANS).filter((p) => p.tier === tarif);
      expect(veStripe.length, `tarif ${tarif} musí být ve Stripe měsíčně i ročně`).toBe(2);
      for (const p of veStripe) {
        expect(new Set(p.modules)).toEqual(new Set(vApp!.modules));
        expect(p.branchesIncluded).toBe(vApp!.branchesIncluded);
        expect(p.smsIncluded).toBe(vApp!.smsIncluded);
        expect(p.label).toBe(vApp!.label);
      }
    });
  }

  it("měsíční a roční varianta téhož tarifu obsahují totéž", () => {
    for (const tarif of ["starter", "business", "enterprise"] as const) {
      const [a, b] = Object.values(PLANS).filter((p) => p.tier === tarif);
      expect(new Set(a.modules)).toEqual(new Set(b.modules));
      expect(a.branchesIncluded).toBe(b.branchesIncluded);
      expect(a.smsIncluded).toBe(b.smsIncluded);
    }
  });

  it("každý tarif ve Stripe má měsíční i roční období a nic mezi tím", () => {
    const intervaly = Object.entries(PLANS).map(([klic, p]) => [klic, p.interval] as const);
    for (const [klic, interval] of intervaly) {
      expect(["month", "year"]).toContain(interval);
      expect(klic.endsWith(interval === "year" ? "_yearly" : "_monthly"), `klíč ${klic} neodpovídá období`).toBe(true);
    }
  });

  it("vyšší tarif ve Stripe obsahuje všechno z nižšího", () => {
    const starter = PLANS.jobi_starter_monthly;
    const business = PLANS.jobi_business_monthly;
    const enterprise = PLANS.jobi_enterprise_monthly;
    for (const m of starter.modules) expect(business.modules).toContain(m);
    for (const m of business.modules) expect(enterprise.modules).toContain(m);
    expect(business.branchesIncluded).toBeGreaterThanOrEqual(starter.branchesIncluded);
    expect(enterprise.branchesIncluded).toBeGreaterThanOrEqual(business.branchesIncluded);
    expect(enterprise.smsIncluded).toBeGreaterThanOrEqual(business.smsIncluded);
  });

  it("každý modul, který umí webhook zapnout, má na obrazovce český popis", () => {
    const zeStripe = new Set<string>();
    for (const p of Object.values(PLANS)) for (const m of p.modules) zeStripe.add(m);
    for (const a of Object.values(ADDONS)) for (const m of a.modules ?? []) zeStripe.add(m);
    zeStripe.add("branches"); // příplatek za pobočku zapíná modul napřímo
    for (const m of zeStripe) {
      expect(MODUL_POPIS[m], `modul ${m} nemá popis na obrazovce Předplatné`).toBeTruthy();
    }
  });

  it("tarif, který dává SMS v ceně, má modul sms a naopak", () => {
    for (const p of Object.values(PLANS)) {
      expect(p.smsIncluded > 0, `${p.label}: smsIncluded a modul sms se rozešly`).toBe(p.modules.includes("sms"));
    }
  });
});

// ---------------------------------------------------------------------------
// 6. Pojistky přímo ve zdrojácích edge funkcí
// ---------------------------------------------------------------------------

/**
 * Referenční implementace nahoře je jen zrcadlo – kdyby někdo přepsal
 * index.ts, testy o tom neví. Tyhle tři kontroly proto sahají rovnou do
 * zdrojáku, a to jen na místa, kde chyba už jednou stála peníze. Je to
 * ošklivé (a stejná obezlička jako v opravneniSeznam.test.ts), ale levnější
 * než další měsíc, kdy zrušené předplatné nikomu nic neodebralo.
 */
describe("pojistky ve zdrojácích edge funkcí", () => {
  const bezKomentaru = (cesta: string) =>
    readFileSync(join(KOREN, cesta), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");

  it("zrušení vypíná nároky filtrem na „valid_until není null“, ne porovnáním s null", () => {
    // `.neq("valid_until", null)` PostgREST přeloží na porovnání s řetězcem
    // „null“ – nesedne na žádný řádek a zrušené předplatné neodebere nic.
    const zdroj = bezKomentaru("supabase/functions/billing-webhook/index.ts");
    expect(zdroj).toMatch(/\.not\(\s*"valid_until",\s*"is",\s*null\s*\)/);
    expect(zdroj, "porovnání valid_until s null tudy nesmí projít").not.toMatch(/\.(neq|eq)\(\s*"valid_until"/);
  });

  it("checkout odmítne pobočku navíc dřív, než ji přidá do košíku", () => {
    // Bez téhle kontroly si Starter připlatil za druhou pobočku, modul
    // `branches` mu nevznikl a databáze mu ji dál odmítala – platil za nic.
    const zdroj = bezKomentaru("supabase/functions/billing-checkout/index.ts");
    const kontrola = zdroj.indexOf('modules.includes("branches")');
    const nakup = zdroj.indexOf('addonKey("jobi_branch_addon"');
    expect(kontrola, "chybí kontrola, že tarif pobočky vůbec umí").toBeGreaterThan(-1);
    expect(nakup, "chybí přidání příplatku za pobočku").toBeGreaterThan(-1);
    expect(nakup, "kontrola musí být dřív než nákup").toBeGreaterThan(kontrola);
  });

  it("webhook nekončí dřív, než se nároky přepíšou", () => {
    // `if (moduly.size === 0) return;` před zápisem znamenalo, že přejmenovaný
    // lookup key ve Stripe zastavil i odebrání přístupu u neplatícího.
    const zdroj = bezKomentaru("supabase/functions/billing-webhook/index.ts");
    expect(zdroj, "prázdné moduly nesmí zastavit celou funkci").not.toMatch(/moduly\.size\s*===\s*0\s*\)\s*return/);
  });

  it("checkout nepřejde chybějící cenu příplatku mlčky", () => {
    // Dřív se položka jen vynechala: zákazník prošel Checkoutem s vědomím, že
    // si koupil SMS nebo pobočku, zaplatil jen tarif a modul nedostal.
    const zdroj = bezKomentaru("supabase/functions/billing-checkout/index.ts");
    expect(zdroj, "chybějící cena příplatku se musí vrátit jako chyba").not.toMatch(/if \(cena\) polozky\.push/);
    expect(zdroj.match(/if \(!cena\) return json/g)?.length, "obě větve příplatku musí hlídat cenu").toBe(2);
  });

  it("checkout má strop na počet příplatkových poboček", () => {
    const zdroj = bezKomentaru("supabase/functions/billing-checkout/index.ts");
    expect(zdroj).toMatch(/MAX_POBOCEK_NAVIC/);
  });

  it("chyba zápisu vrátí 5xx, aby Stripe událost poslal znovu", () => {
    // Kdyby se odpovědělo 200, zůstal by nárok navždy v původním stavu:
    // zaplaceno a nezapnuto, nebo zrušeno a pořád zapnuto.
    const zdroj = bezKomentaru("supabase/functions/billing-webhook/index.ts");
    expect(zdroj).toMatch(/catch \(e\)\s*\{[\s\S]*?, 500\)/);
  });
});
