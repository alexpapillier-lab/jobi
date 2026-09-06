/**
 * Ceník předplatného na obrazovce Předplatné.
 *
 * Částky chodí ze Stripe v haléřích. Kdyby se zapomnělo dělit stem, nabídne
 * aplikace servisu tarif za 29 900 Kč měsíčně místo 299 Kč – a nikdo si ho
 * nekoupí. Když se naopak u tarifu bez ceny vypíše „0 Kč“, čeká majitel, že
 * to má zadarmo.
 *
 * Obsah tarifů se v aplikaci opisuje ručně (zdroj pravdy je Stripe), takže
 * se snadno rozejde: vyšší tarif musí obsahovat všechno z nižšího, jinak by
 * servis po upgradu přišel o modul, který mu do té doby fungoval.
 *
 * Tady se testuje jen to, co je v src/lib. Porovnání s tabulkou PLANS ve
 * Stripe, podpis webhooku, nároky a kvóty jsou v billingWebhook.test.ts.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("./supabaseClient", () => ({
  supabase: null,
  supabaseUrl: "",
  supabaseFetch: async () => {
    throw new Error("v testu se na síť nechodí");
  },
}));

const { castka, TARIFY, MODUL_POPIS, SLEVA_ROCNE, STATUS_LABELS } = await import("./billing");

describe("cena tarifu z haléřů", () => {
  it("haléře ze Stripe se ukážou jako koruny, ne stokrát dráž", () => {
    expect(castka(29900)).toBe("299\u00A0Kč");
    expect(castka(149900)).toBe("1\u00A0499\u00A0Kč");
  });

  it("tarif bez ceny nemá nabízet nulu, ale nic", () => {
    expect(castka(null)).toBe("");
  });

  it("nula je opravdu nula, ne prázdno", () => {
    expect(castka(0)).toBe("0\u00A0Kč");
  });

  it("ceník v eurech se netiskne v korunách", () => {
    expect(castka(29900, "eur")).toBe("299\u00A0€");
    expect(castka(29900, "EUR")).toBe("299\u00A0€");
  });

  it("tisíce oddělují pevnou mezerou, aby se cena nezalomila přes řádek", () => {
    expect(castka(149900)).toContain("\u00A0");
  });

  it("ceny se ukazují v celých korunách, ne s halíři", () => {
    expect(castka(34999)).not.toContain(",");
  });
});

describe("obsah tarifů", () => {
  const podleTieru = Object.fromEntries(TARIFY.map((t) => [t.tier, t]));

  it("ceník nabízí právě tři tarify a každý jen jednou", () => {
    expect(TARIFY.map((t) => t.tier)).toEqual(["starter", "business", "enterprise"]);
  });

  it("vyšší tarif obsahuje všechno z nižšího – upgradem se nesmí nic ztratit", () => {
    for (const m of podleTieru.starter.modules) expect(podleTieru.business.modules).toContain(m);
    for (const m of podleTieru.business.modules) expect(podleTieru.enterprise.modules).toContain(m);
  });

  it("i nejlevnější tarif umí zakázky a faktury – bez toho by aplikace neměla smysl", () => {
    expect(podleTieru.starter.modules).toContain("access");
    expect(podleTieru.starter.modules).toContain("invoices");
  });

  it("pobočky a SMS nabízí jen tarify, které je opravdu mají v ceně", () => {
    expect(podleTieru.starter.modules).not.toContain("branches");
    expect(podleTieru.starter.smsIncluded).toBe(0);
    expect(podleTieru.business.modules).toContain("sms");
    expect(podleTieru.business.smsIncluded).toBeGreaterThan(0);
  });

  it("počet poboček ani SMS v ceně s vyšším tarifem neklesá", () => {
    expect(podleTieru.business.branchesIncluded).toBeGreaterThanOrEqual(podleTieru.starter.branchesIncluded);
    expect(podleTieru.enterprise.branchesIncluded).toBeGreaterThanOrEqual(podleTieru.business.branchesIncluded);
    expect(podleTieru.enterprise.smsIncluded).toBeGreaterThanOrEqual(podleTieru.business.smsIncluded);
  });

  it("každý tarif obsahuje aspoň jednu pobočku, jinak by servis neměl kde pracovat", () => {
    for (const t of TARIFY) expect(t.branchesIncluded).toBeGreaterThanOrEqual(1);
  });

  it("každý modul v tarifu má popis, jinak by na obrazovce byla prázdná odrážka", () => {
    for (const t of TARIFY) {
      for (const m of t.modules) {
        expect(MODUL_POPIS[m], `modul ${m} nemá popis`).toBeTruthy();
      }
    }
  });

  it("každý tarif má název a větu, proč si ho vybrat", () => {
    for (const t of TARIFY) {
      expect(t.label.trim().length).toBeGreaterThan(0);
      expect(t.popis.trim().length).toBeGreaterThan(0);
    }
  });

  it("seznam modulů v tarifu nemá modul dvakrát", () => {
    // Duplicita by na obrazovce vypsala tutéž odrážku dvakrát a vypadala
    // by jako chyba v tom, co si člověk kupuje.
    for (const t of TARIFY) expect(new Set(t.modules).size).toBe(t.modules.length);
  });

  it("aplikace nezná popis modulu, který si nejde koupit", () => {
    // Popis navíc znamená modul, který se odněkud vytratil z tarifů –
    // buď se na obrazovku nedostane, nebo se ho někdo chystá prodávat.
    const prodavane = new Set(TARIFY.flatMap((t) => t.modules));
    for (const modul of Object.keys(MODUL_POPIS)) {
      expect(prodavane.has(modul), `modul ${modul} má popis, ale žádný tarif ho nedává`).toBe(true);
    }
  });

  it("popisy modulů jsou čitelná čeština, ne klíče z databáze", () => {
    for (const [modul, popis] of Object.entries(MODUL_POPIS)) {
      expect(popis).not.toBe(modul);
      expect(popis, `popis modulu ${modul} vypadá jako klíč`).not.toMatch(/^[a-z_]+$/);
    }
  });
});

describe("roční sleva a stavy předplatného", () => {
  it("roční sleva je skutečná sleva, ne nula ani celá cena", () => {
    expect(SLEVA_ROCNE).toBeGreaterThan(0);
    expect(SLEVA_ROCNE).toBeLessThan(100);
  });

  it("stavy ze Stripe mají české popisky, ne anglické klíče", () => {
    for (const stav of ["trialing", "active", "past_due", "canceled", "unpaid"]) {
      expect(STATUS_LABELS[stav], `stav ${stav} nemá popisek`).toBeTruthy();
      expect(STATUS_LABELS[stav]).not.toBe(stav);
    }
  });

  it("i stavy po neúspěšné platbě mají popisek – právě tehdy se člověk dívá", () => {
    // Servis, kterému neprošla karta, otevře obrazovku Předplatné jako první.
    // Prázdné místo místo stavu je ta nejhorší chvíle, kdy nevědět, co se děje.
    for (const stav of ["incomplete", "incomplete_expired", "past_due", "unpaid", "canceled"]) {
      expect(STATUS_LABELS[stav], `stav ${stav} nemá popisek`).toBeTruthy();
    }
  });
});
