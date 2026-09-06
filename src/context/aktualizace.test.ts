/**
 * Aktualizace desktopové aplikace (tauri-plugin-updater).
 *
 * Updater existuje jen v desktopu a jeho selhání se u zákazníka projeví tím,
 * že aplikace roky běží na staré verzi a nikdo neví proč. Testuje se proto
 * to, co uživatel skutečně uvidí: že „nic nového“ není chyba, že přechodný
 * výpadek sítě se sám zkusí znovu a že špatný podpis skončí srozumitelnou
 * hláškou, ne technickým textem z Rustu.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { jeSitovaChyba, humanizeUpdateError, zkontrolujSOpakovanim, pripravUpdateKeStazeni, hlaskaSelhaniRestartu } from "./AppUpdateContext";

const stav = vi.hoisted(() => ({
  odpovedi: [] as Array<() => unknown>,
  volani: [] as Array<unknown>,
}));

vi.mock("@tauri-apps/plugin-updater", () => ({
  check: async (options?: unknown) => {
    stav.volani.push(options);
    const dalsi = stav.odpovedi.shift();
    if (!dalsi) throw new Error("test nepřipravil odpověď");
    return dalsi();
  },
}));

beforeEach(() => {
  stav.odpovedi = [];
  stav.volani = [];
});

afterEach(() => {
  vi.useRealTimers();
});

describe("rozpoznání přechodné síťové chyby", () => {
  it("bere hlášky z Rustu i z prohlížeče", () => {
    for (const m of [
      "error sending request for url",
      "Network is unreachable",
      "Failed to fetch",
      "operation timed out",
      "dns error",
      "connection reset by peer",
      "Broken pipe",
    ]) {
      expect(jeSitovaChyba(m), m).toBe(true);
    }
  });

  it("chybu podpisu nepovažuje za síťovou – opakování by ji nespravilo", () => {
    expect(jeSitovaChyba("signature verification failed")).toBe(false);
    expect(jeSitovaChyba("Permission denied (os error 13)")).toBe(false);
  });
});

describe("hláška pro uživatele", () => {
  it("výpadek sítě říká, že se to zkusí samo", () => {
    expect(humanizeUpdateError(new Error("error sending request"))).toContain("Zkusí se to znovu");
  });

  it("neplatný podpis se pojmenuje, aby bylo jasné, že se nic nenainstalovalo", () => {
    const t = humanizeUpdateError(new Error("Signature verification failed"));
    expect(t).toContain("podpisu");
    expect(t).toContain("nenainstalovala");
  });

  it("aplikace spuštěná z DMG poradí přesunout se do Aplikací", () => {
    expect(humanizeUpdateError(new Error("Permission denied"))).toContain("Aplikace");
  });

  it("neznámou chybu nezamlčí ani nepřepíše", () => {
    expect(humanizeUpdateError(new Error("io error: no space left on device"))).toBe("io error: no space left on device");
    expect(humanizeUpdateError("holý řetězec")).toBe("holý řetězec");
  });
});

describe("kontrola aktualizace s opakováním", () => {
  it("žádná nová verze není chyba – vrací null", async () => {
    stav.odpovedi = [() => null];
    await expect(zkontrolujSOpakovanim()).resolves.toBeNull();
  });

  it("dotaz má timeout, aby se kontrola nezasekla napořád", async () => {
    stav.odpovedi = [() => null];
    await zkontrolujSOpakovanim();
    expect(stav.volani[0]).toEqual({ timeout: 15000 });
  });

  it("po probuzení Macu se první selhání sítě zkusí znovu", async () => {
    vi.useFakeTimers();
    stav.odpovedi = [
      () => {
        throw new Error("error sending request for url");
      },
      () => ({ version: "0.6.0" }),
    ];
    const beh = zkontrolujSOpakovanim();
    await vi.advanceTimersByTimeAsync(2000);
    await expect(beh).resolves.toEqual({ version: "0.6.0" });
    expect(stav.volani).toHaveLength(2);
  });

  it("po třech pokusech to vzdá a chybu předá dál", async () => {
    vi.useFakeTimers();
    const sit = () => {
      throw new Error("error sending request for url");
    };
    stav.odpovedi = [sit, sit, sit];
    const beh = zkontrolujSOpakovanim();
    const overeni = expect(beh).rejects.toThrow("error sending request");
    await vi.advanceTimersByTimeAsync(7000);
    await overeni;
    expect(stav.volani).toHaveLength(3);
  });

  it("chybu podpisu nezkouší znovu – opakování by nic nezměnilo", async () => {
    stav.odpovedi = [
      () => {
        throw new Error("signature verification failed");
      },
      () => ({ version: "0.6.0" }),
    ];
    await expect(zkontrolujSOpakovanim()).rejects.toThrow("signature");
    expect(stav.volani).toHaveLength(1);
  });
});

/**
 * Kliknutí na „Stáhnout“, když objekt Update ještě nemáme.
 *
 * Tohle je místo, kde se chyba dřív ztrácela: kontrola běžela mimo `try`,
 * takže odmítnutý příslib nikdo nezachytil – oba volající ho zahazují
 * (`void appUpdate.downloadAndInstall()` v App.tsx, `onClick` v
 * AppUpdateCard.tsx). Uživatel klikl a nestalo se vůbec nic.
 */
describe("příprava stažení po kliknutí uživatele", () => {
  it("známou verzi z předchozí kontroly neověřuje znovu", async () => {
    const uz = { version: "0.6.0" } as never;
    const vysledek = await pripravUpdateKeStazeni(uz, async () => {
      throw new Error("kontrola se neměla volat");
    });
    expect(vysledek).toEqual({ stav: "ok", update: uz });
  });

  it("výpadek sítě skončí hláškou pro uživatele, ne odmítnutým příslibem", async () => {
    const vysledek = await pripravUpdateKeStazeni(null, async () => {
      throw new Error("error sending request for url");
    });
    expect(vysledek.stav).toBe("chyba");
    if (vysledek.stav !== "chyba") throw new Error("nedosažitelné");
    expect(vysledek.hlaska).toContain("spojit se serverem");
  });

  it("chyba se nikdy nepropíše ven jako výjimka – volající ji zahazují", async () => {
    await expect(
      pripravUpdateKeStazeni(null, async () => {
        throw new Error("cokoliv nečekaného");
      })
    ).resolves.toMatchObject({ stav: "chyba" });
  });

  it("mezitím stažené vydání je „žádná verze“, ne chyba", async () => {
    // Vydání se dá z GitHubu stáhnout zpět; pak kontrola vrátí null.
    expect(await pripravUpdateKeStazeni(null, async () => null)).toEqual({ stav: "zadny" });
  });

  it("nalezenou verzi předá ke stažení", async () => {
    const nova = { version: "0.6.0" } as never;
    expect(await pripravUpdateKeStazeni(null, async () => nova)).toEqual({ stav: "ok", update: nova });
  });
});

describe("selhání restartu do stažené verze", () => {
  it("řekne, že stažená verze nezmizela – jinak by ji uživatel stahoval znovu", () => {
    const t = hlaskaSelhaniRestartu(new Error("os error 1"));
    expect(t).toContain("Restart se nezdařil");
    expect(t).toContain("nainstaluje sama");
  });

  it("i tady se technická hláška přeloží do lidské řeči", () => {
    expect(hlaskaSelhaniRestartu(new Error("Permission denied"))).toContain("oprávnění");
  });
});
