/**
 * Generate print-ready A4 HTML for JobiDocs API /v1/render.
 * Uses Electron Chromium for proper PDF rendering – single page, centered, no overflow.
 * Design tokeny a layout spec ze sdíleného modulu documentDesign.
 */

import { getDesignStyles, type DocumentDesign } from "./documentDesign";

type DocTypeKey = "zakazkovy_list" | "zarucni_list" | "diagnosticky_protokol";
type DocTypeUI = "ticketList" | "diagnosticProtocol" | "warrantyCertificate";

const DOC_TYPE_TO_UI: Record<DocTypeKey, DocTypeUI> = {
  zakazkovy_list: "ticketList",
  zarucni_list: "warrantyCertificate",
  diagnosticky_protokol: "diagnosticProtocol",
};

const DOC_TYPE_LABELS: Record<DocTypeKey, string> = {
  zakazkovy_list: "Zakázkový list",
  zarucni_list: "Záruční list",
  diagnosticky_protokol: "Diagnostický protokol",
};

const DEFAULT_SECTION_ORDER: Record<DocTypeUI, string[]> = {
  ticketList: ["service", "customer", "device", "repairs", "diag", "photos", "dates"],
  diagnosticProtocol: ["service", "customer", "device", "diag", "photos", "dates"],
  warrantyCertificate: ["service", "customer", "device", "repairs", "warranty", "dates"],
};

function serviceContentHtml(companyData: Record<string, unknown>): string {
  const n = (v: unknown) => (v && String(v).trim() ? String(v) : null);
  const name = n(companyData.name) || n(companyData.abbreviation);
  const ico = n(companyData.ico);
  const dic = n(companyData.dic);
  const address = [n(companyData.addressStreet), n(companyData.addressCity), n(companyData.addressZip)].filter(Boolean).join(", ");
  const phone = n(companyData.phone);
  const email = n(companyData.email);
  const website = n(companyData.website);
  const parts: string[] = [];
  if (name) parts.push(`<div>${escapeHtml(name)}</div>`);
  if (ico || dic) parts.push(`<div>${[ico && `IČO: ${escapeHtml(ico)}`, dic && `DIČ: ${escapeHtml(dic)}`].filter(Boolean).join(" • ")}</div>`);
  if (address) parts.push(`<div>${escapeHtml(address)}</div>`);
  if (phone || email || website) parts.push(`<div>${[phone, email, website].filter((x): x is string => !!x).map(escapeHtml).join(" • ")}</div>`);
  if (parts.length === 0) return '<div style="color:#9ca3af;font-size:9px">Vyplňte údaje v Jobi → Nastavení → Servis</div>';
  return parts.join("");
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const SECTION_CONTENT_HTML: Record<string, string> = {
  customer: `<div>Jan Novák</div><div>+420 123 456 789</div><div>jan.novak@email.cz</div><div>Havlíčkova 45, 110 00 Praha 1</div>`,
  device: `<div>iPhone 13 Pro, 128 GB</div><div>SN: SN123456789012</div><div>Stav: Poškozený displej, prasklina v rohu</div><div>Problém: Nefunguje dotyková vrstva v levém dolním rohu</div>`,
  repairs: `<div style="display:flex;justify-content:space-between;gap:12px;width:100%"><span>Výměna displeje</span><span style="white-space:nowrap">2 500 Kč</span></div><div style="display:flex;justify-content:space-between;gap:12px;width:100%"><span>Kalibrace dotykové vrstvy</span><span style="white-space:nowrap">500 Kč</span></div><div style="margin-top:8px;padding-top:6px;border-top:1px solid rgba(0,0,0,0.12);display:flex;justify-content:space-between;gap:12px;width:100%;font-weight:600;font-size:12px"><span>Celková cena</span><span style="white-space:nowrap">3 000 Kč</span></div>`,
  diag: `<div>Displej je mechanicky poškozený v levém dolním rohu. Dotyková vrstva nefunguje v oblasti cca 2×2 cm.</div><div style="margin-top:4px">Doporučena výměna displeje. Záruka na opravu 12 měsíců.</div>`,
  photos: `<div style="display:flex;gap:8px;flex-wrap:wrap"><div style="width:60px;height:60px;background:#e5e7eb;border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:9px;color:#9ca3af">Foto 1</div><div style="width:60px;height:60px;background:#e5e7eb;border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:9px;color:#9ca3af">Foto 2</div></div>`,
  dates: `<div>Přijato: 8. 2. 2025</div><div>Předpokládané dokončení: 10. 2. 2025</div><div>Kód zakázky: DEMO-001</div>`,
};

/** Z řetězce sekce dates (HTML) vytáhne číslo zakázky (Kód zakázky: XXX nebo Číslo zakázky: XXX). */
function extractTicketCodeFromDates(datesHtml: string | undefined): string | null {
  if (!datesHtml || typeof datesHtml !== "string") return null;
  const match = datesHtml.match(/(?:Kód zakázky|Číslo zakázky):\s*([^<]+)/);
  return match ? match[1].trim() || null : null;
}

const SECTION_LABELS: Record<string, string> = {
  service: "Údaje o servisu",
  customer: "Údaje o zákazníkovi",
  device: "Údaje o zařízení",
  repairs: "Provedené opravy",
  warranty: "Záruka",
  diag: "Diagnostika",
  photos: "Fotky",
  dates: "Data",
};

/** Optional override HTML for each section (customer, device, repairs, diag, photos, dates). Used when printing from Jobi with real ticket data. */
export type SectionOverrides = Partial<Record<string, string>>;

/** Při tisku záručního listu z Jobi: datum opravy (ISO), aby se dopočítalo „Záruka do:“ */
export type GenerateDocumentHtmlOptions = { repairDate?: string };

/** České skloňování: 1 měsíc, 2 měsíce, 5 měsíců, 21 měsíc, 22 měsíce, 12 měsíců. */
function warrantyUnitText(n: number, unit: "days" | "months" | "years"): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  const singular = mod10 === 1 && mod100 !== 11; // 1, 21, 31, 101 … ale ne 11, 111
  const few = mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14); // 2–4, 22–24, 32–34 …
  if (unit === "days") {
    if (singular) return "den";
    if (few) return "dny";
    return "dnů";
  }
  if (unit === "months") {
    if (singular) return "měsíc";
    if (few) return "měsíce";
    return "měsíců";
  }
  if (singular) return "rok";
  if (few) return "roky";
  return "let";
}

type WarrantyItem = { label: string; duration: number; unit: "days" | "months" | "years" };

function warrantySectionHtml(docConfig: Record<string, unknown>, repairDate: Date): string {
  const duration = (docConfig.warrantyUnifiedDuration as number) ?? 24;
  const unit = (docConfig.warrantyUnifiedUnit as "days" | "months" | "years") ?? "months";
  const showEndDate = (docConfig.warrantyShowEndDate as boolean) !== false;
  const extraText = (docConfig.warrantyExtraText as string)?.trim() ?? "";
  const items = (docConfig.warrantyItems as WarrantyItem[] | undefined) ?? [];

  let html = "";

  const unitText = warrantyUnitText(duration, unit);
  const sentence = `Záruční doba činí ${duration} ${unitText}.`;
  html += `<div>${escapeHtml(sentence)}</div>`;
  if (showEndDate) {
    let days = 0;
    if (unit === "days") days = duration;
    else if (unit === "months") days = duration * 30;
    else days = duration * 365;
    const warrantyUntil = new Date(repairDate.getTime() + days * 24 * 60 * 60 * 1000);
    html += `<div style="margin-top:8px"><span style="font-weight:600">Záruka do: </span><span>${escapeHtml(warrantyUntil.toLocaleDateString("cs-CZ"))}</span></div>`;
  }

  if (extraText) {
    html += `<div style="margin-top:10px">${escapeHtml(extraText)}</div>`;
  }

  items.forEach((it) => {
    const d = typeof it.duration === "number" ? it.duration : 12;
    const u = (it.unit === "days" || it.unit === "months" || it.unit === "years" ? it.unit : "months") as "days" | "months" | "years";
    const ut = warrantyUnitText(d, u);
    const label = (it.label && String(it.label).trim()) || "Záruka";
    const itemShowEndDate = (it as { showEndDate?: boolean }).showEndDate !== false;
    let line = `${label}: ${d} ${ut}.`;
    if (itemShowEndDate) {
      let addDays = 0;
      if (u === "days") addDays = d;
      else if (u === "months") addDays = d * 30;
      else addDays = d * 365;
      const until = new Date(repairDate.getTime() + addDays * 24 * 60 * 60 * 1000);
      line += ` Záruka do: ${until.toLocaleDateString("cs-CZ")}`;
    }
    html += `<div style="margin-top:6px">${escapeHtml(line)}</div>`;
  });

  return html;
}

export function generateDocumentHtml(
  config: Record<string, unknown>,
  docType: DocTypeKey,
  companyData: Record<string, unknown>,
  sectionOverrides?: SectionOverrides,
  options?: GenerateDocumentHtmlOptions
): string {
  const docConfig = (config[DOC_TYPE_TO_UI[docType]] || {}) as Record<string, unknown>;
  const design = (docConfig.design as DocumentDesign) || "classic";
  const colorMode = (config.colorMode as "color" | "bw") || "color";
  const accentOverride = (config.designAccentColor as string) || "";
  const logoSize = ((config.logoSize as number) ?? 100) / 100;
  const hasLogo = !!config.logoUrl;
  const reviewUrl =
    (config.reviewUrlType as string) === "google" && config.googlePlaceId
      ? `https://search.google.com/local/writereview?placeid=${config.googlePlaceId}`
      : (config.reviewUrl as string) || "";
  const reviewText = (config.reviewText as string) || "Zde nám můžete napsat recenzi";
  const qrCodeSize = (config.qrCodeSize as number) ?? 120;
  const showQr =
    !!reviewUrl &&
    (docType === "zakazkovy_list"
      ? (config.qrOnTicketList as boolean) === true
      : docType === "diagnosticky_protokol"
        ? (config.qrOnDiagnostic as boolean) === true
        : (config.qrOnWarranty as boolean) !== false);
  const legalText = (docConfig.legalText as string) || "";
  const includeCustomerSignature = (docConfig.includeCustomerSignature as boolean) !== false;
  const includeStamp = (docConfig.includeStamp as boolean) === true && !!config.stampUrl;
  const includeStampRight = (docConfig.includeStamp as boolean) === true;
  const includeSignatureOnHandover = (docConfig.includeSignatureOnHandover as boolean) !== false;
  const includeSignatureOnPickup = (docConfig.includeSignatureOnPickup as boolean) !== false;

  const colorOverrides =
    design === "modern" || design === "professional"
      ? {
          primary: (config.designPrimaryColor as string) || undefined,
          secondary: (config.designSecondaryColor as string) || undefined,
          headerBg: (config.designHeaderBg as string) || undefined,
          sectionBorder: (config.designSectionBorder as string) || undefined,
        }
      : undefined;
  const { tokens: styles, spec } = getDesignStyles(design, colorMode, accentOverride || undefined, colorOverrides);
  const order = (docConfig.sectionOrder as string[] | undefined) ?? DEFAULT_SECTION_ORDER[DOC_TYPE_TO_UI[docType]];

  const sectionKeyToInclude: Record<string, string> = {
    service: "includeServiceInfo",
    customer: "includeCustomerInfo",
    device: "includeDeviceInfo",
    repairs: "includeRepairs",
    warranty: "includeWarranty",
    diag: docType === "diagnosticky_protokol" ? "includeDiagnosticText" : "includeDiagnostic",
    photos: "includePhotos",
    dates: "includeDates",
  };

  const repairDate = options?.repairDate ? new Date(options.repairDate) : new Date();

  const orderedSections = order.filter((key) => {
    const includeKey = sectionKeyToInclude[key];
    return includeKey && (docConfig[includeKey] as boolean) !== false;
  });

  const sectionWidths = (docConfig.sectionWidths as Record<string, string>) || {};
  const DEFAULT_WIDTHS: Record<string, string> = {
    service: "full", customer: "full", device: "full", repairs: "full",
    warranty: "full", diag: "full", photos: "half", dates: "half",
  };

  const sectionPadding = spec.density === "compact" ? 8 : 12;
  const sectionRadius = spec.sectionStyle === "underlineTitles" ? 0 : styles.sectionRadius;
  const sectionBorderCss = spec.sectionStyle === "underlineTitles" ? "none" : styles.sectionBorder;
  const sectionBorderLeft = spec.sectionStyle === "leftStripe" ? `3px solid ${styles.secondaryColor}` : "none";
  const titleFontSize = spec.sectionHeaderStyle === "capsule" ? 14 : 13;
  const titleFontWeight = spec.sectionHeaderStyle === "underline" ? 500 : 700;
  const sectionsHtml = orderedSections
    .map((key) => {
      const label = SECTION_LABELS[key] || key;
      const overridden = sectionOverrides && key in sectionOverrides ? sectionOverrides[key] : undefined;
      const content =
        overridden !== undefined
          ? overridden
          : key === "warranty"
            ? (docType === "zarucni_list" && (docConfig.includeWarranty as boolean) === true
                ? warrantySectionHtml(docConfig, repairDate)
                : "")
            : sectionOverrides && ["repairs", "diag", "photos"].includes(key)
              ? ""
              : key === "service"
                ? serviceContentHtml(companyData)
                : (SECTION_CONTENT_HTML[key] || "");
      if (typeof content === "string" && content.trim() === "") return "";
      const width = sectionWidths[key] ?? DEFAULT_WIDTHS[key] ?? "full";
      const halfWidth = width === "half";
      const w = halfWidth ? "334px" : "680px";
      const titleStyle = spec.sectionHeaderStyle === "uppercase" ? `font-size:${titleFontSize}px;font-weight:${titleFontWeight};margin-bottom:0;padding-bottom:6px;border-bottom:1px solid ${styles.secondaryColor};color:${styles.secondaryColor};text-transform:uppercase;letter-spacing:0.05em` : `font-size:${titleFontSize}px;font-weight:${titleFontWeight};margin-bottom:0;padding-bottom:6px;border-bottom:1px solid ${styles.secondaryColor};color:${styles.secondaryColor}`;
      return `<div style="padding:${sectionPadding}px;background:${styles.sectionBg};border-radius:${sectionRadius}px;border:${sectionBorderCss};border-left:${sectionBorderLeft};flex:${halfWidth ? `0 0 ${w}` : "1 1 680px"};width:${w};min-width:${w};max-width:${w};box-sizing:border-box;flex-shrink:0"><div style="${titleStyle}">⋮⋮ ${escapeHtml(label)}</div><div style="font-size:10px;line-height:1.5;color:${styles.contentColor}">${content}</div></div>`;
    })
    .join("");

  const headerRadius = spec.headerLayout === "splitBox" ? 8 : 0;
  const headerTitleSize = spec.headerLayout === "splitBox" ? 16 : 14;
  const headerTitleWeight = spec.headerLayout === "splitBox" ? 800 : 700;
  const headerLeftStripe = spec.headerLayout === "splitBox" && styles.accentColor ? `border-left:6px solid ${styles.accentColor};` : "";
  const qrPos = (config.qrPosition as { x: number; y: number } | undefined);
  const qrX = qrPos && typeof qrPos.x === "number" ? qrPos.x : 620;
  const qrY = qrPos && typeof qrPos.y === "number" ? qrPos.y : 15;
  const qrBlockHtml =
    showQr && reviewUrl
      ? `<div style="position:absolute;left:${qrX}px;top:${qrY}px;display:flex;align-items:center;gap:12px;">
          <div style="text-align:right;font-size:10px;color:${styles.secondaryColor};max-width:140px;line-height:1.3">${escapeHtml(reviewText)}</div>
          <img src="https://api.qrserver.com/v1/create-qr-code/?size=${qrCodeSize}x${qrCodeSize}&ecc=L&data=${encodeURIComponent(reviewUrl)}" alt="QR" style="width:${qrCodeSize}px;height:${qrCodeSize}px;display:block;flex-shrink:0" />
        </div>`
      : "";
  const ticketCode =
    docType === "zakazkovy_list"
      ? extractTicketCodeFromDates(sectionOverrides?.dates) ?? extractTicketCodeFromDates(SECTION_CONTENT_HTML.dates)
      : null;
  const headerTitleLine =
    docType === "zakazkovy_list" && ticketCode
      ? `<div style="display:flex;align-items:baseline;justify-content:center;gap:10px;flex-wrap:wrap">
          <span style="color:${styles.headerText};font-weight:700;font-size:14px">${escapeHtml(DOC_TYPE_LABELS[docType])}</span>
          <span style="color:${styles.headerText};font-weight:800;font-size:18px;letter-spacing:0.05em">${escapeHtml(ticketCode)}</span>
        </div>`
      : `<div style="color:${styles.headerText};font-weight:700;font-size:14px">${escapeHtml(DOC_TYPE_LABELS[docType])}</div>`;
  const headerHtml = `
    <div style="position:relative;min-height:50px;margin-bottom:12px;padding-bottom:10px;border-bottom:${styles.headerBorder};background:${styles.headerBg !== "transparent" ? styles.headerBg : "transparent"};padding:${styles.headerBg !== "transparent" ? "8px 12px 10px 0" : 0};border-radius:${headerRadius}px;${headerLeftStripe}">
      ${hasLogo ? `<img src="${config.logoUrl as string}" alt="Logo" style="position:absolute;left:0;top:50%;transform:translateY(-50%);max-width:${120 * logoSize}px;max-height:${50 * logoSize}px;object-fit:contain" />` : `<div style="position:absolute;left:0;top:50%;transform:translateY(-50%);width:${120 * logoSize}px;height:${50 * logoSize}px;background:#f3f4f6;border-radius:4px;display:flex;align-items:center;justify-content:center;color:#9ca3af;font-size:9px">Logo</div>`}
      <div style="position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);text-align:center;display:flex;flex-direction:column;gap:2px">
        ${headerTitleLine}
        <div style="color:${styles.headerText};font-weight:${headerTitleWeight};font-size:${headerTitleSize}px">${escapeHtml(String(companyData?.name ?? "Název servisu"))}</div>
      </div>
      ${qrBlockHtml}
    </div>`;

  const isTicketList = docType === "zakazkovy_list";
  const hasTicketListSignatures = isTicketList && (includeSignatureOnHandover || includeSignatureOnPickup || includeStampRight);
  const hasOtherSignatures = !isTicketList && (includeCustomerSignature || includeStamp);

  const labelHandover = String(docConfig.signatureLabelHandover ?? "Podpis při předání zákazníkem").trim() || "Podpis při předání zákazníkem";
  const labelPickup = String(docConfig.signatureLabelPickup ?? "Podpis při vyzvednutí zákazníkem").trim() || "Podpis při vyzvednutí zákazníkem";
  const labelService = String(docConfig.signatureLabelService ?? "Podpis / razítko servisu").trim() || "Podpis / razítko servisu";
  const pos = (v: unknown) => (v === "center" || v === "right" ? v : "left");
  const posHandover = pos(docConfig.signaturePositionHandover);
  const posPickup = pos(docConfig.signaturePositionPickup);
  const posService = pos(docConfig.signaturePositionService);

  const stampImgHtml = config.stampUrl ? `<img src="${String(config.stampUrl).replace(/"/g, "&quot;")}" alt="Razítko" style="max-width:70px;max-height:35px;object-fit:contain" />` : `<div style="width:70px;height:35px;background:#f3f4f6;border-radius:4px;display:flex;align-items:center;justify-content:center;font-size:8px;color:#9ca3af">Razítko</div>`;

  const blockHandover = includeSignatureOnHandover
    ? `<div style="width:100%;max-width:140px;border-bottom:1px solid #000;margin-bottom:4px"></div><div style="font-size:9px;color:${styles.contentColor}">${escapeHtml(labelHandover)}</div>`
    : "";
  const blockPickup = includeSignatureOnPickup
    ? `<div style="width:100%;max-width:140px;border-bottom:1px solid #000;margin-bottom:4px"></div><div style="font-size:9px;color:${styles.contentColor}">${escapeHtml(labelPickup)}</div>`
    : "";
  const blockService = includeStampRight
    ? `${stampImgHtml}<div style="font-size:9px;color:${styles.contentColor};margin-top:4px">${escapeHtml(labelService)}</div>`
    : "";

  const slot = (align: "left" | "center" | "right", ...blocks: string[]) => {
    const filtered = blocks.filter(Boolean);
    if (filtered.length === 0) return `<div style="flex:1;min-width:0"></div>`;
    const alignStyle = align === "center" ? "align-items:center" : align === "right" ? "align-items:flex-end" : "align-items:flex-start";
    const inner = filtered.map((b) => `<div>${b}</div>`).join("");
    return `<div style="flex:1;min-width:0;display:flex;flex-direction:column;${alignStyle};gap:8px">${inner}</div>`;
  };

  const byPos = { left: [] as string[], center: [] as string[], right: [] as string[] };
  if (blockHandover) byPos[posHandover].push(blockHandover);
  if (blockPickup) byPos[posPickup].push(blockPickup);
  if (blockService) byPos[posService].push(blockService);

  const signaturesHtml = hasTicketListSignatures
    ? `
    <div style="margin-top:auto;padding-top:28px;display:flex;justify-content:space-between;align-items:flex-end;border-top:1px solid ${styles.sectionBorder};flex-shrink:0;gap:24px">
      ${slot("left", ...byPos.left)}
      ${slot("center", ...byPos.center)}
      ${slot("right", ...byPos.right)}
    </div>`
    : hasOtherSignatures
      ? `
    <div style="margin-top:auto;padding-top:28px;display:flex;justify-content:space-around;border-top:1px solid ${styles.sectionBorder};flex-shrink:0">
      ${includeCustomerSignature ? `<div><div style="width:100px;border-bottom:1px solid #000;margin-bottom:4px"></div><div style="font-size:9px;color:${styles.contentColor}">Podpis zákazníka</div></div>` : ""}
      ${includeStamp ? `<div><div style="width:70px;height:35px;background:#f3f4f6;border-radius:4px;display:flex;align-items:center;justify-content:center;font-size:8px;color:#9ca3af">Razítko</div></div>` : ""}
    </div>`
      : "";

  const legalRadius = spec.sectionStyle === "underlineTitles" ? 0 : styles.sectionRadius;
  const legalHtml = legalText ? `<div style="margin-top:12px;padding:10px;background:${styles.sectionBg};border-radius:${legalRadius}px;font-size:9px;color:${styles.contentColor};border:1px solid ${styles.sectionBorder}">${escapeHtml(legalText)}</div>` : "";

  const bodyHtml = `
    <div style="width:794px;height:1123px;background:#ffffff;padding:57px;box-sizing:border-box;display:flex;flex-direction:column;font-size:10px;line-height:1.4;color:${styles.contentColor}">
      ${headerHtml}
      <div style="flex:1;min-height:0;margin-bottom:12px;display:flex;flex-wrap:wrap;gap:12px;align-content:flex-start">
        ${sectionsHtml}
      </div>
      ${legalHtml}
      ${signaturesHtml}
    </div>`;

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body { width: 100%; height: 100%; overflow: hidden; font-family: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; }
    body { display: flex; align-items: center; justify-content: center; background: white; }
    @page { size: A4; margin: 0; }
  </style>
</head>
<body>
  ${bodyHtml}
</body>
</html>`;
}
