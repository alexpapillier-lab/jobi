import type { TicketEx } from "../pages/Orders";
import type { WarrantyClaimRow } from "../pages/Orders/hooks/useWarrantyClaims";
import { safeLoadCompanyData } from "./companyData";
import { safeLoadDocumentsConfig, getDesignStylesForFallback, escapeHtmlForDoc } from "./documentHelpers";

type ClaimResolutionItem = { id: string; name: string; description?: string; price?: number };

function parseClaimResolutionItems(raw: string | null): ClaimResolutionItem[] {
  if (!raw || !raw.trim()) return [];
  const t = raw.trim();
  if (t.startsWith("[")) {
    try {
      const arr = JSON.parse(t) as unknown;
      if (!Array.isArray(arr)) return [];
      return arr.filter((x): x is ClaimResolutionItem => x && typeof x === "object" && typeof (x as any).id === "string" && typeof (x as any).name === "string").map((x) => ({
        id: (x as any).id,
        name: (x as any).name ?? "",
        description: (x as any).description ?? undefined,
        price: typeof (x as any).price === "number" ? (x as any).price : undefined,
      }));
    } catch {
      return [{ id: (crypto as any).randomUUID?.() ?? `legacy-${Date.now()}`, name: t }];
    }
  }
  return [{ id: (crypto as any).randomUUID?.() ?? `legacy-${Date.now()}`, name: t }];
}

function handoffLabel(m?: string) {
  if (!m) return "—";
  return m;
}

export function generateTicketHTML(ticket: TicketEx, forPrint: boolean = true, config?: any, _includeActions: boolean = false): string {
  const documentsConfig = config || safeLoadDocumentsConfig();
  const companyData = safeLoadCompanyData();
  const design = documentsConfig.ticketList?.design || "classic";
  const colorMode = documentsConfig.colorMode || "color";
  
  const styles = getDesignStylesForFallback(design);
  
  return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="UTF-8">
        <title>Zakázkový list - ${ticket.code}</title>
        <style>
          ${colorMode === "bw" ? `
            * {
              color: #000 !important;
              background: #fff !important;
              border-color: #000 !important;
            }
            img {
              filter: grayscale(100%);
            }
            svg {
              filter: grayscale(100%);
            }
          ` : ""}
          ${forPrint ? `
            @media print {
              @page {
                size: A4;
                margin: 0;
              }
              html, body {
                margin: 0 !important;
                padding: 0 !important;
              }
              .page {
                width: 210mm;
                height: 297mm;
                padding: 12mm;
                margin: 0;
                box-sizing: border-box;
                overflow: visible;
                display: flex !important;
                flex-direction: column !important;
              }
              .content {
                flex: 1 !important;
                display: flex !important;
                flex-direction: column !important;
                overflow: hidden !important;
                min-height: 0 !important;
              }
              .footer {
                flex: 0 0 auto !important;
                position: relative !important;
                overflow: visible !important;
                z-index: 10 !important;
              }
              .document-footer {
                position: relative !important;
                overflow: visible !important;
              }
              .signatures {
                overflow: visible !important;
              }
              .signature-box {
                position: relative !important;
                overflow: visible !important;
              }
              .signature-line {
                overflow: visible !important;
              }
              .card {
                box-shadow: none !important;
              }
              /* Ensure sections display correctly in print - borders and border-radius */
              .section {
                overflow: visible !important;
                position: relative !important;
              }
              .section::before {
                content: none !important;
                display: none !important;
              }
              .section::after {
                content: none !important;
                display: none !important;
              }
              ${colorMode === "bw" ? `
                * {
                  color: #000 !important;
                  background: #fff !important;
                  border-color: #000 !important;
                }
                img {
                  filter: grayscale(100%);
                }
                svg {
                  filter: grayscale(100%);
                }
          ` : ""}
            }
          ` : ""}
          * {
            box-sizing: border-box;
          }
          body {
            font-family: system-ui, -apple-system, sans-serif;
            padding: ${forPrint ? "0" : "20px"};
            margin: 0 auto;
            color: ${styles.primaryColor};
            background: ${forPrint ? "#fff" : styles.bgColor};
            line-height: 1.4;
            font-size: 11px;
            ${forPrint ? `
              min-height: 100vh;
              display: flex;
              flex-direction: column;
            ` : ""}
          }
          ${forPrint ? `
            @media screen {
              body {
                padding: 16px;
                background: #eee;
              }
              .page {
                width: 210mm;
                margin: 0 auto;
                background: #fff;
              }
            }
          ` : `
            body {
              max-width: 210mm;
              width: 210mm;
            }
          `}
          .page {
            ${forPrint ? `
              height: 297mm;
              display: flex;
              flex-direction: column;
            ` : ""}
          }
          .content {
            ${forPrint ? `
              flex: 1;
              display: flex;
              flex-direction: column;
              overflow: hidden;
              min-height: 0;
            ` : ""}
          }
          .document-content {
            ${forPrint ? `
              flex: 1;
              display: flex;
              flex-direction: column;
              overflow-y: auto;
              min-height: 0;
            ` : ""}
          }
          .footer {
            ${forPrint ? `
              flex: 0 0 auto;
              padding-top: 20px;
              padding-bottom: 5mm;
              position: relative !important;
              overflow: visible !important;
              z-index: 10 !important;
            ` : ""}
          }
          .document-footer {
            ${forPrint ? `
              position: relative !important;
              overflow: visible !important;
            ` : ""}
          }
          .signatures {
            ${forPrint ? `
              overflow: visible !important;
            ` : ""}
          }
          .signature-box {
            ${forPrint ? `
              overflow: visible !important;
            ` : ""}
          }
          .signature-line {
            ${forPrint ? `
              overflow: visible !important;
            ` : ""}
          }
          .header {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            margin-bottom: 12px;
            padding: ${design === "modern" ? "15px 20px" : design === "professional" ? "20px" : "8px 0"};
            padding-bottom: ${design === "minimal" ? "8px" : "12px"};
            border-bottom: ${design === "minimal" ? "1px" : design === "modern" ? "3px" : "2px"} solid ${styles.borderColor};
            ${design === "modern" ? `border-bottom-color: ${styles.secondaryColor};` : ""}
            ${design === "professional" ? `border-bottom: 3px solid ${styles.primaryColor};` : ""}
          }
          .header-right {
            flex-shrink: 0;
            margin-left: 20px;
            display: flex;
            flex-direction: column;
            align-items: flex-end;
            justify-content: flex-start;
          }
          .header-left {
            flex: 1;
          }
          .logo {
            max-width: ${((documentsConfig.logoSize ?? 100) / 100) * 120}px;
            max-height: ${((documentsConfig.logoSize ?? 100) / 100) * 50}px;
            width: auto;
            height: auto;
            object-fit: contain;
            margin-bottom: 6px;
          }
          h1 {
            font-size: ${design === "modern" ? "20px" : design === "professional" ? "18px" : "16px"};
            margin: 0;
            font-weight: ${design === "minimal" ? "500" : design === "modern" ? "800" : "700"};
            color: ${design === "modern" || design === "professional" ? styles.headerText : styles.primaryColor};
            ${design === "modern" ? "letter-spacing: -0.5px;" : ""}
          }
          .section {
            margin-bottom: 10px;
            background: ${forPrint ? "transparent" : (design === "minimal" ? "transparent" : styles.sectionBg)};
            padding: ${forPrint ? (design === "minimal" ? "0" : design === "modern" ? "15px" : "12px") : (design === "minimal" ? "0" : design === "modern" ? "15px" : "12px")};
            border-radius: ${forPrint ? (design === "minimal" ? "0" : design === "modern" ? "8px" : "6px") : (design === "minimal" ? "0" : design === "modern" ? "8px" : "6px")};
            border: ${forPrint ? (design === "minimal" ? "none" : styles.sectionBorder) : (design === "minimal" ? "none" : styles.sectionBorder)};
            box-shadow: ${forPrint ? "none" : (design === "minimal" ? "none" : design === "modern" ? "0 2px 8px rgba(59, 130, 246, 0.1)" : design === "professional" ? "0 1px 3px rgba(0,0,0,0.08)" : "0 1px 3px rgba(0,0,0,0.1)")};
            overflow: visible;
            ${design === "professional" ? "border-left: 4px solid " + styles.accentColor + ";" : ""}
            ${design === "modern" ? "border: 2px solid " + styles.borderColor + ";" : ""}
          }
          ${forPrint ? `
            @media print {
              .section {
                border-radius: ${design === "minimal" ? "0" : design === "modern" ? "8px" : "6px"} !important;
                border: ${design === "minimal" ? "none" : styles.sectionBorder} !important;
                overflow: visible !important;
                ${design === "professional" ? "border-left: 4px solid " + styles.accentColor + " !important;" : ""}
                ${design === "modern" ? "border: 2px solid " + styles.borderColor + " !important;" : ""}
              }
            }
          ` : ""}
          .section-title {
            font-size: ${design === "modern" ? "13px" : "12px"};
            font-weight: ${design === "minimal" ? "500" : design === "modern" ? "800" : "bold"};
            margin-bottom: ${design === "modern" ? "10px" : "6px"};
            color: ${design === "modern" ? styles.secondaryColor : styles.secondaryColor};
            ${design === "modern" ? "text-transform: uppercase; letter-spacing: 1px; color: " + styles.secondaryColor + ";" : ""}
            ${design === "professional" ? "color: " + styles.primaryColor + "; border-bottom: 2px solid " + styles.borderColor + "; padding-bottom: 4px;" : ""}
          }
          .field {
            margin-bottom: 4px;
            font-size: 11px;
          }
          .field-label {
            font-weight: 600;
            display: inline-block;
            min-width: 140px;
            color: ${styles.secondaryColor};
            font-size: 11px;
          }
          .field-value {
            color: ${styles.primaryColor};
            font-size: 11px;
          }
          .field-price {
            margin-bottom: 4px;
            font-size: 11px;
            display: flex;
            justify-content: space-between;
            align-items: baseline;
            gap: 10px;
          }
          .field-price .field-label {
            font-weight: 600;
            color: ${styles.secondaryColor};
            font-size: 11px;
            flex-shrink: 0;
            min-width: auto;
          }
          .field-price .field-value {
            color: ${styles.primaryColor};
            font-size: 11px;
            text-align: right;
            flex: 1;
          }
          .divider {
            border-top: 1px solid ${styles.borderColor};
            margin: 8px 0;
          }
          .legal-text {
            margin-top: 12px;
            padding: 10px;
            background: ${styles.bgColor};
            border: 1px solid ${styles.borderColor};
            border-radius: 6px;
            font-size: 9px;
            color: ${styles.secondaryColor};
            line-height: 1.4;
          }
          .signatures {
            margin-top: 12px;
            margin-bottom: 0;
            display: grid;
            grid-template-columns: 1fr 1fr 1fr;
            gap: 20px;
            padding-top: 10px;
            padding-bottom: 0;
            border-top: 1px solid ${styles.borderColor};
          }
          .signature-box {
            text-align: center;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: flex-end;
            min-height: 80px;
          }
          .signature-line {
            border-top: 1px solid ${styles.primaryColor};
            margin-top: auto;
            margin-bottom: 3px;
            height: 1px;
            width: 200px;
            margin-left: auto;
            margin-right: auto;
            flex-shrink: 0;
          }
          .signature-label {
            font-size: 9px;
            color: ${styles.secondaryColor};
            margin-top: 0;
          }
          .signature-box img {
            max-width: ${((documentsConfig.stampSize ?? 100) / 100) * 120}px;
            max-height: ${((documentsConfig.stampSize ?? 100) / 100) * 60}px;
            width: auto;
            height: auto;
            object-fit: contain;
            margin-bottom: auto;
            margin-top: 0;
            order: -1;
          }
          .stamp {
            max-width: 100px;
            max-height: 100px;
            margin: 10px auto;
            display: block;
          }
          ${!forPrint ? `
            .actions {
              position: fixed;
              top: 20px;
              right: 20px;
              display: flex;
              gap: 10px;
              z-index: 1000;
            }
            @media print {
              .actions {
                display: none !important;
              }
            }
            .action-btn {
              padding: 10px 16px;
              border: 1px solid #ddd;
              border-radius: 8px;
              background: white;
              cursor: pointer;
              font-size: 14px;
              font-weight: 600;
              box-shadow: 0 2px 8px rgba(0,0,0,0.1);
            }
            .action-btn:hover {
              background: #f5f5f5;
            }
          ` : ""}
        </style>
      </head>
      <body>
        ${!forPrint ? `
          <div class="actions">
            <button class="action-btn" onclick="window.print()">🖨️ Tisknout</button>
          </div>
        ` : ""}
        <div class="doc-page">
        <div class="doc-content">
        <div class="doc-code-block" style="margin-bottom: 20px; padding: 16px 20px; background: ${styles.bgColor}; border: 3px solid ${styles.borderColor}; border-radius: 10px; text-align: center;">
          <div style="font-size: 12px; font-weight: 700; color: ${styles.secondaryColor}; text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 6px;">Číslo zakázky</div>
          <div style="font-size: 32px; font-weight: 900; color: ${styles.primaryColor}; letter-spacing: 0.08em; line-height: 1.2;">${ticket.code || "—"}</div>
        </div>
        <div class="header">
          <div class="header-left">
            ${documentsConfig.logoUrl ? `<img src="${documentsConfig.logoUrl}" alt="Logo servisu" class="logo" />` : ""}
        <h1>Zakázkový list</h1>
        <div style="font-size: 11px; color: ${styles.secondaryColor}; margin-top: 4px;">Datum: ${new Date(ticket.createdAt).toLocaleDateString("cs-CZ")}</div>
          </div>
          ${(() => {
            if (!documentsConfig.qrOnTicketList) return "";
            const reviewUrl = documentsConfig.reviewUrlType === "google" && documentsConfig.googlePlaceId
              ? `https://search.google.com/local/writereview?placeid=${documentsConfig.googlePlaceId}`
              : documentsConfig.reviewUrl;
            return reviewUrl ? `
            <div class="header-right" style="display: flex; align-items: center; gap: 12px;">
              <div style="text-align: right; font-size: 11px; color: ${styles.secondaryColor}; max-width: 150px;">
                ${documentsConfig.reviewText || "Zde nám můžete napsat recenzi"}
              </div>
              <img src="https://api.qrserver.com/v1/create-qr-code/?size=${documentsConfig.qrCodeSize ?? 120}x${documentsConfig.qrCodeSize ?? 120}&ecc=L&data=${encodeURIComponent(reviewUrl)}" alt="QR" style="width: ${documentsConfig.qrCodeSize ?? 120}px; height: ${documentsConfig.qrCodeSize ?? 120}px; display: block; flex-shrink: 0;" />
            </div>
          ` : "";
          })()}
        </div>
        
        ${documentsConfig.ticketList.includeServiceInfo && (companyData.name || companyData.addressStreet) ? `
          <div class="section">
            <div class="section-title">Servis</div>
            ${companyData.name ? `<div class="field"><span class="field-label">Název:</span><span class="field-value">${companyData.name}</span></div>` : ""}
            ${companyData.addressStreet || companyData.addressCity || companyData.addressZip 
              ? `<div class="field"><span class="field-label">Adresa:</span><span class="field-value">${[companyData.addressStreet, companyData.addressCity, companyData.addressZip].filter(Boolean).join(", ")}</span></div>` 
              : ""}
            ${companyData.phone ? `<div class="field"><span class="field-label">Telefon:</span><span class="field-value">${companyData.phone}</span></div>` : ""}
            ${companyData.email ? `<div class="field"><span class="field-label">E-mail:</span><span class="field-value">${companyData.email}</span></div>` : ""}
            ${companyData.ico ? `<div class="field"><span class="field-label">IČO:</span><span class="field-value">${companyData.ico}</span></div>` : ""}
            ${companyData.dic ? `<div class="field"><span class="field-label">DIČ:</span><span class="field-value">${companyData.dic}</span></div>` : ""}
          </div>
          <div class="divider"></div>
        ` : ""}
        
        ${documentsConfig.ticketList.includeCustomerInfo ? `
        <div class="section">
          <div class="section-title">Zákazník</div>
          <div class="field"><span class="field-label">Jméno:</span><span class="field-value">${ticket.customerName || "—"}</span></div>
          ${ticket.customerPhone ? `<div class="field"><span class="field-label">Telefon:</span><span class="field-value">${ticket.customerPhone}</span></div>` : ""}
          ${ticket.customerEmail ? `<div class="field"><span class="field-label">E-mail:</span><span class="field-value">${ticket.customerEmail}</span></div>` : ""}
          ${ticket.customerAddressStreet || ticket.customerAddressCity || ticket.customerAddressZip 
            ? `<div class="field"><span class="field-label">Adresa:</span><span class="field-value">${[ticket.customerAddressStreet, ticket.customerAddressCity, ticket.customerAddressZip].filter(Boolean).join(", ")}</span></div>` 
            : ""}
          ${ticket.customerCompany ? `<div class="field"><span class="field-label">Firma:</span><span class="field-value">${ticket.customerCompany}</span></div>` : ""}
          ${ticket.customerIco ? `<div class="field"><span class="field-label">IČO:</span><span class="field-value">${ticket.customerIco}</span></div>` : ""}
        </div>
        
        <div class="divider"></div>
        ` : ""}
        
        ${documentsConfig.ticketList.includeDeviceInfo ? `
        <div class="section">
          <div class="section-title">Zařízení</div>
          ${documentsConfig.deviceInfoConfig?.deviceLabel !== false ? `<div class="field"><span class="field-label">Zařízení:</span><span class="field-value">${ticket.deviceLabel || "—"}</span></div>` : ""}
          ${documentsConfig.deviceInfoConfig?.serialOrImei !== false && ticket.serialOrImei ? `<div class="field"><span class="field-label">SN/IMEI:</span><span class="field-value">${ticket.serialOrImei}</span></div>` : ""}
          ${documentsConfig.deviceInfoConfig?.devicePasscode !== false && ticket.devicePasscode ? `<div class="field"><span class="field-label">Heslo/kód:</span><span class="field-value">${documentsConfig.deviceInfoConfig?.devicePasscodeVisible ? ticket.devicePasscode : "••••"}</span></div>` : ""}
          ${documentsConfig.deviceInfoConfig?.deviceCondition !== false && ticket.deviceCondition ? `<div class="field"><span class="field-label">Popis stavu:</span><span class="field-value">${ticket.deviceCondition}</span></div>` : ""}
          ${documentsConfig.deviceInfoConfig?.deviceAccessories !== false && ticket.deviceAccessories ? `<div class="field"><span class="field-label">Příslušenství:</span><span class="field-value">${ticket.deviceAccessories}</span></div>` : ""}
          ${documentsConfig.deviceInfoConfig?.requestedRepair !== false ? `<div class="field"><span class="field-label">Požadovaná oprava:</span><span class="field-value">${ticket.requestedRepair || ticket.issueShort || "—"}</span></div>` : ""}
          ${documentsConfig.deviceInfoConfig?.deviceNote !== false && ticket.deviceNote ? `<div class="field"><span class="field-label">Poznámka:</span><span class="field-value">${ticket.deviceNote}</span></div>` : ""}
          ${documentsConfig.deviceInfoConfig?.handoffMethod !== false && (ticket.handoffMethod || ticket.handbackMethod) ? [
            ticket.handoffMethod ? `<div class="field"><span class="field-label">Převzetí:</span><span class="field-value">${handoffLabel(ticket.handoffMethod)}</span></div>` : "",
            ticket.handbackMethod ? `<div class="field"><span class="field-label">Předání:</span><span class="field-value">${handoffLabel(ticket.handbackMethod)}</span></div>` : "",
          ].filter(Boolean).join("") : ""}
          ${documentsConfig.deviceInfoConfig?.externalId !== false && ticket.externalId ? `<div class="field"><span class="field-label">Externí ID:</span><span class="field-value">${ticket.externalId}</span></div>` : ""}
        </div>
        
          <div class="divider"></div>
        ` : ""}
        
        ${documentsConfig.ticketList.includeRepairs && ticket.performedRepairs && ticket.performedRepairs.length > 0 ? `
          <div class="section">
            <div class="section-title">Provedené opravy</div>
            ${ticket.performedRepairs.map((repair) => {
              const priceText = repair.price ? `${repair.price} Kč` : "";
              return `<div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; font-size: 11px;">
                <span style="color: ${styles.primaryColor};">• ${repair.name}</span>
                ${priceText ? `<span style="color: ${styles.primaryColor}; font-weight: 600; text-align: right;">${priceText}</span>` : ""}
              </div>`;
            }).join("")}
            ${(() => {
              const totalPrice = ticket.performedRepairs?.reduce((sum, r) => sum + (r.price || 0), 0) || 0;
              const discountAmount = ticket.discountType === "percentage" && ticket.discountValue 
                ? totalPrice * (ticket.discountValue / 100)
                : ticket.discountType === "amount" && ticket.discountValue
                ? ticket.discountValue
                : 0;
              const finalPrice = totalPrice - discountAmount;
              if (totalPrice > 0) {
                let result = `<div class="field-price" style="margin-top: 8px; padding-top: 8px; border-top: 1px solid ${styles.borderColor};"><span class="field-label">Celkem:</span><span class="field-value">${totalPrice} Kč</span></div>`;
                if (discountAmount > 0) {
                  const discountText = ticket.discountType === "percentage" 
                    ? `Sleva ${ticket.discountValue}%`
                    : `Sleva ${ticket.discountValue} Kč`;
                  result += `<div class="field-price"><span class="field-label">${discountText}:</span><span class="field-value">-${discountAmount.toFixed(2)} Kč</span></div>`;
                  result += `<div class="field-price" style="margin-top: 10px; padding-top: 10px; border-top: 2px solid ${styles.primaryColor}; font-weight: 700; font-size: 13px;"><span class="field-label" style="font-size: 13px; font-weight: 700;">Konečná cena:</span><span class="field-value" style="font-size: 14px; font-weight: 800; color: ${styles.primaryColor};">${finalPrice.toFixed(2)} Kč</span></div>`;
                } else {
                  result += `<div class="field-price" style="margin-top: 10px; padding-top: 10px; border-top: 2px solid ${styles.primaryColor}; font-weight: 700; font-size: 13px;"><span class="field-label" style="font-size: 13px; font-weight: 700;">Konečná cena:</span><span class="field-value" style="font-size: 14px; font-weight: 800; color: ${styles.primaryColor};">${totalPrice} Kč</span></div>`;
                }
                return result;
              }
              return "";
            })()}
          </div>
          <div class="divider"></div>
        ` : ""}
        
        ${documentsConfig.ticketList.includeDiagnostic && ticket.diagnosticText ? `
          <div class="section">
            <div class="section-title">Diagnostika</div>
            <div style="font-size: 11px; color: ${styles.primaryColor}; white-space: pre-wrap; text-align: left;">${ticket.diagnosticText}</div>
          </div>
        <div class="divider"></div>
        ` : ""}
        
        ${documentsConfig.ticketList.includePhotos && ticket.diagnosticPhotosBefore && ticket.diagnosticPhotosBefore.length > 0 ? `
          <div class="section">
            <div class="section-title">Fotky před</div>
            <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 15px; margin: 15px 0;">
              ${ticket.diagnosticPhotosBefore.map((photoUrl) => `
                <div style="border: 1px solid #ddd; border-radius: 8px; overflow: hidden;">
                  <img src="${photoUrl}" alt="Fotka před" style="width: 100%; height: auto; display: block;" />
                </div>
              `).join("")}
            </div>
          </div>
          <div class="divider"></div>
        ` : ""}
        ${documentsConfig.ticketList.includePhotos && ticket.diagnosticPhotos && ticket.diagnosticPhotos.length > 0 ? `
          <div class="section">
            <div class="section-title">Diagnostické fotografie</div>
            <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 15px; margin: 15px 0;">
              ${ticket.diagnosticPhotos.map((photoUrl) => `
                <div style="border: 1px solid #ddd; border-radius: 8px; overflow: hidden;">
                  <img src="${photoUrl}" alt="Diagnostická fotografie" style="width: 100%; height: auto; display: block;" />
                </div>
              `).join("")}
            </div>
          </div>
          <div class="divider"></div>
        ` : ""}
        
        ${documentsConfig.ticketList.includeDates ? `
        <div class="section">
          <div class="field"><span class="field-label">Datum vytvoření:</span><span class="field-value">${new Date(ticket.createdAt).toLocaleString("cs-CZ")}</span></div>
        </div>
        ` : ""}
        
        ${documentsConfig.ticketList?.legalText ? `
          <div class="legal-text">
            ${documentsConfig.ticketList.legalText}
          </div>
        ` : ""}
        
        </div>
        <div class="doc-footer">
        <div class="document-footer">
        <div class="signatures">
          <div class="signature-box">
            <div class="signature-line"></div>
            <div class="signature-label">Podpis zákazníka - při předání</div>
          </div>
          <div class="signature-box">
            <div class="signature-line"></div>
            <div class="signature-label">Podpis zákazníka - při odevzdání servisem</div>
          </div>
          <div class="signature-box">
            ${documentsConfig.ticketList.includeStamp && documentsConfig.stampUrl ? `
              <img src="${documentsConfig.stampUrl}" alt="Razítko servisu" />
            ` : ""}
            <div class="signature-line"></div>
            <div class="signature-label">Razítko servisu</div>
          </div>
          </div>
        </div>
        </div>
        </div>
        </div>
      </body>
    </html>
  `;
}

export function generateDiagnosticProtocolHTML(ticket: TicketEx, companyData: any, forPrint: boolean = true, config?: any, _includeActions: boolean = false): string {
  const documentsConfig = config || safeLoadDocumentsConfig();
  const design = documentsConfig.diagnosticProtocol?.design || "classic";
  const colorMode = documentsConfig.colorMode || "color";
  
  const styles = getDesignStylesForFallback(design);
  
  return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="UTF-8">
        <title>Diagnostický protokol - ${ticket.code}</title>
        <style>
          ${colorMode === "bw" ? `
            * {
              color: #000 !important;
              background: #fff !important;
              border-color: #000 !important;
            }
            img {
              filter: grayscale(100%);
            }
            svg {
              filter: grayscale(100%);
            }
          ` : ""}
          ${forPrint ? `
            @media print {
              @page {
                size: A4;
                margin: 0;
              }
              html, body {
                margin: 0 !important;
                padding: 0 !important;
              }
              .page {
                width: 210mm;
                height: 297mm;
                padding: 12mm;
                margin: 0;
                box-sizing: border-box;
                overflow: visible;
                display: flex !important;
                flex-direction: column !important;
              }
              .content {
                flex: 1 !important;
                display: flex !important;
                flex-direction: column !important;
                overflow: hidden !important;
                min-height: 0 !important;
              }
              .footer {
                flex: 0 0 auto !important;
                position: relative !important;
                overflow: visible !important;
                z-index: 10 !important;
              }
              .document-footer {
                position: relative !important;
                overflow: visible !important;
              }
              .signatures {
                overflow: visible !important;
              }
              .signature-box {
                position: relative !important;
                overflow: visible !important;
              }
              .signature-line {
                overflow: visible !important;
              }
              .card {
                box-shadow: none !important;
              }
              /* Ensure sections display correctly in print - borders and border-radius */
              .section {
                overflow: visible !important;
                position: relative !important;
              }
              .section::before {
                content: none !important;
                display: none !important;
              }
              .section::after {
                content: none !important;
                display: none !important;
              }
              ${colorMode === "bw" ? `
                * {
                  color: #000 !important;
                  background: #fff !important;
                  border-color: #000 !important;
                }
                img {
                  filter: grayscale(100%);
                }
                svg {
                  filter: grayscale(100%);
                }
          ` : ""}
            }
          ` : ""}
          * {
            box-sizing: border-box;
          }
          body {
            font-family: system-ui, -apple-system, sans-serif;
            padding: ${forPrint ? "0" : "20px"};
            margin: 0 auto;
            color: ${styles.primaryColor};
            background: ${forPrint ? "#fff" : styles.bgColor};
            line-height: 1.4;
            font-size: 11px;
            ${forPrint ? `
              min-height: 100vh;
              display: flex;
              flex-direction: column;
            ` : ""}
          }
          ${forPrint ? `
            @media screen {
              body {
                padding: 16px;
                background: #eee;
              }
              .page {
                width: 210mm;
                margin: 0 auto;
                background: #fff;
              }
            }
          ` : `
            body {
              max-width: 210mm;
              width: 210mm;
            }
          `}
          .page {
            ${forPrint ? `
              height: 297mm;
              display: flex;
              flex-direction: column;
            ` : ""}
          }
          .content {
            ${forPrint ? `
              flex: 1;
              display: flex;
              flex-direction: column;
              overflow: hidden;
              min-height: 0;
            ` : ""}
          }
          .document-content {
            ${forPrint ? `
              flex: 1;
              display: flex;
              flex-direction: column;
              overflow-y: auto;
              min-height: 0;
            ` : ""}
          }
          .footer {
            ${forPrint ? `
              flex: 0 0 auto;
              padding-top: 20px;
              padding-bottom: 5mm;
              position: relative !important;
              overflow: visible !important;
              z-index: 10 !important;
            ` : ""}
          }
          .document-footer {
            ${forPrint ? `
              position: relative !important;
              overflow: visible !important;
            ` : ""}
          }
          .signatures {
            ${forPrint ? `
              overflow: visible !important;
            ` : ""}
          }
          .signature-box {
            ${forPrint ? `
              overflow: visible !important;
            ` : ""}
          }
          .signature-line {
            ${forPrint ? `
              overflow: visible !important;
            ` : ""}
          }
          .header {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            margin-bottom: 12px;
            padding: ${design === "modern" ? "15px 20px" : design === "professional" ? "20px" : "8px 0"};
            padding-bottom: ${design === "minimal" ? "8px" : "12px"};
            border-bottom: ${design === "minimal" ? "1px" : design === "modern" ? "3px" : "2px"} solid ${styles.borderColor};
            ${design === "modern" ? `border-bottom-color: ${styles.secondaryColor};` : ""}
            ${design === "professional" ? `border-bottom: 3px solid ${styles.primaryColor};` : ""}
          }
          .header-right {
            flex-shrink: 0;
            margin-left: 20px;
            display: flex;
            flex-direction: column;
            align-items: flex-end;
            justify-content: flex-start;
          }
          .header-left {
            flex: 1;
          }
          .logo {
            max-width: ${((documentsConfig.logoSize ?? 100) / 100) * 120}px;
            max-height: ${((documentsConfig.logoSize ?? 100) / 100) * 50}px;
            width: auto;
            height: auto;
            object-fit: contain;
            margin-bottom: 6px;
          }
          h1 {
            font-size: ${design === "modern" ? "20px" : design === "professional" ? "18px" : "16px"};
            margin: 0;
            font-weight: ${design === "minimal" ? "500" : design === "modern" ? "800" : "700"};
            color: ${design === "modern" || design === "professional" ? styles.headerText : styles.primaryColor};
            ${design === "modern" ? "letter-spacing: -0.5px;" : ""}
          }
          .section {
            margin-bottom: 10px;
            background: ${forPrint ? "transparent" : (design === "minimal" ? "transparent" : styles.sectionBg)};
            padding: ${forPrint ? (design === "minimal" ? "0" : design === "modern" ? "15px" : "12px") : (design === "minimal" ? "0" : design === "modern" ? "15px" : "12px")};
            border-radius: ${forPrint ? (design === "minimal" ? "0" : design === "modern" ? "8px" : "6px") : (design === "minimal" ? "0" : design === "modern" ? "8px" : "6px")};
            border: ${forPrint ? (design === "minimal" ? "none" : styles.sectionBorder) : (design === "minimal" ? "none" : styles.sectionBorder)};
            box-shadow: ${forPrint ? "none" : (design === "minimal" ? "none" : design === "modern" ? "0 2px 8px rgba(59, 130, 246, 0.1)" : design === "professional" ? "0 1px 3px rgba(0,0,0,0.08)" : "0 1px 3px rgba(0,0,0,0.1)")};
            overflow: visible;
            ${design === "professional" ? "border-left: 4px solid " + styles.accentColor + ";" : ""}
            ${design === "modern" ? "border: 2px solid " + styles.borderColor + ";" : ""}
          }
          ${forPrint ? `
            @media print {
              .section {
                border-radius: ${design === "minimal" ? "0" : design === "modern" ? "8px" : "6px"} !important;
                border: ${design === "minimal" ? "none" : styles.sectionBorder} !important;
                overflow: visible !important;
                ${design === "professional" ? "border-left: 4px solid " + styles.accentColor + " !important;" : ""}
                ${design === "modern" ? "border: 2px solid " + styles.borderColor + " !important;" : ""}
              }
            }
          ` : ""}
          .section-title {
            font-size: ${design === "modern" ? "13px" : "12px"};
            font-weight: ${design === "minimal" ? "500" : design === "modern" ? "800" : "bold"};
            margin-bottom: ${design === "modern" ? "10px" : "6px"};
            color: ${design === "modern" ? styles.secondaryColor : styles.secondaryColor};
            ${design === "modern" ? "text-transform: uppercase; letter-spacing: 1px; color: " + styles.secondaryColor + ";" : ""}
            ${design === "professional" ? "color: " + styles.primaryColor + "; border-bottom: 2px solid " + styles.borderColor + "; padding-bottom: 4px;" : ""}
          }
          .field {
            margin-bottom: 4px;
            font-size: 11px;
          }
          .field-label {
            font-weight: 600;
            display: inline-block;
            min-width: 140px;
            color: ${styles.secondaryColor};
            font-size: 11px;
          }
          .field-value {
            color: ${styles.primaryColor};
            font-size: 11px;
          }
          .field-price {
            margin-bottom: 4px;
            font-size: 11px;
            display: flex;
            justify-content: space-between;
            align-items: baseline;
            gap: 10px;
          }
          .field-price .field-label {
            font-weight: 600;
            color: ${styles.secondaryColor};
            font-size: 11px;
            flex-shrink: 0;
            min-width: auto;
          }
          .field-price .field-value {
            color: ${styles.primaryColor};
            font-size: 11px;
            text-align: right;
            flex: 1;
          }
          .divider {
            border-top: 1px solid ${styles.borderColor};
            margin: 8px 0;
          }
          .diagnostic-text {
            padding: 8px;
            background: ${styles.bgColor};
            border-radius: 6px;
            white-space: pre-wrap;
            line-height: 1.4;
            margin: 6px 0;
            font-size: 11px;
          }
          .legal-text {
            margin-top: 12px;
            padding: 10px;
            background: ${styles.bgColor};
            border: 1px solid ${styles.borderColor};
            border-radius: 6px;
            font-size: 9px;
            color: ${styles.secondaryColor};
            line-height: 1.4;
          }
          .signature-box {
            text-align: center;
            margin-top: 12px;
            padding-top: 10px;
            border-top: 1px solid ${styles.borderColor};
          }
          .signature-line {
            border-top: 1px solid ${styles.primaryColor};
            margin-top: ${design === "minimal" ? "20px" : "30px"};
            margin-bottom: 3px;
            height: 1px;
            width: 200px;
            margin-left: auto;
            margin-right: auto;
          }
          .signature-label {
            font-size: 9px;
            color: ${styles.secondaryColor};
          }
          .signature-box img {
            max-width: ${((documentsConfig.stampSize ?? 100) / 100) * 120}px;
            max-height: ${((documentsConfig.stampSize ?? 100) / 100) * 60}px;
            width: auto;
            height: auto;
            object-fit: contain;
          }
          .stamp {
            max-width: 100px;
            max-height: 100px;
            margin: 10px auto;
            display: block;
          }
          .photo-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
            gap: 15px;
            margin: 15px 0;
          }
          .photo-item {
            border: 1px solid #ddd;
            border-radius: 8px;
            overflow: hidden;
          }
          .photo-item img {
            width: 100%;
            height: auto;
            display: block;
          }
          ${!forPrint ? `
            .actions {
              position: fixed;
              top: 20px;
              right: 20px;
              display: flex;
              gap: 10px;
              z-index: 1000;
            }
            @media print {
              .actions {
                display: none !important;
              }
            }
            .action-btn {
              padding: 10px 16px;
              border: 1px solid #ddd;
              border-radius: 8px;
              background: white;
              cursor: pointer;
              font-size: 14px;
              font-weight: 600;
              box-shadow: 0 2px 8px rgba(0,0,0,0.1);
            }
            .action-btn:hover {
              background: #f5f5f5;
            }
          ` : ""}
        </style>
      </head>
      <body>
        ${!forPrint ? `
          <div class="actions">
            <button class="action-btn" onclick="window.print()">🖨️ Tisknout</button>
          </div>
        ` : ""}
        <div class="doc-page">
        <div class="doc-content">
        <div class="document-content">
        <div class="doc-code-block" style="margin-bottom: 16px; padding: 12px 16px; background: ${styles.bgColor}; border: 2px solid ${styles.borderColor}; border-radius: 8px; text-align: center;">
          <div style="font-size: 11px; font-weight: 700; color: ${styles.secondaryColor}; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px;">Kód zakázky</div>
          <div style="font-size: 22px; font-weight: 900; color: ${styles.primaryColor}; letter-spacing: 0.05em;">${ticket.code || "—"}</div>
        </div>
        <div class="header">
          <div class="header-left">
            ${documentsConfig.logoUrl ? `<img src="${documentsConfig.logoUrl}" alt="Logo servisu" class="logo" />` : ""}
        <h1>Diagnostický protokol</h1>
        <div style="font-size: 11px; color: ${styles.secondaryColor}; margin-top: 4px;">Datum: ${new Date(ticket.createdAt).toLocaleDateString("cs-CZ")}</div>
          </div>
          ${(() => {
            if (!documentsConfig.qrOnDiagnostic) return "";
            const reviewUrl = documentsConfig.reviewUrlType === "google" && documentsConfig.googlePlaceId
              ? `https://search.google.com/local/writereview?placeid=${documentsConfig.googlePlaceId}`
              : documentsConfig.reviewUrl;
            return reviewUrl ? `
            <div class="header-right" style="display: flex; align-items: center; gap: 12px;">
              <div style="text-align: right; font-size: 11px; color: ${styles.secondaryColor}; max-width: 150px;">
                ${documentsConfig.reviewText || "Zde nám můžete napsat recenzi"}
              </div>
              <img src="https://api.qrserver.com/v1/create-qr-code/?size=${documentsConfig.qrCodeSize ?? 120}x${documentsConfig.qrCodeSize ?? 120}&ecc=L&data=${encodeURIComponent(reviewUrl)}" alt="QR" style="width: ${documentsConfig.qrCodeSize ?? 120}px; height: ${documentsConfig.qrCodeSize ?? 120}px; display: block; flex-shrink: 0;" />
            </div>
          ` : "";
          })()}
        </div>
        
        ${documentsConfig.diagnosticProtocol.includeServiceInfo && companyData && (companyData.name || companyData.addressStreet) ? `
          <div class="section">
            <div class="section-title">Servis</div>
            ${companyData.name ? `<div class="field"><span class="field-label">Název:</span><span class="field-value">${companyData.name}</span></div>` : ""}
            ${companyData.addressStreet || companyData.addressCity || companyData.addressZip 
              ? `<div class="field"><span class="field-label">Adresa:</span><span class="field-value">${[companyData.addressStreet, companyData.addressCity, companyData.addressZip].filter(Boolean).join(", ")}</span></div>` 
              : ""}
            ${companyData.phone ? `<div class="field"><span class="field-label">Telefon:</span><span class="field-value">${companyData.phone}</span></div>` : ""}
            ${companyData.email ? `<div class="field"><span class="field-label">E-mail:</span><span class="field-value">${companyData.email}</span></div>` : ""}
            ${companyData.ico ? `<div class="field"><span class="field-label">IČO:</span><span class="field-value">${companyData.ico}</span></div>` : ""}
            ${companyData.dic ? `<div class="field"><span class="field-label">DIČ:</span><span class="field-value">${companyData.dic}</span></div>` : ""}
          </div>
          <div class="divider"></div>
        ` : ""}
        
        ${documentsConfig.diagnosticProtocol.includeCustomerInfo ? `
        <div class="section">
          <div class="section-title">Zákazník</div>
          <div class="field"><span class="field-label">Jméno:</span><span class="field-value">${ticket.customerName || "—"}</span></div>
          ${ticket.customerPhone ? `<div class="field"><span class="field-label">Telefon:</span><span class="field-value">${ticket.customerPhone}</span></div>` : ""}
          ${ticket.customerEmail ? `<div class="field"><span class="field-label">E-mail:</span><span class="field-value">${ticket.customerEmail}</span></div>` : ""}
        </div>
        
        <div class="divider"></div>
        ` : ""}
        
        ${documentsConfig.diagnosticProtocol.includeDeviceInfo ? `
        <div class="section">
          <div class="section-title">Zařízení</div>
          ${documentsConfig.deviceInfoConfig?.deviceLabel !== false ? `<div class="field"><span class="field-label">Zařízení:</span><span class="field-value">${ticket.deviceLabel || "—"}</span></div>` : ""}
          ${documentsConfig.deviceInfoConfig?.serialOrImei !== false && ticket.serialOrImei ? `<div class="field"><span class="field-label">SN/IMEI:</span><span class="field-value">${ticket.serialOrImei}</span></div>` : ""}
          ${documentsConfig.diagnosticProtocol.includeDates ? `<div class="field"><span class="field-label">Datum:</span><span class="field-value">${new Date(ticket.createdAt).toLocaleString("cs-CZ")}</span></div>` : ""}
        </div>
        
        <div class="divider"></div>
        ` : ""}
        
        ${documentsConfig.diagnosticProtocol.includeDiagnosticText ? `
        <div class="section">
          <div class="section-title">Výsledky diagnostiky</div>
          ${ticket.diagnosticText ? `
            <div class="diagnostic-text">${ticket.diagnosticText}</div>
          ` : `
            <div class="field"><span class="field-value">Diagnostika nebyla zadána.</span></div>
          `}
        </div>
        
        <div class="divider"></div>
        ` : ""}
        
        ${documentsConfig.diagnosticProtocol.includePhotos && ticket.diagnosticPhotosBefore && ticket.diagnosticPhotosBefore.length > 0 ? `
          <div class="section">
            <div class="section-title">Fotky před</div>
            <div class="photo-grid">
              ${ticket.diagnosticPhotosBefore.map((photoUrl) => `
                <div class="photo-item">
                  <img src="${photoUrl}" alt="Fotka před" />
                </div>
              `).join("")}
            </div>
          </div>
          <div class="divider"></div>
        ` : ""}
        ${documentsConfig.diagnosticProtocol.includePhotos && ticket.diagnosticPhotos && ticket.diagnosticPhotos.length > 0 ? `
          <div class="section">
            <div class="section-title">Diagnostické fotografie</div>
            <div class="photo-grid">
              ${ticket.diagnosticPhotos.map((photoUrl) => `
                <div class="photo-item">
                  <img src="${photoUrl}" alt="Diagnostická fotografie" />
                </div>
              `).join("")}
            </div>
          </div>
          <div class="divider"></div>
        ` : ""}
        
        ${documentsConfig.diagnosticProtocol.includeDates ? `
        <div class="section" style="padding-left: 50px;">
          <div class="field"><span class="field-label">Datum vytvoření protokolu:</span><span class="field-value">${new Date().toLocaleString("cs-CZ")}</span></div>
        </div>
        ` : ""}
        
        ${documentsConfig.diagnosticProtocol?.legalText ? `
          <div class="legal-text">
            ${documentsConfig.diagnosticProtocol.legalText}
          </div>
        ` : ""}
        
        </div>
        </div>
        <div class="doc-footer">
        <div class="document-footer">
        <div class="signatures" style="display: flex; justify-content: flex-end;">
          <div class="signature-box" style="position: relative;">
            ${documentsConfig.stampUrl ? `
              <img src="${documentsConfig.stampUrl}" alt="Razítko servisu" style="position: relative !important; bottom: auto !important; left: auto !important; transform: none !important; max-width: ${((documentsConfig.stampSize ?? 100) / 100) * 120}px; max-height: ${((documentsConfig.stampSize ?? 100) / 100) * 60}px; width: auto; height: auto; object-fit: contain; margin: 0 auto; margin-bottom: 3px;" />
            ` : ""}
            <div class="signature-line"></div>
            <div class="signature-label">Podpis servisu</div>
          </div>
        </div>
        </div>
        </div>
        </div>
        </div>
      </body>
    </html>
  `;
}

export function generateWarrantyHTML(ticket: TicketEx, companyData: any, forPrint: boolean = true, config?: any, _includeActions: boolean = false): string {
  const documentsConfig = config || safeLoadDocumentsConfig();
  const design = documentsConfig.warrantyCertificate?.design || "classic";
  const colorMode = documentsConfig.colorMode || "color";
  
  const styles = getDesignStylesForFallback(design);
  
  return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="UTF-8">
        <title>Záruční list - ${ticket.code}</title>
        <style>
          ${colorMode === "bw" ? `
            * {
              color: #000 !important;
              background: #fff !important;
              border-color: #000 !important;
            }
            img {
              filter: grayscale(100%);
            }
            svg {
              filter: grayscale(100%);
            }
          ` : ""}
          ${forPrint ? `
            @media print {
              @page {
                size: A4;
                margin: 0;
              }
              html, body {
                margin: 0 !important;
                padding: 0 !important;
              }
              .page {
                width: 210mm;
                height: 297mm;
                padding: 12mm;
                margin: 0;
                box-sizing: border-box;
                overflow: visible;
                display: flex !important;
                flex-direction: column !important;
              }
              .content {
                flex: 1 !important;
                display: flex !important;
                flex-direction: column !important;
                overflow: hidden !important;
                min-height: 0 !important;
              }
              .footer {
                flex: 0 0 auto !important;
                position: relative !important;
                overflow: visible !important;
                z-index: 10 !important;
              }
              .document-footer {
                position: relative !important;
                overflow: visible !important;
              }
              .signatures {
                overflow: visible !important;
              }
              .signature-box {
                position: relative !important;
                overflow: visible !important;
              }
              .signature-line {
                overflow: visible !important;
              }
              .card {
                box-shadow: none !important;
              }
              /* Ensure sections display correctly in print - borders and border-radius */
              .section {
                overflow: visible !important;
                position: relative !important;
              }
              .section::before {
                content: none !important;
                display: none !important;
              }
              .section::after {
                content: none !important;
                display: none !important;
              }
              ${colorMode === "bw" ? `
                * {
                  color: #000 !important;
                  background: #fff !important;
                  border-color: #000 !important;
                }
                img {
                  filter: grayscale(100%);
                }
                svg {
                  filter: grayscale(100%);
                }
          ` : ""}
            }
          ` : ""}
          * {
            box-sizing: border-box;
          }
          body {
            font-family: system-ui, -apple-system, sans-serif;
            padding: ${forPrint ? "0" : "20px"};
            margin: 0 auto;
            color: ${styles.primaryColor};
            background: ${forPrint ? "#fff" : styles.bgColor};
            line-height: 1.4;
            font-size: 11px;
            ${forPrint ? `
              min-height: 100vh;
              display: flex;
              flex-direction: column;
            ` : ""}
          }
          ${forPrint ? `
            @media screen {
              body {
                padding: 16px;
                background: #eee;
              }
              .page {
                width: 210mm;
                margin: 0 auto;
                background: #fff;
              }
            }
          ` : `
            body {
              max-width: 210mm;
              width: 210mm;
            }
          `}
          .page {
            ${forPrint ? `
              height: 297mm;
              display: flex;
              flex-direction: column;
            ` : ""}
          }
          .content {
            ${forPrint ? `
              flex: 1;
              display: flex;
              flex-direction: column;
              overflow: hidden;
              min-height: 0;
            ` : ""}
          }
          .document-content {
            ${forPrint ? `
              flex: 1;
              display: flex;
              flex-direction: column;
              overflow-y: auto;
              min-height: 0;
            ` : ""}
          }
          .footer {
            ${forPrint ? `
              flex: 0 0 auto;
              padding-top: 20px;
              padding-bottom: 5mm;
              position: relative !important;
              overflow: visible !important;
              z-index: 10 !important;
            ` : ""}
          }
          .document-footer {
            ${forPrint ? `
              position: relative !important;
              overflow: visible !important;
            ` : ""}
          }
          .signatures {
            ${forPrint ? `
              overflow: visible !important;
            ` : ""}
          }
          .signature-box {
            ${forPrint ? `
              overflow: visible !important;
            ` : ""}
          }
          .signature-line {
            ${forPrint ? `
              overflow: visible !important;
            ` : ""}
          }
          .header {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            margin-bottom: 12px;
            padding: ${design === "modern" ? "15px 20px" : design === "professional" ? "20px" : "8px 0"};
            padding-bottom: ${design === "minimal" ? "8px" : "12px"};
            border-bottom: ${design === "minimal" ? "1px" : design === "modern" ? "3px" : "2px"} solid ${styles.borderColor};
            ${design === "modern" ? `border-bottom-color: ${styles.secondaryColor};` : ""}
            ${design === "professional" ? `border-bottom: 3px solid ${styles.primaryColor};` : ""}
          }
          .header-right {
            flex-shrink: 0;
            margin-left: 20px;
            display: flex;
            flex-direction: column;
            align-items: flex-end;
            justify-content: flex-start;
          }
          .header-left {
            flex: 1;
          }
          .logo {
            max-width: ${((documentsConfig.logoSize ?? 100) / 100) * 120}px;
            max-height: ${((documentsConfig.logoSize ?? 100) / 100) * 50}px;
            width: auto;
            height: auto;
            object-fit: contain;
            margin-bottom: 6px;
          }
          h1 {
            font-size: ${design === "modern" ? "20px" : design === "professional" ? "18px" : "16px"};
            margin: 0;
            font-weight: ${design === "minimal" ? "500" : design === "modern" ? "800" : "700"};
            color: ${design === "modern" || design === "professional" ? styles.headerText : styles.primaryColor};
            ${design === "modern" ? "letter-spacing: -0.5px;" : ""}
          }
          .section {
            margin-bottom: 10px;
            background: ${forPrint ? "transparent" : (design === "minimal" ? "transparent" : styles.sectionBg)};
            padding: ${forPrint ? (design === "minimal" ? "0" : design === "modern" ? "15px" : "12px") : (design === "minimal" ? "0" : design === "modern" ? "15px" : "12px")};
            border-radius: ${forPrint ? (design === "minimal" ? "0" : design === "modern" ? "8px" : "6px") : (design === "minimal" ? "0" : design === "modern" ? "8px" : "6px")};
            border: ${forPrint ? (design === "minimal" ? "none" : styles.sectionBorder) : (design === "minimal" ? "none" : styles.sectionBorder)};
            box-shadow: ${forPrint ? "none" : (design === "minimal" ? "none" : design === "modern" ? "0 2px 8px rgba(59, 130, 246, 0.1)" : design === "professional" ? "0 1px 3px rgba(0,0,0,0.08)" : "0 1px 3px rgba(0,0,0,0.1)")};
            overflow: visible;
            ${design === "professional" ? "border-left: 4px solid " + styles.accentColor + ";" : ""}
            ${design === "modern" ? "border: 2px solid " + styles.borderColor + ";" : ""}
          }
          ${forPrint ? `
            @media print {
              .section {
                border-radius: ${design === "minimal" ? "0" : design === "modern" ? "8px" : "6px"} !important;
                border: ${design === "minimal" ? "none" : styles.sectionBorder} !important;
                overflow: visible !important;
                ${design === "professional" ? "border-left: 4px solid " + styles.accentColor + " !important;" : ""}
                ${design === "modern" ? "border: 2px solid " + styles.borderColor + " !important;" : ""}
              }
            }
          ` : ""}
          .section-title {
            font-size: ${design === "modern" ? "13px" : "12px"};
            font-weight: ${design === "minimal" ? "500" : design === "modern" ? "800" : "bold"};
            margin-bottom: ${design === "modern" ? "10px" : "6px"};
            color: ${design === "modern" ? styles.secondaryColor : styles.secondaryColor};
            ${design === "modern" ? "text-transform: uppercase; letter-spacing: 1px; color: " + styles.secondaryColor + ";" : ""}
            ${design === "professional" ? "color: " + styles.primaryColor + "; border-bottom: 2px solid " + styles.borderColor + "; padding-bottom: 4px;" : ""}
          }
          .field {
            margin-bottom: 4px;
            font-size: 11px;
          }
          .field-label {
            font-weight: 600;
            display: inline-block;
            min-width: 140px;
            color: ${styles.secondaryColor};
            font-size: 11px;
          }
          .field-value {
            color: ${styles.primaryColor};
            font-size: 11px;
          }
          .field-price {
            margin-bottom: 4px;
            font-size: 11px;
            display: flex;
            justify-content: space-between;
            align-items: baseline;
            gap: 10px;
          }
          .field-price .field-label {
            font-weight: 600;
            color: ${styles.secondaryColor};
            font-size: 11px;
            flex-shrink: 0;
            min-width: auto;
          }
          .field-price .field-value {
            color: ${styles.primaryColor};
            font-size: 11px;
            text-align: right;
            flex: 1;
          }
          .divider {
            border-top: 1px solid ${styles.borderColor};
            margin: 8px 0;
          }
          .legal-text {
            margin-top: 12px;
            padding: 10px;
            background: ${styles.bgColor};
            border: 1px solid ${styles.borderColor};
            border-radius: 6px;
            font-size: 9px;
            color: ${styles.secondaryColor};
            line-height: 1.4;
          }
          .signature-box {
            text-align: center;
            margin-top: 12px;
            padding-top: 10px;
            border-top: 1px solid ${styles.borderColor};
          }
          .signature-line {
            border-top: 1px solid ${styles.primaryColor};
            margin-top: ${design === "minimal" ? "20px" : "30px"};
            margin-bottom: 3px;
            height: 1px;
            width: 200px;
            margin-left: auto;
            margin-right: auto;
          }
          .signature-label {
            font-size: 9px;
            color: ${styles.secondaryColor};
          }
          .signature-box img {
            max-width: ${((documentsConfig.stampSize ?? 100) / 100) * 120}px;
            max-height: ${((documentsConfig.stampSize ?? 100) / 100) * 60}px;
            width: auto;
            height: auto;
            object-fit: contain;
          }
          .stamp {
            max-width: 100px;
            max-height: 100px;
            margin: 10px auto;
            display: block;
          }
          ${!forPrint ? `
            .actions {
              position: fixed;
              top: 20px;
              right: 20px;
              display: flex;
              gap: 10px;
              z-index: 1000;
            }
            @media print {
              .actions {
                display: none !important;
              }
            }
            .action-btn {
              padding: 10px 16px;
              border: 1px solid #ddd;
              border-radius: 8px;
              background: white;
              cursor: pointer;
              font-size: 14px;
              font-weight: 600;
              box-shadow: 0 2px 8px rgba(0,0,0,0.1);
            }
            .action-btn:hover {
              background: #f5f5f5;
            }
          ` : ""}
        </style>
      </head>
      <body>
        ${!forPrint ? `
          <div class="actions">
            <button class="action-btn" onclick="window.print()">🖨️ Tisknout</button>
          </div>
        ` : ""}
        <div class="doc-page">
        <div class="doc-content">
        <div class="document-content">
        <div class="doc-code-block" style="margin-bottom: 16px; padding: 12px 16px; background: ${styles.bgColor}; border: 2px solid ${styles.borderColor}; border-radius: 8px; text-align: center;">
          <div style="font-size: 11px; font-weight: 700; color: ${styles.secondaryColor}; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px;">Kód zakázky</div>
          <div style="font-size: 22px; font-weight: 900; color: ${styles.primaryColor}; letter-spacing: 0.05em;">${ticket.code || "—"}</div>
        </div>
        <div class="header">
          <div class="header-left">
            ${documentsConfig.logoUrl ? `<img src="${documentsConfig.logoUrl}" alt="Logo servisu" class="logo" />` : ""}
        <h1>Záruční list</h1>
        <div style="font-size: 11px; color: ${styles.secondaryColor}; margin-top: 4px;">Datum: ${new Date(ticket.createdAt).toLocaleDateString("cs-CZ")}</div>
          </div>
          ${(() => {
            if (documentsConfig.qrOnWarranty === false) return "";
            const reviewUrl = documentsConfig.reviewUrlType === "google" && documentsConfig.googlePlaceId
              ? `https://search.google.com/local/writereview?placeid=${documentsConfig.googlePlaceId}`
              : documentsConfig.reviewUrl;
            return reviewUrl ? `
            <div class="header-right" style="display: flex; align-items: center; gap: 12px;">
              <div style="text-align: right; font-size: 11px; color: ${styles.secondaryColor}; max-width: 150px;">
                ${documentsConfig.reviewText || "Zde nám můžete napsat recenzi"}
              </div>
              <img src="https://api.qrserver.com/v1/create-qr-code/?size=${documentsConfig.qrCodeSize ?? 120}x${documentsConfig.qrCodeSize ?? 120}&ecc=L&data=${encodeURIComponent(reviewUrl)}" alt="QR" style="width: ${documentsConfig.qrCodeSize ?? 120}px; height: ${documentsConfig.qrCodeSize ?? 120}px; display: block; flex-shrink: 0;" />
            </div>
          ` : "";
          })()}
        </div>
        
        ${documentsConfig.warrantyCertificate?.includeServiceInfo && companyData && (companyData.name || companyData.addressStreet) ? `
          <div class="section">
            <div class="section-title">Servis</div>
            ${companyData.name ? `<div class="field"><span class="field-label">Název:</span><span class="field-value">${companyData.name}</span></div>` : ""}
            ${companyData.addressStreet || companyData.addressCity || companyData.addressZip 
              ? `<div class="field"><span class="field-label">Adresa:</span><span class="field-value">${[companyData.addressStreet, companyData.addressCity, companyData.addressZip].filter(Boolean).join(", ")}</span></div>` 
              : ""}
            ${companyData.phone ? `<div class="field"><span class="field-label">Telefon:</span><span class="field-value">${companyData.phone}</span></div>` : ""}
            ${companyData.email ? `<div class="field"><span class="field-label">E-mail:</span><span class="field-value">${companyData.email}</span></div>` : ""}
            ${companyData.ico ? `<div class="field"><span class="field-label">IČO:</span><span class="field-value">${companyData.ico}</span></div>` : ""}
            ${companyData.dic ? `<div class="field"><span class="field-label">DIČ:</span><span class="field-value">${companyData.dic}</span></div>` : ""}
          </div>
          <div class="divider"></div>
        ` : ""}
        
        ${documentsConfig.warrantyCertificate?.includeCustomerInfo ? `
        <div class="section">
          <div class="section-title">Zákazník</div>
          <div class="field"><span class="field-label">Jméno:</span><span class="field-value">${ticket.customerName || "—"}</span></div>
          ${ticket.customerPhone ? `<div class="field"><span class="field-label">Telefon:</span><span class="field-value">${ticket.customerPhone}</span></div>` : ""}
          ${ticket.customerEmail ? `<div class="field"><span class="field-label">E-mail:</span><span class="field-value">${ticket.customerEmail}</span></div>` : ""}
        </div>
        
        <div class="divider"></div>
        ` : ""}
        
        ${documentsConfig.warrantyCertificate?.includeDeviceInfo ? `
        <div class="section">
          <div class="section-title">Zařízení</div>
          ${documentsConfig.deviceInfoConfig?.deviceLabel !== false ? `<div class="field"><span class="field-label">Zařízení:</span><span class="field-value">${ticket.deviceLabel || "—"}</span></div>` : ""}
          ${documentsConfig.deviceInfoConfig?.serialOrImei !== false && ticket.serialOrImei ? `<div class="field"><span class="field-label">SN/IMEI:</span><span class="field-value">${ticket.serialOrImei}</span></div>` : ""}
        </div>
        
        <div class="divider"></div>
        ` : ""}
        
        ${documentsConfig.warrantyCertificate?.includeRepairs && ticket.performedRepairs && ticket.performedRepairs.length > 0 ? `
          <div class="section">
            <div class="section-title">Provedené opravy</div>
            ${ticket.performedRepairs.map((repair) => {
              const priceText = repair.price ? `${repair.price} Kč` : "";
              return `<div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; font-size: 11px;">
                <span style="color: ${styles.primaryColor};">• ${repair.name}</span>
                ${priceText ? `<span style="color: ${styles.primaryColor}; font-weight: 600; text-align: right;">${priceText}</span>` : ""}
              </div>`;
            }).join("")}
            ${(() => {
              const totalPrice = ticket.performedRepairs?.reduce((sum, r) => sum + (r.price || 0), 0) || 0;
              const discountAmount = ticket.discountType === "percentage" && ticket.discountValue 
                ? totalPrice * (ticket.discountValue / 100)
                : ticket.discountType === "amount" && ticket.discountValue
                ? ticket.discountValue
                : 0;
              const finalPrice = totalPrice - discountAmount;
              if (totalPrice > 0) {
                let result = `<div class="field-price" style="margin-top: 8px; padding-top: 8px; border-top: 1px solid ${styles.borderColor};"><span class="field-label">Celkem:</span><span class="field-value">${totalPrice} Kč</span></div>`;
                if (discountAmount > 0) {
                  const discountText = ticket.discountType === "percentage" 
                    ? `Sleva ${ticket.discountValue}%`
                    : `Sleva ${ticket.discountValue} Kč`;
                  result += `<div class="field-price"><span class="field-label">${discountText}:</span><span class="field-value">-${discountAmount.toFixed(2)} Kč</span></div>`;
                  result += `<div class="field-price" style="margin-top: 10px; padding-top: 10px; border-top: 2px solid ${styles.primaryColor}; font-weight: 700; font-size: 13px;"><span class="field-label" style="font-size: 13px; font-weight: 700;">Konečná cena:</span><span class="field-value" style="font-size: 14px; font-weight: 800; color: ${styles.primaryColor};">${finalPrice.toFixed(2)} Kč</span></div>`;
                } else {
                  result += `<div class="field-price" style="margin-top: 10px; padding-top: 10px; border-top: 2px solid ${styles.primaryColor}; font-weight: 700; font-size: 13px;"><span class="field-label" style="font-size: 13px; font-weight: 700;">Konečná cena:</span><span class="field-value" style="font-size: 14px; font-weight: 800; color: ${styles.primaryColor};">${totalPrice} Kč</span></div>`;
                }
                return result;
              }
              return "";
            })()}
          </div>
          <div class="divider"></div>
        ` : ""}
        
        ${documentsConfig.warrantyCertificate?.includeWarranty ? `
        <div class="section">
          <div class="section-title">Záruční podmínky</div>
          ${documentsConfig.warrantyCertificate.warrantyType === "custom" && documentsConfig.warrantyCertificate.warrantyCustomText
            ? `<div class="field"><span class="field-value">${escapeHtmlForDoc(String(documentsConfig.warrantyCertificate.warrantyCustomText).trim())}</span></div>`
            : documentsConfig.warrantyCertificate.warrantyType === "unified" ? (() => {
            const duration = documentsConfig.warrantyCertificate.warrantyUnifiedDuration || 12;
            const unit = documentsConfig.warrantyCertificate.warrantyUnifiedUnit || "months";
            let days = 0;
            if (unit === "days") days = duration;
            else if (unit === "months") days = duration * 30;
            else if (unit === "years") days = duration * 365;
            const warrantyUntil = new Date(new Date(ticket.createdAt).getTime() + days * 24 * 60 * 60 * 1000);
            let unitText = "";
            if (unit === "days") {
              if (duration === 1) unitText = "den";
              else if (duration >= 2 && duration <= 4) unitText = "dny";
              else unitText = "dnů";
            } else if (unit === "months") {
              if (duration === 1) unitText = "měsíc";
              else if (duration >= 2 && duration <= 4) unitText = "měsíce";
              else unitText = "měsíců";
            } else if (unit === "years") {
              if (duration === 1) unitText = "rok";
              else if (duration >= 2 && duration <= 4) unitText = "roky";
              else unitText = "let";
            }
            return `
              <div class="field"><span class="field-value">Tento záruční list potvrzuje provedení opravy uvedeného zařízení. Záruční doba činí ${duration} ${unitText} od data opravy.</span></div>
              <div class="field" style="margin-top: 8px;"><span class="field-label">Záruka do:</span><span class="field-value">${warrantyUntil.toLocaleDateString("cs-CZ")}</span></div>
            `;
          })() : (() => {
            const items = documentsConfig.warrantyCertificate.warrantyItems || [];
            const repairDate = new Date(ticket.createdAt);
            return `
              <div class="field"><span class="field-value">Tento záruční list potvrzuje provedení opravy uvedeného zařízení. Záruční doby:</span></div>
              ${items.map((item: { name: string; duration: number; unit: "days" | "months" | "years" }) => {
                let days = 0;
                if (item.unit === "days") days = item.duration;
                else if (item.unit === "months") days = item.duration * 30;
                else if (item.unit === "years") days = item.duration * 365;
                const warrantyUntil = new Date(repairDate.getTime() + days * 24 * 60 * 60 * 1000);
                let unitText = "";
                if (item.unit === "days") {
                  if (item.duration === 1) unitText = "den";
                  else if (item.duration >= 2 && item.duration <= 4) unitText = "dny";
                  else unitText = "dnů";
                } else if (item.unit === "months") {
                  if (item.duration === 1) unitText = "měsíc";
                  else if (item.duration >= 2 && item.duration <= 4) unitText = "měsíce";
                  else unitText = "měsíců";
                } else if (item.unit === "years") {
                  if (item.duration === 1) unitText = "rok";
                  else if (item.duration >= 2 && item.duration <= 4) unitText = "roky";
                  else unitText = "let";
                }
                return `
                  <div class="field" style="margin-top: 6px;">
                    <span class="field-label">${item.name || "Záruka"} (${item.duration} ${unitText}):</span>
                    <span class="field-value">do ${warrantyUntil.toLocaleDateString("cs-CZ")}</span>
        </div>
                `;
              }).join("")}
            `;
          })()}
        </div>
        <div class="divider"></div>
        ` : ""}
        
        ${documentsConfig.warrantyCertificate?.includeDates && !documentsConfig.warrantyCertificate?.includeWarranty ? `
        <div class="divider"></div>
        <div class="section">
          <div class="field"><span class="field-label">Datum opravy:</span><span class="field-value">${new Date(ticket.createdAt).toLocaleString("cs-CZ")}</span></div>
        </div>
        ` : ""}
        
        ${documentsConfig.warrantyCertificate?.legalText ? `
          <div class="legal-text">
            ${documentsConfig.warrantyCertificate.legalText}
          </div>
        ` : ""}
        
        </div>
        <div class="doc-footer">
        <div class="document-footer">
        <div class="signatures" style="display: flex; justify-content: flex-end;">
          <div class="signature-box" style="position: relative;">
            ${documentsConfig.stampUrl ? `
              <img src="${documentsConfig.stampUrl}" alt="Razítko servisu" style="position: relative !important; bottom: auto !important; left: auto !important; transform: none !important; max-width: ${((documentsConfig.stampSize ?? 100) / 100) * 120}px; max-height: ${((documentsConfig.stampSize ?? 100) / 100) * 60}px; width: auto; height: auto; object-fit: contain; margin: 0 auto; margin-bottom: 3px;" />
            ` : ""}
            <div class="signature-line"></div>
            <div class="signature-label">Razítko servisu</div>
          </div>
        </div>
        </div>
        </div>
        </div>
        </div>
      </body>
    </html>
  `;
}

/** HTML pro dokument „Přijetí reklamace" (tisk při vytvoření / při přepnutí do stavu). */
export function generatePrijetiReklamaceHTML(claim: WarrantyClaimRow, _companyData: any, config?: any): string {
  const documentsConfig = config || safeLoadDocumentsConfig();
  const design = documentsConfig.ticketList?.design || "classic";
  const colorMode = documentsConfig.colorMode || "color";
  const primaryColor = colorMode === "bw" ? "#000" : (design === "modern" ? "#1e40af" : design === "professional" ? "#0f766e" : "#1e3a5f");
  const secondaryColor = colorMode === "bw" ? "#333" : "#64748b";
  const e = (s: string | null) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const addr = [claim.customer_address_street, claim.customer_address_city, claim.customer_address_zip].filter(Boolean).join(", ");
  return `
    <!DOCTYPE html>
    <html>
    <head><meta charset="utf-8"><title>Přijetí reklamace - ${e(claim.code)}</title>
    <style>
      body { font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; margin: 24px; color: #1e293b; font-size: 13px; }
      .doc-header { display: flex; align-items: center; gap: 16px; margin-bottom: 20px; padding-bottom: 16px; border-bottom: 2px solid ${primaryColor}; }
      .logo { max-width: 120px; max-height: 50px; object-fit: contain; }
      h1 { margin: 0; font-size: 20px; color: ${primaryColor}; }
      .section { margin-bottom: 16px; }
      .section-title { font-weight: 700; font-size: 12px; color: ${secondaryColor}; margin-bottom: 6px; text-transform: uppercase; }
      .field { margin-bottom: 4px; }
      .field-label { color: ${secondaryColor}; margin-right: 8px; }
      .signatures { display: flex; gap: 24px; margin-top: 32px; flex-wrap: wrap; }
      .signature-box { min-width: 140px; }
      .signature-line { border-bottom: 1px solid #333; height: 20px; margin-bottom: 4px; }
      .signature-label { font-size: 10px; color: ${secondaryColor}; }
    </style>
    </head>
    <body>
      <div class="doc-header">
        ${documentsConfig.logoUrl ? `<img src="${documentsConfig.logoUrl}" alt="Logo" class="logo" />` : ""}
        <h1>Přijetí reklamace</h1>
      </div>
      <div class="section">
        <div class="section-title">Reklamace</div>
        <div class="field"><span class="field-label">Kód:</span><span>${e(claim.code)}</span></div>
        <div class="field"><span class="field-label">Datum přijetí:</span><span>${claim.created_at ? new Date(claim.created_at).toLocaleString("cs-CZ") : "—"}</span></div>
      </div>
      <div class="section">
        <div class="section-title">Zákazník</div>
        <div class="field"><span class="field-label">Jméno / firma:</span><span>${e(claim.customer_name) || "—"}</span></div>
        ${claim.customer_phone ? `<div class="field"><span class="field-label">Telefon:</span><span>${e(claim.customer_phone)}</span></div>` : ""}
        ${claim.customer_email ? `<div class="field"><span class="field-label">E-mail:</span><span>${e(claim.customer_email)}</span></div>` : ""}
        ${addr ? `<div class="field"><span class="field-label">Adresa:</span><span>${e(addr)}</span></div>` : ""}
      </div>
      <div class="section">
        <div class="section-title">Zařízení</div>
        <div class="field"><span class="field-label">Popis:</span><span>${e(claim.device_label) || "—"}</span></div>
        ${claim.device_serial ? `<div class="field"><span class="field-label">SN/IMEI:</span><span>${e(claim.device_serial)}</span></div>` : ""}
        ${claim.device_condition ? `<div class="field"><span class="field-label">Stav:</span><span>${e(claim.device_condition)}</span></div>` : ""}
      </div>
      ${claim.notes ? `<div class="section"><div class="section-title">Poznámka / důvod reklamace</div><div>${e(claim.notes)}</div></div>` : ""}
      ${((): string => {
        const raw = claim.resolution_summary || "";
        if (!raw.trim()) return "";
        const items = parseClaimResolutionItems(raw);
        if (items.length === 0) return "";
        const total = items.reduce((sum, r) => sum + (r.price || 0), 0);
        return `
      <div class="section">
        <div class="section-title">Provedené zákroky</div>
        ${items.map((it) => `
        <div class="field" style="margin-bottom: 8px;">
          <span style="font-weight: 700;">${e(it.name)}</span>
          ${it.price != null && it.price > 0 ? `<span style="color: ${primaryColor}; font-weight: 700; margin-left: 8px;">${it.price.toLocaleString("cs-CZ")} Kč</span>` : ""}
          ${it.description ? `<div style="font-size: 12px; color: ${secondaryColor}; margin-top: 2px;">${e(it.description)}</div>` : ""}
        </div>`).join("")}
        ${total > 0 ? `<div class="field" style="margin-top: 8px; font-weight: 700;">Celkem: ${total.toLocaleString("cs-CZ")} Kč</div>` : ""}
      </div>`;
      })()}
      <div class="signatures">
        <div class="signature-box"><div class="signature-line"></div><div class="signature-label">Podpis zákazníka</div></div>
        <div class="signature-box">${documentsConfig.stampUrl ? `<img src="${documentsConfig.stampUrl}" alt="Razítko" style="max-width:100px;max-height:50px;object-fit:contain;margin-bottom:4px;" />` : ""}<div class="signature-line"></div><div class="signature-label">Razítko servisu</div></div>
      </div>
    </body>
    </html>
  `;
}
