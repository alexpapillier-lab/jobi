import { describe, it, expect } from "vitest";
import { scrubPII } from "./errorLog";

describe("scrubPII", () => {
  it("odstraní e-mail", () => {
    expect(scrubPII("Chyba u jan.novak@example.com při uložení")).toBe(
      "Chyba u [email] při uložení"
    );
  });

  it("odstraní telefon včetně předvolby a mezer", () => {
    expect(scrubPII("Zákazník +420 777 123 456 nedostupný")).toBe(
      "Zákazník [telefon] nedostupný"
    );
  });

  it("odstraní telefon bez mezer", () => {
    expect(scrubPII("tel 777123456 selhal")).toBe("tel [telefon] selhal");
  });

  it("odstraní IMEI", () => {
    expect(scrubPII("IMEI 356938035643809 nenalezeno")).toContain("nenalezeno");
    expect(scrubPII("IMEI 356938035643809 nenalezeno")).not.toContain("356938035643809");
  });

  it("ponechá UUID – je to technický identifikátor, ne osobní údaj", () => {
    const uuid = "8071ff8d-f4ff-4faa-9691-1064d63dbebc";
    expect(scrubPII(`ticket ${uuid} nenalezen`)).toContain(uuid);
  });

  it("ponechá běžnou technickou hlášku beze změny", () => {
    const msg = "PGRST116: JSON object requested, multiple rows returned";
    expect(scrubPII(msg)).toBe(msg);
  });

  it("zvládne prázdný vstup", () => {
    expect(scrubPII("")).toBe("");
  });

  it("ořízne příliš dlouhý text", () => {
    expect(scrubPII("x".repeat(900)).length).toBeLessThanOrEqual(500);
  });

  it("odstraní víc údajů najednou", () => {
    const out = scrubPII("a@b.cz volal 777123456");
    expect(out).not.toContain("a@b.cz");
    expect(out).not.toContain("777123456");
  });
});

describe("ID relace", () => {
  it("je stabilní po celý běh aplikace", async () => {
    const { getSessionId } = await import("./errorLog");
    expect(getSessionId()).toBe(getSessionId());
  });

  it("má tvar, který jde nadiktovat do hlášení", async () => {
    const { getSessionId } = await import("./errorLog");
    // 16 hex znaků – dost na rozlišení, ještě se dá přečíst do telefonu
    expect(getSessionId()).toMatch(/^[0-9a-f]{16}$/);
  });
});
