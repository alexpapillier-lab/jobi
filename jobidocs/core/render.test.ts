import { describe, expect, it } from "vitest";
import { DOC_TYPES, defaultTemplate, renderDocument, sampleData, DEFAULT_BRAND, DEFAULT_THEME, variablesToDocumentData, migrateV1Config, substitute, isEmptyAfterSubstitution, formatMoney, formatDate, monthsText } from "./index.js";

describe("render", () => {
  for (const docType of DOC_TYPES) {
    it(`vyrenderuje ${docType} s krátkými i dlouhými daty`, () => {
      for (const kind of ["short", "long", "empty"] as const) {
        const html = renderDocument({ template: defaultTemplate(docType), data: sampleData(docType, kind), brand: DEFAULT_BRAND, theme: DEFAULT_THEME, options: { mode: "print" } });
        expect(html).toContain('<section class="page" data-main');
        expect(html).not.toContain("{{");
        // Tisk nikdy neobsahuje zástupné prvky editoru.
        expect(html).not.toContain("ph-box");
        expect(html).not.toContain("Sem lze přetáhnout");
      }
    });
  }

  it("smlouva o zápůjčce má výchozí šablonu a proměnné náhradního zařízení", () => {
    const data = sampleData("smlouva_zapujcka");
    const html = renderDocument({ template: defaultTemplate("smlouva_zapujcka"), data, brand: DEFAULT_BRAND, theme: DEFAULT_THEME, options: { mode: "print" } });
    expect(html).toContain("Smlouva o zápůjčce");
    expect(html).toContain("iPhone SE 2020");
    // Formát měny odděluje tisíce nezlomitelnou mezerou.
    expect(html).toMatch(/2\u00a0000,00/);
    expect(substitute("{{loaner.deposit}}", { ...data, loaner: { ...data.loaner, deposit: 0 } })).toBe("bez kauce");
    expect(substitute("{{loaner.name}}", sampleData("zakazkovy_list"))).toBe("");
  });

  it("kontrola po opravě: shrnutí a řádky, bez kontroly prázdné", () => {
    const data = { ...sampleData("diagnosticky_protokol"), checklist: { title: "Telefon", items: [
      { text: "Displej", status: "ok" as const },
      { text: "Tlačítka", status: "fail" as const, note: "vibrace slabší" },
      { text: "Kamera", status: null },
    ] } };
    expect(substitute("{{checklist.summary}}", data)).toBe("Ověřeno 2 z 3, 1 s chybou");
    expect(substitute("{{checklist.list}}", data)).toBe("✓ Displej\n✗ Tlačítka – vibrace slabší\n– Kamera");
    expect(substitute("{{checklist.summary}}", sampleData("diagnosticky_protokol"))).toBe("");
  });

  it("nadpis z dat přebíjí název typu i text v šabloně", () => {
    const tpl = defaultTemplate("faktura");
    const args = { template: tpl, brand: DEFAULT_BRAND, theme: DEFAULT_THEME, options: { mode: "print" as const } };
    const bezNadpisu = renderDocument({ ...args, data: sampleData("faktura", "short") });
    expect(bezNadpisu).toContain('<div class="doc-kind">Faktura</div>');
    const dobropis = renderDocument({ ...args, data: { ...sampleData("faktura", "short"), title: "Dobropis" } });
    expect(dobropis).toContain('<div class="doc-kind">Dobropis</div>');
    expect(dobropis).toContain("<title>Dobropis");
  });

  it("prázdná data skryjí řádky bez hodnot a bloky s when=notEmpty", () => {
    const html = renderDocument({ template: defaultTemplate("zarucni_list"), data: sampleData("zarucni_list", "empty"), brand: DEFAULT_BRAND, theme: DEFAULT_THEME, options: { mode: "print" } });
    expect(html).not.toContain("Provedená oprava");
    expect(html).not.toContain("Zakázka dokončena");
  });

  it("fotky jdou na vlastní strany se stejnou hlavičkou", () => {
    const html = renderDocument({ template: defaultTemplate("diagnosticky_protokol"), data: sampleData("diagnosticky_protokol", "long"), brand: DEFAULT_BRAND, theme: DEFAULT_THEME, options: { mode: "print" } });
    expect(html.match(/class="page photo-page"/g)?.length).toBe(3);
    expect(html).toContain("Fotodokumentace 1/3");
  });

  it("editor ukazuje zástupné prvky, tisk ne", () => {
    const t = defaultTemplate("zarucni_list");
    const args = { template: t, data: sampleData("zarucni_list", "short"), brand: {}, theme: DEFAULT_THEME };
    expect(renderDocument({ ...args, options: { mode: "editor" } })).toContain("Razítko – nahrajte ve Značce");
    expect(renderDocument({ ...args, options: { mode: "print" } })).not.toContain("nahrajte ve Značce");
  });

  it("QR „stav zakázky online“ se tiskne jen s odkazem z Jobi", () => {
    const tpl = defaultTemplate("zakazkovy_list");
    tpl.slots.headerRight = [...tpl.slots.headerRight, { id: "qr-portal", type: "qr", source: "portal", size: 20 }];
    const withUrl = renderDocument({ template: tpl, data: { ...sampleData("zakazkovy_list", "short"), portalUrl: "https://appjobi.com/z/?t=abc" }, brand: DEFAULT_BRAND, theme: DEFAULT_THEME, options: { mode: "print" } });
    expect(withUrl).toContain("Stav zakázky sledujte online");
    expect(withUrl).toContain('alt="QR"');
    const withoutUrl = renderDocument({ template: tpl, data: { ...sampleData("zakazkovy_list", "short"), portalUrl: undefined }, brand: DEFAULT_BRAND, theme: DEFAULT_THEME, options: { mode: "print" } });
    expect(withoutUrl).not.toContain("Stav zakázky sledujte online");
    expect(withoutUrl).not.toContain("ph-box");
    expect(substitute("Sledujte: {{portalUrl}}", { ...sampleData("zakazkovy_list", "short"), portalUrl: "https://appjobi.com/z/?t=abc" })).toContain("https://appjobi.com/z/?t=abc");
  });

  it("escapuje HTML z dat", () => {
    const data = sampleData("zakazkovy_list", "short");
    data.device!.issue = "<script>alert(1)</script>";
    const html = renderDocument({ template: defaultTemplate("zakazkovy_list"), data, brand: {}, theme: DEFAULT_THEME, options: { mode: "print" } });
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&lt;script&gt;");
  });
});

describe("proměnné", () => {
  const data = sampleData("zakazkovy_list", "short");
  it("dosadí nové i staré názvy", () => {
    expect(substitute("{{number}} / {{ticket_code}}", data)).toBe("IRPAZ2601527 / IRPAZ2601527");
    expect(substitute("{{customer_name}}", data)).toBe("Jan Novák");
  });
  it("pozná prázdný řádek", () => {
    expect(isEmptyAfterSubstitution("Tel.: {{customer.phone}}", { service: {} })).toBe(true);
    expect(isEmptyAfterSubstitution("Tel.: {{customer.phone}}", data)).toBe(false);
    expect(isEmptyAfterSubstitution("Pevný text", { service: {} })).toBe(false);
  });
  it("formátuje", () => {
    expect(formatDate("2026-09-01")).toBe("1. 9. 2026");
    expect(formatDate("1.9.2026")).toBe("1.9.2026");
    expect(formatMoney(1890).replace(/\s/g, " ")).toBe("1 890,00 Kč");
    expect(monthsText(1)).toBe("1 měsíc");
    expect(monthsText(3)).toBe("3 měsíce");
    expect(monthsText(12)).toBe("12 měsíců");
  });
});

describe("migrace", () => {
  it("v1 variables → DocumentData", () => {
    const d = variablesToDocumentData(
      {
        ticket_code: "Z1",
        customer_name: "Jan",
        repair_items: JSON.stringify([{ name: "Displej", price: "3 490 Kč", quantity: 1, total: "3 490 Kč" }]),
        total_price: "3 490 Kč",
        photo_urls: JSON.stringify(["https://x/1.jpg"]),
      },
      { name: "Servis", ico: "123" },
      "zakazkovy_list"
    );
    expect(d.number).toBe("Z1");
    expect(d.items?.[0].total).toBe(3490);
    expect(d.totals?.total).toBe(3490);
    expect(d.photos).toEqual(["https://x/1.jpg"]);
    expect(d.service.name).toBe("Servis");
  });
  it("v1 config → v2 značka a právní text", () => {
    const docs = migrateV1Config({
      logoUrl: "https://x/logo.png",
      colorMode: "bw",
      ticketList: { legalText: "Můj právní text.", customBlocks: { a: { type: "text", content: "Ahoj" } }, sectionOrder: ["service", "custom-a"] },
    });
    expect(docs.brand.logoUrl).toBe("https://x/logo.png");
    expect(docs.theme.color).toBe("bw");
    const t = docs.templates.zakazkovy_list!;
    expect(JSON.stringify(t.blocks)).toContain("Můj právní text.");
    expect(JSON.stringify(t.blocks)).toContain("Ahoj");
  });

  // Regrese: na iOS z tisku vyjížděl prázdný list navíc.
  //
  // .page má page-break-after:always a reset dělá pravidlo pro POSLEDNÍ
  // stránku. Za stránkami ale v těle dokumentu stojí ještě měřicí skript,
  // takže poslední .page není posledním potomkem a :last-child by nesedl –
  // zalomení by zůstalo v platnosti a Safari za dokument přidá prázdnou
  // stránku. Chromium ji zahodí sám, proto se to na desktopu neprojeví
  // a bez tohohle testu by se to snadno vrátilo.
  it("reset zalomení sedí i na poslední stránku, za kterou stojí skript", () => {
    const html = renderDocument({ template: defaultTemplate("zakazkovy_list"), data: sampleData("zakazkovy_list", "short"), brand: DEFAULT_BRAND, theme: DEFAULT_THEME, options: { mode: "print" } });

    // Předpoklad, na kterém to celé stojí: za poslední stránkou opravdu
    // něco je. Kdyby to jednou přestalo platit, tenhle test to připomene.
    const posledniStranka = html.lastIndexOf("</section>");
    const skript = html.lastIndexOf("<scr" + "ipt>");
    expect(skript, "za stránkami už neleží skript – pak jde :last-child vrátit").toBeGreaterThan(posledniStranka);

    expect(html).toContain(".page:last-of-type{break-after:auto");
    expect(html, ":last-child nikdy nesedne, protože .page není poslední potomek").not.toContain(".page:last-child");
  });

  // Tisk z prohlížeče nesmí rámec stránky roztahovat na pevnou výšku.
  //
  // JobiDocs si papír řídí sám, tam plná A4 sedí. Prohlížeč ale ne: Safari
  // na iOS si z A4 ubere ~14 mm nahoře a ~34 mm dole na vlastní hlavičku
  // a patičku, takže na obsah zbyde ~249 mm. Rámec vysoký 296,6 mm se tam
  // nevejde a spodní řádek s podpisy (margin-top:auto) spadne na druhý list.
  // Ověřeno tiskem všech typů dokumentů na stránku 210x249 mm.
  for (const docType of DOC_TYPES) {
    it(`${docType}: tisk z prohlížeče nemá pevnou výšku stránky`, () => {
      const spolecne = { template: defaultTemplate(docType), data: sampleData(docType, "short"), brand: DEFAULT_BRAND, theme: DEFAULT_THEME };

      const web = renderDocument({ ...spolecne, options: { mode: "print", browserPrint: true } });
      expect(web).toContain("min-height:auto");
      expect(web, "pevná výška by na iOS shodila podpisy na druhou stránku").not.toContain("min-height:296.6mm");

      // JobiDocs zůstává beze změny – tam je plná výška správně.
      const desktop = renderDocument({ ...spolecne, options: { mode: "print" } });
      expect(desktop).toContain("min-height:296.6mm");
    });
  }
});
