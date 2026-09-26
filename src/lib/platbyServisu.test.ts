import { describe, it, expect } from "vitest";
import { dniPoSplatnosti, kPripomenuti, mesicniPrijem, prevedPlatbu, stavPlatby, type PlatbaServisu } from "./platbyServisu";

const platba = (o: Partial<PlatbaServisu>): PlatbaServisu => ({
  serviceId: "s", nazev: "Servis", aktivniServis: true, cenaMesicne: 990, denPlatby: 15, aktivni: true, poznamka: null,
  maNastaveni: true, obdobi: "2026-09", zaplacenoAt: null, zaplacenoCastka: null, posledniObdobi: null, ...o,
});

describe("stav platby", () => {
  it("před dnem platby čeká, v den platby a 3 dny po něm je k zaplacení, pak po splatnosti", () => {
    expect(stavPlatby(platba({}), new Date(2026, 8, 14))).toBe("ceka");
    expect(stavPlatby(platba({}), new Date(2026, 8, 15))).toBe("splatne");
    expect(stavPlatby(platba({}), new Date(2026, 8, 18))).toBe("splatne");
    expect(stavPlatby(platba({}), new Date(2026, 8, 19))).toBe("po_splatnosti");
  });

  it("zaplacený měsíc je zaplacený bez ohledu na datum; neplatící servis je neaktivní", () => {
    expect(stavPlatby(platba({ zaplacenoAt: "2026-09-16T10:00:00Z" }), new Date(2026, 8, 30))).toBe("zaplaceno");
    expect(stavPlatby(platba({ aktivni: false }), new Date(2026, 8, 30))).toBe("neaktivni");
    expect(stavPlatby(platba({ aktivniServis: false }), new Date(2026, 8, 30))).toBe("neaktivni");
    expect(stavPlatby(platba({ cenaMesicne: 0 }), new Date(2026, 8, 30))).toBe("neaktivni");
  });

  it("dny po splatnosti se počítají ke dni platby daného měsíce", () => {
    expect(dniPoSplatnosti(15, "2026-09", new Date(2026, 8, 20))).toBe(5);
    expect(dniPoSplatnosti(15, "2026-09", new Date(2026, 9, 1))).toBe(16);
    expect(dniPoSplatnosti(28, "2026-02", new Date(2026, 1, 27))).toBe(-1);
  });
});

describe("součty a připomínka", () => {
  it("měsíční příjem jen z aktivních servisů", () => {
    expect(mesicniPrijem([platba({ cenaMesicne: 990 }), platba({ cenaMesicne: 500, aktivni: false }), platba({ cenaMesicne: 1500 })])).toBe(2490);
  });

  it("k připomenutí jsou splatné a po splatnosti, nejstarší dluh první", () => {
    const seznam = [
      platba({ serviceId: "a", denPlatby: 1 }),
      platba({ serviceId: "b", denPlatby: 20 }),
      platba({ serviceId: "c", denPlatby: 25 }),
      platba({ serviceId: "d", denPlatby: 1, zaplacenoAt: "2026-09-01T00:00:00Z" }),
    ];
    const v = kPripomenuti(seznam, new Date(2026, 8, 21));
    expect(v.map((x) => x.serviceId)).toEqual(["a", "b"]);
    expect(v[0].stav).toBe("po_splatnosti");
    expect(v[1].stav).toBe("splatne");
  });

  it("řádek z RPC se převede tolerantně", () => {
    const p = prevedPlatbu({ serviceId: "x", nazev: "", cenaMesicne: "990", denPlatby: "40", aktivni: true, obdobi: "2026-09", zaplacenoAt: null, zaplacenoCastka: null });
    expect(p.nazev).toBe("Servis");
    expect(p.cenaMesicne).toBe(990);
    expect(p.denPlatby).toBe(28);
  });
});
