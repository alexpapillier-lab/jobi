import { describe, it, expect } from "vitest";
import { normalizeError, formatInviteEmailReason } from "./errorNormalizer";

describe("normalizeError", () => {
  it("returns 'Neznámá chyba' for falsy input", () => {
    expect(normalizeError(null)).toBe("Neznámá chyba");
    expect(normalizeError(undefined)).toBe("Neznámá chyba");
  });

  it("returns permission message for Not authorized", () => {
    expect(normalizeError(new Error("Not authorized"))).toBe("Nemáte oprávnění k této akci");
  });

  it("returns permission message for PGRST301", () => {
    const err = Object.assign(new Error("xyz"), { code: "PGRST301" });
    expect(normalizeError(err)).toBe("Nemáte oprávnění k této akci");
  });

  it("returns cloud maintenance message for 503", () => {
    expect(normalizeError(new Error("Service 503 unavailable"))).toContain("Cloud je dočasně nedostupný");
  });

  it("returns network message for fetch errors", () => {
    expect(normalizeError(new Error("Failed to fetch"))).toContain("Nelze se připojit k cloudu");
  });

  it("returns PGRST116 as 'Položka nebyla nalezena'", () => {
    const err = Object.assign(new Error("Row not found"), { code: "PGRST116" });
    expect(normalizeError(err)).toBe("Položka nebyla nalezena");
  });

  it("returns original message for unknown errors", () => {
    expect(normalizeError(new Error("Some custom error"))).toBe("Some custom error");
  });
});

describe("formatInviteEmailReason", () => {
  it("returns default for empty reason", () => {
    expect(formatInviteEmailReason("")).toBe("E-mail se nepodařilo odeslat.");
  });

  it("returns Resend domain hint for 403 + your own email", () => {
    const r = "403 - you can only send to your own email until you verify a domain";
    expect(formatInviteEmailReason(r)).toContain("onboarding@resend.dev");
    expect(formatInviteEmailReason(r)).toContain("ověř doménu");
  });

  it("returns original reason for unrelated errors", () => {
    expect(formatInviteEmailReason("Rate limit exceeded")).toBe("Rate limit exceeded");
  });
});
