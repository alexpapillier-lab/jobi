import { describe, it, expect } from "vitest";
import { normalizePhone } from "./phone";

describe("normalizePhone", () => {
  it("returns null for empty/falsy input", () => {
    expect(normalizePhone(null)).toBeNull();
    expect(normalizePhone(undefined)).toBeNull();
    expect(normalizePhone("")).toBeNull();
  });

  it("removes spaces, dashes, parentheses", () => {
    expect(normalizePhone("123 456 789")).toBe("+420123456789");
    expect(normalizePhone("123-456-789")).toBe("+420123456789");
    expect(normalizePhone("(123) 456-789")).toBe("+420123456789");
  });

  it("converts 00 to +", () => {
    expect(normalizePhone("00420123456789")).toBe("+420123456789");
  });

  it("keeps + prefix as is", () => {
    expect(normalizePhone("+420123456789")).toBe("+420123456789");
  });

  it("adds +420 for numbers without country code", () => {
    expect(normalizePhone("123456789")).toBe("+420123456789");
  });

  it("returns null for too short numbers", () => {
    expect(normalizePhone("+")).toBeNull(); // + alone is invalid
    expect(normalizePhone("   ")).toBeNull(); // only whitespace becomes empty
  });

  it("removes non-numeric chars except +", () => {
    expect(normalizePhone("abc123456789xyz")).toBe("+420123456789");
  });
});
