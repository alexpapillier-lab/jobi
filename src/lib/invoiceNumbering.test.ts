/**
 * Číslo dokladu a variabilní symbol.
 *
 * Číslo faktury musí být v řadě jedinečné – dvě faktury se stejným číslem
 * účetní neuzná a servis je dohledává ručně. Když navíc odpadne server,
 * nesmí se stát, že se doklad vůbec nezaloží: raději náhradní číslo, které
 * půjde přepsat, než ztracená faktura.
 *
 * Variabilní symbol je to jediné, podle čeho servis pozná, která platba
 * na účtu patří které faktuře. Když do něj proteče písmeno, banka platbu
 * nespáruje vůbec.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

let rpcOdpoved: { data: unknown; error: unknown } = { data: null, error: null };
const rpcVolani: Array<{ fn: string; args: Record<string, unknown> }> = [];

vi.mock("./typedSupabase", () => ({
  typedSupabase: {
    rpc: (fn: string, args: Record<string, unknown>) => {
      rpcVolani.push({ fn, args });
      return Promise.resolve(rpcOdpoved);
    },
  },
}));

const { generateInvoiceNumber, invoiceNumberToVS } = await import("./invoiceNumbering");

const SID = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  rpcVolani.length = 0;
  rpcOdpoved = { data: null, error: null };
});

describe("přidělení čísla faktury", () => {
  it("použije číslo z databáze – jen ta umí zaručit, že se řada nezopakuje", async () => {
    rpcOdpoved = { data: "FV2026-0042", error: null };
    expect(await generateInvoiceNumber(SID, "FV", 2026)).toBe("FV2026-0042");
    expect(rpcVolani[0].fn).toBe("next_invoice_number");
    expect(rpcVolani[0].args).toEqual({ p_service_id: SID, p_prefix: "FV", p_year: 2026 });
  });

  it("každý druh dokladu si říká o vlastní řadu podle předpony", async () => {
    rpcOdpoved = { data: "ZF2026-0001", error: null };
    await generateInvoiceNumber(SID, "ZF", 2026);
    expect(rpcVolani[0].args.p_prefix).toBe("ZF");
  });

  it("bez zadaného roku se čísluje v aktuálním roce, ne v roce nula", async () => {
    rpcOdpoved = { data: "FV2030-0001", error: null };
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2030, 5, 15));
    try {
      await generateInvoiceNumber(SID, "FV");
    } finally {
      vi.useRealTimers();
    }
    expect(rpcVolani[0].args.p_year).toBe(2030);
  });
});

describe("přidělení čísla, když server nefunguje", () => {
  const naNahradniCislo = async () => generateInvoiceNumber(SID, "FV", 2026);

  it("při chybě databáze vrátí náhradní číslo s předponou a rokem, ne prázdný řetězec", async () => {
    rpcOdpoved = { data: null, error: { message: "function next_invoice_number does not exist" } };
    const cislo = await naNahradniCislo();
    expect(cislo.startsWith("FV2026-")).toBe(true);
    expect(cislo.length).toBeGreaterThan("FV2026-".length);
  });

  it("prázdnou odpověď bere jako selhání – doklad bez čísla by se neuložil", async () => {
    rpcOdpoved = { data: "", error: null };
    expect(await naNahradniCislo()).not.toBe("");
    rpcOdpoved = { data: 12345, error: null };
    expect((await naNahradniCislo()).startsWith("FV2026-")).toBe(true);
  });

  it("dvě náhradní čísla vydaná v různý okamžik se neshodují", async () => {
    rpcOdpoved = { data: null, error: { message: "offline" } };
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-03-01T10:00:00Z"));
      const prvni = await naNahradniCislo();
      vi.setSystemTime(new Date("2026-03-01T10:05:00Z"));
      const druhe = await naNahradniCislo();
      expect(druhe).not.toBe(prvni);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("variabilní symbol z čísla dokladu", () => {
  it("obsahuje jen číslice – banka písmena z předpony nespáruje", () => {
    expect(invoiceNumberToVS("FV2026-0042")).toBe("20260042");
    expect(invoiceNumberToVS("DB2026-7")).toBe("20267");
    expect(/^\d*$/.test(invoiceNumberToVS("FV/2026/0042"))).toBe(true);
  });

  it("nikdy není delší než deset číslic, které banka na VS připouští", () => {
    expect(invoiceNumberToVS("FV2026-000000123456789")).toBe("2026000000");
    expect(invoiceNumberToVS("FV2026-000000123456789").length).toBe(10);
  });

  it("z čísla bez číslic vyjde prázdno, ne písmena", () => {
    expect(invoiceNumberToVS("KONCEPT")).toBe("");
    expect(invoiceNumberToVS("")).toBe("");
  });
});

afterEach(() => {
  vi.useRealTimers();
});
