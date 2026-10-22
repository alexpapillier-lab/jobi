import { describe, expect, it } from "vitest";
import { zakrokyDoSloupce } from "./useZakrokyReklamace";
import { parseClaimResolutionItems, zakrokZCeniku } from "../reklamaceZakroky";
import { claimDocumentData } from "../../../lib/documentData";
import type { WarrantyClaimRow } from "./useWarrantyClaims";

const reklamace = (extra: Record<string, unknown> = {}): WarrantyClaimRow =>
  ({ id: "r1", code: "R26000012", created_at: "2026-09-01T10:00:00.000Z", ...extra }) as unknown as WarrantyClaimRow;

describe("zákroky reklamace → databáze → výdejka", () => {
  it("bezejmenný řádek (právě přidaný „+ Přidat zákrok“) se neukládá", () => {
    expect(zakrokyDoSloupce([{ id: "a", name: "" }])).toBeNull();
    expect(zakrokyDoSloupce([{ id: "a", name: "   " }, { id: "b", name: "Výměna konektoru", price: 490 }])).toBe(
      JSON.stringify([{ id: "b", name: "Výměna konektoru", price: 490 }]),
    );
  });

  it("žádný zákrok = prázdný sloupec, ne prázdné pole", () => {
    expect(zakrokyDoSloupce([])).toBeNull();
  });

  it("uložené zákroky se načtou zpátky a dostanou se na výdejku jako položky s cenou", () => {
    const sloupec = zakrokyDoSloupce([
      { id: "a", name: "Výměna konektoru", price: 490 },
      { id: "b", name: "Kontrola", description: "bez závady", price: 0 },
    ]);
    expect(parseClaimResolutionItems(sloupec).map((z) => z.name)).toEqual(["Výměna konektoru", "Kontrola"]);
    const doklad = claimDocumentData(reklamace({ resolution_summary: sloupec }), { name: "Servis" });
    expect(doklad.items?.map((i) => [i.name, i.total])).toEqual([
      ["Výměna konektoru", 490],
      ["Kontrola", 0],
    ]);
  });

  it("oprava z ceníku jde do zákroků s názvem z ceníku a cenou 0; cenu jde přepsat", () => {
    const z = zakrokZCeniku({ name: "Výměna displeje" });
    expect(z).toMatchObject({ name: "Výměna displeje", price: 0 });
    expect(z.id).toBeTruthy();
    expect(zakrokZCeniku({ name: "Výměna displeje" }).id).not.toBe(z.id);
    const sloupec = zakrokyDoSloupce([z, { ...zakrokZCeniku({ name: "Baterie" }), price: 800 }]);
    expect(parseClaimResolutionItems(sloupec).map((x) => [x.name, x.price])).toEqual([
      ["Výměna displeje", 0],
      ["Baterie", 800],
    ]);
  });
});
