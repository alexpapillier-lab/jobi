import { describe, it, expect } from "vitest";
import {
  escapeHtmlForDoc,
  buildTicketVariablesForJobiDocs,
  buildClaimVariablesForJobiDocs,
  getDesignStylesForFallback,
} from "./documentHelpers";
import type { TicketEx } from "../pages/Orders";

function makeTicket(overrides: Partial<TicketEx> = {}): TicketEx {
  return {
    id: "t1",
    code: "Z25000001",
    customerName: "Jan Novák",
    customerPhone: "+420777111222",
    deviceLabel: "iPhone 15",
    serialOrImei: "123456789",
    issueShort: "Rozbitý displej",
    statusKey: "open",
    createdAt: "2025-06-01T10:00:00Z",
    ...overrides,
  } as TicketEx;
}

const sampleCompanyData = {
  name: "Test Servis",
  phone: "+420111222333",
  email: "info@test.cz",
  ico: "12345678",
  dic: "CZ12345678",
  addressStreet: "Ulice 1",
  addressCity: "Praha",
  addressZip: "11000",
};

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

describe("buildTicketVariablesForJobiDocs", () => {
  it("returns all expected keys", () => {
    const vars = buildTicketVariablesForJobiDocs(makeTicket(), sampleCompanyData);
    const expectedKeys = [
      "ticket_code", "order_code", "customer_name", "customer_phone",
      "customer_email", "customer_address", "device_name", "device_serial",
      "device_imei", "device_state", "device_problem", "service_name",
      "service_phone", "service_email", "service_address", "service_ico",
      "service_dic", "repair_date", "repair_completion_date", "total_price",
      "warranty_until", "diagnostic_text", "note", "repair_items",
      "photo_urls", "complaint_code", "reclamation_code", "original_ticket_code",
    ];
    for (const key of expectedKeys) {
      expect(vars).toHaveProperty(key);
    }
  });

  it("maps basic fields correctly", () => {
    const vars = buildTicketVariablesForJobiDocs(makeTicket(), sampleCompanyData);
    expect(vars.ticket_code).toBe("Z25000001");
    expect(vars.customer_name).toBe("Jan Novák");
    expect(vars.device_name).toBe("iPhone 15");
    expect(vars.service_name).toBe("Test Servis");
    expect(vars.service_ico).toBe("12345678");
  });

  it("handles empty performed repairs", () => {
    const vars = buildTicketVariablesForJobiDocs(makeTicket({ performedRepairs: [] }), sampleCompanyData);
    expect(vars.repair_items).toBe("[]");
    expect(vars.total_price).toBe("");
  });

  it("serializes performed repairs correctly", () => {
    const ticket = makeTicket({
      performedRepairs: [
        { id: "r1", name: "Výměna displeje", type: "manual", price: 2500 },
        { id: "r2", name: "Výměna baterie", type: "manual", price: 800 },
      ],
    });
    const vars = buildTicketVariablesForJobiDocs(ticket, sampleCompanyData);
    const items = JSON.parse(vars.repair_items);
    expect(items).toHaveLength(2);
    expect(items[0].name).toBe("Výměna displeje");
    expect(items[0].price).toBe("2500 Kč");
    expect(vars.total_price).toBe("3300 Kč");
  });

  it("handles null/undefined fields gracefully", () => {
    const ticket = makeTicket({
      customerName: undefined as any,
      customerPhone: undefined as any,
      deviceLabel: undefined as any,
    });
    const vars = buildTicketVariablesForJobiDocs(ticket, {});
    expect(vars.customer_name).toBe("");
    expect(vars.customer_phone).toBe("");
    expect(vars.device_name).toBe("");
    expect(vars.service_name).toBe("");
  });

  it("serializes diagnostic photos", () => {
    const ticket = makeTicket({ diagnosticPhotos: ["https://example.com/a.jpg", "https://example.com/b.jpg"] });
    const vars = buildTicketVariablesForJobiDocs(ticket, sampleCompanyData);
    const urls = JSON.parse(vars.photo_urls);
    expect(urls).toEqual(["https://example.com/a.jpg", "https://example.com/b.jpg"]);
  });

  it("returns empty photo_urls array when no photos", () => {
    const vars = buildTicketVariablesForJobiDocs(makeTicket({ diagnosticPhotos: [] }), sampleCompanyData);
    expect(JSON.parse(vars.photo_urls)).toEqual([]);
  });
});

describe("buildClaimVariablesForJobiDocs", () => {
  const claim = {
    id: "c1",
    code: "R25000001",
    customer_name: "Marie Dvořáková",
    customer_phone: "+420666555444",
    customer_email: "marie@test.cz",
    customer_address_street: "Hlavní 5",
    customer_address_city: "Brno",
    customer_address_zip: "60200",
    device_label: "Samsung Galaxy S24",
    device_serial: "SN987654",
    device_imei: "IMEI987654",
    device_condition: "Poškrábané",
    notes: "Nefunguje GPS",
  } as any;

  it("returns all expected keys", () => {
    const vars = buildClaimVariablesForJobiDocs(claim, "Z25000001");
    expect(vars.complaint_code).toBe("R25000001");
    expect(vars.original_ticket_code).toBe("Z25000001");
    expect(vars.customer_name).toBe("Marie Dvořáková");
    expect(vars.device_name).toBe("Samsung Galaxy S24");
    expect(vars.customer_address).toContain("Hlavní 5");
    expect(vars.customer_address).toContain("Brno");
  });

  it("handles missing original ticket code", () => {
    const vars = buildClaimVariablesForJobiDocs(claim);
    expect(vars.original_ticket_code).toBe("");
  });

  it("handles null fields", () => {
    const emptyClaim = { code: null, customer_name: null, device_label: null, notes: null } as any;
    const vars = buildClaimVariablesForJobiDocs(emptyClaim);
    expect(vars.complaint_code).toBe("");
    expect(vars.customer_name).toBe("");
    expect(vars.device_problem).toBe("");
  });
});

describe("getDesignStylesForFallback", () => {
  it("returns classic styles for unknown design type", () => {
    const styles = getDesignStylesForFallback("unknown");
    expect(styles.primaryColor).toBe("#1f2937");
    expect(styles.headerBg).toBe("#f9fafb");
  });

  it("returns classic styles by default", () => {
    const styles = getDesignStylesForFallback("classic");
    expect(styles.primaryColor).toBe("#1f2937");
    expect(styles.bgColor).toBe("#ffffff");
  });

  it("returns modern styles", () => {
    const styles = getDesignStylesForFallback("modern");
    expect(styles.primaryColor).toBe("#1e40af");
  });

  it("returns minimal styles", () => {
    const styles = getDesignStylesForFallback("minimal");
    expect(styles.primaryColor).toBe("#1a1a1a");
    expect(styles.sectionBorder).toBe("none");
  });

  it("returns professional styles", () => {
    const styles = getDesignStylesForFallback("professional");
    expect(styles.primaryColor).toBe("#0f172a");
  });

  it("all designs include required properties", () => {
    for (const design of ["classic", "modern", "minimal", "professional"]) {
      const styles = getDesignStylesForFallback(design);
      expect(styles).toHaveProperty("primaryColor");
      expect(styles).toHaveProperty("secondaryColor");
      expect(styles).toHaveProperty("accentColor");
      expect(styles).toHaveProperty("borderColor");
      expect(styles).toHaveProperty("bgColor");
      expect(styles).toHaveProperty("headerBg");
      expect(styles).toHaveProperty("headerText");
      expect(styles).toHaveProperty("sectionBg");
      expect(styles).toHaveProperty("sectionBorder");
    }
  });
});
