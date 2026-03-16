import { describe, it, expect } from "vitest";
import {
  trackDocumentAction,
  getDocumentTelemetryStats,
  validateDocumentVariables,
  validateHtmlSize,
} from "./documentTelemetry";

describe("trackDocumentAction + getDocumentTelemetryStats", () => {
  it("tracks events and returns stats", () => {
    trackDocumentAction({ action: "print", docType: "zakazkovy_list", result: "success", durationMs: 500 });
    trackDocumentAction({ action: "export", docType: "zarucni_list", result: "error", durationMs: 1000, errorMessage: "timeout" });
    trackDocumentAction({ action: "export", docType: "zakazkovy_list", result: "fallback", durationMs: 800, usedFallback: true });

    const stats = getDocumentTelemetryStats();
    expect(stats.total).toBeGreaterThanOrEqual(3);
    expect(stats.success).toBeGreaterThanOrEqual(1);
    expect(stats.error).toBeGreaterThanOrEqual(1);
    expect(stats.fallback).toBeGreaterThanOrEqual(1);
    expect(stats.avgDurationMs).toBeGreaterThan(0);
  });
});

describe("validateDocumentVariables", () => {
  it("passes valid variables", () => {
    const result = validateDocumentVariables({
      ticket_code: "Z25000001",
      customer_name: "Test",
      photo_urls: "[]",
      repair_items: "[]",
    });
    expect(result.valid).toBe(true);
    expect(result.warnings).toHaveLength(0);
  });

  it("warns about invalid photo_urls JSON", () => {
    const result = validateDocumentVariables({ photo_urls: "not-json" });
    expect(result.valid).toBe(false);
    expect(result.warnings).toContain("photo_urls is not valid JSON");
  });

  it("warns about disallowed photo URL protocols", () => {
    const result = validateDocumentVariables({
      photo_urls: JSON.stringify(["javascript:alert(1)", "https://ok.com/img.jpg"]),
    });
    expect(result.valid).toBe(false);
    expect(result.warnings.some((w) => w.includes("disallowed protocol"))).toBe(true);
  });

  it("passes valid https photo URLs", () => {
    const result = validateDocumentVariables({
      photo_urls: JSON.stringify(["https://example.com/a.jpg"]),
    });
    expect(result.valid).toBe(true);
  });

  it("passes valid data: photo URLs", () => {
    const result = validateDocumentVariables({
      photo_urls: JSON.stringify(["data:image/png;base64,abc"]),
    });
    expect(result.valid).toBe(true);
  });

  it("warns about invalid repair_items JSON", () => {
    const result = validateDocumentVariables({ repair_items: "{bad" });
    expect(result.valid).toBe(false);
    expect(result.warnings).toContain("repair_items is not valid JSON");
  });
});

describe("validateHtmlSize", () => {
  it("passes small HTML", () => {
    const result = validateHtmlSize("<html><body>Hello</body></html>");
    expect(result.valid).toBe(true);
  });

  it("warns about oversized HTML", () => {
    const bigHtml = "x".repeat(3 * 1024 * 1024);
    const result = validateHtmlSize(bigHtml);
    expect(result.valid).toBe(false);
    expect(result.warnings.some((w) => w.includes("exceeds limit"))).toBe(true);
  });
});
