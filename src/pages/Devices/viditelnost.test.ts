/**
 * Účinná viditelnost v UI ceníku musí sedět s tím, co doopravdy dělá
 * public-catalog (viz src/lib/viditelnost.test.ts). Jinak štítek říká
 * „v API“ a odpověď položku nemá.
 */
import { describe, it, expect } from "vitest";
import { duvodSkrytiOpravy, duvodZdedenehoSkryti, ucinneSkryteModely } from "./viditelnost";
import type { DevicesData, Repair } from "./types";

const t = "2026-01-01T00:00:00.000Z";

function data(prepis: Partial<DevicesData> = {}): DevicesData {
  return {
    brands: [
      { id: "apple", name: "Apple", createdAt: t },
      { id: "dyson", name: "Dyson", createdAt: t },
    ],
    categories: [
      { id: "iphone", brandId: "apple", name: "iPhone", createdAt: t },
      { id: "watch", brandId: "apple", name: "Watch", createdAt: t },
      { id: "vysavace", brandId: "dyson", name: "Vysavače", createdAt: t },
    ],
    models: [
      { id: "6s", categoryId: "iphone", name: "iPhone 6s", createdAt: t },
      { id: "7", categoryId: "iphone", name: "iPhone 7", createdAt: t },
      { id: "ultra", categoryId: "watch", name: "Watch Ultra", createdAt: t },
      { id: "v11", categoryId: "vysavace", name: "V11", createdAt: t },
    ],
    repairs: [],
    ...prepis,
  };
}

const oprava = (prepis: Partial<Repair>): Repair => ({
  id: "r", modelIds: ["6s", "7"], name: "Displej", price: 1, estimatedTime: 1, details: "", createdAt: t, ...prepis,
});

const nazvy = new Map(data().models.map((m) => [m.id, m.name]));

describe("ucinneSkryteModely", () => {
  it("bez skrytí je prázdná", () => {
    expect(ucinneSkryteModely(data()).size).toBe(0);
  });

  it("model skrytý sám má důvod null", () => {
    const d = data();
    d.models[0].publicVisible = false;
    expect([...ucinneSkryteModely(d)]).toEqual([["6s", null]]);
  });

  it("skrytá kategorie schová modely pod sebou a řekne proč", () => {
    const d = data();
    d.categories[0].publicVisible = false;
    const s = ucinneSkryteModely(d);
    expect(s.get("6s")).toBe("kategorie iPhone");
    expect(s.get("7")).toBe("kategorie iPhone");
    expect(s.has("ultra")).toBe(false);
  });

  it("skrytá značka přebije skrytou kategorii – důvod je značka", () => {
    const d = data();
    d.brands[0].publicVisible = false;
    d.categories[0].publicVisible = false;
    const s = ucinneSkryteModely(d);
    expect(s.get("6s")).toBe("značka Apple");
    expect(s.get("ultra")).toBe("značka Apple");
    expect(s.has("v11")).toBe(false);
  });
});

describe("duvodZdedenehoSkryti", () => {
  it("značka nikdy nedědí", () => {
    const d = data();
    d.brands[0].publicVisible = false;
    expect(duvodZdedenehoSkryti(d, { kind: "brand", id: "apple" })).toBeNull();
  });

  it("kategorie dědí ze značky, model z kategorie i značky", () => {
    const d = data();
    d.brands[0].publicVisible = false;
    expect(duvodZdedenehoSkryti(d, { kind: "category", id: "iphone" })).toBe("značka Apple");
    expect(duvodZdedenehoSkryti(d, { kind: "model", id: "6s" })).toBe("značka Apple");
    const e = data();
    e.categories[0].publicVisible = false;
    expect(duvodZdedenehoSkryti(e, { kind: "category", id: "iphone" })).toBeNull();
    expect(duvodZdedenehoSkryti(e, { kind: "model", id: "6s" })).toBe("kategorie iPhone");
    expect(duvodZdedenehoSkryti(e, { kind: "model", id: "ultra" })).toBeNull();
  });
});

describe("duvodSkrytiOpravy", () => {
  it("oprava s aspoň jedním viditelným modelem se posílá", () => {
    const s = new Map<string, string | null>([["6s", null]]);
    expect(duvodSkrytiOpravy(oprava({}), null, s, nazvy)).toBeNull();
  });

  it("oprava jen na skrytých modelech se neposílá", () => {
    const s = new Map<string, string | null>([["6s", null], ["7", "kategorie iPhone"]]);
    expect(duvodSkrytiOpravy(oprava({}), null, s, nazvy)).toBe("všechny její modely jsou skryté");
  });

  it("výjimka u zrovna vybraného modelu má přednost", () => {
    const r = oprava({ publicHiddenModelIds: ["6s"] });
    expect(duvodSkrytiOpravy(r, { kind: "model", id: "6s" }, new Map(), nazvy)).toBe("u modelu iPhone 6s je nastavená výjimka");
    expect(duvodSkrytiOpravy(r, { kind: "model", id: "7" }, new Map(), nazvy)).toBeNull();
    expect(duvodSkrytiOpravy(r, { kind: "category", id: "iphone" }, new Map(), nazvy)).toBeNull();
  });

  it("výjimka u všech modelů opravu vyřadí úplně", () => {
    const r = oprava({ publicHiddenModelIds: ["6s", "7"] });
    expect(duvodSkrytiOpravy(r, null, new Map(), nazvy)).toBe("má výjimku u všech svých modelů");
  });

  it("výjimka a skrytý model dohromady taky vyřadí", () => {
    const r = oprava({ publicHiddenModelIds: ["6s"] });
    const s = new Map<string, string | null>([["7", null]]);
    expect(duvodSkrytiOpravy(r, null, s, nazvy)).toBe("všechny její modely jsou skryté");
  });

  it("obecná oprava bez modelů se posílá", () => {
    expect(duvodSkrytiOpravy(oprava({ modelIds: [] }), null, new Map(), nazvy)).toBeNull();
  });
});
