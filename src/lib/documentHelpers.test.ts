import { describe, it, expect } from "vitest";
import { escapeHtmlForDoc } from "./documentHelpers";

describe("escapeHtmlForDoc", () => {
  it("escapes ampersand", () => {
    expect(escapeHtmlForDoc("A & B")).toBe("A &amp; B");
  });

  it("escapes angle brackets", () => {
    expect(escapeHtmlForDoc("<script>")).toBe("&lt;script&gt;");
  });

  it("escapes double quotes", () => {
    expect(escapeHtmlForDoc('He said "hi"')).toBe("He said &quot;hi&quot;");
  });

  it("handles empty string", () => {
    expect(escapeHtmlForDoc("")).toBe("");
  });
});
