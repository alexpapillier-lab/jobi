import { describe, it, expect, beforeEach, vi } from "vitest";
import type { ZaparkovanyUcet } from "./prepinaniUctu";

/**
 * Přepínání účtů a zámek obrazovky na sdíleném počítači.
 *
 * Dvě hlášení majitele (říjen 2026):
 *  1. „Když je k napsání kód a refreshne se stránka, automaticky se
 *     přihlásí.“ – zámek žil jen ve stavu Reactu. Teď je v localStorage.
 *  2. „Kolega se přihlásil místo prvního a stejně ho to dalo na toho
 *     prvního.“ – `signInWithPassword` hlavního klienta nebere zámek relace,
 *     takže obnova tokenu odchozího, která zrovna běžela, přepsala úložiště
 *     zpátky na něj. Teď se cíl přihlásí v odděleném klientovi a nasadí se
 *     pod zámkem relace.
 *
 * Supabase je tu nahrazený modelem, který se chová jako auth-js 2.89 v tom,
 * na čem chyby stojí: relace leží v úložišti pod `sb-…-auth-token`, každá
 * obnova i `getSession` běží pod jedním zámkem, `signInWithPassword` ne.
 */

const KLIC = "sb-test-auth-token";

type Relace = {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  token_type: "bearer";
  user: { id: string; email: string };
};

function relace(id: string, verze = 1): Relace {
  return {
    access_token: `at-${id}-${verze}`,
    refresh_token: `rt-${id}-${verze}`,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    token_type: "bearer",
    user: { id, email: `${id}@jobi.test` },
  };
}

/* ── Zámek relace: jedna fronta jako Web Locks ─────────────────────────── */
let fronta: Promise<unknown> = Promise.resolve();
function vZamku<R>(fn: () => Promise<R>): Promise<R> {
  const r = fronta.then(fn);
  fronta = r.then(() => undefined, () => undefined);
  return r;
}

/** Ruční „síť“: požadavek čeká, dokud ho test nepustí. */
function brana() {
  let pust!: () => void;
  const cekej = new Promise<void>((r) => { pust = r; });
  return { cekej, pust };
}

const piny: Record<string, string> = {};
/** Refresh tokeny, které server už nevezme (spotřebované obnovou nebo odhlášené). */
const mrtveTokeny = new Set<string>();
let hesla: Record<string, string> = {};
/** Brána, na které visí přihlášení heslem / nasazení tokenů v odděleném klientovi. */
let siteDocasneho: Promise<void> | null = null;

function ulozena(): Relace | null {
  const raw = localStorage.getItem(KLIC) ?? sessionStorage.getItem(KLIC);
  return raw ? (JSON.parse(raw) as Relace) : null;
}

/** Hlavní klient: getSession a obnova pod zámkem, signInWithPassword bez něj (jako auth-js). */
const hlavni = {
  storageKey: KLIC,
  async getSession() {
    return vZamku(async () => ({ data: { session: ulozena() } }));
  },
  /** Obnova tokenu přihlášeného (časovač supabase-js, refreshSession() kdekoli v aplikaci). */
  obnov(sit: Promise<void>) {
    return vZamku(async () => {
      const s = ulozena();
      if (!s) return;
      await sit;
      mrtveTokeny.add(s.refresh_token);
      const verze = Number(s.refresh_token.split("-").pop()) + 1;
      localStorage.setItem(KLIC, JSON.stringify({ ...relace(s.user.id, verze) }));
    });
  },
  /** Přihlášení heslem na hlavním klientovi – zámek nebere (auth-js 2.89, GoTrueClient.signInWithPassword). */
  async signInWithPassword({ email }: { email: string }) {
    const id = email.split("@")[0];
    localStorage.setItem(KLIC, JSON.stringify(relace(id, 1)));
    return { data: { session: relace(id, 1) }, error: null };
  },
};

vi.mock("./supabaseClient", () => ({
  supabase: {
    auth: hlavni,
    async rpc(nazev: string, args: { p_user: string; p_pin?: string }) {
      if (nazev === "over_pin") {
        if (!piny[args.p_user]) return { data: { ok: false, duvod: "bez_pinu" }, error: null };
        return { data: piny[args.p_user] === args.p_pin ? { ok: true } : { ok: false, duvod: "spatny", zbyva: 4 }, error: null };
      }
      if (nazev === "ma_pin") return { data: !!piny[args.p_user], error: null };
      if (nazev === "nastav_pin") return { data: null, error: null };
      return { data: null, error: { message: `neznámé rpc ${nazev}` } };
    },
  },
  klicRelace: () => KLIC,
  vZamkuRelace: <R,>(fn: () => Promise<R>) => vZamku(fn),
  docasnyAuthKlient: () => ({
    async signInWithPassword({ email, password }: { email: string; password: string }) {
      if (siteDocasneho) await siteDocasneho;
      const id = email.split("@")[0];
      if (hesla[id] !== password) return { data: { session: null, user: null }, error: { message: "Invalid login credentials" } };
      return { data: { session: relace(id, 1), user: relace(id, 1).user }, error: null };
    },
    async setSession({ refresh_token }: { access_token: string; refresh_token: string }) {
      if (siteDocasneho) await siteDocasneho;
      if (mrtveTokeny.has(refresh_token)) return { data: { session: null, user: null }, error: { message: "Invalid Refresh Token: Already Used" } };
      const [, id, verze] = refresh_token.split("-");
      // Prošlý access token by supabase-js obnovil; tady stačí platná relace téhož člověka.
      return { data: { session: relace(id, Number(verze)), user: relace(id, 1).user }, error: null };
    },
  }),
}));

vi.mock("./frontaZapisu", () => ({ odesliFrontu: async () => ({ odeslano: 0, zbyva: 0 }) }));
const vycisteno = vi.fn();
vi.mock("./storageInvalidation", () => ({ clearOnSignOut: () => vycisteno() }));

function pametovyStorage() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
    key: (i: number) => [...m.keys()][i] ?? null,
    get length() { return m.size; },
  };
}

const reload = vi.fn();

beforeEach(() => {
  const ls = pametovyStorage();
  const ss = pametovyStorage();
  (globalThis as any).localStorage = ls;
  (globalThis as any).sessionStorage = ss;
  (globalThis as any).window = {
    localStorage: ls,
    sessionStorage: ss,
    dispatchEvent: () => true,
    location: { reload },
  };
  fronta = Promise.resolve();
  for (const k of Object.keys(piny)) delete piny[k];
  mrtveTokeny.clear();
  hesla = { majitel: "heslo-m", technik: "heslo-t" };
  siteDocasneho = null;
  reload.mockReset();
  vycisteno.mockReset();
});

const P = await import("./prepinaniUctu");

function trezor() {
  return P.nactiZaparkovane();
}

describe("chyba 2: kolega se přihlásí, ale aplikace naběhne zase s prvním", () => {
  it("starý postup (signInWithPassword na hlavním klientovi) prohraje závod s obnovou tokenu", async () => {
    // Model původního pridejUcetHeslem: odložit → přihlásit heslem → reload.
    localStorage.setItem(KLIC, JSON.stringify(relace("majitel")));
    const sit = brana();
    await hlavni.getSession(); // zaparkujAktualni
    const obnova = hlavni.obnov(sit.cekej); // obnova majitele už běží (zámek drží ona)
    await new Promise((r) => setTimeout(r, 0)); // přečetla relaci majitele a čeká na server
    await hlavni.signInWithPassword({ email: "technik@jobi.test" }); // bez zámku → zapíše hned
    expect(ulozena()?.user.id).toBe("technik");
    sit.pust();
    await obnova; // obnova majitele dopíše svou relaci až teď…
    expect(ulozena()?.user.id).toBe("majitel"); // …a po reloadu je přihlášený zase majitel
  });

  it("„Přidat účet…“ heslem skončí přihlášeným kolegou i při souběžné obnově tokenu", async () => {
    localStorage.setItem(KLIC, JSON.stringify(relace("majitel")));
    piny.technik = "8765";
    const prihlaseni = brana();
    siteDocasneho = prihlaseni.cekej;

    const prepnuti = P.pridejUcetHeslem("technik@jobi.test", "heslo-t", { nickname: "Majitel", avatarUrl: null });
    // Zatímco se ověřuje heslo, rozběhne se obnova tokenu majitele.
    const sit = brana();
    await Promise.resolve();
    const obnova = hlavni.obnov(sit.cekej);
    prihlaseni.pust();
    await new Promise((r) => setTimeout(r, 0));
    sit.pust();
    await obnova;
    await prepnuti;

    expect(ulozena()?.user.id).toBe("technik");
    // Majitel je na pozadí s tokeny, které platí PO obnově – ne se spotřebovaným refresh tokenem.
    const [m] = trezor();
    expect(m.userId).toBe("majitel");
    expect(m.refreshToken).toBe("rt-majitel-2");
    expect(mrtveTokeny.has(m.refreshToken)).toBe(false);
    expect(m.nickname).toBe("Majitel");
    expect(reload).toHaveBeenCalledTimes(1);
    expect(vycisteno).toHaveBeenCalled();
  });

  it("přepnutí PINem nasadí cíl pod zámkem i při souběžné obnově odchozího", async () => {
    localStorage.setItem(KLIC, JSON.stringify(relace("majitel")));
    const t = relace("technik", 3);
    P.ulozZaparkovane([{ userId: "technik", email: "technik@jobi.test", nickname: null, avatarUrl: null, refreshToken: t.refresh_token, accessToken: t.access_token, zaparkovanoV: "" }]);
    piny.technik = "8765";
    const overeni = brana();
    siteDocasneho = overeni.cekej;

    const prepnuti = P.prepniNaUcet(trezor()[0], "8765", null, "majitel");
    const sit = brana();
    await new Promise((r) => setTimeout(r, 0));
    const obnova = hlavni.obnov(sit.cekej);
    overeni.pust();
    await new Promise((r) => setTimeout(r, 0));
    sit.pust();
    await obnova;
    await prepnuti;

    expect(ulozena()?.user.id).toBe("technik");
    expect(trezor().map((u) => [u.userId, u.refreshToken])).toEqual([["majitel", "rt-majitel-2"]]);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("mrtvý token cíle: odchozí zůstane přihlášený, cíl z trezoru pryč, bez reloadu", async () => {
    localStorage.setItem(KLIC, JSON.stringify(relace("majitel")));
    const t = relace("technik", 1);
    mrtveTokeny.add(t.refresh_token);
    P.ulozZaparkovane([{ userId: "technik", email: null, nickname: null, avatarUrl: null, refreshToken: t.refresh_token, accessToken: t.access_token, zaparkovanoV: "" }]);
    piny.technik = "8765";
    P.zamkniObrazovku("majitel");

    await expect(P.prepniNaUcet(trezor()[0], "8765", null, "majitel")).rejects.toThrow(/vypršelo/);
    expect(ulozena()?.user.id).toBe("majitel");
    expect(trezor()).toEqual([]);
    expect(reload).not.toHaveBeenCalled();
    // Nepovedené přepnutí ze zámku zámek nezruší.
    expect(P.zamcenaObrazovka("majitel")).toBe(true);
  });

  it("špatné heslo nic nezmění: přihlášený zůstává, do trezoru se nic nepřidá", async () => {
    localStorage.setItem(KLIC, JSON.stringify(relace("majitel")));
    P.zamkniObrazovku("majitel");
    await expect(P.pridejUcetHeslem("technik@jobi.test", "spatne", null)).rejects.toThrow("Nesprávný e-mail nebo heslo.");
    expect(ulozena()?.user.id).toBe("majitel");
    expect(trezor()).toEqual([]);
    expect(P.zamcenaObrazovka("majitel")).toBe(true);
    expect(reload).not.toHaveBeenCalled();
  });

  it("úložiště relaci nepřijme: přepnutí selže nahlas a odchozí v trezoru nezůstane", async () => {
    localStorage.setItem(KLIC, JSON.stringify(relace("majitel")));
    const puvodni = localStorage.setItem;
    (localStorage as any).setItem = (k: string, v: string) => {
      if (k === KLIC) throw new Error("QuotaExceededError");
      puvodni(k, v);
    };
    await expect(P.pridejUcetHeslem("technik@jobi.test", "heslo-t", null)).rejects.toThrow(/nepodařilo uložit/);
    expect(ulozena()?.user.id).toBe("majitel");
    expect(trezor()).toEqual([]);
    expect(reload).not.toHaveBeenCalled();
  });

  it("účet bez PINu: relace přepnutá, krok „Nastavte si PIN“ přežije F5, dokončení ho zruší", async () => {
    localStorage.setItem(KLIC, JSON.stringify(relace("majitel")));
    P.zamkniObrazovku("majitel");
    const { potrebujePin } = await P.pridejUcetHeslem("technik@jobi.test", "heslo-t", null);
    expect(potrebujePin).toBe(true);
    expect(ulozena()?.user.id).toBe("technik");
    expect(P.cekaNaPin()).toBe("technik");
    // Kolega se ověřil heslem – jeho relace zamčená není. Zámek majitele
    // zůstává jeho: k němu se dá vrátit zase jen PINem nebo heslem.
    expect(P.zamcenaObrazovka("technik")).toBe(false);
    expect(P.zamcenaObrazovka("majitel")).toBe(true);
    // Stránka se znovu načte hned a krok s PINem ukáže až ta načtená –
    // jinak by ho pozdější znovunačtení (druhá záložka) smazalo uprostřed psaní.
    expect(reload).toHaveBeenCalledTimes(1);
    P.dokonciPrepnuti();
    expect(P.cekaNaPin()).toBeNull();
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it("přihlášený se na zámku přihlásí heslem sám za sebe – nezaparkuje se", async () => {
    localStorage.setItem(KLIC, JSON.stringify(relace("majitel")));
    piny.majitel = "1234";
    P.zamkniObrazovku("majitel");
    await P.pridejUcetHeslem("majitel@jobi.test", "heslo-m", null, "majitel");
    expect(ulozena()?.user.id).toBe("majitel");
    expect(trezor()).toEqual([]);
    expect(P.zamcenaObrazovka("majitel")).toBe(false);
  });

  it("druhá záložka pozná, že se v úložišti změnil přihlášený", () => {
    expect(P.jinyClovekVUlozisti(JSON.stringify(relace("technik")), "majitel")).toBe(true);
    expect(P.jinyClovekVUlozisti(JSON.stringify(relace("majitel", 2)), "majitel")).toBe(false);
    expect(P.jinyClovekVUlozisti(null, "majitel")).toBe(false);
    expect(P.jinyClovekVUlozisti("{rozbité", "majitel")).toBe(false);
  });
});

describe("chyba 1: zámek obrazovky přežije obnovení stránky", () => {
  it("zamčení je v localStorage – nové načtení (i jiná záložka) ho vidí", () => {
    expect(P.zamcenaObrazovka("majitel")).toBe(false);
    P.zamkniObrazovku("majitel");
    expect(P.zamcenaObrazovka("majitel")).toBe(true);
    expect(localStorage.getItem(P.KLIC_ZAMCENO)).not.toBeNull();
  });

  it("poškozený záznam se bere jako zamčeno; ověření ho zahodí", () => {
    localStorage.setItem(P.KLIC_ZAMCENO, "{nesmysl");
    expect(P.zamcenaObrazovka("kdokoli")).toBe(true);
    P.odemkniObrazovku(["majitel"]);
    expect(P.zamcenaObrazovka("kdokoli")).toBe(false);
    expect(localStorage.getItem(P.KLIC_ZAMCENO)).toBeNull();
  });

  it("když localStorage nejde zapsat, zámek se drží aspoň v sessionStorage", () => {
    (localStorage as any).setItem = () => { throw new Error("QuotaExceededError"); };
    P.zamkniObrazovku("majitel");
    expect(P.zamcenaObrazovka("majitel")).toBe(true);
  });

  it("špatný PIN zámek nezruší, správný ano", async () => {
    piny.majitel = "1234";
    P.zamkniObrazovku("majitel");
    await expect(P.odemkniAktualni("majitel", "0000")).rejects.toThrow(/Nesprávný PIN/);
    expect(P.zamcenaObrazovka("majitel")).toBe(true);
    await P.odemkniAktualni("majitel", "1234");
    expect(P.zamcenaObrazovka("majitel")).toBe(false);
    expect(localStorage.getItem(P.KLIC_ZAMCENO)).toBeNull();
  });

  it("ověření kolegy (heslo v jiné záložce) neodemkne zámek přihlášeného", () => {
    P.zamkniObrazovku("majitel");
    P.odemkniObrazovku(["technik"]);
    expect(P.zamcenaObrazovka("majitel")).toBe(true);
    expect(P.zamcenaObrazovka("technik")).toBe(false);
  });

  it("přepnutí PINem na kolegu zámek zruší až po nasazení jeho relace", async () => {
    localStorage.setItem(KLIC, JSON.stringify(relace("majitel")));
    const t = relace("technik");
    P.ulozZaparkovane([{ userId: "technik", email: null, nickname: null, avatarUrl: null, refreshToken: t.refresh_token, accessToken: t.access_token, zaparkovanoV: "" }]);
    piny.technik = "8765";
    P.zamkniObrazovku("majitel");
    const overeni = brana();
    siteDocasneho = overeni.cekej;
    const prepnuti = P.prepniNaUcet(trezor()[0], "8765", null, "majitel");
    await new Promise((r) => setTimeout(r, 0));
    // „F5“ uprostřed: cíl ještě není nasazený a zámek pořád platí.
    expect(ulozena()?.user.id).toBe("majitel");
    expect(P.zamcenaObrazovka("majitel")).toBe(true);
    overeni.pust();
    await prepnuti;
    expect(ulozena()?.user.id).toBe("technik");
    expect(P.zamcenaObrazovka("technik")).toBe(false);
    // Majitel je na pozadí a pořád zamčený – zpátky jen jeho PINem.
    expect(P.zamcenaObrazovka("majitel")).toBe(true);
  });

  it("přepnutí PINem na kolegu, který byl zamčený, jeho zámek zruší", async () => {
    localStorage.setItem(KLIC, JSON.stringify(relace("majitel")));
    const t = relace("technik");
    P.ulozZaparkovane([{ userId: "technik", email: null, nickname: null, avatarUrl: null, refreshToken: t.refresh_token, accessToken: t.access_token, zaparkovanoV: "" }]);
    piny.technik = "8765";
    P.zamkniObrazovku("technik");
    await P.prepniNaUcet(trezor()[0], "8765", null, "majitel");
    expect(ulozena()?.user.id).toBe("technik");
    expect(P.zamcenaObrazovka("technik")).toBe(false);
  });

  it("špatný PIN kolegy: nic se nepřepne a zámek zůstává", async () => {
    localStorage.setItem(KLIC, JSON.stringify(relace("majitel")));
    const t = relace("technik");
    P.ulozZaparkovane([{ userId: "technik", email: null, nickname: null, avatarUrl: null, refreshToken: t.refresh_token, accessToken: t.access_token, zaparkovanoV: "" }]);
    piny.technik = "8765";
    P.zamkniObrazovku("majitel");
    await expect(P.prepniNaUcet(trezor()[0], "1111", null, "majitel")).rejects.toThrow(/Nesprávný PIN/);
    expect(ulozena()?.user.id).toBe("majitel");
    expect(P.zamcenaObrazovka("majitel")).toBe(true);
    expect(reload).not.toHaveBeenCalled();
  });
});

/* ── Původní testy trezoru a PINu ─────────────────────────────────────── */

/** Úložiště v paměti – testy nesmí sahat na skutečný localStorage. */
function pamet() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => { m.set(k, v); },
    removeItem: (k: string) => { m.delete(k); },
    dump: () => Object.fromEntries(m),
  };
}

const ucet = (id: string, kdy = "2026-09-08T10:00:00Z"): ZaparkovanyUcet => ({
  userId: id, email: `${id}@jobi.test`, nickname: id, avatarUrl: null,
  refreshToken: `r-${id}`, accessToken: `a-${id}`, zaparkovanoV: kdy,
});

describe("trezor zaparkovaných účtů", () => {
  it("prázdné úložiště = nikdo", () => {
    expect(P.nactiZaparkovane(pamet())).toEqual([]);
  });

  it("uloží a načte, poslední zaparkovaný je první", () => {
    const s = pamet();
    P.ulozZaparkovane(P.pridejZaparkovany(P.pridejZaparkovany([], ucet("a")), ucet("b")), s);
    expect(P.nactiZaparkovane(s).map((u) => u.userId)).toEqual(["b", "a"]);
  });

  it("tentýž účet nahradí (novější tokeny), nezdvojí", () => {
    const seznam = P.pridejZaparkovany([ucet("a"), ucet("b")], { ...ucet("a"), refreshToken: "r-a-2" });
    expect(seznam.map((u) => u.userId)).toEqual(["a", "b"]);
    expect(seznam[0].refreshToken).toBe("r-a-2");
  });

  it("odebrání smaže klíč, když nikdo nezbyl", () => {
    const s = pamet();
    P.ulozZaparkovane([ucet("a")], s);
    P.ulozZaparkovane(P.odeberZaparkovany(P.nactiZaparkovane(s), "a"), s);
    expect(s.getItem(P.KLIC_ZAPARKOVANE)).toBeNull();
  });

  it("poškozený nebo cizí obsah nepustí dál", () => {
    const s = pamet();
    s.setItem(P.KLIC_ZAPARKOVANE, "{nic");
    expect(P.nactiZaparkovane(s)).toEqual([]);
    s.setItem(P.KLIC_ZAPARKOVANE, JSON.stringify([{ userId: "x" }, ucet("ok")]));
    expect(P.nactiZaparkovane(s).map((u) => u.userId)).toEqual(["ok"]);
  });
});

describe("PIN a zámek", () => {
  it("PIN jsou přesně čtyři číslice", () => {
    expect(P.jePlatnyPin("1234")).toBe(true);
    expect(P.jePlatnyPin("123")).toBe(false);
    expect(P.jePlatnyPin("12345")).toBe(false);
    expect(P.jePlatnyPin("12a4")).toBe(false);
  });

  it("hlášky říkají, kolik zbývá a kdy se odemkne", () => {
    expect(P.hlaskaPinu({ ok: false, duvod: "spatny", zbyva: 1 })).toContain("1 pokus");
    expect(P.hlaskaPinu({ ok: false, duvod: "spatny", zbyva: 3 })).toContain("3 pokusy");
    expect(P.hlaskaPinu({ ok: false, duvod: "bez_pinu" })).toContain("heslem");
    expect(P.hlaskaPinu({ ok: false, duvod: "zamceno", zamceno_do: new Date(Date.now() + 4 * 60000).toISOString() })).toContain("4 min");
    expect(P.hlaskaPinu({ ok: true })).toBe("");
  });

  it("zámek po nečinnosti bere jen známé hodnoty, 0 klíč maže", () => {
    const s = pamet();
    P.nastavZamekPoMinutach(5, s);
    expect(P.zamekPoMinutach(s)).toBe(5);
    s.setItem(P.KLIC_ZAMEK, "7");
    expect(P.zamekPoMinutach(s)).toBe(0);
    P.nastavZamekPoMinutach(0, s);
    expect(s.getItem(P.KLIC_ZAMEK)).toBeNull();
  });
});
