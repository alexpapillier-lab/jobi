import { describe, expect, it } from "vitest";
import { ibanZCislaUctu } from "./banka";

describe("ibanZCislaUctu", () => {
  it("odvodí IBAN z příkladu ČNB (19-2000145399/0800 → CZ65 0800 0000 1920 0014 5399)", () => {
    expect(ibanZCislaUctu("19-2000145399/0800")).toBe("CZ6508000000192000145399");
  });

  it("zvládne účet bez předčíslí a s mezerami", () => {
    expect(ibanZCislaUctu(" 2000145399 / 0800 ")).toBe("CZ7908000000002000145399");
  });

  it("vrátí null pro cizí tvar", () => {
    expect(ibanZCislaUctu("DE89370400440532013000")).toBeNull();
    expect(ibanZCislaUctu("")).toBeNull();
    expect(ibanZCislaUctu(undefined)).toBeNull();
  });
});

/** Kontrola IBAN podle ISO 7064: přesunout „CZkk“ na konec, písmena na čísla, mod 97 = 1. */
function ibanPlatny(iban: string): boolean {
  const s = iban.slice(4) + iban.slice(0, 4);
  const cislice = s.replace(/[A-Z]/g, (ch) => String(ch.charCodeAt(0) - 55));
  let z = 0;
  for (const c of cislice) z = (z * 10 + (c.charCodeAt(0) - 48)) % 97;
  return z === 1;
}

describe("ibanZCislaUctu – hraniční případy", () => {
  it("předčíslí s nulami, nulové předčíslí a nadlimitní délky", () => {
    expect(ibanZCislaUctu("000019-2000145399/0800")).toBe("CZ6508000000192000145399");
    expect(ibanZCislaUctu("0-2000145399/0800")).toBe("CZ7908000000002000145399");
    expect(ibanZCislaUctu("1234567-2000145399/0800")).toBeNull();
    expect(ibanZCislaUctu("12345678901/0800")).toBeNull();
    expect(ibanZCislaUctu("5/0800")).toBeNull();
    expect(ibanZCislaUctu("2000145399/800")).toBeNull();
    expect(ibanZCislaUctu("2000145399/08000")).toBeNull();
  });

  it("chybějící lomítko, přípony a en-dash vrací null; hotový IBAN se vrátí beze změny", () => {
    expect(ibanZCislaUctu("19-2000145399")).toBeNull();
    expect(ibanZCislaUctu("19-2000145399/0800 CZK")).toBeNull();
    expect(ibanZCislaUctu("CZ6508000000192000145399")).toBe("CZ6508000000192000145399");
    expect(ibanZCislaUctu("CZ65 0800 0000 1920 0014 5399")).toBe("CZ6508000000192000145399");
    expect(ibanZCislaUctu("19–2000145399/0800")).toBeNull();
    expect(ibanZCislaUctu(null)).toBeNull();
    expect(ibanZCislaUctu("   ")).toBeNull();
  });

  it("vždy 24 znaků, dvoumístná kontrola a platný kontrolní součet ISO 7064", () => {
    for (const u of ["10/0100", "99/2010", "123456-1234567890/0300", "77-11/5500", "1000000000/6210", "1234567891/0100"]) {
      const iban = ibanZCislaUctu(u);
      expect(iban, u).not.toBeNull();
      expect(iban).toHaveLength(24);
      expect(iban).toMatch(/^CZ\d{22}$/);
      expect(ibanPlatny(iban!), u).toBe(true);
    }
  });

  it("neověřuje modulo 11 českého čísla účtu – nesmyslné číslo projde (nález, nízká)", () => {
    expect(ibanZCislaUctu("1234567891/0100")).not.toBeNull();
  });
});
