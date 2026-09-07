import { describe, it, expect } from "vitest";
import { SLOUPCE_SEZNAMU, SLOUPCE_DETAILU, jePlnyRadekZakazky } from "./sloupceZakazky";

const seznam = SLOUPCE_SEZNAMU.split(",");
const detail = SLOUPCE_DETAILU.split(",");

describe("sloupce zakázky", () => {
  it("seznam je podmnožinou detailu (kromě service_id, které se doplňuje z proměnné)", () => {
    for (const s of seznam) expect(detail, `sloupec ${s} chybí v detailu`).toContain(s);
    expect(seznam).not.toContain("service_id");
    expect(detail).toContain("service_id");
  });

  it("seznam obsahuje vše, z čeho se skládá karta, hledání a filtry", () => {
    // Kdyby některý z nich vypadl, seznam by tiše přestal hledat nebo by na
    // kartě zmizela cena – a poznalo by se to až u zákazníka.
    for (const s of [
      "id",
      "code", // karta + hledání
      "customer_name", // karta + hledání
      "customer_phone", // hledání + odznak nepřečtených SMS
      "title", // zařízení na kartě + hledání
      "device_serial", // hledání + historie zařízení
      "notes", // závada na kartě + hledání
      "external_id", // hledání
      "status", // filtr, seskupení, počty u záložek
      "created_at", // datum na kartě a řazení
      "performed_repairs", // cena na kartě
      "discount_type",
      "discount_value",
      "branch_id", // filtr poboček
    ]) {
      expect(seznam, `seznam potřebuje ${s}`).toContain(s);
    }
  });

  it("detail obsahuje vše, co se zapisuje zpátky při uložení zakázky", () => {
    // Uložení posílá celý řádek složený z paměti. Co by v téhle sadě chybělo,
    // to by se do databáze uložilo prázdné.
    for (const s of [
      "customer_id",
      "customer_email",
      "customer_address_street",
      "customer_address_city",
      "customer_address_zip",
      "customer_company",
      "customer_ico",
      "customer_info",
      "device_passcode",
      "device_condition",
      "device_accessories",
      "device_note",
      "handoff_method",
      "handback_method",
      "estimated_price",
      "diagnostic_text",
      "diagnostic_photos",
      "diagnostic_photos_before",
      "expected_completion_at",
      // Tyhle tři chyběly v selectu za uložením a mizely z paměti po každém
      // uložení detailu: kontrola po opravě, zápůjčka a pobočka.
      "test_checklist",
      "loaner",
      "branch_id",
      "version", // souběžná úprava (optimistický zámek)
    ]) {
      expect(detail, `detail potřebuje ${s}`).toContain(s);
    }
  });

  it("neobsahuje sloupec dvakrát", () => {
    expect(new Set(seznam).size).toBe(seznam.length);
    expect(new Set(detail).size).toBe(detail.length);
  });

  it("pozná plný řádek podle přítomnosti klíče, ne podle hodnoty", () => {
    const radekSeznamu = Object.fromEntries(seznam.map((s) => [s, null]));
    const radekDetailu = Object.fromEntries(detail.map((s) => [s, null]));
    expect(jePlnyRadekZakazky(radekSeznamu)).toBe(false);
    // Prázdná diagnostika je běžný stav – rozhoduje klíč, ne obsah.
    expect(jePlnyRadekZakazky(radekDetailu)).toBe(true);
    expect(jePlnyRadekZakazky({ ...radekDetailu, diagnostic_text: "" })).toBe(true);
    expect(jePlnyRadekZakazky(null)).toBe(false);
    expect(jePlnyRadekZakazky(undefined)).toBe(false);
  });
});
