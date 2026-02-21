import { describe, it, expect } from "vitest";
import { STATUS_COLOR_PALETTE, getContrastText } from "./statusColors";

describe("STATUS_COLOR_PALETTE", () => {
  it("has 75 colors", () => {
    expect(STATUS_COLOR_PALETTE).toHaveLength(75);
  });

  it("each color has bg, fg, name", () => {
    for (const c of STATUS_COLOR_PALETTE) {
      expect(c.bg).toMatch(/^#[0-9A-Fa-f]{6}$/);
      expect(c.fg).toMatch(/^#[0-9A-Fa-f]{6}$/);
      expect(typeof c.name).toBe("string");
      expect(c.name.length).toBeGreaterThan(0);
    }
  });
});

describe("getContrastText", () => {
  it("returns dark text for light background", () => {
    expect(getContrastText("#FFFFFF")).toBe("#111827");
    expect(getContrastText("#F9FAFB")).toBe("#111827");
    expect(getContrastText("#FCD34D")).toBe("#111827");
  });

  it("returns light text for dark background", () => {
    expect(getContrastText("#000000")).toBe("#F9FAFB");
    expect(getContrastText("#111827")).toBe("#F9FAFB");
    expect(getContrastText("#1E3A8A")).toBe("#F9FAFB");
  });

  it("handles hex with or without #", () => {
    expect(getContrastText("FFFFFF")).toBe("#111827");
  });
});
