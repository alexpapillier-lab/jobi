import { describe, expect, it } from "vitest";
import { formularZmenen } from "./formularZmeny";

describe("formularZmenen", () => {
  const zaklad = { customerName: "Jan", customerEmail: "", estimatedPrice: 3490, expectedCompletionAt: null };

  it("předvyplněný formulář beze změny není změna", () => {
    expect(formularZmenen(zaklad, { ...zaklad })).toBe(false);
  });

  it("prázdné hodnoty jsou stejné (undefined, null, \"\")", () => {
    expect(formularZmenen(zaklad, { ...zaklad, customerEmail: undefined, expectedCompletionAt: "" })).toBe(false);
  });

  it("přepsané nebo nově vyplněné pole je změna", () => {
    expect(formularZmenen(zaklad, { ...zaklad, customerName: "Jana" })).toBe(true);
    expect(formularZmenen(zaklad, { ...zaklad, estimatedPrice: undefined })).toBe(true);
    expect(formularZmenen(zaklad, { ...zaklad, warrantyUntil: "2027-01-01" })).toBe(true);
  });

  it("bez základu se bere každé vyplněné pole jako změna", () => {
    expect(formularZmenen(null, {})).toBe(false);
    expect(formularZmenen(null, { customerName: "Jan" })).toBe(true);
  });
});
