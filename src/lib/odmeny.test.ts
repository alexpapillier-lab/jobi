import { describe, it, expect } from "vitest";
import { castkaOdmeny, hraniceMesice, klicMesice, najdiPravidlo, nazevMesice, normalizujOdmeny, posunKlicMesice, zamestnanecMesice, type PravidloOdmeny } from "./odmeny";

const pravidlo = (p: Partial<PravidloOdmeny>): PravidloOdmeny => ({
  id: "x", nazev: "", hledat: "čištění", typ: "castka", hodnota: 100, komu: "pridal", aktivni: true, ...p,
});

describe("čtení nastavení z configu", () => {
  it("rozbité a prázdné položky se přeskočí, výchozí je veřejný žebříček", () => {
    const n = normalizujOdmeny({
      pravidla: [
        { id: "a", nazev: "Čištění", hledat: " Servisní čištění ", typ: "castka", hodnota: "100", komu: "pridal" },
        { hledat: "", hodnota: 5 },
        null,
        { id: "b", hledat: "sklo", typ: "procento", hodnota: "12,5", komu: "technik", aktivni: false },
      ],
    });
    expect(n.verejny_zebricek).toBe(true);
    expect(n.pravidla).toHaveLength(2);
    expect(n.pravidla[0]).toMatchObject({ id: "a", hledat: "Servisní čištění", typ: "castka", hodnota: 100, komu: "pridal", aktivni: true });
    expect(n.pravidla[1]).toMatchObject({ id: "b", typ: "procento", hodnota: 12.5, komu: "technik", aktivni: false });
  });

  it("chybějící config = žádná pravidla, ne pád", () => {
    expect(normalizujOdmeny(undefined)).toEqual({ pravidla: [], verejny_zebricek: true, zobrazit_v_navigaci: false });
    expect(normalizujOdmeny({ verejny_zebricek: false }).verejny_zebricek).toBe(false);
  });

  it("zobrazení v navigaci: výslovně z configu, jinak podle aktivního pravidla", () => {
    const aktivni = { pravidla: [{ hledat: "čištění", hodnota: 100 }] };
    const vypnute = { pravidla: [{ hledat: "čištění", hodnota: 100, aktivni: false }] };
    expect(normalizujOdmeny(aktivni).zobrazit_v_navigaci).toBe(true);
    expect(normalizujOdmeny(vypnute).zobrazit_v_navigaci).toBe(false);
    expect(normalizujOdmeny({ ...vypnute, zobrazit_v_navigaci: true }).zobrazit_v_navigaci).toBe(true);
    expect(normalizujOdmeny({ ...aktivni, zobrazit_v_navigaci: false }).zobrazit_v_navigaci).toBe(false);
  });
});

describe("výběr pravidla a částka", () => {
  const pravidla = [
    pravidlo({ id: "1", hledat: "servisní čištění", hodnota: 100 }),
    pravidlo({ id: "2", hledat: "čištění", hodnota: 50 }),
    pravidlo({ id: "3", hledat: "sklo", typ: "procento", hodnota: 10 }),
    pravidlo({ id: "4", hledat: "těsnění", hodnota: 30, aktivni: false }),
  ];

  it("bere první pravidlo v pořadí, které sedí, bez ohledu na velikost písmen", () => {
    expect(najdiPravidlo(pravidla, "Servisní čištění + výměna filtru")?.id).toBe("1");
    expect(najdiPravidlo(pravidla, "Čištění kartáče")?.id).toBe("2");
  });

  it("vypnuté pravidlo se nepoužije", () => {
    expect(najdiPravidlo(pravidla, "Výměna těsnění cyklonu")).toBeNull();
  });

  it("procento se počítá z ceny opravy, na haléře", () => {
    expect(castkaOdmeny(pravidla[2], 390)).toBe(39);
    expect(castkaOdmeny(pravidla[2], 333.33)).toBe(33.33);
    expect(castkaOdmeny(pravidla[0], 9999)).toBe(100);
  });
});

describe("měsíce", () => {
  it("klíč, posun a název", () => {
    expect(klicMesice(new Date(2026, 8, 26))).toBe("2026-09");
    expect(posunKlicMesice("2026-01", -1)).toBe("2025-12");
    expect(posunKlicMesice("2026-12", 1)).toBe("2027-01");
    expect(nazevMesice("2026-09")).toBe("Září 2026");
  });

  it("hranice měsíce pokrývají celý měsíc včetně poslední milisekundy", () => {
    const h = hraniceMesice("2026-02");
    expect(h.od.getTime()).toBe(new Date(2026, 1, 1).getTime());
    expect(h.do.getTime()).toBe(new Date(2026, 2, 1).getTime() - 1);
  });
});

describe("zaměstnanec měsíce", () => {
  it("nejvyšší částka vyhrává, nepřiřazené řádky nikdy", () => {
    const v = zamestnanecMesice([
      { userId: null, jmeno: "Nepřiřazeno", pocet: 9, castka: 900 },
      { userId: "a", jmeno: "Terka", pocet: 3, castka: 300 },
      { userId: "b", jmeno: "Armani", pocet: 5, castka: 250 },
    ]);
    expect(v.map((x) => x.jmeno)).toEqual(["Terka"]);
  });

  it("remíza v částce rozhoduje počet, úplná remíza = dva vítězové", () => {
    expect(zamestnanecMesice([
      { userId: "a", jmeno: "A", pocet: 2, castka: 200 },
      { userId: "b", jmeno: "B", pocet: 4, castka: 200 },
    ]).map((x) => x.jmeno)).toEqual(["B"]);
    expect(zamestnanecMesice([
      { userId: "a", jmeno: "A", pocet: 2, castka: 200 },
      { userId: "b", jmeno: "B", pocet: 2, castka: 200 },
    ])).toHaveLength(2);
    expect(zamestnanecMesice([])).toEqual([]);
  });
});
