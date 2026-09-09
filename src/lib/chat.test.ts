import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  KANAL_SERVIS,
  KLIC_FRONTY,
  MAX_STARI_FRONTY_MS,
  MAX_VE_FRONTE,
  formatCasZpravy,
  frontaJakoZpravy,
  inicialy,
  jePlatnyKlic,
  kanalZpravy,
  klicKanalu,
  mapujZpravu,
  nactiFrontu,
  nahledZpravy,
  najdiRozepsanouZminku,
  odeberZFronty,
  prepniReakci,
  pridejDoFronty,
  proberFrontu,
  rozdelTextPodleZminek,
  rozlozKlic,
  seradKanaly,
  sloupceKanalu,
  souhrnNeprectenych,
  textZminky,
  ulozFrontu,
  vlozZminku,
  zminkyVTextu,
  type Kanal,
  type NeodeslanaZprava,
  type Zminka,
} from "./chat";
import { maUpozornit } from "./chatUpozorneni";

/* Databáze tu není – knihovna se dá načíst i bez klienta. */
vi.mock("./supabaseClient", () => ({ supabase: null }));

describe("klíče kanálů", () => {
  it("skládá a rozkládá klíč", () => {
    expect(klicKanalu("servis")).toBe("servis");
    expect(klicKanalu("pobocka", "b1")).toBe("pobocka:b1");
    expect(klicKanalu("dm", "u2")).toBe("dm:u2");
    expect(rozlozKlic("pobocka:b1")).toEqual({ typ: "pobocka", id: "b1" });
    expect(rozlozKlic("dm:u2")).toEqual({ typ: "dm", id: "u2" });
    expect(rozlozKlic("servis")).toEqual({ typ: "servis", id: null });
  });

  it("neznámý klíč bere jako servis a nepovažuje ho za platný", () => {
    expect(rozlozKlic("cokoliv")).toEqual({ typ: "servis", id: null });
    expect(jePlatnyKlic("cokoliv")).toBe(false);
    expect(jePlatnyKlic("dm:")).toBe(false);
    expect(jePlatnyKlic("pobocka:x")).toBe(true);
  });

  it("kanál pobočky/DM bez id je chyba", () => {
    expect(() => klicKanalu("dm")).toThrow();
  });

  it("kanál zprávy: u DM je to vždy ten druhý", () => {
    const ja = "ja";
    expect(kanalZpravy({ branchId: null, recipientId: null, senderId: "x" }, ja)).toBe(KANAL_SERVIS);
    expect(kanalZpravy({ branchId: "b1", recipientId: null, senderId: "x" }, ja)).toBe("pobocka:b1");
    expect(kanalZpravy({ branchId: null, recipientId: "on", senderId: ja }, ja)).toBe("dm:on");
    expect(kanalZpravy({ branchId: null, recipientId: ja, senderId: "on" }, ja)).toBe("dm:on");
  });

  it("sloupce pro zápis odpovídají klíči", () => {
    expect(sloupceKanalu("servis")).toEqual({ branch_id: null, recipient_id: null });
    expect(sloupceKanalu("pobocka:b1")).toEqual({ branch_id: "b1", recipient_id: null });
    expect(sloupceKanalu("dm:u2")).toEqual({ branch_id: null, recipient_id: "u2" });
  });

  it("řadí servis, pobočky, lidi a drží pořadí ze serveru", () => {
    const k = (kanal: string, typ: Kanal["typ"]): Kanal => ({ kanal, typ, id: null, nazev: kanal, avatarUrl: null });
    const s = seradKanaly([k("dm:b", "dm"), k("pobocka:2", "pobocka"), k("servis", "servis"), k("dm:a", "dm"), k("pobocka:1", "pobocka")]);
    expect(s.map((x) => x.kanal)).toEqual(["servis", "pobocka:2", "pobocka:1", "dm:b", "dm:a"]);
  });
});

describe("zmínky v textu", () => {
  const zakazka: Zminka = { typ: "zakazka", id: "t1", popis: "SN26000012" };
  const zakaznik: Zminka = { typ: "zakaznik", id: "c1", popis: "Pavel Konečný" };
  const clen: Zminka = { typ: "clen", id: "u1", popis: "Aleki" };

  it("rozdělí text podle uložených zmínek, ne podle regexu", () => {
    const casti = rozdelTextPodleZminek("Prosím @Aleki, #SN26000012 pro #Pavel Konečný je hotová. #nezminka", [zakazka, zakaznik, clen]);
    expect(casti).toEqual([
      { typ: "text", text: "Prosím " },
      { typ: "zminka", text: "@Aleki", zminka: clen },
      { typ: "text", text: ", " },
      { typ: "zminka", text: "#SN26000012", zminka: zakazka },
      { typ: "text", text: " pro " },
      { typ: "zminka", text: "#Pavel Konečný", zminka: zakaznik },
      { typ: "text", text: " je hotová. #nezminka" },
    ]);
  });

  it("bez zmínek vrací jeden textový díl; prázdný text nic", () => {
    expect(rozdelTextPodleZminek("ahoj", [])).toEqual([{ typ: "text", text: "ahoj" }]);
    expect(rozdelTextPodleZminek("ahoj", null)).toEqual([{ typ: "text", text: "ahoj" }]);
    expect(rozdelTextPodleZminek("", [zakazka])).toEqual([]);
  });

  it("kratší popis neukousne začátek delšího a zmínka musí končit na hranici slova", () => {
    const kratka: Zminka = { typ: "zakazka", id: "t0", popis: "SN26" };
    const casti = rozdelTextPodleZminek("#SN26000012 a #SN26", [kratka, zakazka]);
    expect(casti).toEqual([
      { typ: "zminka", text: "#SN26000012", zminka: zakazka },
      { typ: "text", text: " a " },
      { typ: "zminka", text: "#SN26", zminka: kratka },
    ]);
  });

  it("stejná zmínka vícekrát v textu se vykreslí pokaždé", () => {
    const casti = rozdelTextPodleZminek("#SN26000012 a zase #SN26000012", [zakazka]);
    expect(casti.filter((c) => c.typ === "zminka")).toHaveLength(2);
  });

  it("zmínka smazaná z textu se do pole nepošle; duplicity se sloučí", () => {
    expect(zminkyVTextu("jen #SN26000012", [zakazka, zakaznik, zakazka])).toEqual([zakazka]);
    expect(textZminky(clen)).toBe("@Aleki");
  });

  it("pozná rozepsanou zmínku před kurzorem", () => {
    expect(najdiRozepsanouZminku("ahoj #SN26", 10)).toEqual({ znak: "#", dotaz: "SN26", od: 5 });
    expect(najdiRozepsanouZminku("@Al", 3)).toEqual({ znak: "@", dotaz: "Al", od: 0 });
    expect(najdiRozepsanouZminku("#Pavel Kon", 10)).toEqual({ znak: "#", dotaz: "Pavel Kon", od: 0 });
  });

  it("nespouští se uprostřed slova, přes řádek ani po delší větě", () => {
    expect(najdiRozepsanouZminku("e-mail@firma.cz", 15)).toBeNull();
    expect(najdiRozepsanouZminku("#SN26\nnový", 10)).toBeNull();
    expect(najdiRozepsanouZminku("#SN26 je hotová a čeká", 22)).toBeNull();
    expect(najdiRozepsanouZminku("# mezera", 8)).toBeNull();
    expect(najdiRozepsanouZminku("bez zminky", 10)).toBeNull();
  });

  it("vloží vybranou zmínku místo rozepsané a posune kurzor", () => {
    const text = "ahoj #SN26 díky";
    const r = najdiRozepsanouZminku(text, 10)!;
    const v = vlozZminku(text, r, zakazka, 10);
    expect(v.text).toBe("ahoj #SN26000012  díky");
    expect(v.kurzor).toBe("ahoj #SN26000012 ".length);
  });
});

describe("fronta neodeslaných", () => {
  const polozka = (id: string, vlozeno = 1000): NeodeslanaZprava => ({
    id,
    serviceId: "s1",
    kanal: "servis",
    senderId: "ja",
    text: `zpráva ${id}`,
    mentions: [],
    attachments: [],
    vlozeno,
    pokusy: 0,
  });

  it("stejné id nahradí, přetečení zahodí nejstarší", () => {
    let f = pridejDoFronty([], polozka("a"));
    f = pridejDoFronty(f, { ...polozka("a"), text: "nová" });
    expect(f).toHaveLength(1);
    expect(f[0].text).toBe("nová");
    for (let i = 0; i < MAX_VE_FRONTE + 5; i++) f = pridejDoFronty(f, polozka(`x${i}`));
    expect(f).toHaveLength(MAX_VE_FRONTE);
    expect(f[0].id).toBe("x5");
  });

  it("odebírá a probírá staré", () => {
    const f = [polozka("a", 0), polozka("b", 5_000)];
    expect(odeberZFronty(f, "a").map((p) => p.id)).toEqual(["b"]);
    expect(proberFrontu(f, MAX_STARI_FRONTY_MS + 1000).map((p) => p.id)).toEqual(["b"]);
  });

  it("převádí položky na zprávy ve stavu odesílá se / chyba jen pro daný kanál", () => {
    const z = frontaJakoZpravy([polozka("a"), { ...polozka("b"), kanal: "dm:on", pokusy: 2 }, { ...polozka("c"), serviceId: "jiny" }], "s1", "dm:on");
    expect(z).toHaveLength(1);
    expect(z[0]).toMatchObject({ id: "b", recipientId: "on", branchId: null, stav: "chyba", senderId: "ja" });
    expect(frontaJakoZpravy([polozka("a")], "s1", "servis")[0].stav).toBe("odesila");
  });

  describe("localStorage", () => {
    const sklad = new Map<string, string>();
    beforeEach(() => {
      sklad.clear();
      vi.stubGlobal("localStorage", {
        getItem: (k: string) => sklad.get(k) ?? null,
        setItem: (k: string, v: string) => void sklad.set(k, v),
        removeItem: (k: string) => void sklad.delete(k),
      });
    });

    it("ukládá a načítá, poškozený obsah ignoruje", () => {
      ulozFrontu([polozka("a")]);
      expect(nactiFrontu().map((p) => p.id)).toEqual(["a"]);
      sklad.set(KLIC_FRONTY, "{rozbité");
      expect(nactiFrontu()).toEqual([]);
      sklad.set(KLIC_FRONTY, JSON.stringify([{ id: "bez-kanalu" }, polozka("b")]));
      expect(nactiFrontu().map((p) => p.id)).toEqual(["b"]);
    });
  });
});

describe("drobnosti", () => {
  it("přepíná reakci", () => {
    const a = prepniReakci([], "m", "ja", "👍");
    expect(a.pridano).toBe(true);
    expect(a.reakce).toHaveLength(1);
    const b = prepniReakci(a.reakce, "m", "ja", "👍");
    expect(b.pridano).toBe(false);
    expect(b.reakce).toHaveLength(0);
  });

  it("iniciály a náhled", () => {
    expect(inicialy("Pavel Konečný")).toBe("PK");
    expect(inicialy("Aleki")).toBe("A");
    expect(inicialy("")).toBe("?");
    expect(nahledZpravy({ text: "a\n\nb", attachments: [], deletedAt: null })).toBe("a b");
    expect(nahledZpravy({ text: "", attachments: [{ path: "p", name: "x.pdf", type: "", size: 1 }], deletedAt: null })).toBe("📎 x.pdf");
    expect(nahledZpravy({ text: "x", attachments: [], deletedAt: "2026-01-01" })).toBe("Zpráva smazána");
  });

  it("čas zprávy: dnes jen hodina, tenhle týden den, jinak datum", () => {
    const ted = new Date(2026, 8, 8, 15, 0);
    expect(formatCasZpravy(new Date(2026, 8, 8, 9, 5).toISOString(), ted)).toBe("9:05");
    expect(formatCasZpravy(new Date(2026, 8, 6, 9, 5).toISOString(), ted)).toBe("ne 9:05");
    expect(formatCasZpravy(new Date(2026, 7, 1, 9, 5).toISOString(), ted)).toBe("1. 8. 9:05");
    expect(formatCasZpravy(new Date(2025, 7, 1, 9, 5).toISOString(), ted)).toBe("1. 8. 2025 9:05");
    expect(formatCasZpravy("nesmysl", ted)).toBe("");
  });

  it("mapuje řádek databáze a vyhazuje vadné zmínky", () => {
    const z = mapujZpravu({ id: 1, service_id: "s", sender_id: "u", text: "t", mentions: [{ typ: "zakazka", id: "x", popis: "SN1" }, { typ: "blbost", id: "y" }], attachments: [{ path: "s/u/a.png" }], pinned: true, created_at: "2026-01-01" });
    expect(z.id).toBe("1");
    expect(z.mentions).toEqual([{ typ: "zakazka", id: "x", popis: "SN1" }]);
    expect(z.attachments[0]).toEqual({ path: "s/u/a.png", name: "a.png", type: "", size: 0 });
    expect(z.pinned).toBe(true);
    expect(z.branchId).toBeNull();
  });

  it("součet nepřečtených", () => {
    expect(souhrnNeprectenych({ servis: 2, "dm:a": 3 })).toBe(5);
    expect(souhrnNeprectenych({})).toBe(0);
  });
});

describe("kdy upozornit", () => {
  it("nikdy na vlastní zprávu, jinak jen když ji uživatel zrovna nečte", () => {
    const zaklad = { kanal: "servis", aktivniKanal: "servis", panelOtevren: true, oknoMaFokus: true };
    expect(maUpozornit({ ...zaklad, jeCizi: false })).toBe(false);
    expect(maUpozornit({ ...zaklad, jeCizi: true })).toBe(false);
    expect(maUpozornit({ ...zaklad, jeCizi: true, oknoMaFokus: false })).toBe(true);
    expect(maUpozornit({ ...zaklad, jeCizi: true, panelOtevren: false })).toBe(true);
    expect(maUpozornit({ ...zaklad, jeCizi: true, aktivniKanal: "dm:x" })).toBe(true);
  });
});
