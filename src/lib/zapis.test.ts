/**
 * Očištění těla zápisu ve veřejném API.
 *
 * Tohle je jediné místo, které brání tomu, aby se přes API přepsalo
 * service_id nebo public_visible. Testuje se odsud, protože edge funkce
 * běží v Denu a vlastní testy nemá.
 */
import { describe, it, expect } from "vitest";
import { zmenyProduktu, zmenyOprav, otiskTela } from "../../supabase/functions/_shared/zapis";

const UUID = "0a7587f1-1111-4222-8333-444455556666";

describe("zmenyProduktu", () => {
  it("propustí sklad a cenu", () => {
    const v = zmenyProduktu([{ sku: "BAT-6S", stock: 4, price: 590 }]);
    expect(v.chyby).toEqual([]);
    expect(v.zmeny).toEqual([{ id: undefined, sku: "BAT-6S", hodnoty: { stock: 4, price: 590 } }]);
  });

  it("NEPROPUSTÍ nic jiného, ani když to klient pošle", () => {
    const v = zmenyProduktu([{
      sku: "X", stock: 1,
      service_id: "cizi-servis", public_visible: false, name: "přepsáno", id_: "nesmysl",
    }]);
    expect(v.zmeny[0].hodnoty).toEqual({ stock: 1 });
    expect(Object.keys(v.zmeny[0].hodnoty)).not.toContain("service_id");
    expect(Object.keys(v.zmeny[0].hodnoty)).not.toContain("public_visible");
    expect(Object.keys(v.zmeny[0].hodnoty)).not.toContain("name");
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

  it("NEPROPUSTÍ náklady – to je marže servisu", () => {
    const v = zmenyOprav([{ id: UUID, price: 100, costs: 1 }]);
    expect(Object.keys(v.zmeny[0].hodnoty)).not.toContain("costs");
  });

  it("nedá se adresovat názvem, jen id", () => {
    const v = zmenyOprav([{ name: "Výměna displeje", price: 1 }]);
    expect(v.zmeny).toEqual([]);
    expect(v.chyby[0]).toMatch(/platné id/);
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
