import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Bez klienta se funkce ani nedostane k úložišti; prázdný objekt stačí,
// protože se testuje jen čtení uložené relace, ne volání do cloudu.
vi.mock("../lib/supabaseClient", () => ({
  supabase: {},
  supabaseUrl: "https://test.supabase.co",
  supabaseAnonKey: "anon",
  supabaseFetch: () => Promise.reject(new Error("v testu se nesíťuje")),
  resetTauriFetchState: () => {},
}));

const { isAuthenticated, setAuthenticated } = await import("./Login");

/** Úložiště v paměti se stejným rozhraním, jaké funkce používá (length/key/getItem). */
function pametoveUloziste(polozky: Record<string, string>) {
  const klice = Object.keys(polozky);
  return {
    get length() {
      return klice.length;
    },
    key: (i: number) => klice[i] ?? null,
    getItem: (k: string) => polozky[k] ?? null,
    setItem: () => {},
    removeItem: () => {},
    clear: () => {},
  };
}

function nastavUloziste(u: unknown) {
  Object.defineProperty(globalThis, "localStorage", { value: u, configurable: true, writable: true });
}

const zaHodinu = Math.floor(Date.now() / 1000) + 3600;
const predHodinou = Math.floor(Date.now() / 1000) - 3600;
const KLIC = "sb-abcdefgh-auth-token";

beforeEach(() => {
  nastavUloziste(pametoveUloziste({}));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * Podle tohohle se při startu rozhodne, jestli se ukáže aplikace, nebo
 * přihlašovací obrazovka. Falešné „ano“ pustí uživatele do rozhraní, které
 * mu pak databáze na každý dotaz odmítne; falešné „ne“ ho vyhodí i s
 * rozepsanou zakázkou, přestože platnou relaci má.
 */
describe("rozpoznání přihlášené relace v úložišti", () => {
  it("v prázdném úložišti nikdo přihlášený není", () => {
    expect(isAuthenticated()).toBe(false);
  });

  it("platná relace s dosud neuplynulou platností znamená přihlášeno", () => {
    nastavUloziste(pametoveUloziste({ [KLIC]: JSON.stringify({ access_token: "abc", expires_at: zaHodinu }) }));
    expect(isAuthenticated()).toBe(true);
  });

  it("relace s prošlou platností se nepovažuje za přihlášení", () => {
    nastavUloziste(pametoveUloziste({ [KLIC]: JSON.stringify({ access_token: "abc", expires_at: predHodinou }) }));
    expect(isAuthenticated()).toBe(false);
  });

  it("relace bez uvedené platnosti se bere jako platná – uživatele nevyhodíme", () => {
    nastavUloziste(pametoveUloziste({ [KLIC]: JSON.stringify({ access_token: "abc" }) }));
    expect(isAuthenticated()).toBe(true);
  });

  it("zbytek po starém přihlášení bez tokenu přihlášení nedělá", () => {
    nastavUloziste(pametoveUloziste({ [KLIC]: JSON.stringify({ user: { id: "u1" }, expires_at: zaHodinu }) }));
    expect(isAuthenticated()).toBe(false);
  });

  it("prošlá relace nepřebije platnou uloženou vedle ní", () => {
    nastavUloziste(
      pametoveUloziste({
        "sb-stary-auth-token": JSON.stringify({ access_token: "stary", expires_at: predHodinou }),
        "sb-novy-auth-token": JSON.stringify({ access_token: "novy", expires_at: zaHodinu }),
      })
    );
    expect(isAuthenticated()).toBe(true);
  });

  it("poškozený obsah klíče nespadne a hledá se dál", () => {
    nastavUloziste(
      pametoveUloziste({
        "sb-rozbity-auth-token": "{tohle není JSON",
        "sb-dobry-auth-token": JSON.stringify({ access_token: "abc", expires_at: zaHodinu }),
      })
    );
    expect(isAuthenticated()).toBe(true);
  });

  it("sám poškozený klíč znamená nepřihlášeno, ne výjimku", () => {
    nastavUloziste(pametoveUloziste({ "sb-rozbity-auth-token": "{tohle není JSON" }));
    expect(() => isAuthenticated()).not.toThrow();
    expect(isAuthenticated()).toBe(false);
  });

  it("data aplikace uložená vedle relace se za přihlášení nepovažují", () => {
    nastavUloziste(
      pametoveUloziste({
        jobsheet_theme: "dark",
        jobsheet_active_service: JSON.stringify({ access_token: "tohle není relace" }),
      })
    );
    expect(isAuthenticated()).toBe(false);
  });

  it("nedostupné úložiště (soukromé okno) znamená nepřihlášeno, ne pád aplikace", () => {
    nastavUloziste({
      get length(): number {
        throw new Error("localStorage není k dispozici");
      },
      key: () => null,
      getItem: () => null,
    });
    expect(() => isAuthenticated()).not.toThrow();
    expect(isAuthenticated()).toBe(false);
  });
});

/**
 * Zbytek po dřívějším ručním přepínání přihlášení. Dnes o stavu rozhoduje
 * jen Supabase – kdyby funkce začala něco ukládat, byl by tu druhý zdroj
 * pravdy a ty se rozejdou.
 */
describe("ruční nastavení přihlášení", () => {
  it("nic neukládá a nemění, co se v úložišti najde", () => {
    nastavUloziste(pametoveUloziste({}));
    setAuthenticated(true);
    expect(isAuthenticated()).toBe(false);
  });
});
