import { describe, it, expect } from "vitest";
import { formatJobiDocsErrorForUser } from "./jobidocs";

describe("formatJobiDocsErrorForUser", () => {
  it("returns default for empty/undefined input", () => {
    expect(formatJobiDocsErrorForUser(undefined)).toBe("Neznámá chyba JobiDocs.");
    expect(formatJobiDocsErrorForUser("")).toBe("Neznámá chyba JobiDocs.");
    expect(formatJobiDocsErrorForUser("   ")).toBe("Neznámá chyba JobiDocs.");
  });

  it("appends guidance for 'not found' errors", () => {
    const result = formatJobiDocsErrorForUser("Template not found for doc_type zakazkovy_list");
    expect(result).toContain("not found");
    expect(result).toContain("zkontrolujte");
    expect(result).toContain("šablona");
  });

  it("appends guidance for 'nenalezen' errors (Czech)", () => {
    const result = formatJobiDocsErrorForUser("Šablona nenalezena");
    expect(result).toContain("nenalezena");
    expect(result).toContain("restartujte JobiDocs");
  });

  it("appends guidance for 'not_found' errors", () => {
    const result = formatJobiDocsErrorForUser("doc_type not_found");
    expect(result).toContain("not_found");
    expect(result).toContain("zkontrolujte");
  });

  it("returns original message for other errors", () => {
    expect(formatJobiDocsErrorForUser("Printer offline")).toBe("Printer offline");
    expect(formatJobiDocsErrorForUser("Timeout")).toBe("Timeout");
  });
});
