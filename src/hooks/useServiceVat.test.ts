import { describe, it, expect, vi } from "vitest";

// Hook sahá na databázi; tady jde jen o čistý výpočet vedle něj.
vi.mock("../lib/supabaseClient", () => ({ supabase: null }));

const { sazbaProNovouPolozku, VYCHOZI_DPH } = await import("./useServiceVat");

/**
 * Sazba DPH u nové položky faktury.
 *
 * Neplátce DPH nesmí dostat na fakturu 21 %. Kdyby ji dostal, buď to
 * technik u každého řádku ručně přepisuje, nebo pošle zákazníkovi doklad
 * s daní, kterou nemá právo vybírat – a to řeší až účetní nebo finanční
 * úřad.
 */
describe("sazba DPH pro novou položku faktury", () => {
  it("neplátce DPH dostane nulovou sazbu, i když má v nastavení uloženo 21 %", () => {
    expect(sazbaProNovouPolozku({ vatPayer: false, defaultVatRate: 21 })).toBe(0);
  });

  it("plátce dostane sazbu, kterou má servis nastavenou", () => {
    expect(sazbaProNovouPolozku({ vatPayer: true, defaultVatRate: 21 })).toBe(21);
  });

  it("snížená sazba servisu se respektuje, nepřepíše se na základní", () => {
    expect(sazbaProNovouPolozku({ vatPayer: true, defaultVatRate: 12 })).toBe(12);
  });

  it("plátce s nulovou sazbou (vývoz, přenesená daňová povinnost) dostane nulu", () => {
    expect(sazbaProNovouPolozku({ vatPayer: true, defaultVatRate: 0 })).toBe(0);
  });

  it("neplátce má nulu i při nesmyslné uložené sazbě", () => {
    expect(sazbaProNovouPolozku({ vatPayer: false, defaultVatRate: -5 })).toBe(0);
    expect(sazbaProNovouPolozku({ vatPayer: false, defaultVatRate: Number.NaN })).toBe(0);
  });
});

/**
 * Výchozí hodnoty se použijí, dokud se nastavení nenačte a taky když se
 * načíst nepodaří. Kdyby se tiše změnily, servis by chvíli fakturoval
 * podle něčeho jiného, než má v nastavení.
 */
describe("výchozí nastavení DPH", () => {
  it("před načtením se servis chová jako plátce se základní sazbou", () => {
    expect(VYCHOZI_DPH.vatPayer).toBe(true);
    expect(VYCHOZI_DPH.defaultVatRate).toBe(21);
    expect(VYCHOZI_DPH.pricesIncludeVat).toBe(true);
  });

  it("výchozí hodnoty projdou stejným výpočtem jako uložené nastavení", () => {
    expect(sazbaProNovouPolozku(VYCHOZI_DPH)).toBe(21);
  });
});
