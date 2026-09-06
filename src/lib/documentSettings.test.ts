import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * Nastavení dokumentů je jeden JSON sloupec, takže každý zápis musí nejdřív
 * načíst, co v databázi je. Kdyby se „nepodařilo načíst“ spletlo s „ještě
 * tam nic není“, uložil by se jen právě měněný kousek – a servis by přišel
 * o šablony i firemní údaje kvůli jedné vteřině bez signálu.
 */

let ctenaOdpoved: { data: unknown; error: unknown } = { data: null, error: null };
const zapsano: unknown[] = [];
let zapisChyba: unknown = null;

vi.mock("./supabaseClient", () => ({
  supabase: {
    from() {
      return {
        select() {
          return {
            eq() {
              return { maybeSingle: async () => ctenaOdpoved };
            },
          };
        },
        upsert(radek: unknown) {
          if (zapisChyba) return Promise.resolve({ error: zapisChyba });
          zapsano.push(radek);
          return Promise.resolve({ error: null });
        },
      };
    },
  },
}));
vi.mock("./errorLog", () => ({ logError: async () => {} }));

const { saveDocumentsConfigAutoPrint, saveDocumentsConfigWarrantyCertificate, loadDocumentsConfigRawFromDB } =
  await import("./documentSettings");

const SID = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  zapsano.length = 0;
  zapisChyba = null;
  ctenaOdpoved = { data: null, error: null };
});

describe("nastavení dokumentů", () => {
  it("zachová zbytek configu", async () => {
    ctenaOdpoved = { data: { config: { sablony: ["A"], companyData: { ico: "123" } }, version: 3 }, error: null };
    const ok = await saveDocumentsConfigAutoPrint(SID, { warrantyOnCreate: true });
    expect(ok).toBe(true);
    expect(zapsano[0]).toEqual({
      service_id: SID,
      config: { sablony: ["A"], companyData: { ico: "123" }, autoPrint: { warrantyOnCreate: true } },
    });
  });

  it("při chybě čtení radši neuloží nic", async () => {
    ctenaOdpoved = { data: null, error: { message: "Failed to fetch" } };
    const ok = await saveDocumentsConfigAutoPrint(SID, { warrantyOnCreate: true });
    expect(ok).toBe(false);
    expect(zapsano).toHaveLength(0);
  });

  it("nový servis bez řádku uloží jen svou část", async () => {
    ctenaOdpoved = { data: null, error: null };
    const ok = await saveDocumentsConfigAutoPrint(SID, { warrantyOnCreate: true });
    expect(ok).toBe(true);
    expect(zapsano[0]).toEqual({ service_id: SID, config: { autoPrint: { warrantyOnCreate: true } } });
  });

  it("záruční list se slučuje s tím, co už tam je", async () => {
    ctenaOdpoved = { data: { config: { warrantyCertificate: { warrantyUnifiedDuration: 24, warrantyCustomText: "starý" } }, version: 1 }, error: null };
    await saveDocumentsConfigWarrantyCertificate(SID, { warrantyCustomText: "nový" });
    expect(zapsano[0]).toEqual({
      service_id: SID,
      config: { warrantyCertificate: { warrantyUnifiedDuration: 24, warrantyCustomText: "nový" } },
    });
  });

  it("neúspěšný zápis se pozná", async () => {
    ctenaOdpoved = { data: { config: {}, version: 1 }, error: null };
    zapisChyba = { message: "row-level security" };
    expect(await saveDocumentsConfigAutoPrint(SID, { warrantyOnCreate: true })).toBe(false);
  });

  it("čtení vrátí null, když se nepodaří", async () => {
    ctenaOdpoved = { data: null, error: { message: "nope" } };
    expect(await loadDocumentsConfigRawFromDB(SID)).toBeNull();
  });
});
