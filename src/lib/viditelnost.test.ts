/**
 * Dědění viditelnosti ve veřejném API.
 *
 * Testuje se odsud, protože edge funkce běží v Denu a vlastní testy nemá.
 * Soubor _shared/viditelnost.ts je proto záměrně bez Deno API.
 */
import { describe, it, expect } from "vitest";
import { viditelneVetve } from "../../supabase/functions/_shared/viditelnost";

const znacky = [{ id: "apple" }, { id: "dyson" }];
const kategorie = [
  { id: "iphone", brand_id: "apple" },
  { id: "watch", brand_id: "apple" },
  { id: "vysavace", brand_id: "dyson" },
];
const modely = [
  { id: "6s", category_id: "iphone" },
  { id: "7", category_id: "iphone" },
  { id: "ultra", category_id: "watch" },
  { id: "v11", category_id: "vysavace" },
];

describe("viditelneVetve", () => {
  it("při ničem skrytém pustí všechno", () => {
    const v = viditelneVetve(znacky, kategorie, modely);
    expect(v.kategorie).toHaveLength(3);
    expect(v.modely).toHaveLength(4);
  });

  it("skrytá značka schová i kategorie a modely pod sebou", () => {
    // Dyson chybí ve vstupu = je skrytý
    const v = viditelneVetve([{ id: "apple" }], kategorie, modely);
    expect(v.kategorie.map((c) => c.id)).toEqual(["iphone", "watch"]);
    expect(v.idModelu.has("v11")).toBe(false);
    expect(v.idModelu.has("6s")).toBe(true);
  });

  it("skrytá kategorie schová modely pod sebou, sourozence nechá", () => {
    const bezWatch = kategorie.filter((c) => c.id !== "watch");
    const v = viditelneVetve(znacky, bezWatch, modely);
    expect(v.idModelu.has("ultra")).toBe(false);
    expect(v.idModelu.has("6s")).toBe(true);
    expect(v.modely).toHaveLength(3);
  });

  it("skrytý model nezmizí sourozencům", () => {
    const bez6s = modely.filter((m) => m.id !== "6s");
    const v = viditelneVetve(znacky, kategorie, bez6s);
    expect(v.idModelu.has("6s")).toBe(false);
    expect(v.idModelu.has("7")).toBe(true);
  });

  it("osiřelý řádek s neexistujícím rodičem ven nepustí", () => {
    const v = viditelneVetve(znacky, [{ id: "duch", brand_id: "neexistuje" }], [
      { id: "sirotek", category_id: "duch" },
    ]);
    expect(v.kategorie).toHaveLength(0);
    expect(v.modely).toHaveLength(0);
  });
});
