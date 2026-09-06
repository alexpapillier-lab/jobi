/**
 * Objednávky dílů od dodavatele.
 *
 * „Na cestě“ je číslo, podle kterého technik pozná, jestli díl objednávat
 * znovu. Když se do něj započítá i to, co už dorazilo nebo co je jen
 * rozepsaný návrh, objedná servis díly dvakrát a platí je dvakrát.
 *
 * Text objednávky jde rovnou dodavateli do e-mailu. Když v něm chybí kód
 * dílu nebo se místo názvu pošle prázdno, přijde jiný díl, než servis
 * potřeboval, a zakázka stojí o týden déle.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("./supabaseClient", () => ({ getSupabaseClient: () => null }));
vi.mock("./reportError", () => ({ reportSilent: () => {} }));

const { onOrderQty, textObjednavky, jenUuid } = await import("./purchaseOrders");
type PurchaseOrder = Awaited<ReturnType<typeof import("./purchaseOrders").loadOrders>>["data"][number];
type Supplier = NonNullable<Awaited<ReturnType<typeof import("./purchaseOrders").saveSupplier>>["data"]>;

const polozka = (o: { productId: string; qty: number; receivedQty?: number }) => ({
  id: `it-${o.productId}`,
  orderId: "obj-1",
  productId: o.productId,
  ticketId: null,
  qty: o.qty,
  unitPrice: null,
  receivedQty: o.receivedQty ?? 0,
  createdAt: "2026-01-01T00:00:00Z",
});

const objednavka = (
  status: PurchaseOrder["status"],
  items: ReturnType<typeof polozka>[],
  cislo = "OBJ-1",
): PurchaseOrder => ({
  id: "obj-1",
  serviceId: "servis-1",
  supplierId: "dod-1",
  number: cislo,
  status,
  note: null,
  orderedAt: null,
  expectedAt: null,
  receivedAt: null,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  items,
});

const dodavatel: Supplier = {
  id: "dod-1",
  serviceId: "servis-1",
  name: "Mobilní díly s.r.o.",
  email: "obchod@dily.cz",
  phone: null,
  website: null,
  leadDays: 3,
  note: null,
  orderIndex: 0,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

describe("kusy na cestě", () => {
  it("počítá jen skutečně objednané, ne rozepsané návrhy", () => {
    const navrh = onOrderQty([objednavka("draft", [polozka({ productId: "p1", qty: 5 })])]);
    expect(navrh.get("p1")).toBeUndefined();
    const objednano = onOrderQty([objednavka("ordered", [polozka({ productId: "p1", qty: 5 })])]);
    expect(objednano.get("p1")).toBe(5);
  });

  it("přijaté a zrušené objednávky už na cestě nejsou", () => {
    expect(onOrderQty([objednavka("received", [polozka({ productId: "p1", qty: 5 })])]).size).toBe(0);
    expect(onOrderQty([objednavka("cancelled", [polozka({ productId: "p1", qty: 5 })])]).size).toBe(0);
  });

  it("z částečně přijaté objednávky zbývá jen nedodaný zbytek", () => {
    const m = onOrderQty([objednavka("ordered", [polozka({ productId: "p1", qty: 10, receivedQty: 4 })])]);
    expect(m.get("p1")).toBe(6);
  });

  it("celý dodaný díl z „na cestě“ zmizí, místo aby tam visel jako nula", () => {
    const m = onOrderQty([objednavka("ordered", [polozka({ productId: "p1", qty: 3, receivedQty: 3 })])]);
    expect(m.has("p1")).toBe(false);
  });

  it("dodávka navíc nedá záporné číslo, které by snížilo jiné objednávky", () => {
    const m = onOrderQty([
      objednavka("ordered", [polozka({ productId: "p1", qty: 3, receivedQty: 5 })]),
      objednavka("ordered", [polozka({ productId: "p1", qty: 2 })], "OBJ-2"),
    ]);
    expect(m.get("p1")).toBe(2);
  });

  it("stejný díl z několika objednávek se sečte do jednoho čísla", () => {
    const m = onOrderQty([
      objednavka("ordered", [polozka({ productId: "p1", qty: 2 }), polozka({ productId: "p2", qty: 1 })]),
      objednavka("ordered", [polozka({ productId: "p1", qty: 3 })], "OBJ-2"),
    ]);
    expect(m.get("p1")).toBe(5);
    expect(m.get("p2")).toBe(1);
  });

  it("bez objednávek je mapa prázdná, ne plná nul", () => {
    expect(onOrderQty([]).size).toBe(0);
    expect(onOrderQty([objednavka("ordered", [])]).size).toBe(0);
  });
});

describe("text objednávky pro dodavatele", () => {
  const produkty = new Map([
    ["p1", { name: "Displej iPhone 13", supplierSku: "APL-13-LCD", sku: "D13" }],
    ["p2", { name: "Baterie iPhone 13", supplierSku: null, sku: "B13" }],
    ["p3", { name: "Lepidlo", supplierSku: null, sku: undefined }],
  ]);

  const order = (o: Partial<{ number: string; note: string | null; items: { productId: string; qty: number }[] }> = {}) => ({
    number: "OBJ-2026-001",
    note: null,
    items: [{ productId: "p1", qty: 2 }],
    ...o,
  });

  it("obsahuje číslo objednávky, dodavatele, množství i název dílu", () => {
    const t = textObjednavky(order(), dodavatel, produkty);
    expect(t).toContain("Objednávka OBJ-2026-001");
    expect(t).toContain("Dodavatel: Mobilní díly s.r.o.");
    expect(t).toContain("2 × Displej iPhone 13");
  });

  it("přednost má kód dodavatele – podle svého skladového si díl nenajde", () => {
    expect(textObjednavky(order(), dodavatel, produkty)).toContain("(APL-13-LCD)");
    // bez kódu dodavatele se pošle aspoň vlastní kód
    expect(textObjednavky(order({ items: [{ productId: "p2", qty: 1 }] }), dodavatel, produkty)).toContain("(B13)");
  });

  it("díl bez jakéhokoliv kódu se pošle jen s názvem, ne s prázdnou závorkou", () => {
    const t = textObjednavky(order({ items: [{ productId: "p3", qty: 1 }] }), dodavatel, produkty);
    expect(t).toContain("1 × Lepidlo");
    expect(t).not.toContain("()");
  });

  it("díl, který mezitím zmizel z katalogu, je v textu vidět, ne vynechaný", () => {
    const t = textObjednavky(order({ items: [{ productId: "smazany", qty: 4 }] }), dodavatel, produkty);
    expect(t).toContain("4 × Neznámý produkt");
  });

  it("bez zvoleného dodavatele se řádek s dodavatelem nepíše", () => {
    const t = textObjednavky(order(), null, produkty);
    expect(t).not.toContain("Dodavatel:");
    expect(t).toContain("Objednávka OBJ-2026-001");
  });

  it("poznámka je až za položkami, aby ji dodavatel nepřečetl jako díl", () => {
    const t = textObjednavky(order({ note: "Prosím expres." }), dodavatel, produkty);
    const radky = t.split("\n");
    expect(radky[radky.length - 1]).toBe("Poznámka: Prosím expres.");
    expect(radky.findIndex((r) => r.includes("Displej"))).toBeLessThan(radky.length - 1);
  });

  it("bez poznámky nekončí text prázdným řádkem s dvojtečkou", () => {
    expect(textObjednavky(order(), dodavatel, produkty)).not.toContain("Poznámka:");
  });

  it("objednávka bez položek pošle aspoň hlavičku, ne prázdný e-mail", () => {
    expect(textObjednavky(order({ items: [] }), dodavatel, produkty)).toContain("Objednávka OBJ-2026-001");
  });
});

describe("filtr identifikátorů dílů pro server", () => {
  const UUID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
  const UUID2 = "9c858901-8a57-4791-81fe-4c455b099bc9";

  it("propustí jen uuid – lokální produkt s jiným id by dotaz na server shodil", () => {
    expect(jenUuid([UUID, "produkt-z-ceniku", "", "123"])).toEqual([UUID]);
  });

  it("stejný díl vybraný dvakrát pošle jen jednou", () => {
    expect(jenUuid([UUID, UUID, UUID2])).toEqual([UUID, UUID2]);
  });

  it("prázdný nebo chybějící seznam neznamená chybu, ale prázdný výsledek", () => {
    expect(jenUuid([])).toEqual([]);
    expect(jenUuid(null)).toEqual([]);
    expect(jenUuid(undefined)).toEqual([]);
  });

  it("nepustí dál skoro-uuid, které by databáze odmítla", () => {
    expect(jenUuid([UUID.slice(0, -1)])).toEqual([]);
    expect(jenUuid([`${UUID}x`])).toEqual([]);
    expect(jenUuid([` ${UUID} `])).toEqual([]);
  });
});
