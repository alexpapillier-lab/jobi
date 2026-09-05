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
