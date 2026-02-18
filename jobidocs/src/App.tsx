import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import packageJson from "../package.json";
import { generateDocumentHtml } from "./documentToHtml";
import { AppLogo } from "./components/AppLogo";
import { getDesignStyles, type DocumentDesign, type LayoutSpec } from "./documentDesign";
import {
  DndContext,
  pointerWithin,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  rectSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

const API_BASE = "http://127.0.0.1:3847";

declare global {
  interface Window {
    electron?: {
      openPrintDialog: (html: string) => Promise<void>;
      showSaveDialog: (defaultName: string) => Promise<string | null>;
    };
  }
}

type Printer = { name: string; status: string; available: boolean };
type ActivityEntry = { ts: string; action: "print" | "export"; status: "ok" | "error" | "pending"; detail?: string };
type ServiceEntry = { service_id: string; service_name: string; role: string };

type DocTypeKey = "zakazkovy_list" | "zarucni_list" | "diagnosticky_protokol";
type DocTypeUI = "ticketList" | "diagnosticProtocol" | "warrantyCertificate";

const DOC_TYPE_LABELS: Record<DocTypeKey, string> = {
  zakazkovy_list: "Zakázkový list",
  zarucni_list: "Záruční list",
  diagnosticky_protokol: "Diagnostický protokol",
};

const DOC_TYPE_TO_UI: Record<DocTypeKey, DocTypeUI> = {
  zakazkovy_list: "ticketList",
  zarucni_list: "warrantyCertificate",
  diagnosticky_protokol: "diagnosticProtocol",
};

const DESIGN_OPTIONS: { value: DocumentDesign; label: string }[] = [
  { value: "classic", label: "Klasický" },
  { value: "modern", label: "Moderní" },
  { value: "minimal", label: "Minimální" },
  { value: "professional", label: "Profesionální" },
];

// Sample data for preview
const SAMPLE_DATA: Record<string, { label: string; content: React.ReactNode }> = {
  service: {
    label: "Údaje o servisu",
    content: null, // rendered dynamically from companyData
  },
  customer: {
    label: "Údaje o zákazníkovi",
    content: (
      <>
        <div>Jan Novák</div>
        <div>+420 123 456 789</div>
        <div>jan.novak@email.cz</div>
        <div>Havlíčkova 45, 110 00 Praha 1</div>
      </>
    ),
  },
  device: {
    label: "Údaje o zařízení",
    content: (
      <>
        <div>iPhone 13 Pro, 128 GB</div>
        <div>SN: SN123456789012</div>
        <div>Stav: Poškozený displej, prasklina v rohu</div>
        <div>Problém: Nefunguje dotyková vrstva v levém dolním rohu</div>
      </>
    ),
  },
  repairs: {
    label: "Provedené opravy",
    content: (
      <div style={{ width: "100%" }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, width: "100%" }}>
          <span>Výměna displeje</span>
          <span style={{ whiteSpace: "nowrap" }}>2 500 Kč</span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, width: "100%" }}>
          <span>Kalibrace dotykové vrstvy</span>
          <span style={{ whiteSpace: "nowrap" }}>500 Kč</span>
        </div>
        <div style={{ marginTop: 8, paddingTop: 6, borderTop: "1px solid rgba(0,0,0,0.12)", display: "flex", justifyContent: "space-between", gap: 12, width: "100%", fontWeight: 600 }}>
          <span>Celková cena</span>
          <span style={{ whiteSpace: "nowrap" }}>3 000 Kč</span>
        </div>
      </div>
    ),
  },
  diag: {
    label: "Diagnostika",
    content: (
      <>
        <div>Displej je mechanicky poškozený v levém dolním rohu. Dotyková vrstva nefunguje v oblasti cca 2×2 cm.</div>
        <div style={{ marginTop: 4 }}>Doporučena výměna displeje. Záruka na opravu 12 měsíců.</div>
      </>
    ),
  },
  photos: {
    label: "Fotky",
    content: (
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {[1, 2].map((i) => (
          <div key={i} style={{ width: 60, height: 60, background: "#e5e7eb", borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, color: "#9ca3af" }}>
            Foto {i}
          </div>
        ))}
      </div>
    ),
  },
  dates: {
    label: "Data",
    content: (
      <>
        <div>Přijato: 8. 2. 2025</div>
        <div>Předpokládané dokončení: 10. 2. 2025</div>
        <div>Kód zakázky: DEMO-001</div>
      </>
    ),
  },
  warranty: {
    label: "Záruka",
    content: null, // vykreslí se dynamicky z docConfig v SectionCardContent
  },
};

const DEFAULT_SECTION_ORDER: Record<DocTypeUI, string[]> = {
  ticketList: ["service", "customer", "device", "repairs", "diag", "photos", "dates"],
  diagnosticProtocol: ["service", "customer", "device", "diag", "photos", "dates"],
  warrantyCertificate: ["service", "customer", "device", "repairs", "warranty", "dates"],
};

type SectionWidth = "full" | "half";
const DEFAULT_SECTION_WIDTHS: Record<string, SectionWidth> = {
  service: "full",
  customer: "full",
  device: "full",
  repairs: "full",
  warranty: "full",
  diag: "full",
  photos: "half",
  dates: "half",
};

const INCLUDE_KEY_TO_SECTION_KEY: Record<string, string> = {
  includeServiceInfo: "service",
  includeCustomerInfo: "customer",
  includeDeviceInfo: "device",
  includeRepairs: "repairs",
  includeWarranty: "warranty",
  includeDiagnostic: "diag",
  includeDiagnosticText: "diag",
  includePhotos: "photos",
  includeDates: "dates",
};

// Default DocumentsConfig shape (matches Jobi)
const DESIGN_ACCENT_PRESETS: { value: string; label: string }[] = [
  { value: "", label: "Výchozí" },
  { value: "#2563eb", label: "Modrá" },
  { value: "#059669", label: "Zelená" },
  { value: "#d97706", label: "Oranžová" },
  { value: "#7c3aed", label: "Fialová" },
  { value: "#dc2626", label: "Červená" },
];

function defaultDocumentsConfig(): Record<string, unknown> {
  return {
    logoUrl: undefined,
    stampUrl: undefined,
    logoSize: 100,
    stampSize: 100,
    reviewUrl: "",
    reviewUrlType: "custom",
    googlePlaceId: "",
    reviewText: "Zde nám můžete napsat recenzi",
    qrCodeSize: 120,
    qrPosition: { x: 620, y: 15 },
    qrOnTicketList: false,
    qrOnDiagnostic: false,
    qrOnWarranty: true,
    colorMode: "color",
    designAccentColor: "",
    designPrimaryColor: "",
    designSecondaryColor: "",
    designHeaderBg: "",
    designSectionBorder: "",
    ticketList: {
      includeServiceInfo: true,
      includeCustomerInfo: true,
      includeDeviceInfo: true,
      includeRepairs: true,
      includeDiagnostic: false,
      includePhotos: false,
      includeDates: true,
      includeStamp: false,
      includeSignatureOnHandover: true,
      includeSignatureOnPickup: true,
      design: "classic",
      legalText: "Tento dokument slouží jako potvrzení o přijetí zařízení do servisu.",
      sectionOrder: DEFAULT_SECTION_ORDER.ticketList,
      sectionWidths: { ...DEFAULT_SECTION_WIDTHS },
      signatureLabelHandover: "Podpis při předání zákazníkem",
      signatureLabelPickup: "Podpis při vyzvednutí zákazníkem",
      signatureLabelService: "Podpis / razítko servisu",
      signaturePositionHandover: "left",
      signaturePositionPickup: "center",
      signaturePositionService: "right",
    },
    diagnosticProtocol: {
      includeServiceInfo: true,
      includeCustomerInfo: true,
      includeDeviceInfo: true,
      includeDiagnosticText: true,
      includePhotos: true,
      includeDates: true,
      includeStamp: false,
      includeCustomerSignature: false,
      design: "classic",
      legalText: "Diagnostický protokol obsahuje výsledky diagnostiky.",
      sectionOrder: DEFAULT_SECTION_ORDER.diagnosticProtocol,
      sectionWidths: { ...DEFAULT_SECTION_WIDTHS },
    },
    warrantyCertificate: {
      includeServiceInfo: true,
      includeCustomerInfo: true,
      includeDeviceInfo: true,
      includeRepairs: true,
      includeWarranty: true,
      warrantyUnifiedDuration: 24,
      warrantyUnifiedUnit: "months",
      warrantyShowEndDate: true,
      warrantyExtraText: "",
      warrantyItems: [],
      includeDates: true,
      includeStamp: false,
      includeCustomerSignature: true,
      design: "classic",
      legalText: "Záruční list potvrzuje provedené opravy.",
      sectionOrder: DEFAULT_SECTION_ORDER.warrantyCertificate,
      sectionWidths: { ...DEFAULT_SECTION_WIDTHS },
    },
  };
}

// Modern Checkbox
function ModernCheckbox({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 12, cursor: "pointer", padding: "10px 12px", borderRadius: 10, border: "1px solid var(--border)", background: checked ? "var(--accent-soft)" : "var(--panel)", transition: "var(--transition-smooth)" }}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} style={{ width: 18, height: 18, accentColor: "var(--accent)" }} />
      <span style={{ fontSize: 14, color: "var(--text)" }}>{label}</span>
    </label>
  );
}

// Document type picker
function DocumentTypePicker({ value, onChange }: { value: DocTypeKey; onChange: (v: DocTypeKey) => void }) {
  return (
    <div style={{ display: "flex", gap: 8 }}>
      {(["zakazkovy_list", "zarucni_list", "diagnosticky_protokol"] as DocTypeKey[]).map((dt) => (
        <button
          key={dt}
          type="button"
          onClick={() => onChange(dt)}
          style={{
            flex: 1,
            padding: "12px 16px",
            borderRadius: 12,
            border: value === dt ? "2px solid var(--accent)" : "1px solid var(--border)",
            background: value === dt ? "var(--accent-soft)" : "var(--panel)",
            color: "var(--text)",
            fontSize: 13,
            fontWeight: 600,
            cursor: "pointer",
            transition: "var(--transition-smooth)",
          }}
        >
          {DOC_TYPE_LABELS[dt]}
        </button>
      ))}
    </div>
  );
}

// Render service section content from companyData (from Jobi settings)
function renderServiceContent(companyData: Record<string, unknown>) {
  const n = (v: unknown) => (v && String(v).trim() ? String(v) : null);
  const name = n(companyData.name) || n(companyData.abbreviation);
  const ico = n(companyData.ico);
  const dic = n(companyData.dic);
  const address = [n(companyData.addressStreet), n(companyData.addressCity), n(companyData.addressZip)].filter(Boolean).join(", ");
  const phone = n(companyData.phone);
  const email = n(companyData.email);
  const website = n(companyData.website);

  const parts: React.ReactNode[] = [];
  if (name) parts.push(<div key="name">{name}</div>);
  if (ico || dic) parts.push(<div key="ico">{[ico && `IČO: ${ico}`, dic && `DIČ: ${dic}`].filter(Boolean).join(" • ")}</div>);
  if (address) parts.push(<div key="addr">{address}</div>);
  if (phone || email || website) {
    parts.push(<div key="contact">{[phone, email, website].filter(Boolean).join(" • ")}</div>);
  }
  if (parts.length === 0) {
    return <div style={{ color: "#9ca3af", fontSize: 9 }}>Vyplňte údaje v Jobi → Nastavení → Servis</div>;
  }
  return <>{parts}</>;
}

/** České skloňování pro náhled záruky: 1 měsíc, 2 měsíce, 5 měsíců, 21 měsíc … */
function warrantyUnitTextPreview(n: number, unit: "days" | "months" | "years"): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  const singular = mod10 === 1 && mod100 !== 11;
  const few = mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14);
  if (unit === "days") return singular ? "den" : few ? "dny" : "dnů";
  if (unit === "months") return singular ? "měsíc" : few ? "měsíce" : "měsíců";
  return singular ? "rok" : few ? "roky" : "let";
}

// Shared section card content (used by SortableSection and DragOverlay)
function SectionCardContent({
  sectionKey,
  styles,
  spec,
  companyData,
  docType,
  docConfig,
}: {
  sectionKey: string;
  styles: Record<string, unknown>;
  spec: LayoutSpec;
  companyData: Record<string, unknown>;
  docType?: DocTypeKey;
  docConfig?: Record<string, unknown>;
}) {
  const sample = SAMPLE_DATA[sectionKey];
  if (!sample) return null;
  let content: React.ReactNode = sample.content;
  if (sectionKey === "service") content = renderServiceContent(companyData);
  else if (sectionKey === "warranty" && docType === "zarucni_list" && docConfig) {
    const duration = (docConfig.warrantyUnifiedDuration as number) ?? 24;
    const unit = ((docConfig.warrantyUnifiedUnit as string) || "months") as "days" | "months" | "years";
    const showEndDate = (docConfig.warrantyShowEndDate as boolean) !== false;
    const extraText = (docConfig.warrantyExtraText as string)?.trim() ?? "";
    const items = (docConfig.warrantyItems as Array<{ label: string; duration: number; unit: string; showEndDate?: boolean }>) ?? [];
    const unitText = warrantyUnitTextPreview(duration, unit);
    const sentence = `Záruční doba činí ${duration} ${unitText}.`;
    let days = 0;
    if (unit === "days") days = duration;
    else if (unit === "months") days = duration * 30;
    else days = duration * 365;
    const repairDate = new Date();
    const warrantyUntil = new Date(repairDate.getTime() + days * 24 * 60 * 60 * 1000);
    content = (
      <>
        <div>{sentence}</div>
        {showEndDate && (
          <div style={{ marginTop: 8 }}>
            <span style={{ fontWeight: 600 }}>Záruka do: </span>
            <span>{warrantyUntil.toLocaleDateString("cs-CZ")}</span>
          </div>
        )}
        {extraText && <div style={{ marginTop: 10 }}>{extraText}</div>}
        {items.map((it, idx) => {
          const d = typeof it.duration === "number" ? it.duration : 12;
          const u = (it.unit === "days" || it.unit === "months" || it.unit === "years" ? it.unit : "months") as "days" | "months" | "years";
          const ut = warrantyUnitTextPreview(d, u);
          const label = (it.label && String(it.label).trim()) || "Záruka";
          const itemShowEndDate = it.showEndDate !== false;
          let addDays = 0;
          if (u === "days") addDays = d;
          else if (u === "months") addDays = d * 30;
          else addDays = d * 365;
          const until = new Date(repairDate.getTime() + addDays * 24 * 60 * 60 * 1000);
          const line = itemShowEndDate ? `${label}: ${d} ${ut}. Záruka do: ${until.toLocaleDateString("cs-CZ")}` : `${label}: ${d} ${ut}.`;
          return (
            <div key={idx} style={{ marginTop: 6 }}>
              {line}
            </div>
          );
        })}
      </>
    );
  }
  const titleFontSize = spec.sectionHeaderStyle === "capsule" ? 14 : 13;
  const titleFontWeight = spec.sectionHeaderStyle === "underline" ? 500 : 700;
  return (
    <>
      <div style={{ fontSize: titleFontSize, fontWeight: titleFontWeight, marginBottom: 0, paddingBottom: 6, borderBottom: `1px solid ${styles.secondaryColor as string}`, color: styles.secondaryColor as string, display: "flex", alignItems: "center", gap: 6, ...(spec.sectionHeaderStyle === "uppercase" && { textTransform: "uppercase" as const, letterSpacing: "0.05em" }) }}>
        <span style={{ opacity: 0.6 }}>⋮⋮</span>
        {sample.label}
      </div>
      <div style={{ fontSize: 10, lineHeight: 1.5, color: (styles.contentColor as string) ?? "#171717" }}>{content}</div>
    </>
  );
}

// Sortable section item for document preview
function SortableSection({
  id,
  sectionKey,
  styles,
  spec,
  companyData,
  sectionWidth,
  docType,
  docConfig,
}: {
  id: string;
  sectionKey: string;
  styles: Record<string, unknown>;
  spec: LayoutSpec;
  companyData: Record<string, unknown>;
  sectionWidth: SectionWidth;
  docType?: DocTypeKey;
  docConfig?: Record<string, unknown>;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useSortable({ id });
  const sample = SAMPLE_DATA[sectionKey];
  if (!sample) return null;

  const sectionRadius = (spec.sectionStyle === "underlineTitles" ? 0 : ((styles.sectionRadius as number) ?? 6)) as number;
  const sectionPadding = spec.density === "compact" ? 8 : 12;
  const sectionBorder = spec.sectionStyle === "underlineTitles" ? "none" : (styles.sectionBorder as string);
  const sectionBorderLeft = spec.sectionStyle === "leftStripe" ? `3px solid ${styles.secondaryColor}` : undefined;
  const isHalf = sectionWidth === "half";
  const CONTENT_WIDTH = 680;
  const GAP = 12;
  const halfWidth = (CONTENT_WIDTH - GAP) / 2;
  const widthPx = isHalf ? halfWidth : CONTENT_WIDTH;
  const style: React.CSSProperties = {
    padding: sectionPadding,
    background: styles.sectionBg as string,
    borderRadius: sectionRadius,
    border: sectionBorder,
    ...(sectionBorderLeft && { borderLeft: sectionBorderLeft }),
    transform: CSS.Transform.toString(transform),
    transition: "transform 0.15s ease-out",
    opacity: isDragging ? 0.85 : 1,
    cursor: isDragging ? "grabbing" : "grab",
    touchAction: "none",
    flex: isHalf ? `0 0 ${halfWidth}px` : `1 1 ${CONTENT_WIDTH}px`,
    width: `${widthPx}px`,
    minWidth: `${widthPx}px`,
    maxWidth: `${widthPx}px`,
    boxSizing: "border-box",
    flexShrink: 0,
    ...(isDragging && { willChange: "transform", position: "relative", zIndex: 1000 }),
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <SectionCardContent sectionKey={sectionKey} styles={styles} spec={spec} companyData={companyData} docType={docType} docConfig={docConfig} />
    </div>
  );
}

// Document preview - A4, no scroll, scale to fit, draggable sections, draggable QR
function DocumentPreview({
  docType,
  config,
  companyData,
  onSectionOrderChange,
  onQrPositionChange,
}: {
  docType: DocTypeKey;
  config: Record<string, unknown>;
  companyData: Record<string, unknown>;
  onSectionOrderChange?: (order: string[]) => void;
  onQrPositionChange?: (pos: { x: number; y: number }) => void;
}) {
  const docConfig = config[DOC_TYPE_TO_UI[docType]] as Record<string, unknown> | undefined;
  const design = (docConfig?.design as DocumentDesign) || "classic";
  const logoSize = ((config.logoSize as number) ?? 100) / 100;
  const hasLogo = !!config.logoUrl;
  const colorMode = (config.colorMode as "color" | "bw") || "color";
  const designAccentColor = (config.designAccentColor as string) || "";
  const { styles, spec } = useMemo(() => {
    const colorOverrides =
      design === "modern" || design === "professional"
        ? {
            primary: (config.designPrimaryColor as string) || undefined,
            secondary: (config.designSecondaryColor as string) || undefined,
            headerBg: (config.designHeaderBg as string) || undefined,
            sectionBorder: (config.designSectionBorder as string) || undefined,
          }
        : undefined;
    const { tokens, spec: s } = getDesignStyles(design, colorMode, designAccentColor || undefined, colorOverrides);
    return { styles: { ...tokens, bgColor: tokens.sectionBg }, spec: s };
  }, [design, colorMode, designAccentColor, config.designPrimaryColor, config.designSecondaryColor, config.designHeaderBg, config.designSectionBorder]);

  const sectionOrder = useMemo(() => {
    const order = docConfig?.sectionOrder as string[] | undefined;
    const defaultOrder = DEFAULT_SECTION_ORDER[DOC_TYPE_TO_UI[docType]];
    let list = (order && Array.isArray(order)) ? [...order] : defaultOrder;
    // Migrace: záruční list musí mít v pořadí sekci "warranty" (staré uložené configy ji nemají)
    if (docType === "zarucni_list" && !list.includes("warranty")) {
      const idx = list.indexOf("dates");
      if (idx >= 0) list = [...list.slice(0, idx), "warranty", ...list.slice(idx)];
      else list = [...list, "warranty"];
    }
    return list;
  }, [docConfig?.sectionOrder, docType]);

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

  const orderedSections = useMemo(() => {
    return sectionOrder.filter((key) => {
      const includeKey = sectionKeyToInclude[key];
      if (!includeKey) return false;
      const val = docConfig?.[includeKey];
      if (key === "warranty" && docType === "zarucni_list" && val === undefined) return true;
      return (val as boolean) !== false;
    });
  }, [sectionOrder, docConfig, sectionKeyToInclude, docType]);

  const sectionWidths = useMemo(() => {
    const sw = docConfig?.sectionWidths as Record<string, SectionWidth> | undefined;
    const merged = { ...DEFAULT_SECTION_WIDTHS };
    if (sw && typeof sw === "object") {
      Object.keys(sw).forEach((k) => {
        if (sw[k] === "full" || sw[k] === "half") merged[k] = sw[k];
      });
    }
    return merged;
  }, [docConfig?.sectionWidths]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      const oldIndex = orderedSections.indexOf(active.id as string);
      const newIndex = orderedSections.indexOf(over.id as string);
      if (oldIndex === -1 || newIndex === -1) return;
      const newOrder = arrayMove(orderedSections, oldIndex, newIndex);
      onSectionOrderChange?.(newOrder);
    },
    [orderedSections, onSectionOrderChange]
  );

  const legalText = (docConfig?.legalText as string) || "";
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
  const containerRef = useRef<HTMLDivElement>(null);
  const documentRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.5);
  const qrPosition = useMemo(() => {
    const p = config.qrPosition as { x: number; y: number } | undefined;
    return p && typeof p.x === "number" && typeof p.y === "number" ? p : { x: 620, y: 15 };
  }, [config.qrPosition]);
  const [isQrDragging, setIsQrDragging] = useState(false);
  const [qrDragPosition, setQrDragPosition] = useState<{ x: number; y: number } | null>(null);
  const qrDragStartRef = useRef<{ clientX: number; clientY: number; x: number; y: number } | null>(null);
  const qrDragCurrentRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (!isQrDragging) return;
    const onMove = (e: MouseEvent) => {
      const start = qrDragStartRef.current;
      if (!start || !documentRef.current) return;
      const rect = documentRef.current.getBoundingClientRect();
      const scaleX = 794 / rect.width;
      const scaleY = 1123 / rect.height;
      const dx = (e.clientX - start.clientX) * scaleX;
      const dy = (e.clientY - start.clientY) * scaleY;
      const newX = Math.max(0, Math.min(794 - qrCodeSize, start.x + dx));
      const newY = Math.max(0, Math.min(1123 - qrCodeSize, start.y + dy));
      const pos = { x: newX, y: newY };
      qrDragCurrentRef.current = pos;
      setQrDragPosition(pos);
    };
    const onUp = () => {
      const final = qrDragCurrentRef.current ?? qrDragStartRef.current ? { x: qrDragStartRef.current!.x, y: qrDragStartRef.current!.y } : qrPosition;
      if (onQrPositionChange) onQrPositionChange(final);
      qrDragStartRef.current = null;
      qrDragCurrentRef.current = null;
      setQrDragPosition(null);
      setIsQrDragging(false);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [isQrDragging, onQrPositionChange, qrCodeSize, qrPosition]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (w > 0 && h > 0) {
        const s = Math.min(w / 794, h / 1123);
        setScale(s);
      }
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div
      ref={containerRef}
      className="document-preview"
      style={{
        width: "100%",
        aspectRatio: "210 / 297",
        maxHeight: "calc(100vh - 200px)",
        position: "relative",
        overflow: "hidden",
        background: "#f3f4f6",
        borderRadius: 8,
      }}
    >
      <div
        ref={documentRef}
        style={{
          position: "absolute",
          top: "50%",
          left: "50%",
          width: 794,
          height: 1123,
          background: styles.bgColor,
          padding: 57,
          boxSizing: "border-box",
          transformOrigin: "center center",
          transform: `translate(-50%, -50%) scale(${scale})`,
          boxShadow: "0 4px 24px rgba(0,0,0,0.12)",
          fontSize: 10,
          lineHeight: 1.4,
          color: (styles as { contentColor?: string }).contentColor ?? "#171717",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* Header: Logo left, Doc title + Service name centered on full page */}
        <div
          style={{
            position: "relative",
            minHeight: 50,
            marginBottom: 12,
            paddingBottom: 10,
            borderBottom: (styles as { headerBorder?: string }).headerBorder ?? `${styles.borderWidth}px solid ${styles.borderColor}`,
            background: styles.headerBg !== "transparent" ? styles.headerBg : undefined,
            padding: styles.headerBg !== "transparent" ? "8px 12px 10px 0" : undefined,
            borderRadius: spec.headerLayout === "splitBox" ? 8 : 0,
            ...(spec.headerLayout === "splitBox" && styles.accentColor && { borderLeft: `6px solid ${styles.accentColor as string}` }),
          }}
        >
          {hasLogo ? (
            <img
              src={config.logoUrl as string}
              alt="Logo"
              style={{ position: "absolute", left: 0, top: "50%", transform: "translateY(-50%)", maxWidth: 120 * logoSize, maxHeight: 50 * logoSize, objectFit: "contain" }}
            />
          ) : (
            <div style={{ position: "absolute", left: 0, top: "50%", transform: "translateY(-50%)", width: 120 * logoSize, height: 50 * logoSize, background: "#f3f4f6", borderRadius: 4, display: "flex", alignItems: "center", justifyContent: "center", color: "#9ca3af", fontSize: 9 }}>
              Logo
            </div>
          )}
          <div style={{ position: "absolute", left: "50%", top: "50%", transform: "translate(-50%, -50%)", textAlign: "center", display: "flex", flexDirection: "column", gap: 2 }}>
            {docType === "zakazkovy_list" ? (
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "center", gap: 10, flexWrap: "wrap" }}>
                <span style={{ color: styles.headerText, fontWeight: 700, fontSize: 14 }}>{DOC_TYPE_LABELS[docType]}</span>
                <span style={{ color: styles.headerText, fontWeight: 800, fontSize: 18, letterSpacing: "0.05em" }}>DEMO-001</span>
              </div>
            ) : (
              <div style={{ color: styles.headerText, fontWeight: 700, fontSize: 14 }}>
                {DOC_TYPE_LABELS[docType]}
              </div>
            )}
            <div style={{ color: styles.headerText, fontWeight: spec.headerLayout === "splitBox" ? 800 : 700, fontSize: spec.headerLayout === "splitBox" ? 16 : 14 }}>
              {String(companyData?.name ?? "Název servisu")}
            </div>
          </div>
          {showQr && reviewUrl && (
            <div
              role="button"
              tabIndex={0}
              title="Tažením přesunete QR kód na požadované místo"
              onMouseDown={(e) => {
                if (e.button !== 0 || !onQrPositionChange) return;
                e.preventDefault();
                const pos = qrDragPosition ?? qrPosition;
                qrDragStartRef.current = { clientX: e.clientX, clientY: e.clientY, x: pos.x, y: pos.y };
                setIsQrDragging(true);
              }}
              style={{
                position: "absolute",
                left: (qrDragPosition ?? qrPosition).x,
                top: (qrDragPosition ?? qrPosition).y,
                display: "flex",
                alignItems: "center",
                gap: 12,
                cursor: isQrDragging ? "grabbing" : "grab",
                userSelect: "none",
              }}
            >
              <div style={{ textAlign: "right", fontSize: 10, color: styles.secondaryColor, maxWidth: 140, lineHeight: 1.3 }}>{reviewText}</div>
              <img src={`https://api.qrserver.com/v1/create-qr-code/?size=${qrCodeSize}x${qrCodeSize}&ecc=L&data=${encodeURIComponent(reviewUrl)}`} alt="QR" style={{ width: qrCodeSize, height: qrCodeSize, display: "block", flexShrink: 0, pointerEvents: "none" }} draggable={false} />
            </div>
          )}
        </div>

        {/* Sortable sections */}
        <DndContext sensors={sensors} collisionDetection={pointerWithin} onDragEnd={handleDragEnd}>
          <SortableContext items={orderedSections} strategy={rectSortingStrategy}>
            <div style={{ flex: 1, minHeight: 0, marginBottom: 12, display: "flex", flexWrap: "wrap", gap: 12, alignContent: "flex-start", color: (styles as { contentColor?: string }).contentColor ?? "#171717" }}>
              {orderedSections.map((key) => (
                <SortableSection
                  key={key}
                  id={key}
                  sectionKey={key}
                  styles={styles}
                  spec={spec}
                  companyData={companyData}
                  sectionWidth={sectionWidths[key] ?? "full"}
                  docType={docType}
                  docConfig={docConfig}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>

        {/* Legal text */}
        {legalText && (
          <div style={{ marginTop: 12, padding: 10, background: styles.sectionBg, borderRadius: spec.sectionStyle === "underlineTitles" ? 0 : ((styles.sectionRadius as number) ?? 6), fontSize: 9, color: (styles.contentColor as string) ?? "#171717", border: `1px solid ${styles.borderColor}` }}>
            {legalText}
          </div>
        )}

        {/* Signatures */}
        {(docType === "zakazkovy_list"
          ? ((docConfig?.includeSignatureOnHandover as boolean) !== false ||
              (docConfig?.includeSignatureOnPickup as boolean) !== false ||
              (docConfig?.includeStamp as boolean) === true)
          : ((docConfig?.includeCustomerSignature as boolean) !== false || (!!config.stampUrl && (docConfig?.includeStamp as boolean) === true))) && (
          <div
            style={{
              marginTop: "auto",
              paddingTop: 28,
              display: "flex",
              justifyContent: docType === "zakazkovy_list" ? "space-between" : "space-around",
              alignItems: "flex-end",
              borderTop: `1px solid ${styles.borderColor}`,
              flexShrink: 0,
              gap: 24,
            }}
          >
            {docType === "zakazkovy_list" ? (() => {
              const lblH = String(docConfig?.signatureLabelHandover ?? "Podpis při předání zákazníkem").trim() || "Podpis při předání zákazníkem";
              const lblP = String(docConfig?.signatureLabelPickup ?? "Podpis při vyzvednutí zákazníkem").trim() || "Podpis při vyzvednutí zákazníkem";
              const lblS = String(docConfig?.signatureLabelService ?? "Podpis / razítko servisu").trim() || "Podpis / razítko servisu";
              const pos = (v: unknown) => (v === "center" || v === "right" ? v : "left");
              const posH = pos(docConfig?.signaturePositionHandover);
              const posP = pos(docConfig?.signaturePositionPickup);
              const posS = pos(docConfig?.signaturePositionService);
              const contentColor = (styles as { contentColor?: string }).contentColor ?? "#171717";
              const byPos: { left: React.ReactNode[]; center: React.ReactNode[]; right: React.ReactNode[] } = { left: [], center: [], right: [] };
              if ((docConfig?.includeSignatureOnHandover as boolean) !== false) {
                byPos[posH].push(<><div style={{ width: "100%", maxWidth: 140, borderBottom: "1px solid #000", marginBottom: 4 }} /><div style={{ fontSize: 9, color: contentColor }}>{lblH}</div></>);
              }
              if ((docConfig?.includeSignatureOnPickup as boolean) !== false) {
                byPos[posP].push(<><div style={{ width: "100%", maxWidth: 140, borderBottom: "1px solid #000", marginBottom: 4 }} /><div style={{ fontSize: 9, color: contentColor }}>{lblP}</div></>);
              }
              if ((docConfig?.includeStamp as boolean) === true) {
                byPos[posS].push(
                  <>
                    {config.stampUrl ? <img src={config.stampUrl as string} alt="Razítko" style={{ maxWidth: 70, maxHeight: 35, objectFit: "contain" }} /> : <div style={{ width: 70, height: 35, background: "#f3f4f6", borderRadius: 4, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 8, color: "#9ca3af" }}>Razítko</div>}
                    <div style={{ fontSize: 9, color: contentColor, marginTop: 4 }}>{lblS}</div>
                  </>
                );
              }
              const Slot = ({ align, children }: { align: "left" | "center" | "right"; children: React.ReactNode }) => (
                <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", alignItems: align === "center" ? "center" : align === "right" ? "flex-end" : "flex-start", gap: 8 }}>{children}</div>
              );
              return (
                <>
                  <Slot align="left">{byPos.left}</Slot>
                  <Slot align="center">{byPos.center}</Slot>
                  <Slot align="right">{byPos.right}</Slot>
                </>
              );
            })() : (
              <>
                {(docConfig?.includeCustomerSignature as boolean) !== false && (
                  <div>
                    <div style={{ width: 100, borderBottom: "1px solid #000", marginBottom: 4 }} />
                    <div style={{ fontSize: 9, color: (styles as { contentColor?: string }).contentColor ?? "#171717" }}>Podpis zákazníka</div>
                  </div>
                )}
                {!!config.stampUrl && (docConfig?.includeStamp as boolean) === true && (
                  <div>
                    <div style={{ width: 70, height: 35, background: "#f3f4f6", borderRadius: 4, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 8, color: "#9ca3af" }}>Razítko</div>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// Tab navigation
type TabKey = "aktivity" | "tiskarna" | "dokumenty";

function TabNav({ active, onChange }: { active: TabKey; onChange: (t: TabKey) => void }) {
  const tabs: { key: TabKey; label: string }[] = [
    { key: "aktivity", label: "Aktivity" },
    { key: "tiskarna", label: "Tiskárna" },
    { key: "dokumenty", label: "Dokumenty" },
  ];
  return (
    <div style={{ display: "flex", gap: 8, borderBottom: "2px solid var(--border)", paddingBottom: 0, marginBottom: 24 }}>
      {tabs.map((t) => {
        const isActive = active === t.key;
        return (
          <button
            key={t.key}
            onClick={() => onChange(t.key)}
            style={{
              padding: "12px 24px",
              border: "none",
              borderBottom: isActive ? "3px solid var(--accent)" : "3px solid transparent",
              marginBottom: -2,
              background: isActive ? "var(--accent-soft)" : "transparent",
              color: isActive ? "var(--accent)" : "var(--text)",
              fontWeight: isActive ? 900 : 600,
              cursor: "pointer",
              fontSize: 14,
              transition: "var(--transition-smooth)",
              borderRadius: "12px 12px 0 0",
            }}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

export default function App() {
  const [tab, setTab] = useState<TabKey>("dokumenty");
  const [health, setHealth] = useState<{ ok?: boolean } | null>(null);
  const [printers, setPrinters] = useState<Printer[]>([]);
  const [activities, setActivities] = useState<ActivityEntry[]>([]);
  const [context, setContext] = useState<{
    services: ServiceEntry[];
    activeServiceId: string | null;
    documentsConfig?: Record<string, unknown> | null;
    companyData?: Record<string, unknown> | null;
    jobidocsLogo?: { background: string; jInner: string; foreground: string } | null;
  }>({ services: [], activeServiceId: null });
  const [serviceId, setServiceId] = useState("");
  const [preferredPrinter, setPreferredPrinter] = useState("");
  const [savedPrinter, setSavedPrinter] = useState<string | null>(null);
  const [settingsLoadedForService, setSettingsLoadedForService] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [docType, setDocType] = useState<DocTypeKey>("zakazkovy_list");
  const [config, setConfig] = useState<Record<string, unknown>>(() => defaultDocumentsConfig());
  const [configLoading, setConfigLoading] = useState(false);
  const [configSaved, setConfigSaved] = useState(false);
  const [warrantyDurationInput, setWarrantyDurationInput] = useState<string | null>(null);
  const fileInputLogo = useRef<HTMLInputElement>(null);
  const fileInputStamp = useRef<HTMLInputElement>(null);
  const [customColorPickerOpen, setCustomColorPickerOpen] = useState(false);
  const [customColorPickerExtra, setCustomColorPickerExtra] = useState<string | null>(null);
  const [printLoading, setPrintLoading] = useState(false);
  const [printError, setPrintError] = useState<string | null>(null);
  const [printToQueueLoading, setPrintToQueueLoading] = useState(false);
  const [printToQueueError, setPrintToQueueError] = useState<string | null>(null);
  const [printToQueueSuccess, setPrintToQueueSuccess] = useState(false);
  const [exportToFileLoading, setExportToFileLoading] = useState(false);
  const [exportToFileError, setExportToFileError] = useState<string | null>(null);
  const [pdfPreviewUrl, setPdfPreviewUrl] = useState<string | null>(null);
  const pdfUrlRef = useRef<string | null>(null);
  const previousPdfUrlToRevokeRef = useRef<string | null>(null);

  const fetchHealth = useCallback(async () => {
    try {
      const r = await fetch(`${API_BASE}/v1/health`);
      const d = await r.json();
      setHealth(d);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  const fetchPrinters = useCallback(async () => {
    try {
      const r = await fetch(`${API_BASE}/v1/printers`);
      const d = await r.json();
      setPrinters(d.printers || []);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  const fetchContext = useCallback(async () => {
    try {
      const r = await fetch(`${API_BASE}/v1/context`);
      const d = await r.json();
      setContext({
        services: d.services || [],
        activeServiceId: d.activeServiceId ?? null,
        documentsConfig: d.documentsConfig ?? null,
        companyData: d.companyData ?? null,
        jobidocsLogo: d.jobidocsLogo ?? null,
      });
      // Nepřepisujeme config z kontextu – uživatelské změny (viditelné sekce, šířky) by se jinak každé 2 s ztratily.
      // Config se načítá jen z fetchDocumentsConfig při výběru servisu.
    } catch {
      setContext({ services: [], activeServiceId: null, jobidocsLogo: null });
    }
  }, []);

  const fetchActivity = useCallback(async () => {
    try {
      const r = await fetch(`${API_BASE}/v1/activity`);
      const d = await r.json();
      setActivities(d.entries || []);
    } catch {
      setActivities([]);
    }
  }, []);

  const fetchSettings = useCallback(async (sid: string) => {
    if (!sid) return;
    try {
      const r = await fetch(`${API_BASE}/v1/settings?service_id=${encodeURIComponent(sid)}`);
      const d = await r.json();
      const name = d.preferred_printer_name ?? "";
      setSavedPrinter(name || null);
      setPreferredPrinter(name);
      setSettingsLoadedForService(sid);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  const fetchDocumentsConfig = useCallback(async (sid: string) => {
    if (!sid) return;
    setConfigLoading(true);
    try {
      const r = await fetch(`${API_BASE}/v1/documents-config?service_id=${encodeURIComponent(sid)}`);
      const d = await r.json();
      if (d.config) {
        const raw = typeof d.config === "object" && d.config !== null ? (d.config as Record<string, unknown>) : {};
        const wc = raw.warrantyCertificate as Record<string, unknown> | undefined;
        if (wc && Array.isArray(wc.sectionOrder) && !(wc.sectionOrder as string[]).includes("warranty")) {
          const order = wc.sectionOrder as string[];
          const idx = order.indexOf("dates");
          const newOrder = idx >= 0 ? [...order.slice(0, idx), "warranty", ...order.slice(idx)] : [...order, "warranty"];
          raw.warrantyCertificate = { ...wc, sectionOrder: newOrder };
        }
        setConfig((prev) => ({ ...defaultDocumentsConfig(), ...prev, ...raw }));
      }
    } catch {
      // Use context config
    } finally {
      setConfigLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchHealth();
    fetchPrinters();
  }, [fetchHealth, fetchPrinters]);

  useEffect(() => {
    fetchActivity();
    fetchContext();
    const id = setInterval(() => {
      fetchActivity();
      fetchContext();
    }, 2000);
    return () => clearInterval(id);
  }, [fetchActivity, fetchContext]);

  useEffect(() => {
    if (context.activeServiceId && context.services.some((s) => s.service_id === context.activeServiceId)) {
      setServiceId(context.activeServiceId);
    }
  }, [context.activeServiceId, context.services]);

  useEffect(() => {
    if (serviceId) {
      fetchSettings(serviceId);
      fetchDocumentsConfig(serviceId);
    } else {
      setSettingsLoadedForService(null);
    }
  }, [serviceId, fetchSettings, fetchDocumentsConfig]);

  // Při otevření záložky Tiskárna znovu načíst nastavení a seznam tiskáren (aby se vždy zobrazila aktuální uložená tiskárna)
  useEffect(() => {
    if (tab === "tiskarna" && serviceId) {
      fetchSettings(serviceId);
      fetchPrinters();
    }
  }, [tab, serviceId, fetchSettings, fetchPrinters]);

  useEffect(() => {
    if (docType !== "zarucni_list" || (config.warrantyCertificate as Record<string, unknown>)?.includeWarranty !== true) {
      setWarrantyDurationInput(null);
    }
  }, [docType, config.warrantyCertificate]);

  // Nepřepisujeme config z context.documentsConfig – jinak by se lokální změny (odkliknutí sekce, celá/polovina) vracely zpět při každé aktualizaci kontextu.

  const companyData = context.companyData || {};

  const handleSaveSettings = async () => {
    if (!serviceId) return;
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`${API_BASE}/v1/settings?service_id=${encodeURIComponent(serviceId)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ preferred_printer_name: preferredPrinter || undefined }),
      });
      if (!r.ok) throw new Error(await r.text());
      const d = await r.json();
      const name = d.preferred_printer_name ?? "";
      setSavedPrinter(name || null);
      setPreferredPrinter(name);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveConfig = async () => {
    if (!serviceId) {
      setError("Vyberte servis");
      return;
    }
    setConfigLoading(true);
    setError(null);
    setConfigSaved(false);
    try {
      const r = await fetch(`${API_BASE}/v1/documents-config?service_id=${encodeURIComponent(serviceId)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config }),
      });
      if (!r.ok) throw new Error(await r.text());
      setConfigSaved(true);
      setTimeout(() => setConfigSaved(false), 2000);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setConfigLoading(false);
    }
  };

  const updateDocConfig = (path: string[], value: unknown) => {
    setConfig((prev) => {
      const next = JSON.parse(JSON.stringify(prev));
      let target: Record<string, unknown> = next;
      const docKey = DOC_TYPE_TO_UI[docType];
      if (!target[docKey]) target[docKey] = {};
      target = target[docKey] as Record<string, unknown>;
      for (let i = 0; i < path.length - 1; i++) {
        const k = path[i];
        if (!target[k]) (target as Record<string, unknown>)[k] = {};
        target = target[k] as Record<string, unknown>;
      }
      (target as Record<string, unknown>)[path[path.length - 1]] = value;
      return next;
    });
  };

  const handleSectionOrderChange = useCallback(
    (order: string[]) => {
      updateDocConfig(["sectionOrder"], order);
    },
    [docType]
  );

  const closePdfPreview = useCallback(() => {
    if (pdfUrlRef.current) {
      URL.revokeObjectURL(pdfUrlRef.current);
      pdfUrlRef.current = null;
    }
    previousPdfUrlToRevokeRef.current = null;
    setPdfPreviewUrl(null);
    setPrintToQueueError(null);
    setPrintToQueueSuccess(false);
    setExportToFileError(null);
  }, []);

  const handlePrintPreview = useCallback(async () => {
    if (pdfUrlRef.current) {
      URL.revokeObjectURL(pdfUrlRef.current);
      pdfUrlRef.current = null;
    }
    previousPdfUrlToRevokeRef.current = null;
    setPdfPreviewUrl(null);
    setPrintLoading(true);
    setPrintError(null);
    try {
      const html = generateDocumentHtml(config, docType, context.companyData || {});
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 60000);
      const r = await fetch(`${API_BASE}/v1/render`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ html }),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      if (!r.ok) {
        const err = await r.json().catch(() => ({ error: r.statusText }));
        const msg =
          r.status === 503
            ? "Služba je dočasně nedostupná. Zkuste to znovu."
            : r.status === 504
              ? "Vypršel časový limit. Zkuste to znovu."
              : (err as { error?: string }).error || r.statusText || "Render selhal";
        throw new Error(msg);
      }
      const { pdf_base64 } = (await r.json()) as { pdf_base64?: string };
      if (!pdf_base64) throw new Error("Chybná odpověď API");
      const bytes = Uint8Array.from(atob(pdf_base64), (c) => c.charCodeAt(0));
      const blob = new Blob([bytes], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      previousPdfUrlToRevokeRef.current = pdfUrlRef.current;
      pdfUrlRef.current = url;
      setPdfPreviewUrl(url);
    } catch (e) {
      const err = e as Error;
      setPrintError(err.name === "AbortError" ? "Vypršel časový limit (60 s). Zkuste to znovu." : err.message);
    } finally {
      setPrintLoading(false);
    }
  }, [config, docType, context.companyData]);

  const handlePrintToQueue = useCallback(async () => {
    setPrintToQueueError(null);
    setPrintToQueueLoading(true);
    try {
      const html = generateDocumentHtml(config, docType, context.companyData || {});
      const r = await fetch(`${API_BASE}/v1/print`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ html, service_id: serviceId || undefined }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        throw new Error((data as { error?: string }).error || r.statusText || "Tisk se nezdařil");
      }
      setPrintToQueueSuccess(true);
      setTimeout(() => setPrintToQueueSuccess(false), 3000);
    } catch (e) {
      setPrintToQueueError((e as Error).message);
    } finally {
      setPrintToQueueLoading(false);
    }
  }, [config, docType, context.companyData, serviceId]);

  const handleExportToFile = useCallback(async () => {
    if (typeof window === "undefined" || !window.electron?.showSaveDialog) return;
    setExportToFileError(null);
    setExportToFileLoading(true);
    try {
      const path = await window.electron.showSaveDialog("dokument.pdf");
      if (!path) return;
      const html = generateDocumentHtml(config, docType, context.companyData || {});
      const r = await fetch(`${API_BASE}/v1/export`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ html, target_path: path }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        throw new Error((data as { error?: string }).error || r.statusText || "Export se nezdařil");
      }
    } catch (e) {
      setExportToFileError((e as Error).message);
    } finally {
      setExportToFileLoading(false);
    }
  }, [config, docType, context.companyData]);

  const revokePreviousPdfUrlAfterLoad = useCallback(() => {
    if (previousPdfUrlToRevokeRef.current) {
      URL.revokeObjectURL(previousPdfUrlToRevokeRef.current);
      previousPdfUrlToRevokeRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!pdfPreviewUrl) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") closePdfPreview();
    };
    document.addEventListener("keydown", onKeyDown);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = overflow;
    };
  }, [pdfPreviewUrl, closePdfPreview]);

  const docConfig = (config[DOC_TYPE_TO_UI[docType]] || {}) as Record<string, unknown>;

  const handleFileLogo = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => setConfig((prev) => ({ ...prev, logoUrl: reader.result as string }));
    reader.readAsDataURL(f);
  };

  const handleFileStamp = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => setConfig((prev) => ({ ...prev, stampUrl: reader.result as string }));
    reader.readAsDataURL(f);
  };

  const sectionFields: { key: string; label: string }[] =
    docType === "zakazkovy_list"
      ? [
          { key: "includeServiceInfo", label: "Údaje o servisu" },
          { key: "includeCustomerInfo", label: "Údaje o zákazníkovi" },
          { key: "includeDeviceInfo", label: "Údaje o zařízení" },
          { key: "includeRepairs", label: "Provedené opravy" },
          { key: "includeDiagnostic", label: "Diagnostika" },
          { key: "includePhotos", label: "Fotky" },
          { key: "includeDates", label: "Data" },
          { key: "includeStamp", label: "Podpis / razítko servisu" },
          { key: "includeSignatureOnHandover", label: "Podpis při předání zákazníkem" },
          { key: "includeSignatureOnPickup", label: "Podpis při vyzvednutí zákazníkem" },
        ]
      : docType === "diagnosticky_protokol"
        ? [
            { key: "includeServiceInfo", label: "Údaje o servisu" },
            { key: "includeCustomerInfo", label: "Údaje o zákazníkovi" },
            { key: "includeDeviceInfo", label: "Údaje o zařízení" },
            { key: "includeDiagnosticText", label: "Text diagnostiky" },
            { key: "includePhotos", label: "Fotky" },
            { key: "includeDates", label: "Data" },
            { key: "includeStamp", label: "Razítko / podpis" },
            { key: "includeCustomerSignature", label: "Podpis zákazníka" },
          ]
        : [
            { key: "includeServiceInfo", label: "Údaje o servisu" },
            { key: "includeCustomerInfo", label: "Údaje o zákazníkovi" },
            { key: "includeDeviceInfo", label: "Údaje o zařízení" },
            { key: "includeRepairs", label: "Provedené opravy" },
            { key: "includeWarranty", label: "Záruka" },
            { key: "includeDates", label: "Data" },
            { key: "includeStamp", label: "Razítko / podpis" },
            { key: "includeCustomerSignature", label: "Podpis zákazníka" },
          ];

  return (
    <div style={{ minHeight: "100vh", padding: 24 }}>
      <div style={{ maxWidth: 1200, margin: "0 auto" }}>
        <header style={{ marginBottom: 24, display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
          <AppLogo size={48} colors={context.jobidocsLogo ?? undefined} modern />
          <div>
            <h1 style={{ fontSize: 28, fontWeight: 800, marginBottom: 4, color: "var(--text)" }}>JobiDocs</h1>
            <p style={{ color: "var(--muted)", fontSize: 14 }}>Tisk a export dokumentů z Jobi.</p>
          </div>
        </header>

        <div
          className="glass-panel"
          style={{
            padding: 12,
            marginBottom: 16,
            background: health?.ok ? "rgba(34,197,94,0.1)" : error ? "rgba(239,68,68,0.1)" : "var(--panel)",
            borderColor: health?.ok ? "rgba(34,197,94,0.3)" : error ? "rgba(239,68,68,0.3)" : undefined,
          }}
        >
          {health?.ok && <span style={{ color: "#16a34a", fontWeight: 600 }}>✓ API běží na portu 3847</span>}
          {error && <span style={{ color: "#dc2626" }}>Chyba: {error}</span>}
          {!health && !error && <span style={{ color: "var(--muted)" }}>Načítám…</span>}
        </div>

        <TabNav active={tab} onChange={setTab} />

        {tab === "aktivity" && (
          <section className="glass-panel">
            <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 16, color: "var(--text)" }}>Aktivity (požadavky z Jobi)</h2>
            <div style={{ padding: 16, borderRadius: 12, background: "var(--panel-2)", maxHeight: 400, overflowY: "auto" }}>
              {activities.length === 0 && <div style={{ color: "var(--muted)" }}>Žádné požadavky zatím</div>}
              {activities.map((a, i) => (
                <div key={`${a.ts}-${i}`} style={{ display: "flex", gap: 12, marginBottom: 8, alignItems: "flex-start" }}>
                  <span style={{ color: "var(--muted)", flexShrink: 0 }}>{new Date(a.ts).toLocaleTimeString("cs-CZ")}</span>
                  <span style={{ fontWeight: 600, color: a.action === "print" ? "#2563eb" : "#059669" }}>{a.action === "print" ? "Tisk" : "Export"}</span>
                  <span style={{ color: a.status === "ok" ? "#16a34a" : a.status === "error" ? "#dc2626" : "#ca8a04", fontWeight: a.status === "error" ? 600 : 400 }}>
                    {a.status === "ok" ? "✓" : a.status === "error" ? "✗" : "…"}
                  </span>
                  {a.detail && <span style={{ color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis" }}>{a.detail}</span>}
                </div>
              ))}
            </div>
            <div style={{ marginTop: 16, fontSize: 12, color: "var(--muted)" }}>
              JobiDocs {packageJson.version}
            </div>
          </section>
        )}

        {tab === "tiskarna" && (
          <section className="glass-panel" style={{ maxWidth: 480 }}>
            <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 16, color: "var(--text)" }}>Preferovaná tiskárna</h2>
            <label style={{ display: "block", marginBottom: 8, fontSize: 13, color: "var(--muted)" }}>Servis</label>
            <select
              value={serviceId}
              onChange={(e) => setServiceId(e.target.value)}
              style={{ width: "100%", padding: "12px 14px", borderRadius: 12, border: "1px solid var(--border)", background: "var(--panel)", color: "var(--text)", marginBottom: 16 }}
            >
              <option value="">(žádný – spusťte Jobi pro načtení)</option>
              {context.services.map((s) => (
                <option key={s.service_id} value={s.service_id}>
                  {s.service_name} {context.activeServiceId === s.service_id ? "(aktivní)" : ""}
                </option>
              ))}
            </select>
            <label style={{ display: "block", marginBottom: 8, fontSize: 13, color: "var(--muted)" }}>Tiskárna</label>
            <select
              value={preferredPrinter}
              onChange={(e) => setPreferredPrinter(e.target.value)}
              style={{ width: "100%", padding: "12px 14px", borderRadius: 12, border: "1px solid var(--border)", background: "var(--panel)", color: "var(--text)" }}
            >
              <option value="">(žádná)</option>
              {printers.map((p) => (
                <option key={p.name} value={p.name}>{p.name}</option>
              ))}
            </select>
            <button
              onClick={handleSaveSettings}
              disabled={loading}
              style={{ marginTop: 16, padding: "12px 24px", borderRadius: 12, border: "none", background: "var(--accent)", color: "white", fontWeight: 600, cursor: loading ? "not-allowed" : "pointer" }}
            >
              {loading ? "Ukládám…" : "Uložit tiskárnu"}
            </button>
            {serviceId && settingsLoadedForService === serviceId && (
              <div style={{ marginTop: 12, fontSize: 13, color: "#16a34a" }}>Uloženo: {savedPrinter ?? "(žádná)"}</div>
            )}
          </section>
        )}

        {tab === "dokumenty" && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24, alignItems: "start" }}>
            <div className="glass-panel" style={{ display: "flex", flexDirection: "column", gap: 20 }}>
              <h2 style={{ fontSize: 18, fontWeight: 700, color: "var(--text)" }}>Customizace dokumentu</h2>
              <DocumentTypePicker value={docType} onChange={setDocType} />

              <div>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10, color: "var(--text)" }}>Logo v dokumentech</div>
                <input ref={fileInputLogo} type="file" accept="image/*" onChange={handleFileLogo} style={{ display: "none" }} />
                <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 8 }}>
                  <button type="button" onClick={() => fileInputLogo.current?.click()} style={{ padding: "10px 16px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--panel)", color: "var(--text)", fontSize: 13, cursor: "pointer" }}>
                    {config.logoUrl ? "Změnit logo" : "Nahrát logo"}
                  </button>
                  <span style={{ fontSize: 12, color: "var(--muted)" }}>Velikost: {((config.logoSize as number) ?? 100)}%</span>
                  <input type="range" min={50} max={150} value={((config.logoSize as number) ?? 100)} onChange={(e) => setConfig((prev) => ({ ...prev, logoSize: Number(e.target.value) }))} style={{ flex: 1 }} />
                </div>
              </div>

              <div>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10, color: "var(--text)" }}>Razítko / podpis</div>
                <input ref={fileInputStamp} type="file" accept="image/*" onChange={handleFileStamp} style={{ display: "none" }} />
                <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                  <button type="button" onClick={() => fileInputStamp.current?.click()} style={{ padding: "10px 16px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--panel)", color: "var(--text)", fontSize: 13, cursor: "pointer" }}>
                    {config.stampUrl ? "Změnit razítko" : "Nahrát razítko"}
                  </button>
                  <span style={{ fontSize: 12, color: "var(--muted)" }}>Velikost: {((config.stampSize as number) ?? 100)}%</span>
                  <input type="range" min={50} max={150} value={((config.stampSize as number) ?? 100)} onChange={(e) => setConfig((prev) => ({ ...prev, stampSize: Number(e.target.value) }))} style={{ flex: 1 }} />
                </div>
              </div>

              {docType === "zakazkovy_list" && (
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10, color: "var(--text)" }}>Bloky podpisů (dole na dokumentu)</div>
                  <p style={{ fontSize: 12, color: "var(--muted)", marginBottom: 10 }}>Texty a pozice jednotlivých bloků podpisů.</p>
                  {[
                    { key: "Handover", label: "Podpis při předání", configLabel: "signatureLabelHandover", configPos: "signaturePositionHandover" },
                    { key: "Pickup", label: "Podpis při vyzvednutí", configLabel: "signatureLabelPickup", configPos: "signaturePositionPickup" },
                    { key: "Service", label: "Podpis / razítko servisu", configLabel: "signatureLabelService", configPos: "signaturePositionService" },
                  ].map(({ key, label, configLabel, configPos }) => (
                    <div key={key} style={{ marginBottom: 14 }}>
                      <label style={{ display: "block", fontSize: 12, fontWeight: 500, marginBottom: 4, color: "var(--text)" }}>{label}</label>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        <input
                          type="text"
                          value={String((docConfig as Record<string, unknown>)[configLabel] ?? { Handover: "Podpis při předání zákazníkem", Pickup: "Podpis při vyzvednutí zákazníkem", Service: "Podpis / razítko servisu" }[key])}
                          onChange={(e) => updateDocConfig([configLabel], e.target.value)}
                          placeholder={label}
                          style={{ flex: 1, minWidth: 180, padding: "8px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--panel)", color: "var(--text)", fontSize: 13 }}
                        />
                        <select
                          value={String((docConfig as Record<string, unknown>)[configPos] ?? { Handover: "left", Pickup: "center", Service: "right" }[key])}
                          onChange={(e) => updateDocConfig([configPos], e.target.value)}
                          style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--panel)", color: "var(--text)", fontSize: 13 }}
                        >
                          <option value="left">Vlevo dole</option>
                          <option value="center">Uprostřed dole</option>
                          <option value="right">Vpravo dole</option>
                        </select>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10, color: "var(--text)" }}>Design</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {DESIGN_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => updateDocConfig(["design"], opt.value)}
                      style={{
                        padding: "8px 14px",
                        borderRadius: 10,
                        border: (docConfig.design || "classic") === opt.value ? "2px solid var(--accent)" : "1px solid var(--border)",
                        background: (docConfig.design || "classic") === opt.value ? "var(--accent-soft)" : "var(--panel)",
                        color: "var(--text)",
                        fontSize: 12,
                        fontWeight: 600,
                        cursor: "pointer",
                      }}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10, color: "var(--text)" }}>Barevný režim</div>
                <div style={{ display: "flex", borderRadius: 8, overflow: "hidden", border: "1px solid var(--border)" }}>
                  <button
                    type="button"
                    onClick={() => setConfig((prev) => ({ ...prev, colorMode: "color" }))}
                    style={{
                      flex: 1,
                      padding: "8px 14px",
                      fontSize: 12,
                      fontWeight: 600,
                      border: "none",
                      background: (config.colorMode || "color") === "color" ? "var(--accent)" : "var(--panel)",
                      color: (config.colorMode || "color") === "color" ? "white" : "var(--text)",
                      cursor: "pointer",
                    }}
                  >
                    Barva
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfig((prev) => ({ ...prev, colorMode: "bw" }))}
                    style={{
                      flex: 1,
                      padding: "8px 14px",
                      fontSize: 12,
                      fontWeight: 600,
                      border: "none",
                      borderLeft: "1px solid var(--border)",
                      background: config.colorMode === "bw" ? "var(--accent)" : "var(--panel)",
                      color: config.colorMode === "bw" ? "white" : "var(--text)",
                      cursor: "pointer",
                    }}
                  >
                    Černobílý
                  </button>
                </div>
              </div>

              {(config.colorMode || "color") === "color" && (
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10, color: "var(--text)" }}>Barva designu</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                    {DESIGN_ACCENT_PRESETS.map((opt) => (
                      <button
                        key={opt.value || "default"}
                        type="button"
                        onClick={() => {
                          setConfig((prev) => ({ ...prev, designAccentColor: opt.value }));
                          setCustomColorPickerOpen(false);
                          setCustomColorPickerExtra(null);
                        }}
                        style={{
                          padding: "8px 14px",
                          borderRadius: 10,
                          border: ((config.designAccentColor as string) || "") === opt.value ? "2px solid var(--accent)" : "1px solid var(--border)",
                          background: ((config.designAccentColor as string) || "") === opt.value ? "var(--accent-soft)" : "var(--panel)",
                          color: "var(--text)",
                          fontSize: 12,
                          fontWeight: 600,
                          cursor: "pointer",
                          display: "flex",
                          alignItems: "center",
                          gap: 6,
                        }}
                      >
                        {opt.value && <span style={{ width: 12, height: 12, borderRadius: "50%", background: opt.value, flexShrink: 0 }} />}
                        {opt.label}
                      </button>
                    ))}
                    <button
                      type="button"
                        onClick={() => {
                        const val = config.designAccentColor as string;
                        const isCustom = val && !DESIGN_ACCENT_PRESETS.some((p) => p.value === val);
                        if (!isCustom) setConfig((prev) => ({ ...prev, designAccentColor: val || "#6366f1" }));
                        setCustomColorPickerOpen(!customColorPickerOpen);
                        setCustomColorPickerExtra(null);
                      }}
                      style={{
                        padding: "8px 14px",
                        borderRadius: 10,
                        border: customColorPickerOpen || ((config.designAccentColor as string) && !DESIGN_ACCENT_PRESETS.some((p) => p.value === (config.designAccentColor as string))) ? "2px solid var(--accent)" : "1px solid var(--border)",
                        background: customColorPickerOpen ? "var(--accent-soft)" : "var(--panel)",
                        color: "var(--text)",
                        fontSize: 12,
                        fontWeight: 600,
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                      }}
                    >
                      <span style={{ width: 12, height: 12, borderRadius: "50%", background: (config.designAccentColor as string) && !DESIGN_ACCENT_PRESETS.some((p) => p.value === (config.designAccentColor as string)) ? (config.designAccentColor as string) : "#9ca3af", flexShrink: 0 }} />
                      Vlastní
                    </button>
                  </div>
                  {customColorPickerOpen && (
                    <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 12 }}>
                      <input
                        type="color"
                        value={((config.designAccentColor as string) && /^#[0-9a-fA-F]{6}$/.test(config.designAccentColor as string) ? (config.designAccentColor as string) : "#6366f1")}
                        onChange={(e) => setConfig((prev) => ({ ...prev, designAccentColor: e.target.value }))}
                        style={{ width: 48, height: 36, padding: 2, cursor: "pointer", borderRadius: 8, border: "1px solid var(--border)" }}
                        title="Vyberte barvu"
                      />
                      <span style={{ fontSize: 12, color: "var(--muted)" }}>
                        Kliknutím otevřete spektrum a vyberte vlastní barvu
                      </span>
                    </div>
                  )}
                </div>
              )}

              {(config.colorMode || "color") === "color" && ((docConfig.design as string) === "modern" || (docConfig.design as string) === "professional") && (
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10, color: "var(--text)" }}>Další barvy</div>
                  <p style={{ fontSize: 12, color: "var(--muted)", marginBottom: 10 }}>Nepovinně přepište barvy designu. Prázdné = výchozí.</p>
                  {[
                    { key: "designPrimaryColor", label: "Primární (nadpisy, text hlavičky)" },
                    { key: "designSecondaryColor", label: "Sekundární (nadpisy sekcí)" },
                    { key: "designHeaderBg", label: "Pozadí hlavičky" },
                    { key: "designSectionBorder", label: "Rámečky sekcí" },
                  ].map(({ key, label }) => {
                    const val = (config[key] as string) || "";
                    const isCustom = val && !DESIGN_ACCENT_PRESETS.some((p) => p.value === val);
                    const isPickerOpen = customColorPickerExtra === key;
                    return (
                      <div key={key} style={{ marginBottom: 16 }}>
                        <div style={{ fontSize: 12, fontWeight: 500, color: "var(--text)", marginBottom: 8 }}>{label}</div>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                          {DESIGN_ACCENT_PRESETS.map((opt) => (
                            <button
                              key={opt.value || "default"}
                              type="button"
                              onClick={() => {
                                setConfig((prev) => ({ ...prev, [key]: opt.value }));
                                setCustomColorPickerExtra(null);
                                setCustomColorPickerOpen(false);
                              }}
                              style={{
                                padding: "8px 14px",
                                borderRadius: 10,
                                border: val === opt.value ? "2px solid var(--accent)" : "1px solid var(--border)",
                                background: val === opt.value ? "var(--accent-soft)" : "var(--panel)",
                                color: "var(--text)",
                                fontSize: 12,
                                fontWeight: 600,
                                cursor: "pointer",
                                display: "flex",
                                alignItems: "center",
                                gap: 6,
                              }}
                            >
                              {opt.value && <span style={{ width: 12, height: 12, borderRadius: "50%", background: opt.value, flexShrink: 0 }} />}
                              {opt.label}
                            </button>
                          ))}
                          <button
                            type="button"
                            onClick={() => {
                              if (!isCustom) setConfig((prev) => ({ ...prev, [key]: val || "#6366f1" }));
                              setCustomColorPickerExtra(isPickerOpen ? null : key);
                              setCustomColorPickerOpen(false);
                            }}
                            style={{
                              padding: "8px 14px",
                              borderRadius: 10,
                              border: isPickerOpen || isCustom ? "2px solid var(--accent)" : "1px solid var(--border)",
                              background: isPickerOpen ? "var(--accent-soft)" : "var(--panel)",
                              color: "var(--text)",
                              fontSize: 12,
                              fontWeight: 600,
                              cursor: "pointer",
                              display: "flex",
                              alignItems: "center",
                              gap: 6,
                            }}
                          >
                            <span style={{ width: 12, height: 12, borderRadius: "50%", background: isCustom ? val : "#9ca3af", flexShrink: 0 }} />
                            Vlastní
                          </button>
                        </div>
                        {isPickerOpen && (
                          <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 12 }}>
                            <input
                              type="color"
                              value={val && /^#[0-9a-fA-F]{6}$/.test(val) ? val : "#6366f1"}
                              onChange={(e) => setConfig((prev) => ({ ...prev, [key]: e.target.value }))}
                              style={{ width: 48, height: 36, padding: 2, cursor: "pointer", borderRadius: 8, border: "1px solid var(--border)" }}
                              title="Vyberte barvu"
                            />
                            <span style={{ fontSize: 12, color: "var(--muted)" }}>
                              Kliknutím otevřete spektrum a vyberte vlastní barvu
                            </span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              <div>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10, color: "var(--text)" }}>Viditelné sekce</div>
                <div style={{ display: "grid", gap: 8 }}>
                  {sectionFields.map((f) => (
                    <ModernCheckbox key={f.key} checked={(docConfig[f.key] as boolean) !== false} onChange={(checked) => updateDocConfig([f.key], checked)} label={f.label} />
                  ))}
                </div>
              </div>

              {docType === "zarucni_list" && (docConfig.includeWarranty as boolean) === true && (
                <div
                  className="glass-panel"
                  style={{
                    padding: 16,
                    borderRadius: 14,
                    border: "1px solid var(--border)",
                    background: "var(--panel-2)",
                    display: "flex",
                    flexDirection: "column",
                    gap: 16,
                  }}
                >
                  <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>Délka záruky</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                    <input
                      type="number"
                      min={1}
                      max={999}
                      value={warrantyDurationInput ?? String((docConfig.warrantyUnifiedDuration as number) ?? 24)}
                      onFocus={() => setWarrantyDurationInput(String((docConfig.warrantyUnifiedDuration as number) ?? 24))}
                      onChange={(e) => setWarrantyDurationInput(e.target.value)}
                      onBlur={() => {
                        const raw = warrantyDurationInput ?? "";
                        const n = parseInt(raw, 10);
                        const val = Number.isNaN(n) || n < 1 || n > 999 ? 24 : n;
                        updateDocConfig(["warrantyUnifiedDuration"], val);
                        setWarrantyDurationInput(null);
                      }}
                      style={{
                        width: 64,
                        padding: "10px 12px",
                        borderRadius: 12,
                        border: "1px solid var(--border)",
                        background: "var(--panel)",
                        color: "var(--text)",
                        fontSize: 15,
                        fontWeight: 600,
                        textAlign: "center",
                      }}
                    />
                    <div style={{ display: "flex", borderRadius: 12, overflow: "hidden", border: "1px solid var(--border)", background: "var(--panel)" }}>
                      {(["days", "months", "years"] as const).map((u) => {
                        const label = u === "days" ? "dny" : u === "months" ? "měsíce" : "roky";
                        const isActive = (docConfig.warrantyUnifiedUnit as string) === u;
                        return (
                          <button
                            key={u}
                            type="button"
                            onClick={() => updateDocConfig(["warrantyUnifiedUnit"], u)}
                            style={{
                              padding: "10px 16px",
                              fontSize: 13,
                              fontWeight: 600,
                              border: "none",
                              borderLeft: u !== "days" ? "1px solid var(--border)" : "none",
                              background: isActive ? "var(--accent)" : "transparent",
                              color: isActive ? "white" : "var(--text)",
                              cursor: "pointer",
                              transition: "background 0.15s ease, color 0.15s ease",
                            }}
                          >
                            {label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>V dokumentu zobrazit</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <label
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        cursor: "pointer",
                        padding: "12px 14px",
                        borderRadius: 12,
                        border: (docConfig.warrantyShowEndDate as boolean) !== false ? "2px solid var(--accent)" : "1px solid var(--border)",
                        background: (docConfig.warrantyShowEndDate as boolean) !== false ? "var(--accent-soft)" : "var(--panel)",
                        transition: "border-color 0.15s ease, background 0.15s ease",
                      }}
                    >
                      <input type="radio" name="warrantyDisplay" checked={(docConfig.warrantyShowEndDate as boolean) !== false} onChange={() => updateDocConfig(["warrantyShowEndDate"], true)} style={{ accentColor: "var(--accent)", width: 18, height: 18 }} />
                      <span style={{ fontSize: 13, color: "var(--text)" }}>Záruka do (datum konce)</span>
                    </label>
                    <label
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        cursor: "pointer",
                        padding: "12px 14px",
                        borderRadius: 12,
                        border: (docConfig.warrantyShowEndDate as boolean) === false ? "2px solid var(--accent)" : "1px solid var(--border)",
                        background: (docConfig.warrantyShowEndDate as boolean) === false ? "var(--accent-soft)" : "var(--panel)",
                        transition: "border-color 0.15s ease, background 0.15s ease",
                      }}
                    >
                      <input type="radio" name="warrantyDisplay" checked={(docConfig.warrantyShowEndDate as boolean) === false} onChange={() => updateDocConfig(["warrantyShowEndDate"], false)} style={{ accentColor: "var(--accent)", width: 18, height: 18 }} />
                      <span style={{ fontSize: 13, color: "var(--text)" }}>Pouze délka záruky (bez data)</span>
                    </label>
                  </div>

                  <div>
                    <label style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 6, color: "var(--text)" }}>Dodatečné informace</label>
                    <textarea
                      value={(docConfig.warrantyExtraText as string) ?? ""}
                      onChange={(e) => updateDocConfig(["warrantyExtraText"], e.target.value)}
                      placeholder="Volitelný text pod zárukou (např. podmínky, vyloučení…)"
                      rows={2}
                      style={{ width: "100%", padding: "10px 12px", borderRadius: 12, border: "1px solid var(--border)", background: "var(--panel)", color: "var(--text)", fontSize: 13, resize: "vertical" }}
                    />
                  </div>

                  <div>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                      <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>Další záruky</span>
                      <button
                        type="button"
                        onClick={() => {
                          const list = (docConfig.warrantyItems as Array<{ label: string; duration: number; unit: string }>) ?? [];
                          updateDocConfig(["warrantyItems"], [...list, { label: "Záruka na díly", duration: 12, unit: "months", showEndDate: true }]);
                        }}
                        style={{
                          padding: "6px 12px",
                          borderRadius: 10,
                          border: "1px solid var(--accent)",
                          background: "var(--accent-soft)",
                          color: "var(--accent)",
                          fontSize: 12,
                          fontWeight: 600,
                          cursor: "pointer",
                        }}
                      >
                        + Přidat záruku
                      </button>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      {((docConfig.warrantyItems as Array<{ label: string; duration: number; unit: string; showEndDate?: boolean }>) ?? []).map((item, index) => (
                        <div
                          key={index}
                          style={{
                            display: "flex",
                            flexWrap: "wrap",
                            alignItems: "center",
                            gap: 8,
                            padding: 10,
                            borderRadius: 12,
                            border: "1px solid var(--border)",
                            background: "var(--panel)",
                          }}
                        >
                          <input
                            type="text"
                            value={item.label}
                            onChange={(e) => {
                              const list = [...((docConfig.warrantyItems as Array<{ label: string; duration: number; unit: string; showEndDate?: boolean }>) ?? [])];
                              list[index] = { ...list[index], label: e.target.value };
                              updateDocConfig(["warrantyItems"], list);
                            }}
                            placeholder="např. Záruka na díly"
                            style={{ flex: "1 1 120px", minWidth: 100, padding: "8px 10px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--panel-2)", color: "var(--text)", fontSize: 13 }}
                          />
                          <input
                            type="number"
                            min={1}
                            max={999}
                            value={item.duration}
                            onChange={(e) => {
                              const list = [...((docConfig.warrantyItems as Array<{ label: string; duration: number; unit: string; showEndDate?: boolean }>) ?? [])];
                              list[index] = { ...list[index], duration: e.target.valueAsNumber || 12 };
                              updateDocConfig(["warrantyItems"], list);
                            }}
                            style={{ width: 52, padding: "8px 6px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--panel-2)", color: "var(--text)", fontSize: 13, textAlign: "center" }}
                          />
                          <select
                            value={item.unit}
                            onChange={(e) => {
                              const list = [...((docConfig.warrantyItems as Array<{ label: string; duration: number; unit: string; showEndDate?: boolean }>) ?? [])];
                              list[index] = { ...list[index], unit: e.target.value };
                              updateDocConfig(["warrantyItems"], list);
                            }}
                            style={{ padding: "8px 10px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--panel-2)", color: "var(--text)", fontSize: 13 }}
                          >
                            <option value="days">dny</option>
                            <option value="months">měsíce</option>
                            <option value="years">roky</option>
                          </select>
                          <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: 12, color: "var(--text)" }}>
                            <input
                              type="checkbox"
                              checked={(item as { showEndDate?: boolean }).showEndDate !== false}
                              onChange={(e) => {
                                const list = [...((docConfig.warrantyItems as Array<{ label: string; duration: number; unit: string; showEndDate?: boolean }>) ?? [])];
                                list[index] = { ...list[index], showEndDate: e.target.checked };
                                updateDocConfig(["warrantyItems"], list);
                              }}
                              style={{ accentColor: "var(--accent)" }}
                            />
                            <span>Do data</span>
                          </label>
                          <button
                            type="button"
                            onClick={() => {
                              const list = ((docConfig.warrantyItems as Array<{ label: string; duration: number; unit: string; showEndDate?: boolean }>) ?? []).filter((_, i) => i !== index);
                              updateDocConfig(["warrantyItems"], list);
                            }}
                            title="Odebrat"
                            style={{
                              padding: "8px 10px",
                              borderRadius: 10,
                              border: "1px solid var(--border)",
                              background: "transparent",
                              color: "var(--muted)",
                              fontSize: 12,
                              cursor: "pointer",
                            }}
                          >
                            Odebrat
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              <div>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10, color: "var(--text)" }}>Šířka sekcí</div>
                <p style={{ fontSize: 12, color: "var(--muted)", marginBottom: 8 }}>Poloviční sekce zobrazí dvě vedle sebe jako kartičky.</p>
                <div style={{ display: "grid", gap: 8 }}>
                  {sectionFields.filter((f) => INCLUDE_KEY_TO_SECTION_KEY[f.key]).map((f) => {
                    const sectionKey = INCLUDE_KEY_TO_SECTION_KEY[f.key];
                    const sw = (docConfig.sectionWidths as Record<string, SectionWidth>) || {};
                    const width = sw[sectionKey] ?? DEFAULT_SECTION_WIDTHS[sectionKey] ?? "full";
                    return (
                      <div key={f.key} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ fontSize: 12, color: "var(--text)", flex: "1 1 0" }}>{f.label}</span>
                        <div style={{ display: "flex", borderRadius: 8, overflow: "hidden", border: "1px solid var(--border)" }}>
                          <button
                            type="button"
                            onClick={() => updateDocConfig(["sectionWidths", sectionKey], "full")}
                            style={{
                              padding: "6px 12px",
                              fontSize: 11,
                              fontWeight: 600,
                              border: "none",
                              background: width === "full" ? "var(--accent)" : "var(--panel)",
                              color: width === "full" ? "white" : "var(--text)",
                              cursor: "pointer",
                            }}
                          >
                            Celá
                          </button>
                          <button
                            type="button"
                            onClick={() => updateDocConfig(["sectionWidths", sectionKey], "half")}
                            style={{
                              padding: "6px 12px",
                              fontSize: 11,
                              fontWeight: 600,
                              border: "none",
                              borderLeft: "1px solid var(--border)",
                              background: width === "half" ? "var(--accent)" : "var(--panel)",
                              color: width === "half" ? "white" : "var(--text)",
                              cursor: "pointer",
                            }}
                          >
                            Polovina
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div>
                <label style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 8, color: "var(--text)" }}>Vlastní text (právní ustanovení)</label>
                <textarea
                  value={(docConfig.legalText as string) || ""}
                  onChange={(e) => updateDocConfig(["legalText"], e.target.value)}
                  rows={4}
                  style={{ width: "100%", padding: 12, borderRadius: 12, border: "1px solid var(--border)", background: "var(--panel)", color: "var(--text)", fontSize: 13, resize: "vertical" }}
                  placeholder="Vlastní text zobrazený na dokumentu…"
                />
              </div>

              <div>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10, color: "var(--text)" }}>QR kód (odkaz na recenze)</div>
                <p style={{ fontSize: 12, color: "var(--muted)", marginBottom: 10 }}>
                  <a href="https://support.google.com/business/answer/16816815?sjid=8982499859156130050-EU" target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent)" }}>Jak získat odkaz na Google recenze</a>
                </p>
                <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
                  <button
                    type="button"
                    onClick={() => setConfig((prev) => ({ ...prev, reviewUrlType: "custom" }))}
                    style={{
                      padding: "8px 14px",
                      borderRadius: 10,
                      border: (config.reviewUrlType as string) === "custom" ? "2px solid var(--accent)" : "1px solid var(--border)",
                      background: (config.reviewUrlType as string) === "custom" ? "var(--accent-soft)" : "var(--panel)",
                      color: "var(--text)",
                      fontSize: 12,
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    Vlastní odkaz
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfig((prev) => ({ ...prev, reviewUrlType: "google" }))}
                    style={{
                      padding: "8px 14px",
                      borderRadius: 10,
                      border: (config.reviewUrlType as string) === "google" ? "2px solid var(--accent)" : "1px solid var(--border)",
                      background: (config.reviewUrlType as string) === "google" ? "var(--accent-soft)" : "var(--panel)",
                      color: "var(--text)",
                      fontSize: 12,
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    Google recenze (Place ID)
                  </button>
                </div>
                {(config.reviewUrlType as string) === "google" ? (
                  <input
                    type="text"
                    value={(config.googlePlaceId as string) || ""}
                    onChange={(e) => setConfig((prev) => ({ ...prev, googlePlaceId: e.target.value.trim() }))}
                    placeholder="Google Place ID (např. ChIJ…)"
                    style={{ width: "100%", padding: "10px 12px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--panel)", color: "var(--text)", fontSize: 13, marginBottom: 10 }}
                  />
                ) : (
                  <input
                    type="url"
                    value={(config.reviewUrl as string) || ""}
                    onChange={(e) => setConfig((prev) => ({ ...prev, reviewUrl: e.target.value.trim() }))}
                    placeholder="https://…"
                    style={{ width: "100%", padding: "10px 12px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--panel)", color: "var(--text)", fontSize: 13, marginBottom: 10 }}
                  />
                )}
                <label style={{ display: "block", fontSize: 12, fontWeight: 500, marginBottom: 6, color: "var(--text)" }}>Text u QR kódu</label>
                <input
                  type="text"
                  value={(config.reviewText as string) || ""}
                  onChange={(e) => setConfig((prev) => ({ ...prev, reviewText: e.target.value }))}
                  placeholder="Zde nám můžete napsat recenzi"
                  style={{ width: "100%", padding: "10px 12px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--panel)", color: "var(--text)", fontSize: 13, marginBottom: 10 }}
                />
                <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 8, color: "var(--text)" }}>Zobrazit QR na dokumentech</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <ModernCheckbox checked={(config.qrOnTicketList as boolean) === true} onChange={(v) => setConfig((prev) => ({ ...prev, qrOnTicketList: v }))} label="Zakázkový list" />
                  <ModernCheckbox checked={(config.qrOnDiagnostic as boolean) === true} onChange={(v) => setConfig((prev) => ({ ...prev, qrOnDiagnostic: v }))} label="Diagnostický protokol" />
                  <ModernCheckbox checked={(config.qrOnWarranty as boolean) !== false} onChange={(v) => setConfig((prev) => ({ ...prev, qrOnWarranty: v }))} label="Záruční list" />
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 10 }}>
                  <span style={{ fontSize: 12, color: "var(--muted)" }}>Velikost QR: {((config.qrCodeSize as number) ?? 120)} px</span>
                  <input type="range" min={80} max={200} value={((config.qrCodeSize as number) ?? 120)} onChange={(e) => setConfig((prev) => ({ ...prev, qrCodeSize: Number(e.target.value) }))} style={{ flex: 1 }} />
                </div>
                <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 8 }}>Pozici QR kódu změníte tažením v náhledu dokumentu vpravo.</p>
              </div>

              <p style={{ fontSize: 12, color: "var(--muted)" }}>Pořadí sekcí upravíte tažením přímo v dokumentu vpravo. Poloviční sekce se zobrazí dvě vedle sebe.</p>

              <button
                onClick={handleSaveConfig}
                disabled={configLoading || !serviceId}
                style={{ padding: "14px 24px", borderRadius: 12, border: "none", background: configSaved ? "#16a34a" : "var(--accent)", color: "white", fontWeight: 700, fontSize: 14, cursor: configLoading || !serviceId ? "not-allowed" : "pointer" }}
              >
                {configLoading ? "Ukládám…" : configSaved ? "Uloženo ✓" : "Uložit nastavení dokumentů"}
              </button>
            </div>

            <section className="glass-panel document-preview-section" style={{ overflow: "hidden" }}>
              <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 12, color: "var(--text)" }}>Náhled dokumentu</h2>
              <p style={{ fontSize: 12, color: "var(--muted)", marginBottom: 12 }}>Přetáhněte sekce pro změnu pořadí.</p>
              <DocumentPreview docType={docType} config={config} companyData={companyData} onSectionOrderChange={handleSectionOrderChange} onQrPositionChange={(pos) => setConfig((prev) => ({ ...prev, qrPosition: pos }))} />
              <button
                type="button"
                onClick={handlePrintPreview}
                disabled={printLoading}
                style={{ marginTop: 16, padding: "12px 20px", borderRadius: 12, border: "none", background: "var(--accent)", color: "white", fontWeight: 600, fontSize: 14, cursor: printLoading ? "not-allowed" : "pointer" }}
              >
                {printLoading ? "Generuji PDF…" : "Tisk ukázky"}
              </button>
              {printError && (
                <p style={{ marginTop: 12, padding: "10px 14px", fontSize: 13, color: "#b91c1c", background: "#fef2f2", borderRadius: 8, border: "1px solid #fecaca" }}>
                  Chyba generování: {printError}
                </p>
              )}
            </section>
          </div>
        )}
      </div>

      {pdfPreviewUrl && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Náhled PDF"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 9999,
            background: "rgba(0,0,0,0.6)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            padding: 24,
            boxSizing: "border-box",
          }}
          onClick={closePdfPreview}
        >
          <div
            role="document"
            style={{
              background: "white",
              borderRadius: 12,
              boxShadow: "0 25px 80px rgba(0,0,0,0.25)",
              overflow: "hidden",
              display: "flex",
              flexDirection: "column",
              maxWidth: "100%",
              maxHeight: "100%",
              width: "90vw",
              height: "90vh",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0, gap: 12 }}>
              <span style={{ fontWeight: 600, color: "var(--text)" }}>Náhled PDF</span>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                <button
                  type="button"
                  onClick={handlePrintToQueue}
                  disabled={printToQueueLoading}
                  style={{ padding: "8px 14px", borderRadius: 8, border: "none", background: "var(--accent)", color: "white", fontWeight: 600, cursor: printToQueueLoading ? "not-allowed" : "pointer", fontSize: 13 }}
                >
                  {printToQueueLoading ? "Odesílám…" : "Tisk na tiskárnu"}
                </button>
                {typeof window !== "undefined" && window.electron?.showSaveDialog && (
                  <button
                    type="button"
                    onClick={handleExportToFile}
                    disabled={exportToFileLoading}
                    style={{ padding: "8px 14px", borderRadius: 8, border: "1px solid var(--border)", background: "white", color: "var(--text)", fontWeight: 500, cursor: exportToFileLoading ? "not-allowed" : "pointer", fontSize: 13 }}
                  >
                    {exportToFileLoading ? "Ukládám…" : "Export do souboru"}
                  </button>
                )}
                {typeof window !== "undefined" && window.electron?.openPrintDialog && (
                  <button
                    type="button"
                    onClick={() => {
                      const html = generateDocumentHtml(config, docType, context.companyData || {});
                      window.electron?.openPrintDialog(html);
                    }}
                    style={{ padding: "8px 14px", borderRadius: 8, border: "1px solid var(--border)", background: "white", color: "var(--text)", fontWeight: 500, cursor: "pointer", fontSize: 13 }}
                  >
                    Tisk (okno)…
                  </button>
                )}
                <a
                  href={pdfPreviewUrl}
                  download="nahled.pdf"
                  style={{ padding: "8px 14px", borderRadius: 8, border: "1px solid var(--border)", background: "white", color: "var(--text)", fontWeight: 500, cursor: "pointer", fontSize: 13, textDecoration: "none" }}
                >
                  Stáhnout PDF
                </a>
                <a
                  href={pdfPreviewUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ padding: "8px 14px", borderRadius: 8, border: "1px solid var(--border)", background: "white", color: "var(--text)", fontWeight: 500, cursor: "pointer", fontSize: 13, textDecoration: "none" }}
                >
                  Otevřít v systému
                </a>
                <button
                  type="button"
                  onClick={closePdfPreview}
                  style={{ padding: "8px 16px", borderRadius: 8, border: "none", background: "var(--accent)", color: "white", fontWeight: 600, cursor: "pointer", fontSize: 13 }}
                >
                  Zavřít
                </button>
              </div>
            </div>
            {printToQueueSuccess && (
              <div style={{ padding: "8px 12px", margin: "0 12px 8px", fontSize: 12, color: "#166534", background: "#f0fdf4", borderRadius: 8, border: "1px solid #bbf7d0" }}>
                Úloha odeslána do fronty
              </div>
            )}
            {exportToFileError && (
              <div style={{ padding: "8px 12px", margin: "0 12px 8px", fontSize: 12, color: "#b91c1c", background: "#fef2f2", borderRadius: 8, border: "1px solid #fecaca" }}>
                {exportToFileError}
              </div>
            )}
            {printToQueueError && (
              <div style={{ padding: "8px 12px", margin: "0 12px 8px", fontSize: 12, color: "#b91c1c", background: "#fef2f2", borderRadius: 8, border: "1px solid #fecaca" }}>
                {printToQueueError}
              </div>
            )}
            <iframe
              src={pdfPreviewUrl}
              title="Náhled PDF"
              style={{ flex: 1, width: "100%", minHeight: 0, border: "none" }}
              onLoad={revokePreviousPdfUrlAfterLoad}
            />
          </div>
        </div>
      )}
    </div>
  );
}
