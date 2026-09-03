/**
 * Rozdílové ukládání skladu.
 *
 * Tohle rozhoduje o tom, jestli se ztratí data. Před opravou posílal každý
 * klient celý sklad, takže kdo měl data načtená před cizí úpravou, přepsal
 * ji svou starší kopií – u obrázků doslova na null.
 */
import { describe, it, expect } from "vitest";
import { rozdilSkladu } from "./inventoryDb";
import type { InventoryData, Product, Warehouse } from "./inventoryDb";

const SID = "servis-1";
const WH = "sklad-hlavni";
const WH2 = "sklad-dodavatel";

const hlavni: Warehouse = { id: WH, name: "Hlavní sklad", isDefault: true, publicVisible: true, createdAt: "2026-01-01T00:00:00Z" };
const dodavatel: Warehouse = { id: WH2, name: "Dodavatel", isDefault: false, publicVisible: false, createdAt: "2026-01-01T00:00:00Z" };

const produkt = (o: Partial<Product> & { id: string }): Product => ({
  name: "Produkt", modelIds: [], stock: 0, stockByWarehouse: {}, price: 0, createdAt: "2026-01-01T00:00:00Z", ...o,
});

const sklad = (products: Product[], warehouses: Warehouse[] = [hlavni]): InventoryData =>
  ({ productCategories: [], products, warehouses });

describe("rozdilSkladu", () => {
  it("beze změny neposílá nic", () => {
    const s = sklad([produkt({ id: "a" }), produkt({ id: "b" })]);
    const r = rozdilSkladu(s, s, SID);
    expect(r.produktyKeZmene).toEqual([]);
    expect(r.produktyKeSmazani).toEqual([]);
  });

  it("posílá jen změněný produkt, ostatní nechá být", () => {
    const driv = sklad([produkt({ id: "a" }), produkt({ id: "b" })]);
    const ted = sklad([produkt({ id: "a", name: "Jiný název" }), produkt({ id: "b" })]);
    const r = rozdilSkladu(ted, driv, SID);
    expect(r.produktyKeZmene.map((x) => x.id)).toEqual(["a"]);
  });

  it("nový produkt pošle", () => {
    const r = rozdilSkladu(sklad([produkt({ id: "a" }), produkt({ id: "c" })]), sklad([produkt({ id: "a" })]), SID);
    expect(r.produktyKeZmene.map((x) => x.id)).toEqual(["c"]);
  });

  it("smaže jen to, co klient sám odebral", () => {
    const driv = sklad([produkt({ id: "a" }), produkt({ id: "b" })]);
    const ted = sklad([produkt({ id: "a" })]);
    expect(rozdilSkladu(ted, driv, SID).produktyKeSmazani).toEqual(["b"]);
  });

  // Tohle je ta chyba, kvůli které zmizely obrázky.
  it("cizí produkt, o kterém klient neví, nesmaže ani nepřepíše", () => {
    const driv = sklad([produkt({ id: "a" })]);
    const ted = sklad([produkt({ id: "a", name: "Jiný název" })]);
    const r = rozdilSkladu(ted, driv, SID);
    expect(r.produktyKeSmazani).toEqual([]);          // „cizi“ v datech není a přesto se nemaže
    expect(r.produktyKeZmene.map((x) => x.id)).toEqual(["a"]);
  });

  it("obrázek přidaný jinde nepřepíše na prázdno", () => {
    // klient načetl produkt bez obrázku a od té doby na něm nic nedělal
    const driv = sklad([produkt({ id: "a" }), produkt({ id: "b" })]);
    const ted = sklad([produkt({ id: "a", name: "Jiný název" }), produkt({ id: "b" })]);
    const r = rozdilSkladu(ted, driv, SID);
    // posílá se jen „a“; „b“ se nedotkne, takže jeho image_url zůstane
    expect(r.produktyKeZmene).toHaveLength(1);
    expect(r.produktyKeZmene[0].id).toBe("a");
  });

  it("změnu obrázku pozná", () => {
    const driv = sklad([produkt({ id: "a" })]);
    const ted = sklad([produkt({ id: "a", imageUrl: "data:image/jpeg;base64,AAA" })]);
    const r = rozdilSkladu(ted, driv, SID);
    expect(r.produktyKeZmene).toHaveLength(1);
    expect(r.produktyKeZmene[0].image_url).toBe("data:image/jpeg;base64,AAA");
  });

  it("pozná i změnu pořadí, ne jen obsahu", () => {
    const driv = sklad([produkt({ id: "a" }), produkt({ id: "b" })]);
    const ted = sklad([produkt({ id: "b" }), produkt({ id: "a" })]);
    const r = rozdilSkladu(ted, driv, SID);
    expect(r.produktyKeZmene.map((x) => x.id).sort()).toEqual(["a", "b"]);
  });

  it("chybějící obrázek posílá jako null, ne undefined", () => {
    const r = rozdilSkladu(sklad([produkt({ id: "a" })]), sklad([]), SID);
    expect(r.produktyKeZmene[0].image_url).toBeNull();
  });
});

describe("rozdilSkladu – víc skladů", () => {
  it("množství se neposílá v řádku produktu, ale zvlášť", () => {
    const driv = sklad([produkt({ id: "a", stockByWarehouse: { [WH]: 2 } })]);
    const ted = sklad([produkt({ id: "a", stockByWarehouse: { [WH]: 5 } })]);
    const r = rozdilSkladu(ted, driv, SID);
    expect(r.produktyKeZmene).toEqual([]);
    expect(r.stavyKeZmene).toEqual([{ product_id: "a", warehouse_id: WH, service_id: SID, quantity: 5 }]);
  });

  it("stejné SKU ve dvou skladech jsou dva řádky", () => {
    const driv = sklad([produkt({ id: "a" })], [hlavni, dodavatel]);
    const ted = sklad([produkt({ id: "a", stockByWarehouse: { [WH]: 3, [WH2]: 4 } })], [hlavni, dodavatel]);
    const r = rozdilSkladu(ted, driv, SID);
    expect(r.stavyKeZmene).toHaveLength(2);
    expect(r.stavyKeZmene.map((x) => x.quantity).sort()).toEqual([3, 4]);
  });

  /* Nula se neukládá jako řádek. Kdyby se ukládala, „odepsán poslední kus“
     by se od „nikdy tu nebyl“ nedalo odlišit a součet by seděl jen náhodou. */
  it("nulové množství řádek smaže, neuloží nulu", () => {
    const driv = sklad([produkt({ id: "a", stockByWarehouse: { [WH]: 2 } })]);
    const ted = sklad([produkt({ id: "a", stockByWarehouse: { [WH]: 0 } })]);
    const r = rozdilSkladu(ted, driv, SID);
    expect(r.stavyKeZmene).toEqual([]);
    expect(r.stavyKeSmazani).toEqual([{ product_id: "a", warehouse_id: WH }]);
  });

  it("řádky smazaného produktu se nemažou zvlášť – zařídí to kaskáda", () => {
    const driv = sklad([produkt({ id: "a", stockByWarehouse: { [WH]: 2 } })]);
    const ted = sklad([]);
    const r = rozdilSkladu(ted, driv, SID);
    expect(r.produktyKeSmazani).toEqual(["a"]);
    expect(r.stavyKeSmazani).toEqual([]);
  });

  it("řádky smazaného skladu se nemažou zvlášť", () => {
    const driv = sklad([produkt({ id: "a", stockByWarehouse: { [WH]: 1, [WH2]: 9 } })], [hlavni, dodavatel]);
    const ted = sklad([produkt({ id: "a", stockByWarehouse: { [WH]: 1 } })], [hlavni]);
    const r = rozdilSkladu(ted, driv, SID);
    expect(r.skladyKeSmazani).toEqual([WH2]);
    expect(r.stavyKeSmazani).toEqual([]);
  });

  it("přejmenování skladu pošle sklad, ne produkty", () => {
    const driv = sklad([produkt({ id: "a", stockByWarehouse: { [WH]: 1 } })]);
    const ted = sklad([produkt({ id: "a", stockByWarehouse: { [WH]: 1 } })], [{ ...hlavni, name: "Praha" }]);
    const r = rozdilSkladu(ted, driv, SID);
    expect(r.skladyKeZmene.map((x) => x.name)).toEqual(["Praha"]);
    expect(r.produktyKeZmene).toEqual([]);
    expect(r.stavyKeZmene).toEqual([]);
  });
});
