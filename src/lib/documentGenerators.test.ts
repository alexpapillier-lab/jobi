/**
 * Náhradní generátory dokladů uvnitř Jobi (bez JobiDocs).
 *
 * Skládají HTML zakázkového listu, diagnostického protokolu, záručního listu
 * a příjemky reklamace ručně, z řetězců. Do textu se přitom dostane všechno,
 * co si servis a zákazník napsali – jméno, název opravy, poznámka. Testy níž
 * hlídají, že se z takového textu nestane značka a že doklad vznikne i pro
 * zakázku, do které nikdo nic nedoplnil.
 */
import { describe, expect, it } from "vitest";
import { generateDiagnosticProtocolHTML, generatePrijetiReklamaceHTML, generateTicketHTML, generateWarrantyHTML } from "./documentGenerators";
import type { TicketEx } from "../pages/Orders";
import type { WarrantyClaimRow } from "../pages/Orders/hooks/useWarrantyClaims";

const zakazka = (extra: Partial<TicketEx> = {}): TicketEx =>
  ({ id: "t1", code: "Z26000001", customerName: "Jan Novák", deviceLabel: "iPhone 13", createdAt: "2026-09-01T10:00:00.000Z", status: "received", ...extra }) as unknown as TicketEx;

const reklamace = (extra: Record<string, unknown> = {}): WarrantyClaimRow =>
  ({ id: "r1", code: "R26000012", created_at: "2026-09-01T10:00:00.000Z", customer_name: "Jan Novák", device_label: "iPhone 13", ...extra }) as unknown as WarrantyClaimRow;

const firma = { name: "Servis Novák", addressStreet: "Dlouhá 5", addressCity: "Praha", addressZip: "110 00", ico: "12345678" };

/** Tělo dokumentu bez stylů – zákazník vidí jen tohle. */
function naPapire(html: string): string {
  const od = html.indexOf("</style>");
  return od === -1 ? html : html.slice(od);
}

// Zakázka se dá vytisknout kdykoli, i minutu po přijetí: bez oprav, bez cen,
// bez sériového čísla. Nesmí z toho vypadnout výjimka ani „undefined“.
describe("doklad z holé zakázky", () => {
  const holaZakazka = zakazka({ customerName: undefined, deviceLabel: undefined, code: undefined });

  it("zakázkový list vznikne i pro zakázku bez zákazníka, bez zařízení a bez čísla", () => {
    const html = generateTicketHTML(holaZakazka);
    expect(html).toContain("Zakázkový list");
    // Chybějící údaj má na papíře pomlčku, ne prázdné místo ani „undefined“.
    expect(naPapire(html)).toContain("—");
    expect(naPapire(html)).not.toContain("undefined");
    expect(naPapire(html)).not.toContain("NaN");
  });

  it("záruční list a diagnostický protokol vzniknou i bez firemních údajů", () => {
    for (const html of [generateWarrantyHTML(holaZakazka, null), generateDiagnosticProtocolHTML(holaZakazka, null)]) {
      expect(html).toContain("<!DOCTYPE html>");
      expect(naPapire(html)).not.toContain("undefined");
      expect(naPapire(html)).not.toContain("NaN");
    }
  });

  it("zakázka bez oprav nevytiskne prázdnou sekci Provedené opravy", () => {
    const papir = naPapire(generateTicketHTML(zakazka({ performedRepairs: [] } as Partial<TicketEx>)));
    expect(papir).not.toContain("Provedené opravy");
  });

  it("diagnostika, kterou technik nenapsal, se přizná, místo prázdného rámečku", () => {
    const papir = naPapire(generateDiagnosticProtocolHTML(zakazka(), firma));
    expect(papir).toContain("Diagnostika nebyla zadána.");
  });
});

// Servis, který si vyplní firemní údaje, je chce mít na dokladu. Zákazník
// bez nich neví, komu zařízení svěřil a kam má jít reklamovat.
describe("firemní údaje na dokladu", () => {
  it("záruční list vytiskne název, adresu a IČO servisu", () => {
    const papir = naPapire(generateWarrantyHTML(zakazka(), firma));
    expect(papir).toContain("Servis Novák");
    expect(papir).toContain("Dlouhá 5, Praha, 110 00");
    expect(papir).toContain("12345678");
  });

  it("bez vyplněných firemních údajů se sekce Servis vynechá celá", () => {
    const papir = naPapire(generateWarrantyHTML(zakazka(), { name: "", addressStreet: "" }));
    expect(papir).not.toContain("Název:");
  });
});

// Položky kontroly po opravě píše technik vlastními slovy. „Displej < 5 %“
// nesmí ukousnout zbytek protokolu.
describe("kontrola po opravě v diagnostickém protokolu", () => {
  const sKontrolou = (polozky: Array<{ text: string; stav?: string; poznamka?: string }>) =>
    naPapire(generateDiagnosticProtocolHTML(zakazka({ testChecklist: { sablonaNazev: "Telefon", polozky } } as unknown as Partial<TicketEx>), firma));

  it("vytiskne odškrtnuté i neúspěšné položky včetně poznámky technika", () => {
    const papir = sKontrolou([
      { text: "Displej a dotyk", stav: "ok" },
      { text: "Tlačítka", stav: "chyba", poznamka: "vibrace slabší" },
      { text: "Kamera" },
    ]);
    expect(papir).toContain("✓ Displej a dotyk");
    expect(papir).toContain("✗ Tlačítka – vibrace slabší");
    expect(papir).toContain("– Kamera");
  });

  it("špičaté závorky v položce kontroly se vytisknou jako text", () => {
    const papir = sKontrolou([{ text: "<b>Baterie</b> pod 80 %", stav: "ok" }]);
    expect(papir).toContain("&lt;b&gt;Baterie&lt;/b&gt;");
    expect(papir).not.toContain("<b>Baterie</b>");
  });

  it("bez založené kontroly se sekce na protokol nedostane", () => {
    expect(naPapire(generateDiagnosticProtocolHTML(zakazka(), firma))).not.toContain("Kontrola po opravě");
  });
});

// Příjemku reklamace podepisuje zákazník. Text v ní pochází z toho, co
// nadiktoval u pultu – včetně uvozovek, ampersandů a špičatých závorek.
describe("příjemka reklamace", () => {
  it("jméno zákazníka i důvod reklamace se vytisknou jako text, ne jako značka", () => {
    const html = generatePrijetiReklamaceHTML(reklamace({ customer_name: '<b>Jan</b> & "syn"', notes: "<script>alert(1)</script>" }), null);
    expect(html).toContain("&lt;b&gt;Jan&lt;/b&gt; &amp; &quot;syn&quot;");
    expect(html).not.toContain("<b>Jan</b>");
    expect(html).not.toContain("<script>alert(1)");
  });

  it("reklamace bez vyřízení nevytiskne prázdnou sekci Provedené zákroky", () => {
    const html = generatePrijetiReklamaceHTML(reklamace({ resolution_summary: "   " }), null);
    expect(html).not.toContain("Provedené zákroky");
  });

  it("uložené zákroky se vytisknou s cenami a součtem", () => {
    const html = generatePrijetiReklamaceHTML(
      reklamace({ resolution_summary: JSON.stringify([{ id: "a", name: "Výměna displeje", price: 1500 }, { id: "b", name: "Kontrola", price: 500 }]) }),
      null,
    );
    expect(html).toContain("Výměna displeje");
    expect(html).toContain("Celkem:");
    expect(html.replace(/\s/g, " ")).toContain("2 000 Kč");
  });

  it("psaný závěr reklamace se vytiskne jako jediný zákrok, ne jako rozsypaný JSON", () => {
    const html = generatePrijetiReklamaceHTML(reklamace({ resolution_summary: "Reklamace uznána, displej vyměněn." }), null);
    expect(html).toContain("Reklamace uznána, displej vyměněn.");
  });

  it("reklamace bez jména a bez popisu zařízení má aspoň pomlčky, ne prázdno", () => {
    const html = generatePrijetiReklamaceHTML(reklamace({ customer_name: null, device_label: null }), null);
    expect(html).toContain("—");
    expect(html).not.toContain("undefined");
    expect(html).not.toContain("null<");
  });
});

// Zakázka s dlouhým seznamem oprav je běžná u firemních zákazníků –
// generátor ji musí poskládat celou, ne jen prvních pár řádků.
describe("dlouhá zakázka", () => {
  it("čtyřicet oprav se vytiskne do zakázkového listu i do záručního listu", () => {
    const opravy = Array.from({ length: 40 }, (_, i) => ({ id: `r${i}`, name: `Oprava číslo ${i + 1}`, type: "manual", price: 100 }));
    const t = zakazka({ performedRepairs: opravy } as unknown as Partial<TicketEx>);
    for (const papir of [naPapire(generateTicketHTML(t)), naPapire(generateWarrantyHTML(t, firma))]) {
      expect(papir).toContain("Oprava číslo 1<");
      expect(papir).toContain("Oprava číslo 40<");
      expect(papir.replace(/\s/g, " ")).toContain("4 000,00 Kč");
    }
  });

  it("název opravy na dvě stě znaků doklad nerozbije", () => {
    const dlouhy = "Výměna displeje ".repeat(13).slice(0, 200);
    const papir = naPapire(generateTicketHTML(zakazka({ performedRepairs: [{ id: "a", name: dlouhy, type: "manual", price: 100 }] } as unknown as Partial<TicketEx>)));
    expect(papir).toContain(dlouhy);
  });
});
