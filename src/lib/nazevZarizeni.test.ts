import { describe, expect, it } from "vitest";
import { nazevSeZnackou } from "./nazevZarizeni";

describe("nazevSeZnackou", () => {
  it("přidá značku, když ji model neobsahuje", () => {
    expect(nazevSeZnackou("Apple", "iPhone 16")).toBe("Apple iPhone 16");
  });
  it("nezdvojí značku, kterou model už má (Dyson Dyson V15)", () => {
    expect(nazevSeZnackou("Dyson", "Dyson V15")).toBe("Dyson V15");
    expect(nazevSeZnackou("Dyson", "dyson V15 Detect")).toBe("dyson V15 Detect");
  });
  it("nespletí značku s jiným slovem na začátku modelu", () => {
    expect(nazevSeZnackou("Mi", "Mix 4")).toBe("Mi Mix 4");
  });
  it("zvládne prázdné hodnoty", () => {
    expect(nazevSeZnackou("", "V15")).toBe("V15");
    expect(nazevSeZnackou(null, " V15 ")).toBe("V15");
    expect(nazevSeZnackou("Dyson", "")).toBe("Dyson");
  });
});
