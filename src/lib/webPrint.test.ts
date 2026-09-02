/**
 * Ověřuje, že generátor dokumentů z JobiDocs jde použít přímo z Jobi.
 *
 * Na tom stojí tisk ve webové verzi: v prohlížeči žádný JobiDocs neběží,
 * takže HTML musí vzniknout tady. Kdyby do generátoru někdy přibyla
 * závislost na Node nebo Electronu, tenhle test spadne.
 */
import { describe, it, expect } from "vitest";
import { generateDocumentHtml } from "../../jobidocs/src/documentToHtml";

// Pole odpovídají typu CompanyData z src/lib/companyData.ts – generátor
// v JobiDocs čte přesně tyhle názvy, takže se dá předat beze změny.
const companyData = {
  name: "Servis Novák",
  addressStreet: "Dlouhá 5",
  addressCity: "Praha",
  ico: "12345678",
};

const config = {
  colorMode: "color",
  ticketList: { design: "classic" },
};

describe("generateDocumentHtml – použitelnost mimo JobiDocs", () => {
  it("vyrobí HTML dokument", () => {
    const html = generateDocumentHtml(config, "zakazkovy_list", companyData);
    expect(typeof html).toBe("string");
    expect(html.length).toBeGreaterThan(100);
    expect(html.toLowerCase()).toContain("<html");
  });

  it("dosadí předané proměnné místo ukázkových hodnot", () => {
    const html = generateDocumentHtml(config, "zakazkovy_list", companyData, undefined, {
      variables: { ticket_code: "J-28A99Z", customer_name: "Jan Novák" },
      useSampleFallbacks: false,
    });
    expect(html).toContain("J-28A99Z");
  });

  it("promítne název firmy z companyData (shodná pole jako typ CompanyData)", () => {
    const html = generateDocumentHtml(config, "zakazkovy_list", companyData);
    expect(html).toContain("Servis Novák");
  });

  it("zvládne i ostatní typy dokumentů", () => {
    for (const docType of ["zarucni_list", "diagnosticky_protokol", "prijemka_reklamace"] as const) {
      const html = generateDocumentHtml(config, docType, companyData);
      expect(html.length).toBeGreaterThan(100);
    }
  });
});
