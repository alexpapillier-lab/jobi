import { describe, it, expect } from "vitest";
import { hraniceDotazeni, promitniRadek } from "./useRealtimeZakazek";
import type { EvidenceZapisu } from "../../../lib/slouceniZakazky";
import type { TicketEx } from "../typy";

const bezZapisu: EvidenceZapisu = { bezici: new Map(), odlozene: new Set(), neulozene: new Set() };
const radek = (id: string, x: Record<string, unknown> = {}) => ({
  id,
  service_id: "s1",
  code: id.toUpperCase(),
  status: "received",
  created_at: "2026-10-27T08:00:00Z",
  updated_at: "2026-10-27T08:00:00Z",
  deleted_at: null,
  ...x,
});

describe("hraniceDotazeni", () => {
  it("od nejnovější změny v seznamu minus dvě minuty rezervy", () => {
    const s = [{ updatedAt: "2026-10-27T08:00:00.000Z" }, { updatedAt: "2026-10-27T09:30:00.000Z" }, { updatedAt: null }];
    expect(hraniceDotazeni(s as Pick<TicketEx, "updatedAt">[])).toBe("2026-10-27T09:28:00.000Z");
  });
  it("prázdný seznam: poslední den", () => {
    const ted = Date.parse("2026-10-27T10:00:00Z");
    expect(hraniceDotazeni([], ted)).toBe("2026-10-26T10:00:00.000Z");
  });
});

describe("promitniRadek", () => {
  it("zakázka přidaná odjinud se zařadí nahoru podle data založení", () => {
    const prev = promitniRadek([], radek("a"), bezZapisu);
    const dalsi = promitniRadek(prev, radek("b", { created_at: "2026-10-27T09:00:00Z" }), bezZapisu);
    expect(dalsi.map((t) => t.id)).toEqual(["b", "a"]);
  });
  it("změna stavu existující zakázky se promítne", () => {
    const prev = promitniRadek([], radek("a"), bezZapisu);
    const dalsi = promitniRadek(prev, radek("a", { status: "ready", updated_at: "2026-10-27T09:00:00Z" }), bezZapisu);
    expect(dalsi).toHaveLength(1);
    expect(dalsi[0].status).toBe("ready");
  });
  it("smazaná zakázka ze seznamu zmizí; neznámá smazaná nic nemění", () => {
    const prev = promitniRadek([], radek("a"), bezZapisu);
    expect(promitniRadek(prev, radek("a", { deleted_at: "2026-10-27T09:00:00Z" }), bezZapisu)).toEqual([]);
    expect(promitniRadek(prev, radek("x", { deleted_at: "2026-10-27T09:00:00Z" }), bezZapisu)).toBe(prev);
  });
});

describe("promitniRadek – rozepsaná diagnostika otevřené zakázky", () => {
  // IRP26000284, 27. 10. 2026: text a fotka v diagnostice zmizely po návratu
  // do okna (uložení PDF), protože dotažený řádek z databáze je přepsal prázdnem.
  const sRozepsanou = () => {
    const prev = promitniRadek([], radek("a", { diagnostic_text: "", diagnostic_photos: [] }), bezZapisu);
    return prev.map((t) => ({ ...t, diagnosticText: "Prasklé tlačítko", diagnosticPhotos: ["f1.jpg"] }));
  };
  const zDb = radek("a", { diagnostic_text: "", diagnostic_photos: [], status: "ready", updated_at: "2026-10-27T09:00:00Z" });

  it("otevřená zakázka s rozepsaným textem a fotkou si je podrží, zbytek se převezme", () => {
    const detail = { id: "a", rozepsane: { diagnosticText: true, diagnosticPhotos: true, performedRepairs: false } };
    const [t] = promitniRadek(sRozepsanou(), zDb, bezZapisu, detail);
    expect(t.diagnosticText).toBe("Prasklé tlačítko");
    expect(t.diagnosticPhotos).toEqual(["f1.jpg"]);
    expect(t.status).toBe("ready");
  });

  it("bez rozepsaného nebo u jiné zakázky se převezme databáze", () => {
    const nic = { diagnosticText: false, diagnosticPhotos: false, performedRepairs: false };
    expect(promitniRadek(sRozepsanou(), zDb, bezZapisu, { id: "a", rozepsane: nic })[0].diagnosticText).toBeFalsy();
    const jina = { id: "b", rozepsane: { ...nic, diagnosticText: true, diagnosticPhotos: true } };
    expect(promitniRadek(sRozepsanou(), zDb, bezZapisu, jina)[0].diagnosticPhotos ?? []).toEqual([]);
  });
});
