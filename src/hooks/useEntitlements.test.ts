import { describe, it, expect } from "vitest";
import { vyhodnotNaroky, zbyvaDni, type NarokRadek } from "./useEntitlements";

/**
 * Nároky rozhodují o dvou věcech, které se nesmí splést: co je vidět
 * (moduly) a kdy se aplikace zamkne (nárok „access“). Testy jdou po
 * hranicích, protože obě chyby jsou drahé – zamčený servis, který platí,
 * i odemčená aplikace, za kterou nikdo neplatí.
 */

const TED = Date.parse("2026-09-07T12:00:00.000Z");

function radek(cast: Partial<NarokRadek> & { module: string }): NarokRadek {
  return { active: true, valid_until: null, quota: null, ...cast };
}

describe("vyhodnocení nároků servisu", () => {
  it("trvalý nárok platí a zkušební období se neodpočítává", () => {
    const v = vyhodnotNaroky([radek({ module: "access" }), radek({ module: "invoices" })], TED);
    expect([...v.modules].sort()).toEqual(["access", "invoices"]);
    expect(v.trialEndsAt).toBeNull();
  });

  it("nárok s platností v minulosti modul nezapíná", () => {
    const v = vyhodnotNaroky(
      [radek({ module: "access", valid_until: "2026-09-06T12:00:00.000Z" })],
      TED,
    );
    expect(v.modules.has("access")).toBe(false);
  });

  it("nárok platný ještě hodinu modul zapíná – poslední den se pracuje dál", () => {
    const v = vyhodnotNaroky(
      [radek({ module: "access", valid_until: "2026-09-07T13:00:00.000Z" })],
      TED,
    );
    expect(v.modules.has("access")).toBe(true);
  });

  it("odebraný nárok (active = false) modul nezapíná ani s platností do budoucna", () => {
    const v = vyhodnotNaroky(
      [radek({ module: "sms", active: false, valid_until: "2027-01-01T00:00:00.000Z" })],
      TED,
    );
    expect(v.modules.has("sms")).toBe(false);
  });

  it("počet kusů se bere jen z platných nároků", () => {
    const v = vyhodnotNaroky(
      [
        radek({ module: "branches", quota: 5 }),
        radek({ module: "sms", quota: 300, valid_until: "2026-09-01T00:00:00.000Z" }),
      ],
      TED,
    );
    expect(v.quotas.branches).toBe(5);
    expect(v.quotas.sms).toBeUndefined();
  });

  /**
   * Zkušební období se pozná podle nároku „access“ – podle něj se aplikace
   * zamyká. Dřív se bralo nejzazší datum ze všech modulů, takže platícímu
   * servisu s doplňkem na dobu určitou proužek tvrdil, že mu končí zkušební
   * období a aplikace se zamkne. Nezamkla se; jen ho to strašilo.
   */
  it("konec zkušebního období se čte z nároku „access“, ne z doplňků", () => {
    const v = vyhodnotNaroky(
      [
        radek({ module: "access" }),
        radek({ module: "sms", valid_until: "2026-09-09T00:00:00.000Z" }),
        radek({ module: "branches", valid_until: "2026-12-01T00:00:00.000Z" }),
      ],
      TED,
    );
    expect(v.trialEndsAt).toBeNull();
  });

  it("zkušební servis má konec podle „access“, i když jiný modul platí déle", () => {
    const v = vyhodnotNaroky(
      [
        radek({ module: "access", valid_until: "2026-09-20T00:00:00.000Z" }),
        radek({ module: "invoices", valid_until: "2026-10-31T00:00:00.000Z" }),
      ],
      TED,
    );
    expect(v.trialEndsAt).toBe("2026-09-20T00:00:00.000Z");
  });

  /**
   * Po vypršení musí datum zůstat: aplikace pak umí říct „zkušební období
   * skončilo“. Kdyby zmizelo s modulem, obrazovka by mlčky zhasla.
   */
  it("po vypršení „access“ zůstává datum, aby šlo říct, že období skončilo", () => {
    const v = vyhodnotNaroky(
      [radek({ module: "access", valid_until: "2026-09-01T00:00:00.000Z" })],
      TED,
    );
    expect(v.modules.has("access")).toBe(false);
    expect(v.trialEndsAt).toBe("2026-09-01T00:00:00.000Z");
  });

  it("servis bez jediného nároku nemá nic a nic se neodpočítává", () => {
    const v = vyhodnotNaroky([], TED);
    expect(v.modules.size).toBe(0);
    expect(v.trialEndsAt).toBeNull();
  });
});

describe("odpočet zbývajících dní", () => {
  it("bez konce se nic neodpočítává", () => {
    expect(zbyvaDni(null, TED)).toBeNull();
  });

  it("poslední den zkušebního období hlásí jeden den, ne nulu", () => {
    // Zbývá pár hodin – uživatel má pracovat dál a vidět varování.
    expect(zbyvaDni("2026-09-07T20:00:00.000Z", TED)).toBe(1);
  });

  it("přesně v okamžiku konce je nula – aplikace se zamyká", () => {
    expect(zbyvaDni("2026-09-07T12:00:00.000Z", TED)).toBe(0);
  });

  it("den po konci je záporný", () => {
    expect(zbyvaDni("2026-09-06T12:00:00.000Z", TED)).toBeLessThan(0);
  });

  it("třicetidenní zkušební období od založení servisu hlásí 30 dní", () => {
    const konec = new Date(TED + 30 * 86_400_000).toISOString();
    expect(zbyvaDni(konec, TED)).toBe(30);
  });
});
