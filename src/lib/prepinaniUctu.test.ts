import { describe, it, expect } from "vitest";
import {
  KLIC_ZAPARKOVANE, KLIC_ZAMEK, hlaskaPinu, jePlatnyPin, nactiZaparkovane, nastavZamekPoMinutach,
  odeberZaparkovany, pridejZaparkovany, ulozZaparkovane, zamekPoMinutach, type ZaparkovanyUcet,
} from "./prepinaniUctu";

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
    expect(nactiZaparkovane(pamet())).toEqual([]);
  });

  it("uloží a načte, poslední zaparkovaný je první", () => {
    const s = pamet();
    ulozZaparkovane(pridejZaparkovany(pridejZaparkovany([], ucet("a")), ucet("b")), s);
    expect(nactiZaparkovane(s).map((u) => u.userId)).toEqual(["b", "a"]);
  });

  it("tentýž účet nahradí (novější tokeny), nezdvojí", () => {
    const seznam = pridejZaparkovany([ucet("a"), ucet("b")], { ...ucet("a"), refreshToken: "r-a-2" });
    expect(seznam.map((u) => u.userId)).toEqual(["a", "b"]);
    expect(seznam[0].refreshToken).toBe("r-a-2");
  });

  it("odebrání smaže klíč, když nikdo nezbyl", () => {
    const s = pamet();
    ulozZaparkovane([ucet("a")], s);
    ulozZaparkovane(odeberZaparkovany(nactiZaparkovane(s), "a"), s);
    expect(s.getItem(KLIC_ZAPARKOVANE)).toBeNull();
  });

  it("poškozený nebo cizí obsah nepustí dál", () => {
    const s = pamet();
    s.setItem(KLIC_ZAPARKOVANE, "{nic");
    expect(nactiZaparkovane(s)).toEqual([]);
    s.setItem(KLIC_ZAPARKOVANE, JSON.stringify([{ userId: "x" }, ucet("ok")]));
    expect(nactiZaparkovane(s).map((u) => u.userId)).toEqual(["ok"]);
  });
});

describe("PIN a zámek", () => {
  it("PIN jsou přesně čtyři číslice", () => {
    expect(jePlatnyPin("1234")).toBe(true);
    expect(jePlatnyPin("123")).toBe(false);
    expect(jePlatnyPin("12345")).toBe(false);
    expect(jePlatnyPin("12a4")).toBe(false);
  });

  it("hlášky říkají, kolik zbývá a kdy se odemkne", () => {
    expect(hlaskaPinu({ ok: false, duvod: "spatny", zbyva: 1 })).toContain("1 pokus");
    expect(hlaskaPinu({ ok: false, duvod: "spatny", zbyva: 3 })).toContain("3 pokusy");
    expect(hlaskaPinu({ ok: false, duvod: "bez_pinu" })).toContain("heslem");
    expect(hlaskaPinu({ ok: false, duvod: "zamceno", zamceno_do: new Date(Date.now() + 4 * 60000).toISOString() })).toContain("4 min");
    expect(hlaskaPinu({ ok: true })).toBe("");
  });

  it("zámek po nečinnosti bere jen známé hodnoty, 0 klíč maže", () => {
    const s = pamet();
    nastavZamekPoMinutach(5, s);
    expect(zamekPoMinutach(s)).toBe(5);
    s.setItem(KLIC_ZAMEK, "7");
    expect(zamekPoMinutach(s)).toBe(0);
    nastavZamekPoMinutach(0, s);
    expect(s.getItem(KLIC_ZAMEK)).toBeNull();
  });
});
