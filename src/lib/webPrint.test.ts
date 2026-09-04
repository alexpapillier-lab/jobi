/**
 * Ověřuje, že jádro JobiDocs jde použít přímo z Jobi.
 *
 * Na tom stojí tisk ve webové verzi: v prohlížeči žádný JobiDocs neběží,
 * takže HTML musí vzniknout tady. Kdyby do jádra někdy přibyla závislost
 * na Node nebo Electronu, tenhle test spadne.
 */
import { describe, it, expect } from "vitest";
import { renderDocument, defaultTemplate, DEFAULT_BRAND, DEFAULT_THEME } from "../../jobidocs/core/index";
import { ticketDocumentData } from "./documentData";
import type { TicketEx } from "../pages/Orders";

const ticket = {
  id: "1",
  code: "J-28A99Z",
  customerName: "Jan Novák",
  customerPhone: "+420 777 123 456",
  deviceLabel: "iPhone 13",
  serialOrImei: "SN123",
  issueShort: "Rozbitý displej",
  status: "received",
  createdAt: "2026-09-01T10:00:00.000Z",
  performedRepairs: [{ id: "r1", name: "Výměna displeje", type: "manual", price: 3490 }],
} as unknown as TicketEx;

const companyData = { name: "Servis Novák", addressStreet: "Dlouhá 5", addressCity: "Praha", addressZip: "110 00", ico: "12345678" };

describe("jádro JobiDocs z Jobi", () => {
  it("sestaví data zakázky a vyrenderuje HTML s reálnými hodnotami", () => {
    const data = ticketDocumentData(ticket, companyData);
    expect(data.number).toBe("J-28A99Z");
    expect(data.items?.[0].total).toBe(3490);
    const html = renderDocument({ template: defaultTemplate("zakazkovy_list"), data, brand: DEFAULT_BRAND, theme: DEFAULT_THEME, options: { mode: "print" } });
    expect(html.toLowerCase()).toContain("<html");
    expect(html).toContain("J-28A99Z");
    expect(html).toContain("Jan Novák");
    expect(html).toContain("1. 9. 2026");
    expect(html).not.toContain("{{");
  });

  it("záruční list vytiskne cenu opravy formátovanou v Kč", () => {
    const data = ticketDocumentData(ticket, companyData, { completedAt: "2026-09-03T10:00:00.000Z", warrantyMonths: 12 });
    const html = renderDocument({ template: defaultTemplate("zarucni_list"), data, brand: DEFAULT_BRAND, theme: DEFAULT_THEME, options: { mode: "print" } });
    expect(html.replace(/\s/g, " ")).toContain("3 490,00 Kč");
    expect(html).toContain("12 měsíců");
  });
});
