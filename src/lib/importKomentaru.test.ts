import { describe, expect, it } from "vitest";
import { parseCsv } from "./csv";
import { klicKomentare, odhadniMapovaniKomentaru, pripravKomentare, zapisKomentare, type CileKomentaru, type KlientKomentaru, type RadekKomentare } from "./importKomentaru";

const CSV = [
  "Kód;Druh;Autor;Datum;Text",
  "IRPAZ2400001;zakázka;Technik A;08.12.2022 09:51;Zákazník volal, chce to do pátku.",
  "irpaz2400001;zakázka;Technik A;08.12.2022 09:51;Zákazník volal,  chce to do pátku.",
  "IRPAZ2400001;zakázka;;09.12.2022 10:00;Díl objednán.",
  "IRPAR2400001;reklamace;Technik B;02.02.2024 09:00;Kontakt: paní Nováková, 777 000 111.",
  "IRPAR2400002;reklamace;Technik B;02.02.2024 09:00;Reklamace bez zakázky.",
  "IRPAZ2400009;zakázka;Technik A;08.12.2022 09:51;Zakázka, která v Jobi není.",
  "IRPAZ2400001;zakázka;Technik A;;Bez data.",
  "IRPAZ2400001;zakázka;Technik A;někdy;Špatné datum.",
  "IRPAZ2400001;zakázka;Technik A;08.12.2022 09:51;",
  ";;;;",
].join("\n");

const CILE: CileKomentaru = {
  zakazky: new Map([["IRPAZ2400001", "t-1"], ["IRPAZ2400002", "t-2"]]),
  reklamace: new Map([
    ["IRPAR2400001", { id: "r-1", sourceTicketId: "t-2" }],
    ["IRPAR2400002", { id: "r-2", sourceTicketId: null }],
  ]),
  existujici: new Set([klicKomentare("t-1", new Date(2022, 11, 9, 10, 0).toISOString(), "Díl objednán.")]),
};

describe("importKomentaru", () => {
  it("odhadne sloupce podle hlavičky", () => {
    expect(odhadniMapovaniKomentaru(["Kód", "Druh", "Autor", "Datum", "Text"])).toEqual(["code", "kind", "author", "date", "text"]);
    expect(odhadniMapovaniKomentaru(["Číslo zakázky", "Vytvořeno", "Uživatel", "Komentář", "Cokoliv"])).toEqual(["code", "date", "author", "text", null]);
  });

  it("plán: zakázka podle čísla, reklamace na svou zakázku s předponou, duplicity a chyby", () => {
    const t = parseCsv(CSV);
    const plan = pripravKomentare(t, odhadniMapovaniKomentaru(t.hlavicka), CILE);

    expect(plan.radky.map((r) => [r.ticket_id, r.author, r.content, r.created_at])).toEqual([
      ["t-1", "Technik A", "Zákazník volal, chce to do pátku.", new Date(2022, 11, 8, 9, 51).toISOString()],
      ["t-2", "Technik B", "[Reklamace IRPAR2400001] Kontakt: paní Nováková, 777 000 111.", new Date(2024, 1, 2, 9, 0).toISOString()],
    ]);
    expect(plan.radky[0]).toMatchObject({ author_id: null, pinned: false });
    expect([plan.zakazek, plan.reklamaci, plan.preskoceno]).toEqual([1, 1, 2]);
    expect(plan.chyby).toEqual([
      { radek: 6, zprava: "IRPAR2400002: reklamace není napojená na zakázku, komentář nemá kam" },
      { radek: 7, zprava: "IRPAZ2400009: zakázka v servisu není" },
      { radek: 8, zprava: "IRPAZ2400001: chybí datum" },
      { radek: 9, zprava: "IRPAZ2400001: nečitelné datum „někdy“" },
      { radek: 10, zprava: "IRPAZ2400001: prázdný komentář" },
    ]);
  });

  it("bez sloupce Druh se kód hledá mezi zakázkami i reklamacemi", () => {
    const t = parseCsv("Kód;Datum;Text\nIRPAR2400001;1.1.2024;Ahoj\nIRPAZ2400002;1.1.2024;Ahoj");
    const plan = pripravKomentare(t, odhadniMapovaniKomentaru(t.hlavicka), CILE);
    expect(plan.chyby).toEqual([]);
    expect(plan.radky.map((r) => [r.ticket_id, r.author, r.content])).toEqual([
      ["t-2", "Import", "[Reklamace IRPAR2400001] Ahoj"],
      ["t-2", "Import", "Ahoj"],
    ]);
  });

  it("klíč duplicity nezávisí na tvaru data ani na velikosti písmen", () => {
    expect(klicKomentare("t", "2024-02-02T08:00:00+00:00", "Ahoj  světe")).toBe(klicKomentare("t", "2024-02-02T08:00:00.000Z", "ahoj světe"));
  });

  it("zápis po dávkách, vadná dávka se projde po jednom", async () => {
    const vlozeno: unknown[] = [];
    let pokus = 0;
    const klient: KlientKomentaru = {
      from: () => ({
        insert: async (radky: unknown) => {
          pokus += 1;
          if (Array.isArray(radky)) {
            if (pokus === 1) return { error: { message: "dávka spadla" } };
            vlozeno.push(...radky);
            return { error: null };
          }
          const r = radky as { content: string };
          if (r.content === "vadný") return { error: { message: "check violation" } };
          vlozeno.push(radky);
          return { error: null };
        },
      }),
    };
    const radek = (content: string): RadekKomentare => ({ ticket_id: "t-1", author: "A", author_id: null, content, pinned: false, created_at: "2024-01-01T00:00:00.000Z" });
    const postup: number[] = [];
    const v = await zapisKomentare(klient, "svc", [radek("a"), radek("vadný"), radek("b")], (p) => postup.push(p), 2);
    expect(v).toEqual({ zapsano: 2, chyb: 1, chyby: ["check violation"] });
    expect(vlozeno).toHaveLength(2);
    expect((vlozeno[0] as { service_id: string }).service_id).toBe("svc");
    expect(postup).toEqual([67, 100]);
  });
});
