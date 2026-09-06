/**
 * Očištění těla zápisu ve veřejném API.
 *
 * Tohle je jediné místo, které brání tomu, aby se přes API přepsalo
 * service_id nebo public_visible. Testuje se odsud, protože edge funkce
 * běží v Denu a vlastní testy nemá.
 */
import { describe, it, expect } from "vitest";
import { zmenyProduktu, zmenyOprav, zmenyKatalogu, otiskTela } from "../../supabase/functions/_shared/zapis";

const UUID = "0a7587f1-1111-4222-8333-444455556666";

describe("zmenyProduktu", () => {
  it("propustí sklad a cenu", () => {
    const v = zmenyProduktu([{ sku: "BAT-6S", stock: 4, price: 590 }]);
    expect(v.chyby).toEqual([]);
    expect(v.zmeny).toEqual([{ id: undefined, sku: "BAT-6S", hodnoty: { stock: 4, price: 590 } }]);
  });

  it("NEPROPUSTÍ vlastnictví ani interní sloupce, ani když je klient pošle", () => {
    const v = zmenyProduktu([{
      sku: "X", stock: 1, name: "Nový název", public_visible: false,
      service_id: "cizi-servis", order_index: 5, repair_ids: ["x"], image_url: "http://x", id_: "nesmysl",
    }]);
    expect(v.zmeny[0].hodnoty).toEqual({ stock: 1, name: "Nový název", public_visible: false });
    expect(Object.keys(v.zmeny[0].hodnoty)).not.toContain("service_id");
    expect(Object.keys(v.zmeny[0].hodnoty)).not.toContain("order_index");
    expect(Object.keys(v.zmeny[0].hodnoty)).not.toContain("repair_ids");
  });

  it("založení a smazání produktu", () => {
    const v = zmenyProduktu([
      { create: true, name: "Baterie X", sku: "BAT-X", price: 590, purchase_price: 300, min_stock: 2, model_ids: [UUID] },
      { create: true, sku: "BEZ-JMENA" },
      { id: UUID, delete: true },
      { sku: "BAT-X", delete: true },
    ]);
    expect(v.zmeny[0]).toMatchObject({ akce: "create", sku: undefined, hodnoty: { name: "Baterie X", sku: "BAT-X", price: 590, purchase_price: 300, min_stock: 2, model_ids: [UUID] } });
    expect(v.zmeny[1]).toEqual({ id: UUID, hodnoty: {}, akce: "delete" });
    expect(v.chyby).toEqual(["products[1]: nový produkt potřebuje name", "products[3]: mazat jde jen podle id"]);
  });

  it("vazby musí být id, ne cokoli", () => {
    const v = zmenyProduktu([{ sku: "A", category_id: "kategorie", model_ids: ["x"] }, { sku: "B", category_id: null }]);
    expect(v.chyby).toEqual(["products[0]: category_id musí být id nebo null", "products[0]: model_ids musí být pole id", "products[0]: není co měnit (povolené: stock, price, purchase_price, min_stock, name, description, supplier_sku, category_id, model_ids, public_visible)"]);
    expect(v.zmeny[0].hodnoty).toEqual({ category_id: null });
  });

  it("chce id nebo sku", () => {
    const v = zmenyProduktu([{ stock: 1 }]);
    expect(v.zmeny).toEqual([]);
    expect(v.chyby[0]).toMatch(/chybí id nebo sku/);
  });

  it("nepustí záporné ani nečíselné hodnoty", () => {
    expect(zmenyProduktu([{ sku: "A", stock: -1 }]).chyby[0]).toMatch(/stock/);
    expect(zmenyProduktu([{ sku: "A", stock: "hodně" }]).chyby[0]).toMatch(/stock/);
    expect(zmenyProduktu([{ sku: "A", price: -5 }]).chyby[0]).toMatch(/price/);
    // true by se jako Number stalo jedničkou
    expect(zmenyProduktu([{ sku: "A", stock: true }]).chyby[0]).toMatch(/stock/);
  });

  it("sklad zaokrouhlí na celé, cenu na haléře", () => {
    expect(zmenyProduktu([{ sku: "A", stock: 3.9 }]).zmeny[0].hodnoty.stock).toBe(3);
    expect(zmenyProduktu([{ sku: "A", price: 12.345 }]).zmeny[0].hodnoty.price).toBe(12.35);
  });

  it("řekne, že není co měnit", () => {
    expect(zmenyProduktu([{ sku: "A" }]).chyby[0]).toMatch(/není co měnit/);
  });

  it("odmítne příliš velkou dávku celou, ne po kusech", () => {
    const v = zmenyProduktu(Array.from({ length: 201 }, (_, i) => ({ sku: `S${i}`, stock: 1 })));
    expect(v.zmeny).toEqual([]);
    expect(v.chyby[0]).toMatch(/nejvýš 200/);
  });

  it("id musí být UUID, ne libovolný řetězec", () => {
    const v = zmenyProduktu([{ id: "'; drop table --", stock: 1 }]);
    expect(v.chyby[0]).toMatch(/chybí id nebo sku/);
  });
});

describe("zmenyOprav", () => {
  it("propustí cenu a čas", () => {
    const v = zmenyOprav([{ id: UUID, price: 1490, estimated_time: 60 }]);
    expect(v.chyby).toEqual([]);
    expect(v.zmeny[0].hodnoty).toEqual({ price: 1490, estimated_time: 60 });
  });

  it("náklady, název, popis a vazby jdou měnit; service_id ne", () => {
    const v = zmenyOprav([{ id: UUID, price: 100, costs: 1, name: "Displej", details: "originál", product_ids: [UUID], service_id: "x" }]);
    expect(v.zmeny[0].hodnoty).toEqual({ price: 100, costs: 1, name: "Displej", details: "originál", product_ids: [UUID] });
  });

  it("úprava bez id neprojde; založení bez id chce name a model_ids", () => {
    expect(zmenyOprav([{ price: 1 }]).chyby[0]).toMatch(/platné id/);
    const bezModelu = zmenyOprav([{ name: "Výměna displeje", price: 1 }]);
    expect(bezModelu.zmeny).toEqual([]);
    expect(bezModelu.chyby[0]).toMatch(/model_ids/);
    const nova = zmenyOprav([{ name: "Výměna displeje", price: 1490, model_ids: [UUID, UUID] }]);
    expect(nova.zmeny[0]).toEqual({ id: undefined, akce: "create", hodnoty: { name: "Výměna displeje", price: 1490, model_ids: [UUID] } });
    expect(zmenyOprav([{ id: UUID, delete: true }]).zmeny[0]).toEqual({ id: UUID, hodnoty: {}, akce: "delete" });
  });
});

describe("zmenyKatalogu", () => {
  it("značky, kategorie a modely: založit nebo přejmenovat, mazat ne", () => {
    expect(zmenyKatalogu([{ name: "Apple" }], "brands").zmeny[0]).toEqual({ hodnoty: { name: "Apple" }, akce: "create" });
    expect(zmenyKatalogu([{ name: "Telefony" }], "categories").chyby[0]).toMatch(/brand_id/);
    expect(zmenyKatalogu([{ name: "iPhone 15", category_id: UUID }], "models").zmeny[0]).toEqual({ hodnoty: { name: "iPhone 15", category_id: UUID }, akce: "create" });
    expect(zmenyKatalogu([{ id: UUID, name: "Apple Inc." }], "brands").zmeny[0]).toEqual({ id: UUID, hodnoty: { name: "Apple Inc." } });
    expect(zmenyKatalogu([{ id: UUID, delete: true }], "models").chyby[0]).toMatch(/jen v aplikaci/);
  });
});

describe("zmenyProduktu – sklad", () => {
  it("bez warehouse projde jako dřív (existující integrace nesmí přestat)", () => {
    const v = zmenyProduktu([{ sku: "BAT-V8", stock: 4 }]);
    expect(v.chyby).toEqual([]);
    expect(v.zmeny[0].sklad).toBeUndefined();
    expect(v.zmeny[0].hodnoty.stock).toBe(4);
  });

  it("warehouse se propíše", () => {
    const v = zmenyProduktu([{ sku: "BAT-V8", stock: 4, warehouse: "Dodavatel" }]);
    expect(v.chyby).toEqual([]);
    expect(v.zmeny[0].sklad).toBe("Dodavatel");
  });

  it("warehouse bez stock je chyba, ne tichý souhlas", () => {
    const v = zmenyProduktu([{ sku: "BAT-V8", price: 100, warehouse: "Dodavatel" }]);
    expect(v.zmeny).toEqual([]);
    expect(v.chyby[0]).toMatch(/warehouse/);
  });
});

describe("otiskTela", () => {
  it("stejné tělo dá stejný otisk, jiné jiný", async () => {
    const a = await otiskTela({ products: [{ sku: "A", stock: 1 }] });
    const b = await otiskTela({ products: [{ sku: "A", stock: 1 }] });
    const c = await otiskTela({ products: [{ sku: "A", stock: 2 }] });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});
