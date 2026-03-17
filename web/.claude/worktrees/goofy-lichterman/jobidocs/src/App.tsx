import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import packageJson from "../package.json";
import { generateDocumentHtml } from "./documentToHtml";
import { AppLogo } from "./components/AppLogo";
import { getDesignStyles, type DocumentDesign, type LayoutSpec, type SectionStyle } from "./documentDesign";
import {
  DndContext,
  DragOverlay,
  pointerWithin,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { sanitizeRichText } from "./richText";

const API_BASE = "http://127.0.0.1:3847";
const WIZARD_STORAGE_KEY = "jobidocs_wizard_dismissed";

/** Všechny podporované proměnné pro vlastní text – při tisku z Jobi se nahradí. */
export const CUSTOM_TEXT_VARIABLES: Record<string, string> = {
  ticket_code: "Kód zakázky",
  order_code: "Číslo zakázky (alias)",
  customer_name: "Jméno zákazníka",
  customer_phone: "Telefon zákazníka",
  customer_email: "E-mail zákazníka",
  customer_address: "Adresa zákazníka",
  device_name: "Název zařízení",
  device_serial: "Sériové číslo",
  device_imei: "IMEI",
  device_state: "Stav zařízení",
  device_problem: "Popis problému",
  service_name: "Název servisu",
  service_phone: "Telefon servisu",
  service_email: "E-mail servisu",
  service_address: "Adresa servisu",
  service_ico: "IČO",
  service_dic: "DIČ",
  repair_date: "Datum přijetí / opravy",
  repair_completion_date: "Předpokládané dokončení",
  total_price: "Celková cena",
  warranty_until: "Záruka do data",
  diagnostic_text: "Text diagnostiky",
  note: "Poznámka",
};

/** Ukázkové hodnoty pro proměnné {{…}} (náhled / tisk z JobiDocs). Při tisku z Jobi pošle Jobi své hodnoty. */
function getSampleVariablesForPreview(companyData: Record<string, unknown>): Record<string, string> {
  const name: string = (companyData?.name != null && String(companyData.name).trim() !== "") ? String(companyData.name).trim() : "Název servisu";
  const d = new Date();
  const repairDate = d.toLocaleDateString("cs-CZ");
  const completionDate = new Date(d.getTime() + 2 * 24 * 60 * 60 * 1000).toLocaleDateString("cs-CZ");
  const warrantyUntil = new Date(d.getTime() + 365 * 24 * 60 * 60 * 1000).toLocaleDateString("cs-CZ");
  return {
    ticket_code: "DEMO-001",
    order_code: "DEMO-001",
    complaint_code: "R-2025-001",
    reclamation_code: "R-2025-001",
    original_ticket_code: "DEMO-001",
    customer_name: "Jan Novák",
    customer_phone: "+420 123 456 789",
    customer_email: "jan.novak@email.cz",
    customer_address: "Havlíčkova 45, 110 00 Praha 1",
    device_name: "iPhone 13 Pro, 128 GB",
    device_serial: "SN123456789012",
    device_imei: "35 123456 789012 3",
    device_state: "Poškozený displej",
    device_problem: "Nefunguje dotyková vrstva v rohu",
    service_name: name,
    service_phone: (companyData?.phone != null && String(companyData.phone).trim() !== "") ? String(companyData.phone) : "+420 234 567 890",
    service_email: (companyData?.email != null && String(companyData.email).trim() !== "") ? String(companyData.email) : "servis@example.cz",
    service_address: [companyData?.addressStreet, companyData?.addressCity, companyData?.addressZip].filter(Boolean).map((x) => String(x)).join(", ") || "Ulice 1, 110 00 Praha",
    service_ico: (companyData?.ico != null && String(companyData.ico).trim() !== "") ? String(companyData.ico) : "12345678",
    service_dic: (companyData?.dic != null && String(companyData.dic).trim() !== "") ? String(companyData.dic) : "CZ12345678",
    repair_date: repairDate,
    repair_completion_date: completionDate,
    total_price: "3 000 Kč",
    warranty_until: warrantyUntil,
    diagnostic_text: "Displej mechanicky poškozen. Doporučena výměna.",
    note: "Zákazník souhlasí s opravou.",
    repair_items: JSON.stringify([
      { name: "Výměna displeje", price: "2 500 Kč" },
      { name: "Kalibrace dotykové vrstvy", price: "500 Kč" },
    ]),
  };
}

declare global {
  interface Window {
    electron?: {
      openPrintDialog: (html: string) => Promise<void>;
      showSaveDialog: (defaultName: string) => Promise<string | null>;
      update?: {
        check: () => Promise<string | null>;
        getState: () => Promise<{ version: string; downloaded: boolean; progress: number } | null>;
        getError: () => Promise<string | null>;
        download: () => Promise<boolean>;
        quitAndInstall: () => Promise<void>;
        onState: (cb: (state: { version: string; downloaded: boolean; progress: number } | null) => void) => () => void;
        onError: (cb: (err: string | null) => void) => () => void;
      };
    };
  }
}

type Printer = { name: string; status: string; available: boolean };
type ActivityEntry = { ts: string; action: "print" | "export"; status: "ok" | "error" | "pending"; detail?: string };
type ServiceEntry = { service_id: string; service_name: string; role: string };

type DocTypeKey = "zakazkovy_list" | "zarucni_list" | "diagnosticky_protokol" | "prijemka_reklamace" | "vydejka_reklamace";
type DocTypeUI = "ticketList" | "diagnosticProtocol" | "warrantyCertificate" | "prijemkaReklamace" | "vydejkaReklamace";

const DOC_TYPE_LABELS: Record<DocTypeKey, string> = {
  zakazkovy_list: "Zakázkový list",
  zarucni_list: "Záruční list",
  diagnosticky_protokol: "Diagnostický protokol",
  prijemka_reklamace: "Příjemka reklamace",
  vydejka_reklamace: "Výdejka reklamace",
};

const DOC_TYPE_TO_UI: Record<DocTypeKey, DocTypeUI> = {
  zakazkovy_list: "ticketList",
  zarucni_list: "warrantyCertificate",
  diagnosticky_protokol: "diagnosticProtocol",
  prijemka_reklamace: "prijemkaReklamace",
  vydejka_reklamace: "vydejkaReklamace",
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
    content: null, // vykreslí se dynamicky z companyData + sectionFields v SectionCardContent
  },
  device: {
    label: "Údaje o zařízení",
    content: null, // vykreslí se dynamicky z companyData + sectionFields v SectionCardContent
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
  diagnosticProtocol: ["device", "service", "diag", "photos", "dates", "custom-adca988a-f92e-497d-8910-3d904936ed61"],
  warrantyCertificate: ["device", "service", "repairs", "warranty", "dates", "custom-5bbd72cc-33a7-405b-a0a3-e726af943779"],
  prijemkaReklamace: ["service", "customer", "device", "dates"],
  vydejkaReklamace: ["service", "customer", "dates", "device", "repairs"],
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

/** Proměnné zobrazené v režimu Šablona po sekcích (service/customer/device filtrujeme podle sectionFields). */
const TEMPLATE_PLACEHOLDERS_BY_SECTION: Record<string, string[]> = {
  service: ["service_name", "service_ico", "service_dic", "service_address", "service_phone", "service_email"],
  customer: ["customer_name", "customer_phone", "customer_email", "customer_address"],
  device: ["device_name", "device_serial", "device_imei", "device_state", "device_problem"],
  repairs: ["total_price"],
  diag: ["diagnostic_text"],
  photos: [],
  dates: ["ticket_code", "repair_date", "repair_completion_date"],
  warranty: ["warranty_until"],
};
/** Pro sekce s výběrem polí: klíč pole v sectionFields -> pořadí v TEMPLATE_PLACEHOLDERS (index). */
const SECTION_FIELD_KEY_TO_VAR_INDEX: Record<string, Record<string, number>> = {
  service: { name: 0, ico: 1, dic: 2, address: 3, phone: 4, email: 5 },
  customer: { name: 0, phone: 1, email: 2, address: 3 },
  device: { name: 0, serial: 1, imei: 2, state: 3, problem: 4 },
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

const SECTION_KEY_TO_INCLUDE_BY_DOC: Record<DocTypeKey, Record<string, string>> = {
  zakazkovy_list: { service: "includeServiceInfo", customer: "includeCustomerInfo", device: "includeDeviceInfo", repairs: "includeRepairs", diag: "includeDiagnostic", photos: "includePhotos", dates: "includeDates" },
  diagnosticky_protokol: { service: "includeServiceInfo", customer: "includeCustomerInfo", device: "includeDeviceInfo", diag: "includeDiagnosticText", photos: "includePhotos", dates: "includeDates" },
  zarucni_list: { service: "includeServiceInfo", customer: "includeCustomerInfo", device: "includeDeviceInfo", repairs: "includeRepairs", warranty: "includeWarranty", dates: "includeDates" },
  prijemka_reklamace: { service: "includeServiceInfo", customer: "includeCustomerInfo", device: "includeDeviceInfo", dates: "includeDates" },
  vydejka_reklamace: { service: "includeServiceInfo", customer: "includeCustomerInfo", device: "includeDeviceInfo", repairs: "includeRepairs", dates: "includeDates" },
};

// Draggable palette item for section (drag from palette into preview)
const PALETTE_CUSTOM_TEXT_ID = "palette-custom-text";
const PALETTE_CUSTOM_HEADING_ID = "palette-custom-heading";
const PALETTE_CUSTOM_SEPARATOR_ID = "palette-custom-separator";
const PALETTE_CUSTOM_SPACER_ID = "palette-custom-spacer";
const PALETTE_SIGNATURE_LINE_ID = "palette-signature-line";
/** Možnosti stylu sekce (přepisují výchozí styl z designu). */
const SECTION_STYLE_OPTIONS: { value: "" | SectionStyle; label: string }[] = [
  { value: "", label: "Výchozí" },
  { value: "boxed", label: "S rámečkem" },
  { value: "ruled", label: "S linkami" },
  { value: "cards", label: "Karty" },
  { value: "underlineTitles", label: "Jen podtržené nadpisy" },
  { value: "leftStripe", label: "S levým pruhem" },
];

const PALETTE_CUSTOM_ID_TO_TYPE: Record<string, "text" | "heading" | "separator" | "spacer" | "signature"> = {
  [PALETTE_CUSTOM_TEXT_ID]: "text",
  [PALETTE_CUSTOM_HEADING_ID]: "heading",
  [PALETTE_CUSTOM_SEPARATOR_ID]: "separator",
  [PALETTE_CUSTOM_SPACER_ID]: "spacer",
  [PALETTE_SIGNATURE_LINE_ID]: "signature",
};

/** Pole, která lze zobrazit/skrýt v sekci Údaje o servisu */
const SERVICE_FIELDS: { key: keyof ServiceSectionFields; label: string }[] = [
  { key: "name", label: "Název" },
  { key: "ico", label: "IČO" },
  { key: "dic", label: "DIČ" },
  { key: "address", label: "Adresa" },
  { key: "phone", label: "Telefon" },
  { key: "email", label: "E-mail" },
  { key: "website", label: "Web" },
];

export type ServiceSectionFields = { name?: boolean; ico?: boolean; dic?: boolean; address?: boolean; phone?: boolean; email?: boolean; website?: boolean };
const DEFAULT_SERVICE_FIELDS: ServiceSectionFields = Object.fromEntries(SERVICE_FIELDS.map((f) => [f.key, true])) as ServiceSectionFields;

/** Pole v sekci Údaje o zákazníkovi */
const CUSTOMER_FIELDS: { key: keyof CustomerSectionFields; label: string }[] = [
  { key: "name", label: "Jméno" },
  { key: "phone", label: "Telefon" },
  { key: "email", label: "E-mail" },
  { key: "address", label: "Adresa" },
];
export type CustomerSectionFields = { name?: boolean; phone?: boolean; email?: boolean; address?: boolean };
const DEFAULT_CUSTOMER_FIELDS: CustomerSectionFields = Object.fromEntries(CUSTOMER_FIELDS.map((f) => [f.key, true])) as CustomerSectionFields;

/** Pole v sekci Údaje o zařízení */
const DEVICE_FIELDS: { key: keyof DeviceSectionFields; label: string }[] = [
  { key: "name", label: "Název / model" },
  { key: "serial", label: "Sériové číslo" },
  { key: "imei", label: "IMEI" },
  { key: "state", label: "Stav" },
  { key: "problem", label: "Problém" },
];
export type DeviceSectionFields = { name?: boolean; serial?: boolean; imei?: boolean; state?: boolean; problem?: boolean };
const DEFAULT_DEVICE_FIELDS: DeviceSectionFields = Object.fromEntries(DEVICE_FIELDS.map((f) => [f.key, true])) as DeviceSectionFields;

/** Sekce s výběrem polí v paletě */
const SECTION_FIELDS_BY_KEY: Record<
  string,
  { fields: readonly { key: string; label: string }[]; defaultFields: Record<string, boolean> }
> = {
  service: { fields: SERVICE_FIELDS, defaultFields: DEFAULT_SERVICE_FIELDS as Record<string, boolean> },
  customer: { fields: CUSTOMER_FIELDS, defaultFields: DEFAULT_CUSTOMER_FIELDS as Record<string, boolean> },
  device: { fields: DEVICE_FIELDS, defaultFields: DEFAULT_DEVICE_FIELDS as Record<string, boolean> },
};

function getPaletteDragLabel(activeId: string): string {
  if (activeId === PALETTE_CUSTOM_TEXT_ID) return "Vlastní text";
  if (activeId === PALETTE_CUSTOM_HEADING_ID) return "Vlastní nadpis";
  if (activeId === PALETTE_CUSTOM_SEPARATOR_ID) return "Oddělovač";
  if (activeId === PALETTE_CUSTOM_SPACER_ID) return "Prázdný řádek";
  if (activeId === PALETTE_SIGNATURE_LINE_ID) return "Řádek na podpis";
  const sectionKey = activeId.replace("palette-", "");
  return (SAMPLE_DATA[sectionKey] as { label?: string } | undefined)?.label ?? sectionKey;
}

/** Label sekce v dokumentu (paleta, přetahování, úprava). Pro custom bloky používá content bloku nebo výchozí název typu. */
function getSectionDragLabel(sectionId: string, docConfig?: Record<string, unknown>): string {
  if (sectionId.startsWith("custom-")) {
    const blocks = (docConfig?.customBlocks as Record<string, { type?: string; content?: string }>) || {};
    const block = blocks[sectionId.slice(7)];
    const content = typeof block?.content === "string" ? block.content.trim() : "";
    if (content.length > 0 && content.length <= 60) return content;
    const t = block?.type;
    if (t === "heading") return "Vlastní nadpis";
    if (t === "separator") return "Oddělovač";
    if (t === "spacer") return "Prázdný řádek";
    if (t === "signature") return "Řádek na podpis";
    return "Vlastní text";
  }
  return (SAMPLE_DATA[sectionId] as { label?: string } | undefined)?.label ?? sectionId;
}

function SectionPaletteItem({
  sectionKey,
  inDocument,
  docConfig,
}: {
  sectionKey: string;
  inDocument: boolean;
  docConfig?: Record<string, unknown>;
}) {
  const label = sectionKey.startsWith("custom-") && docConfig
    ? getSectionDragLabel(sectionKey, docConfig)
    : (SAMPLE_DATA[sectionKey]?.label ?? sectionKey);
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `palette-${sectionKey}`, data: { sectionKey } });

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      style={{
        padding: "8px 12px",
        borderRadius: 10,
        border: "1px solid var(--border)",
        background: inDocument ? "var(--accent-soft)" : "var(--panel)",
        color: "var(--text)",
        fontSize: 12,
        fontWeight: 500,
        cursor: "grab",
        display: "flex",
        alignItems: "center",
        gap: 6,
        opacity: isDragging ? 0.6 : 1,
      }}
    >
      <span style={{ opacity: 0.6 }}>⋮⋮</span>
      <span style={{ flex: 1 }}>{label}</span>
      {inDocument && <span style={{ fontSize: 10, color: "var(--accent)", fontWeight: 600 }}>✓</span>}
    </div>
  );
}

function PaletteCustomBlockItem({ id, label, hasAny }: { id: string; label: string; hasAny: boolean }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id, data: { type: id } });
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      style={{
        padding: "8px 12px",
        borderRadius: 10,
        border: "1px solid var(--border)",
        background: hasAny ? "var(--accent-soft)" : "var(--panel)",
        color: "var(--text)",
        fontSize: 12,
        fontWeight: 500,
        cursor: "grab",
        display: "flex",
        alignItems: "center",
        gap: 6,
        opacity: isDragging ? 0.6 : 1,
      }}
    >
      <span style={{ opacity: 0.6 }}>⋮⋮</span>
      {label}
      {hasAny && <span style={{ fontSize: 10, color: "var(--accent)", fontWeight: 600 }}>✓</span>}
    </div>
  );
}

/** Editor vlastního textu s možností tučného (bold) a vložení proměnných. */
function CustomTextEditor({ value, onChange }: { value: string; onChange: (html: string) => void }) {
  const editorRef = useRef<HTMLDivElement>(null);
  const lastValueRef = useRef<string | null>(null);
  useEffect(() => {
    if (!editorRef.current || lastValueRef.current === value) return;
    lastValueRef.current = value;
    editorRef.current.innerHTML = (value || "").replace(/\n/g, "<br/>");
  }, [value]);
  const saveFromEditor = useCallback(() => {
    if (!editorRef.current) return;
    const raw = editorRef.current.innerHTML;
    const safe = sanitizeRichText(raw);
    lastValueRef.current = safe;
    onChange(safe);
  }, [onChange]);
  const applyBold = useCallback(() => {
    editorRef.current?.focus();
    document.execCommand("bold", false);
    saveFromEditor();
  }, [saveFromEditor]);
  const insertVariable = useCallback(
    (key: string) => {
      editorRef.current?.focus();
      const text = (editorRef.current?.innerHTML && !editorRef.current.innerText?.endsWith(" ") ? " " : "") + "{{" + key + "}}";
      document.execCommand("insertText", false, text);
      saveFromEditor();
    },
    [saveFromEditor]
  );
  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
        <label style={{ fontSize: 11, fontWeight: 500, color: "var(--text)" }}>Text</label>
        <button
          type="button"
          onClick={applyBold}
          title="Tučné (vyberte text a klikněte)"
          style={{ padding: "4px 8px", fontSize: 12, fontWeight: 700, borderRadius: 6, border: "1px solid var(--border)", background: "var(--panel)", color: "var(--text)", cursor: "pointer" }}
        >
          B
        </button>
      </div>
      <div
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        onInput={saveFromEditor}
        data-placeholder="Sem napište text…"
        style={{ width: "100%", minHeight: 60, padding: 8, borderRadius: 8, border: "1px solid var(--border)", background: "var(--panel)", color: "var(--text)", fontSize: 12, boxSizing: "border-box", outline: "none" }}
      />
      <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 2 }}>Vložit proměnnou:</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
        {Object.entries(CUSTOM_TEXT_VARIABLES).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => insertVariable(key)}
            style={{ padding: "3px 6px", fontSize: 10, borderRadius: 4, border: "1px solid var(--border)", background: "var(--panel)", color: "var(--text)", cursor: "pointer" }}
            title={`{{${key}}}`}
          >
            {label}
          </button>
        ))}
      </div>
    </>
  );
}

// Drop zone mezi sekcemi – levá a pravá polovina (pro poloviční sekce).
function SectionDropZone({ index }: { index: number }) {
  const left = useDroppable({ id: `drop-${index}-left` });
  const right = useDroppable({ id: `drop-${index}-right` });
  const baseStyle: React.CSSProperties = {
    minHeight: 28,
    flexShrink: 0,
    borderRadius: 6,
    transition: "background 0.2s ease, border 0.2s ease, min-height 0.2s ease",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    boxSizing: "border-box",
  };
  return (
    <div style={{ width: "100%", display: "flex", gap: 4 }}>
      <div
        ref={left.setNodeRef}
        style={{
          ...baseStyle,
          flex: 1,
          minHeight: left.isOver ? 44 : 28,
          background: left.isOver ? "var(--accent-soft)" : "rgba(0,0,0,0.03)",
          border: left.isOver ? "2px dashed var(--accent)" : "1px dashed var(--border)",
        }}
      >
        {left.isOver && <span style={{ fontSize: 11, fontWeight: 600, color: "var(--accent)" }}>Pustit vlevo</span>}
      </div>
      <div
        ref={right.setNodeRef}
        style={{
          ...baseStyle,
          flex: 1,
          minHeight: right.isOver ? 44 : 28,
          background: right.isOver ? "var(--accent-soft)" : "rgba(0,0,0,0.03)",
          border: right.isOver ? "2px dashed var(--accent)" : "1px dashed var(--border)",
        }}
      >
        {right.isOver && <span style={{ fontSize: 11, fontWeight: 600, color: "var(--accent)" }}>Pustit vpravo</span>}
      </div>
    </div>
  );
}

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
    qrOnPrijemka: false,
    qrOnVydejka: false,
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
      includePhotos: true,
      includeDates: true,
      includeStamp: false,
      includeSignatureOnHandover: true,
      includeSignatureOnPickup: true,
      design: "classic",
      legalText: "Tento dokument slouží jako potvrzení o přijetí zařízení do servisu.",
      sectionOrder: [
        "service",
        "customer",
        "device",
        "diag",
        "dates",
        "custom-5e22a812-48c6-4bc1-9d71-1b01a5a606c4",
        "custom-93a5c7f0-1d7a-490b-8155-506eb2fe7894",
        "custom-a1310d2a-f97e-4957-88d2-98d7be612370",
      ],
      sectionWidths: {
        service: "half",
        customer: "half",
        device: "full",
        repairs: "full",
        warranty: "full",
        diag: "full",
        photos: "half",
        dates: "half",
      },
      sectionStyles: {},
      sectionFields: {
        service: { name: true, ico: true, dic: true, address: true, phone: true, email: true, website: true },
        customer: { name: true, phone: true, email: true, address: true },
        device: { name: true, serial: true, imei: true, state: true, problem: true },
      },
      customBlocks: {
        "5e22a812-48c6-4bc1-9d71-1b01a5a606c4": { type: "signature", content: "Podpis zákazníka při převzetí servisem" },
        "93a5c7f0-1d7a-490b-8155-506eb2fe7894": { type: "signature", content: "Podpis zákazníka při vyzvednutí " },
        "a1310d2a-f97e-4957-88d2-98d7be612370": { type: "signature", content: "Podpis / razítko servisu" },
      },
      signatureLabelHandover: "Podpis při předání zákazníkem",
      signatureLabelPickup: "Podpis při vyzvednutí zákazníkem",
      signatureLabelService: "Podpis / razítko servisu",
      signaturePositionHandover: "left",
      signaturePositionPickup: "center",
      signaturePositionService: "right",
      sectionSide: { service: "right", photos: "right", dates: "left" },
      signaturePositions: {
        "5e22a812-48c6-4bc1-9d71-1b01a5a606c4": { x: 46.56, y: 930.6 },
        "93a5c7f0-1d7a-490b-8155-506eb2fe7894": { x: 289.41, y: 929.26 },
        "a1310d2a-f97e-4957-88d2-98d7be612370": { x: 530.55, y: 927.92 },
      },
      headerTitleFontSize: 18,
      headerTicketCodeFontSize: 20,
    },
    diagnosticProtocol: {
      design: "classic",
      legalText: "Diagnostický protokol obsahuje výsledky diagnostiky.",
      sectionSide: { device: "left" },
      customBlocks: {
        "adca988a-f92e-497d-8910-3d904936ed61": { type: "signature", content: "Razítko / podpis servisu" },
      },
      includeServiceInfo: true,
      includeCustomerInfo: true,
      includeDeviceInfo: true,
      includeDiagnosticText: true,
      includePhotos: true,
      includeDates: true,
      includeStamp: false,
      includeCustomerSignature: false,
      sectionOrder: DEFAULT_SECTION_ORDER.diagnosticProtocol,
      sectionWidths: { service: "half", customer: "full", device: "half", repairs: "full", diag: "full", photos: "half", dates: "half", warranty: "full" },
      sectionStyles: {},
      sectionFields: {
        device: { name: true, serial: true, imei: true, state: true, problem: true },
        service: { name: true, ico: true, dic: true, address: true, phone: true, email: true, website: true },
        customer: { name: true, phone: true, email: true, address: true },
      },
      repairsTableColumns: ["name", "price"],
      signaturePositions: {
        "adca988a-f92e-497d-8910-3d904936ed61": { x: 570.16, y: 954.71 },
      },
    },
    warrantyCertificate: {
      design: "classic",
      legalText: "Záruční list potvrzuje provedené opravy.",
      sectionSide: { device: "left", customer: "left" },
      customBlocks: {
        "5bbd72cc-33a7-405b-a0a3-e726af943779": { type: "signature", content: "Razítko / podpis servisu" },
      },
      includeServiceInfo: true,
      includeCustomerInfo: true,
      includeDeviceInfo: true,
      includeRepairs: true,
      includeWarranty: true,
      warrantyUnifiedDuration: 12,
      warrantyUnifiedUnit: "months",
      warrantyShowEndDate: true,
      warrantyExtraText: "",
      warrantyItems: [],
      includeDates: true,
      includeStamp: false,
      includeCustomerSignature: true,
      sectionOrder: DEFAULT_SECTION_ORDER.warrantyCertificate,
      sectionWidths: { service: "half", customer: "half", device: "half", repairs: "full", diag: "full", photos: "half", dates: "half", warranty: "half" },
      sectionStyles: {},
      sectionFields: {
        device: { name: true, serial: true, imei: true, state: true, problem: true },
        service: { name: true, ico: true, dic: true, address: true, phone: true, email: true, website: true },
        customer: { name: true, phone: true, email: true, address: true },
      },
      sectionVisibility: {},
      repairsTableColumns: ["name", "price"],
      signaturePositions: {
        "5bbd72cc-33a7-405b-a0a3-e726af943779": { x: 574.9, y: 945.44 },
      },
    },
    prijemkaReklamace: {
      design: "classic",
      legalText: "Příjemka reklamace potvrzuje převzetí reklamovaného zboží.",
      customBlocks: {},
      includeDates: true,
      sectionSide: { service: "right" },
      sectionOrder: DEFAULT_SECTION_ORDER.prijemkaReklamace,
      sectionFields: {
        device: { imei: true, name: true, state: true, serial: true, problem: true },
        service: { dic: true, ico: true, name: true, email: true, phone: true, address: true, website: true },
        customer: { name: true, email: true, phone: true, address: true },
      },
      sectionStyles: {},
      sectionWidths: {
        diag: "full",
        dates: "half",
        device: "full",
        photos: "half",
        repairs: "full",
        service: "half",
        customer: "half",
        warranty: "full",
      },
      includeDeviceInfo: true,
      includeServiceInfo: true,
      includeCustomerInfo: true,
    },
    vydejkaReklamace: {
      design: "classic",
      legalText: "Výdejka reklamace potvrzuje vyzvednutí po vyřízení reklamace.",
      customBlocks: {},
      includeDates: true,
      sectionOrder: DEFAULT_SECTION_ORDER.vydejkaReklamace,
      sectionFields: {
        device: { imei: true, name: true, state: true, serial: true, problem: true },
        service: { dic: true, ico: true, name: true, email: true, phone: true, address: true, website: true },
        customer: { name: true, email: true, phone: true, address: true },
      },
      sectionStyles: {},
      sectionWidths: {
        diag: "full",
        dates: "half",
        device: "half",
        photos: "half",
        repairs: "full",
        service: "full",
        customer: "full",
        warranty: "full",
      },
      includeDeviceInfo: true,
      includeServiceInfo: true,
      includeCustomerInfo: true,
      includeRepairs: true,
      sectionSide: { device: "left", dates: "right" },
      repairsTableColumns: ["name", "price"],
    },
  };
}

function getEffectiveSectionStyle(
  sectionKey: string,
  spec: LayoutSpec,
  docConfig?: Record<string, unknown>
): SectionStyle {
  const overrides = docConfig?.sectionStyles as Record<string, string> | undefined;
  const v = overrides?.[sectionKey];
  if (v && (v === "boxed" || v === "ruled" || v === "cards" || v === "underlineTitles" || v === "leftStripe")) return v as SectionStyle;
  return spec.sectionStyle;
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

// Breadcrumbs (Návrh 6) – orientace v aplikaci
function Breadcrumbs({ items }: { items: { label: string; current?: boolean }[] }) {
  return (
    <nav aria-label="Breadcrumb" style={{ marginBottom: 12, fontSize: 13, color: "var(--muted)" }}>
      {items.map((item, i) => (
        <span key={i}>
          {i > 0 && <span style={{ margin: "0 6px", opacity: 0.6 }}>›</span>}
          <span style={{ color: item.current ? "var(--text)" : "var(--muted)", fontWeight: item.current ? 600 : 400 }}>
            {item.label}
          </span>
        </span>
      ))}
    </nav>
  );
}

// Document type picker – horní tab bar (Návrh 5)
function DocumentTypePicker({ value, onChange }: { value: DocTypeKey; onChange: (v: DocTypeKey) => void }) {
  return (
    <div className="doc-type-tabs">
      {(["zakazkovy_list", "zarucni_list", "diagnosticky_protokol", "prijemka_reklamace", "vydejka_reklamace"] as DocTypeKey[]).map((dt) => (
        <button
          key={dt}
          type="button"
          onClick={() => onChange(dt)}
          className={value === dt ? "active" : ""}
        >
          {DOC_TYPE_LABELS[dt]}
        </button>
      ))}
    </div>
  );
}

// Accordion pro skupiny nastavení (Návrh 8)
function Accordion({ title, open, onToggle, children }: { title: string; open: boolean; onToggle: () => void; children: React.ReactNode }) {
  return (
    <div className="accordion-group">
      <button type="button" className="accordion-head" onClick={onToggle} aria-expanded={open}>
        {title}
        <span style={{ fontSize: 18, lineHeight: 1 }}>{open ? "−" : "+"}</span>
      </button>
      {open && <div className="accordion-body">{children}</div>}
    </div>
  );
}

// Render service section content from companyData (from Jobi settings). visibleFields: which fields to show (default all true).
function renderServiceContent(companyData: Record<string, unknown>, visibleFields?: ServiceSectionFields | null) {
  const show = (key: keyof ServiceSectionFields) => visibleFields?.[key] !== false;
  const n = (v: unknown) => (v && String(v).trim() ? String(v) : null);
  const name = n(companyData.name) || n(companyData.abbreviation);
  const ico = n(companyData.ico);
  const dic = n(companyData.dic);
  const address = [n(companyData.addressStreet), n(companyData.addressCity), n(companyData.addressZip)].filter(Boolean).join(", ");
  const phone = n(companyData.phone);
  const email = n(companyData.email);
  const website = n(companyData.website);

  const parts: React.ReactNode[] = [];
  if (show("name") && name) parts.push(<div key="name">{name}</div>);
  if (show("ico") || show("dic")) {
    const icoDic = [show("ico") && ico && `IČO: ${ico}`, show("dic") && dic && `DIČ: ${dic}`].filter(Boolean).join(" • ");
    if (icoDic) parts.push(<div key="ico">{icoDic}</div>);
  }
  if (show("address") && address) parts.push(<div key="addr">{address}</div>);
  if (show("phone") || show("email") || show("website")) {
    const contact = [show("phone") && phone, show("email") && email, show("website") && website].filter(Boolean).join(" • ");
    if (contact) parts.push(<div key="contact">{contact}</div>);
  }
  if (parts.length === 0) {
    return <div style={{ color: "#9ca3af", fontSize: 9 }}>Vyplňte údaje v Jobi → Nastavení → Servis</div>;
  }
  return <>{parts}</>;
}

function renderCustomerContent(companyData: Record<string, unknown>, visibleFields?: CustomerSectionFields | null) {
  const show = (key: keyof CustomerSectionFields) => visibleFields?.[key] !== false;
  const n = (v: unknown) => (v && String(v).trim() ? String(v) : null);
  const name = n(companyData.customer_name) || "Jan Novák";
  const phone = n(companyData.customer_phone) || "+420 123 456 789";
  const email = n(companyData.customer_email) || "jan.novak@email.cz";
  const address = n(companyData.customer_address) || "Havlíčkova 45, 110 00 Praha 1";
  const parts: React.ReactNode[] = [];
  if (show("name")) parts.push(<div key="name">{name}</div>);
  if (show("phone")) parts.push(<div key="phone">{phone}</div>);
  if (show("email")) parts.push(<div key="email">{email}</div>);
  if (show("address")) parts.push(<div key="address">{address}</div>);
  return <>{parts}</>;
}

function renderDeviceContent(companyData: Record<string, unknown>, visibleFields?: DeviceSectionFields | null) {
  const show = (key: keyof DeviceSectionFields) => visibleFields?.[key] !== false;
  const n = (v: unknown) => (v && String(v).trim() ? String(v) : null);
  const name = n(companyData.device_name) || "iPhone 13 Pro, 128 GB";
  const serial = n(companyData.device_serial) || "SN123456789012";
  const imei = n(companyData.device_imei) || "35 123456 789012 3";
  const state = n(companyData.device_state) || "Poškozený displej, prasklina v rohu";
  const problem = n(companyData.device_problem) || "Nefunguje dotyková vrstva v levém dolním rohu";
  const parts: React.ReactNode[] = [];
  if (show("name")) parts.push(<div key="name">{name}</div>);
  if (show("serial")) parts.push(<div key="serial">SN: {serial}</div>);
  if (show("imei")) parts.push(<div key="imei">IMEI: {imei}</div>);
  if (show("state")) parts.push(<div key="state">Stav: {state}</div>);
  if (show("problem")) parts.push(<div key="problem">Problém: {problem}</div>);
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
  previewMode = "sample",
}: {
  sectionKey: string;
  styles: Record<string, unknown>;
  spec: LayoutSpec;
  companyData: Record<string, unknown>;
  docType?: DocTypeKey;
  docConfig?: Record<string, unknown>;
  previewMode?: "sample" | "template";
}) {
  const sample = SAMPLE_DATA[sectionKey];
  if (!sample) return null;
  let content: React.ReactNode = sample.content;
  const sectionFieldsMap = docConfig?.sectionFields as Record<string, Record<string, boolean>> | undefined;

  if (previewMode === "template") {
    const varsList = TEMPLATE_PLACEHOLDERS_BY_SECTION[sectionKey];
    const fieldToIndex = SECTION_FIELD_KEY_TO_VAR_INDEX[sectionKey];
    let placeholders: string[] = [];
    if (varsList && fieldToIndex && sectionFieldsMap?.[sectionKey]) {
      const visible = sectionFieldsMap[sectionKey];
      placeholders = varsList.filter((_, i) => {
        const fieldKey = Object.keys(fieldToIndex).find((k) => fieldToIndex[k] === i);
        return fieldKey == null || visible[fieldKey] !== false;
      });
    } else if (varsList) {
      placeholders = varsList;
    }
    if (sectionKey === "photos") placeholders = []; // zobrazíme text
    content = (
      <>
        {placeholders.length > 0
          ? placeholders.map((v) => (
              <div key={v} style={{ fontFamily: "monospace", fontSize: 10, color: "var(--muted)" }}>
                {"{{" + v + "}}"}
              </div>
            ))
          : sectionKey === "photos"
            ? <div style={{ fontSize: 10, color: "var(--muted)" }}>Fotky z Jobi</div>
            : null}
      </>
    );
  } else if (sectionKey === "service") {
    content = renderServiceContent(companyData, sectionFieldsMap?.service as ServiceSectionFields | undefined);
  } else if (sectionKey === "customer") {
    content = renderCustomerContent(companyData, sectionFieldsMap?.customer as CustomerSectionFields | undefined);
  } else if (sectionKey === "device") {
    content = renderDeviceContent(companyData, sectionFieldsMap?.device as DeviceSectionFields | undefined);
  } else if (sectionKey === "warranty" && docType === "zarucni_list" && docConfig) {
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
  sectionStyleOverride,
  docType,
  docConfig,
  previewMode = "sample",
  onEditClick,
  selectedSectionId,
}: {
  id: string;
  sectionKey: string;
  styles: Record<string, unknown>;
  spec: LayoutSpec;
  companyData: Record<string, unknown>;
  sectionWidth: SectionWidth;
  sectionStyleOverride: SectionStyle;
  docType?: DocTypeKey;
  docConfig?: Record<string, unknown>;
  previewMode?: "sample" | "template";
  onEditClick?: (id: string) => void;
  selectedSectionId?: string | null;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useSortable({ id });
  const sample = SAMPLE_DATA[sectionKey];
  if (!sample) return null;

  const sectionRadius = (sectionStyleOverride === "underlineTitles" ? 0 : ((styles.sectionRadius as number) ?? 6)) as number;
  const sectionPadding = spec.density === "compact" ? 8 : 12;
  const sectionBorder = sectionStyleOverride === "underlineTitles" ? "none" : (styles.sectionBorder as string);
  const sectionBorderLeft = sectionStyleOverride === "leftStripe" ? `3px solid ${styles.secondaryColor}` : undefined;
  const isHalf = sectionWidth === "half";
  const CONTENT_WIDTH = 680;
  const GAP = 12;
  const halfWidth = (CONTENT_WIDTH - GAP) / 2;
  const isSelected = selectedSectionId === id;
  const style: React.CSSProperties = {
    width: "100%",
    flexShrink: 0,
    transform: CSS.Transform.toString(transform),
    transition: isDragging ? "none" : "transform 0.2s ease",
    opacity: isDragging ? 0.4 : 1,
    cursor: "grab",
    touchAction: "none",
    ...(isDragging && { pointerEvents: "none", zIndex: 0 }),
  };
  const cardStyle: React.CSSProperties = {
    padding: sectionPadding,
    background: styles.sectionBg as string,
    borderRadius: sectionRadius,
    border: sectionBorder,
    ...(sectionBorderLeft && { borderLeft: sectionBorderLeft }),
    width: isHalf ? halfWidth : CONTENT_WIDTH,
    maxWidth: "100%",
    boxSizing: "border-box",
    position: "relative",
    ...(isSelected && { outline: "2px solid var(--accent)", outlineOffset: 2 }),
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={(e) => { e.stopPropagation(); onEditClick?.(id); }}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onEditClick?.(id); } }}
      aria-label={`Sekce ${(SAMPLE_DATA[sectionKey] as { label?: string })?.label ?? sectionKey}, kliknutím upravit`}
    >
      <div style={cardStyle}>
        <SectionCardContent sectionKey={sectionKey} styles={styles} spec={spec} companyData={companyData} docType={docType} docConfig={docConfig} previewMode={previewMode} />
      </div>
    </div>
  );
}

// Placeholder in section list so signature blocks keep their order in DnD; real signature is rendered in overlay
function SortableSignaturePlaceholder({ id }: { id: string }) {
  const { setNodeRef } = useSortable({ id });
  return <div ref={setNodeRef} style={{ height: 0, minHeight: 0, overflow: "hidden", margin: 0, padding: 0, border: "none", flex: "0 0 0" }} aria-hidden />;
}

type CustomBlockData = {
  type: "text" | "heading" | "separator" | "spacer" | "signature";
  content?: string;
  /** jen u type "text": zobrazit nadpis (výchozí true) */
  showHeading?: boolean;
  /** jen u type "text": text nadpisu (výchozí "Vlastní text") */
  headingText?: string;
  /** jen u type "text": čára pod nadpisem (výchozí true) */
  showHeadingLine?: boolean;
};

function SortableCustomBlock({
  id,
  styles,
  spec,
  docConfig,
  onEditClick,
  selectedSectionId,
}: {
  id: string;
  styles: Record<string, unknown>;
  spec: LayoutSpec;
  docConfig?: Record<string, unknown>;
  onEditClick?: (id: string) => void;
  selectedSectionId?: string | null;
}) {
  const blockId = id.startsWith("custom-") ? id.slice(7) : id;
  const blocks = (docConfig?.customBlocks as Record<string, CustomBlockData>) || {};
  const block = blocks[blockId];
  const blockType = block?.type || "text";
  const content = (block?.content as string)?.trim() || "";
  const { attributes, listeners, setNodeRef, transform, isDragging } = useSortable({ id });
  const CONTENT_WIDTH = 680;
  const sectionRadius = (spec.sectionStyle === "underlineTitles" ? 0 : ((styles.sectionRadius as number) ?? 6)) as number;
  const sectionPadding = spec.density === "compact" ? 8 : 12;
  const sectionBorder = spec.sectionStyle === "underlineTitles" ? "none" : (styles.sectionBorder as string);
  const titleFontSize = spec.sectionHeaderStyle === "capsule" ? 14 : 13;
  const titleFontWeight = spec.sectionHeaderStyle === "underline" ? 500 : 700;
  const isSelected = selectedSectionId === id;
  const outerStyle: React.CSSProperties = {
    width: "100%",
    flexShrink: 0,
    transform: CSS.Transform.toString(transform),
    transition: isDragging ? "none" : "transform 0.2s ease",
    opacity: isDragging ? 0.4 : 1,
    cursor: "grab",
    touchAction: "none",
    ...(isDragging && { pointerEvents: "none", zIndex: 0 }),
  };
  const cardStyle: React.CSSProperties =
    blockType === "separator"
      ? { padding: "4px 0", width: CONTENT_WIDTH, maxWidth: "100%", boxSizing: "border-box" }
      : blockType === "spacer"
        ? { width: CONTENT_WIDTH, maxWidth: "100%", boxSizing: "border-box", minHeight: Math.max(8, parseInt(content, 10) || 24) }
        : {
            padding: sectionPadding,
            background: styles.sectionBg as string,
            borderRadius: sectionRadius,
            border: sectionBorder,
            width: CONTENT_WIDTH,
            maxWidth: "100%",
            boxSizing: "border-box",
            position: "relative",
            ...(isSelected && { outline: "2px solid var(--accent)", outlineOffset: 2 }),
          };
  const sectionClick = (e: React.MouseEvent) => { e.stopPropagation(); onEditClick?.(id); };
  const sectionKeyDown = (e: React.KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onEditClick?.(id); } };
  if (blockType === "separator") {
    return (
      <div ref={setNodeRef} style={outerStyle} {...attributes} {...listeners} onClick={sectionClick} role="button" tabIndex={0} onKeyDown={sectionKeyDown} aria-label="Oddělovač, kliknutím upravit">
        <div style={cardStyle}>
          <hr style={{ margin: 0, border: "none", borderTop: `1px solid ${styles.sectionBorder as string}` }} />
        </div>
      </div>
    );
  }
  if (blockType === "spacer") {
    return (
      <div ref={setNodeRef} style={outerStyle} {...attributes} {...listeners} onClick={sectionClick} role="button" tabIndex={0} onKeyDown={sectionKeyDown} aria-label="Prázdný řádek, kliknutím upravit">
        <div style={cardStyle} />
      </div>
    );
  }
  if (blockType === "heading") {
    return (
      <div ref={setNodeRef} style={outerStyle} {...attributes} {...listeners} onClick={sectionClick} role="button" tabIndex={0} onKeyDown={sectionKeyDown} aria-label="Vlastní nadpis, kliknutím upravit">
        <div style={cardStyle}>
          <div style={{ fontSize: 16, fontWeight: 700, lineHeight: 1.3, color: (styles.contentColor as string) ?? "#171717" }}>
            {content || <span style={{ color: "var(--muted)", fontWeight: 400 }}>Nadpis</span>}
          </div>
        </div>
      </div>
    );
  }
  if (blockType === "signature") {
    const label = content || "podpis";
    return (
      <div ref={setNodeRef} style={outerStyle} {...attributes} {...listeners} onClick={sectionClick} role="button" tabIndex={0} onKeyDown={sectionKeyDown} aria-label="Řádek na podpis, kliknutím upravit">
        <div style={cardStyle}>
          <div style={{ width: "100%", borderBottom: `1px solid ${styles.contentColor ?? "#171717"}`, marginBottom: 4 }} />
          <div style={{ fontSize: 10, color: (styles.contentColor as string) ?? "#171717" }}>{label}</div>
        </div>
      </div>
    );
  }
  const showHeading = (block?.showHeading as boolean) !== false;
  const headingLabel = (block?.headingText as string)?.trim() || "Vlastní text";
  const showLine = (block?.showHeadingLine as boolean) !== false;
  return (
    <div ref={setNodeRef} style={outerStyle} {...attributes} {...listeners} onClick={sectionClick} role="button" tabIndex={0} onKeyDown={sectionKeyDown} aria-label="Vlastní text, kliknutím upravit">
      <div style={cardStyle}>
        {showHeading && (
          <div
            style={{
              fontSize: titleFontSize,
              fontWeight: titleFontWeight,
              marginBottom: 0,
              paddingBottom: 6,
              ...(showLine && { borderBottom: `1px solid ${styles.secondaryColor as string}` }),
              color: styles.secondaryColor as string,
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <span style={{ opacity: 0.6 }}>⋮⋮</span>
            {headingLabel}
          </div>
        )}
        <div style={{ fontSize: 10, lineHeight: 1.5, color: (styles.contentColor as string) ?? "#171717", whiteSpace: "pre-wrap" }}>
          {content ? <span dangerouslySetInnerHTML={{ __html: sanitizeRichText(content).replace(/\n/g, "<br/>") }} /> : <span style={{ color: "var(--muted)" }}>{"Sem napište text… (můžete použít {{ticket_code}}, {{customer_name}}…)"}</span>}
        </div>
      </div>
    </div>
  );
}

// Document preview - A4, no scroll, scale to fit, draggable sections, draggable QR, logo, stamp
function DocumentPreview({
  docType,
  config,
  companyData,
  onSectionOrderChange,
  onQrPositionChange,
  onLogoPositionChange,
  onStampPositionChange,
  onSignaturePositionChange,
  externalDnd,
  sectionOrder: sectionOrderProp,
  orderedSections: orderedSectionsProp,
  previewMode = "sample",
  selectedSectionId,
  onSectionSelect,
  onLogoSelect,
  onStampSelect,
}: {
  docType: DocTypeKey;
  config: Record<string, unknown>;
  companyData: Record<string, unknown>;
  onSectionOrderChange?: (order: string[]) => void;
  onQrPositionChange?: (pos: { x: number; y: number }) => void;
  onLogoPositionChange?: (pos: { x: number; y: number } | null) => void;
  onStampPositionChange?: (pos: { x: number; y: number } | null) => void;
  onSignaturePositionChange?: (blockId: string, pos: { x: number; y: number } | null) => void;
  onLogoSelect?: () => void;
  onStampSelect?: () => void;
  /** When true, parent provides DndContext; we render drop zones and no internal DndContext */
  externalDnd?: boolean;
  sectionOrder?: string[];
  orderedSections?: string[];
  previewMode?: "sample" | "template";
  selectedSectionId?: string | null;
  onSectionSelect?: (id: string | null) => void;
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
    if (sectionOrderProp !== undefined && Array.isArray(sectionOrderProp)) return sectionOrderProp;
    const order = docConfig?.sectionOrder as string[] | undefined;
    const defaultOrder = DEFAULT_SECTION_ORDER[DOC_TYPE_TO_UI[docType]];
    let list = (order && Array.isArray(order)) ? [...order] : defaultOrder;
    if (docType === "zarucni_list" && !list.includes("warranty")) {
      const idx = list.indexOf("dates");
      if (idx >= 0) list = [...list.slice(0, idx), "warranty", ...list.slice(idx)];
      else list = [...list, "warranty"];
    }
    return list;
  }, [sectionOrderProp, docConfig?.sectionOrder, docType]);

  const sectionKeyToInclude: Record<string, string> = useMemo(
    () => ({
      service: "includeServiceInfo",
      customer: "includeCustomerInfo",
      device: "includeDeviceInfo",
      repairs: "includeRepairs",
      warranty: "includeWarranty",
      diag: docType === "diagnosticky_protokol" ? "includeDiagnosticText" : "includeDiagnostic",
      photos: "includePhotos",
      dates: "includeDates",
    }),
    [docType]
  );

  const orderedSections = useMemo(() => {
    if (orderedSectionsProp !== undefined) return orderedSectionsProp;
    return sectionOrder.filter((key) => {
      if (key.startsWith("custom-")) return true;
      const includeKey = sectionKeyToInclude[key];
      if (!includeKey) return false;
      const val = docConfig?.[includeKey];
      if (key === "warranty" && docType === "zarucni_list" && val === undefined) return true;
      return (val as boolean) !== false;
    });
  }, [orderedSectionsProp, sectionOrder, docConfig, sectionKeyToInclude, docType]);

  const customBlocks = (docConfig?.customBlocks as Record<string, { type?: string; content?: string }>) || {};
  const signatureBlockIds = useMemo(
    () => orderedSections.filter((key) => key.startsWith("custom-") && customBlocks[key.slice(7)]?.type === "signature").map((k) => k.slice(7)),
    [orderedSections, customBlocks]
  );
  const signaturePositions = (docConfig?.signaturePositions as Record<string, { x: number; y: number }>) || {};

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

  const sectionSide = (docConfig?.sectionSide as Record<string, "left" | "right">) || {};

  const sectionRows = useMemo(() => {
    const rows: string[][] = [];
    let i = 0;
    while (i < orderedSections.length) {
      const key = orderedSections[i];
      const isHalf = key.startsWith("custom-") ? false : (sectionWidths[key] === "half");
      if (!isHalf) {
        rows.push([key]);
        i += 1;
      } else {
        const side = sectionSide[key] ?? "left";
        if (i + 1 < orderedSections.length) {
          const nextKey = orderedSections[i + 1];
          const nextHalf = nextKey.startsWith("custom-") ? false : (sectionWidths[nextKey] === "half");
          if (nextHalf) {
            rows.push(side === "left" ? [key, nextKey] : [nextKey, key]);
            i += 2;
          } else {
            rows.push([key]);
            i += 1;
          }
        } else {
          rows.push([key]);
          i += 1;
        }
      }
    }
    return rows;
  }, [orderedSections, sectionWidths, sectionSide]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 10 } }),
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

  const renderSectionItem = (key: string) =>
    key.startsWith("custom-") && customBlocks[key.slice(7)]?.type === "signature" ? (
      <SortableSignaturePlaceholder key={key} id={key} />
    ) : key.startsWith("custom-") ? (
      <SortableCustomBlock key={key} id={key} styles={styles} spec={spec} docConfig={docConfig} onEditClick={onSectionSelect} selectedSectionId={selectedSectionId} />
    ) : (
      <SortableSection
        key={key}
        id={key}
        sectionKey={key}
        styles={styles}
        spec={spec}
        companyData={companyData}
        sectionWidth={sectionWidths[key] ?? "full"}
        sectionStyleOverride={getEffectiveSectionStyle(key, spec, docConfig)}
        docType={docType}
        docConfig={docConfig}
        previewMode={previewMode}
        onEditClick={onSectionSelect}
        selectedSectionId={selectedSectionId}
      />
    );

  const sectionsContent = (
    <SortableContext items={orderedSections} strategy={verticalListSortingStrategy}>
      <div style={{ flex: 1, minHeight: 0, marginBottom: 12, display: "flex", flexDirection: "column", gap: 10, width: "100%", color: (styles as { contentColor?: string }).contentColor ?? "#171717" }}>
        <SectionDropZone index={0} />
        {sectionRows.map((row, rowIdx) => {
          const dropIndexAfter = sectionRows.slice(0, rowIdx + 1).reduce((s, r) => s + r.length, 0);
          return (
            <React.Fragment key={rowIdx}>
              <div style={{ display: "flex", gap: 10, width: "100%", alignItems: "flex-start" }}>
                {row.length === 1 ? (
                  (() => {
                    const key = row[0];
                    const isHalf = !key.startsWith("custom-") && sectionWidths[key] === "half";
                    const side = sectionSide[key] ?? "left";
                    if (isHalf) {
                      return (
                        <div key={key} style={{ flex: 1, display: "flex", justifyContent: side === "right" ? "flex-end" : "flex-start" }}>
                          {renderSectionItem(key)}
                        </div>
                      );
                    }
                    return <React.Fragment key={key}>{renderSectionItem(key)}</React.Fragment>;
                  })()
                ) : (
                  row.map((key) => (
                    <div key={key} style={{ flex: 1, minWidth: 0 }}>
                      {renderSectionItem(key)}
                    </div>
                  ))
                )}
              </div>
              <SectionDropZone index={dropIndexAfter} />
            </React.Fragment>
          );
        })}
      </div>
    </SortableContext>
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
        : docType === "zarucni_list"
          ? (config.qrOnWarranty as boolean) !== false
          : docType === "prijemka_reklamace"
            ? (config.qrOnPrijemka as boolean) === true
            : docType === "vydejka_reklamace"
              ? (config.qrOnVydejka as boolean) === true
              : false);
  const containerRef = useRef<HTMLDivElement>(null);
  const documentRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.5);
  const qrPosition = useMemo(() => {
    const p = config.qrPosition as { x: number; y: number } | undefined;
    return p && typeof p.x === "number" && typeof p.y === "number" ? p : { x: 620, y: 15 };
  }, [config.qrPosition]);
  const logoPosition = useMemo(() => {
    const p = config.logoPosition as { x: number; y: number } | undefined;
    return p && typeof p.x === "number" && typeof p.y === "number" ? p : null;
  }, [config.logoPosition]);
  const stampPosition = useMemo(() => {
    const p = config.stampPosition as { x: number; y: number } | undefined;
    return p && typeof p.x === "number" && typeof p.y === "number" ? p : null;
  }, [config.stampPosition]);
  const stampSize = ((config.stampSize as number) ?? 100) / 100;
  const LOGO_W = 120 * logoSize;
  const LOGO_H = 50 * logoSize;
  const STAMP_W = Math.round(70 * stampSize);
  const STAMP_H = Math.round(35 * stampSize);
  const SIGNATURE_LINE_W = 100;
  const SIGNATURE_LINE_H = 28;
  const [isQrDragging, setIsQrDragging] = useState(false);
  const [qrDragPosition, setQrDragPosition] = useState<{ x: number; y: number } | null>(null);
  const qrDragStartRef = useRef<{ clientX: number; clientY: number; x: number; y: number } | null>(null);
  const qrDragCurrentRef = useRef<{ x: number; y: number } | null>(null);
  const [isLogoDragging, setIsLogoDragging] = useState(false);
  const [logoDragPosition, setLogoDragPosition] = useState<{ x: number; y: number } | null>(null);
  const logoDragStartRef = useRef<{ clientX: number; clientY: number; x: number; y: number } | null>(null);
  const logoDragCurrentRef = useRef<{ x: number; y: number } | null>(null);
  const [isStampDragging, setIsStampDragging] = useState(false);
  const [stampDragPosition, setStampDragPosition] = useState<{ x: number; y: number } | null>(null);
  const stampDragStartRef = useRef<{ clientX: number; clientY: number; x: number; y: number } | null>(null);
  const stampDragCurrentRef = useRef<{ x: number; y: number } | null>(null);
  const [signatureDraggingBlockId, setSignatureDraggingBlockId] = useState<string | null>(null);
  const [signatureDragState, setSignatureDragState] = useState<{ blockId: string; x: number; y: number } | null>(null);
  const signatureDragStartRef = useRef<{ clientX: number; clientY: number; x: number; y: number; blockId: string } | null>(null);
  const signatureDragCurrentRef = useRef<{ x: number; y: number } | null>(null);
  const logoDidDragRef = useRef(false);
  const stampDidDragRef = useRef(false);
  const DRAG_THRESHOLD_PX = 4;

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
      const lastPos = qrDragCurrentRef.current;
      const startPos = qrDragStartRef.current;
      const final = lastPos ?? (startPos ? { x: startPos.x, y: startPos.y } : qrPosition);
      if (onQrPositionChange) onQrPositionChange(final);
      qrDragStartRef.current = null;
      qrDragCurrentRef.current = null;
      setQrDragPosition(final);
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
    if (!isLogoDragging) return;
    const onMove = (e: MouseEvent) => {
      const start = logoDragStartRef.current;
      if (!start || !documentRef.current) return;
      const rect = documentRef.current.getBoundingClientRect();
      const scaleX = 794 / rect.width;
      const scaleY = 1123 / rect.height;
      const dx = (e.clientX - start.clientX) * scaleX;
      const dy = (e.clientY - start.clientY) * scaleY;
      const newX = Math.max(0, Math.min(794 - LOGO_W, start.x + dx));
      const newY = Math.max(0, Math.min(1123 - LOGO_H, start.y + dy));
      const pos = { x: newX, y: newY };
      logoDragCurrentRef.current = pos;
      setLogoDragPosition(pos);
    };
    const onUp = () => {
      const lastPos = logoDragCurrentRef.current;
      const startPos = logoDragStartRef.current;
      if (startPos && lastPos && (Math.abs(lastPos.x - startPos.x) > DRAG_THRESHOLD_PX || Math.abs(lastPos.y - startPos.y) > DRAG_THRESHOLD_PX)) {
        logoDidDragRef.current = true;
      }
      const final = lastPos ?? (startPos ? { x: startPos.x, y: startPos.y } : { x: 0, y: 28 });
      if (onLogoPositionChange) onLogoPositionChange(final);
      logoDragStartRef.current = null;
      logoDragCurrentRef.current = null;
      setLogoDragPosition(final);
      setIsLogoDragging(false);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [isLogoDragging, onLogoPositionChange, LOGO_W, LOGO_H]);

  useEffect(() => {
    if (!isStampDragging) return;
    const onMove = (e: MouseEvent) => {
      const start = stampDragStartRef.current;
      if (!start || !documentRef.current) return;
      const rect = documentRef.current.getBoundingClientRect();
      const scaleX = 794 / rect.width;
      const scaleY = 1123 / rect.height;
      const dx = (e.clientX - start.clientX) * scaleX;
      const dy = (e.clientY - start.clientY) * scaleY;
      const newX = Math.max(0, Math.min(794 - STAMP_W, start.x + dx));
      const newY = Math.max(0, Math.min(1123 - STAMP_H, start.y + dy));
      const pos = { x: newX, y: newY };
      stampDragCurrentRef.current = pos;
      setStampDragPosition(pos);
    };
    const onUp = () => {
      const lastPos = stampDragCurrentRef.current;
      const startPos = stampDragStartRef.current;
      if (startPos && lastPos && (Math.abs(lastPos.x - startPos.x) > DRAG_THRESHOLD_PX || Math.abs(lastPos.y - startPos.y) > DRAG_THRESHOLD_PX)) {
        stampDidDragRef.current = true;
      }
      const final = lastPos ?? (startPos ? { x: startPos.x, y: startPos.y } : { x: 362, y: 1050 });
      if (onStampPositionChange) onStampPositionChange(final);
      stampDragStartRef.current = null;
      stampDragCurrentRef.current = null;
      setStampDragPosition(final);
      setIsStampDragging(false);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [isStampDragging, onStampPositionChange, STAMP_W, STAMP_H]);

  useEffect(() => {
    if (!signatureDraggingBlockId) return;
    const start = signatureDragStartRef.current;
    if (!start || start.blockId !== signatureDraggingBlockId) return;
    const onMove = (e: MouseEvent) => {
      if (!documentRef.current) return;
      const rect = documentRef.current.getBoundingClientRect();
      const scaleX = 794 / rect.width;
      const scaleY = 1123 / rect.height;
      const dx = (e.clientX - start.clientX) * scaleX;
      const dy = (e.clientY - start.clientY) * scaleY;
      const newX = Math.max(0, Math.min(794 - SIGNATURE_LINE_W, start.x + dx));
      const newY = Math.max(0, Math.min(1123 - SIGNATURE_LINE_H, start.y + dy));
      const pos = { x: newX, y: newY };
      signatureDragCurrentRef.current = pos;
      setSignatureDragState((prev) => (prev ? { ...prev, x: newX, y: newY } : null));
    };
    const onUp = () => {
      const lastPos = signatureDragCurrentRef.current;
      const startPos = signatureDragStartRef.current;
      const blockId = startPos?.blockId ?? signatureDraggingBlockId;
      const final = lastPos ?? (startPos ? { x: startPos.x, y: startPos.y } : signaturePositions[blockId] ?? { x: 50, y: 500 });
      if (onSignaturePositionChange) onSignaturePositionChange(blockId, final);
      signatureDragStartRef.current = null;
      signatureDragCurrentRef.current = null;
      setSignatureDraggingBlockId(null);
      setSignatureDragState(null);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [signatureDraggingBlockId, onSignaturePositionChange, signaturePositions, SIGNATURE_LINE_W, SIGNATURE_LINE_H]);

  const TOL = 2;
  useEffect(() => {
    if (!qrDragPosition) return;
    const want = config.qrPosition as { x: number; y: number } | undefined;
    if (want && typeof want.x === "number" && typeof want.y === "number" && Math.abs(want.x - qrDragPosition.x) <= TOL && Math.abs(want.y - qrDragPosition.y) <= TOL) {
      setQrDragPosition(null);
    }
  }, [config.qrPosition, qrDragPosition]);

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
        maxHeight: "calc(100vh - 120px)",
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
          outline: "2px solid rgba(0,0,0,0.12)",
          outlineOffset: -2,
          fontSize: 10,
          lineHeight: 1.4,
          color: (styles as { contentColor?: string }).contentColor ?? "#171717",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* Header: Logo left, Doc title + Service name centered on full page */}
        {(() => {
          const headerRadius = (docConfig?.headerBorderRadius as number) ?? (spec.headerLayout === "splitBox" ? 8 : 0);
          const titleFontSize = (docConfig?.headerTitleFontSize as number) ?? 14;
          const ticketCodeFontSize = (docConfig?.headerTicketCodeFontSize as number) ?? 18;
          const subtitleFontSize = (docConfig?.headerSubtitleFontSize as number) ?? (spec.headerLayout === "splitBox" ? 16 : 14);
          const subtitleWeight = spec.headerLayout === "splitBox" ? 800 : 700;
          return (
        <div
          style={{
            position: "relative",
            minHeight: 50,
            marginBottom: 12,
            paddingBottom: 10,
            borderBottom: (styles as { headerBorder?: string }).headerBorder ?? `${styles.borderWidth}px solid ${styles.borderColor}`,
            background: styles.headerBg !== "transparent" ? styles.headerBg : undefined,
            padding: styles.headerBg !== "transparent" ? "8px 12px 10px 0" : undefined,
            borderRadius: headerRadius,
            ...(spec.headerLayout === "splitBox" && styles.accentColor && { borderLeft: `6px solid ${styles.accentColor as string}` }),
          }}
        >
          {hasLogo && !logoPosition && !isLogoDragging && (
            <div
              role="button"
              tabIndex={0}
              title="Kliknutím upravíte, tažením přesunete logo"
              onMouseDown={(e) => {
                if (e.button !== 0 || !onLogoPositionChange) return;
                e.preventDefault();
                logoDidDragRef.current = false;
                logoDragStartRef.current = { clientX: e.clientX, clientY: e.clientY, x: 0, y: 28 };
                setLogoDragPosition({ x: 0, y: 28 });
                setIsLogoDragging(true);
              }}
              onClick={(e) => { e.stopPropagation(); if (!logoDidDragRef.current) onLogoSelect?.(); logoDidDragRef.current = false; }}
              style={{ position: "absolute", left: 0, top: "50%", transform: "translateY(-50%)", cursor: "grab", userSelect: "none" }}
            >
              <img src={config.logoUrl as string} alt="Logo" style={{ maxWidth: LOGO_W, maxHeight: LOGO_H, objectFit: "contain", pointerEvents: "none" }} draggable={false} />
            </div>
          )}
          {!hasLogo && !logoPosition && (
            <div
              role="button"
              tabIndex={0}
              title="Kliknutím nahrajete logo"
              onClick={(e) => { e.stopPropagation(); onLogoSelect?.(); }}
              style={{ position: "absolute", left: 0, top: "50%", transform: "translateY(-50%)", width: LOGO_W, height: LOGO_H, background: "#f3f4f6", borderRadius: 4, display: "flex", alignItems: "center", justifyContent: "center", color: "#9ca3af", fontSize: 9, cursor: "pointer" }}
            >
              Logo
            </div>
          )}
          <div style={{ position: "absolute", left: "50%", top: "50%", transform: "translate(-50%, -50%)", textAlign: "center", display: "flex", flexDirection: "column", gap: 2 }}>
            {(docType === "zakazkovy_list" || docType === "prijemka_reklamace" || docType === "vydejka_reklamace") ? (
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "center", gap: 10, flexWrap: "wrap" }}>
                <span style={{ color: styles.headerText, fontWeight: 700, fontSize: titleFontSize }}>{DOC_TYPE_LABELS[docType]}</span>
                <span style={{ color: styles.headerText, fontWeight: 800, fontSize: ticketCodeFontSize, letterSpacing: "0.05em" }}>
                  {docType === "zakazkovy_list" ? "DEMO-001" : "R-2025-001"}
                </span>
              </div>
            ) : (
              <div style={{ color: styles.headerText, fontWeight: 700, fontSize: titleFontSize }}>
                {DOC_TYPE_LABELS[docType]}
              </div>
            )}
            <div style={{ color: styles.headerText, fontWeight: subtitleWeight, fontSize: subtitleFontSize }}>
              {String(companyData?.name ?? "Název servisu")}
            </div>
          </div>
          {(hasLogo && (logoPosition || isLogoDragging)) && (
            <div
              role="button"
              tabIndex={0}
              title="Kliknutím upravíte, tažením přesunete logo"
              onMouseDown={(e) => {
                if (e.button !== 0 || !onLogoPositionChange) return;
                e.preventDefault();
                logoDidDragRef.current = false;
                const pos = logoDragPosition ?? logoPosition ?? { x: 0, y: 28 };
                logoDragStartRef.current = { clientX: e.clientX, clientY: e.clientY, x: pos.x, y: pos.y };
                setIsLogoDragging(true);
              }}
              onClick={(e) => { e.stopPropagation(); if (!logoDidDragRef.current) onLogoSelect?.(); logoDidDragRef.current = false; }}
              style={{
                position: "absolute",
                left: (logoDragPosition ?? logoPosition ?? { x: 0, y: 28 }).x,
                top: (logoDragPosition ?? logoPosition ?? { x: 0, y: 28 }).y,
                cursor: isLogoDragging ? "grabbing" : "grab",
                userSelect: "none",
                zIndex: 10,
              }}
            >
              <img src={config.logoUrl as string} alt="Logo" style={{ maxWidth: LOGO_W, maxHeight: LOGO_H, objectFit: "contain", pointerEvents: "none" }} draggable={false} />
            </div>
          )}
          {(config.stampUrl || (docConfig?.includeStamp as boolean) === true) && (
            <div
              role="button"
              tabIndex={0}
              title="Kliknutím upravíte, tažením přesunete razítko"
              onMouseDown={(e) => {
                if (e.button !== 0 || !onStampPositionChange) return;
                e.preventDefault();
                stampDidDragRef.current = false;
                const defaultPos = { x: 362, y: 1050 };
                const pos = stampDragPosition ?? stampPosition ?? defaultPos;
                stampDragStartRef.current = { clientX: e.clientX, clientY: e.clientY, x: pos.x, y: pos.y };
                setIsStampDragging(true);
              }}
              onClick={(e) => { e.stopPropagation(); if (!stampDidDragRef.current) onStampSelect?.(); stampDidDragRef.current = false; }}
              style={{
                position: "absolute",
                left: (stampDragPosition ?? stampPosition ?? { x: 362, y: 1050 }).x,
                top: (stampDragPosition ?? stampPosition ?? { x: 362, y: 1050 }).y,
                cursor: isStampDragging ? "grabbing" : "grab",
                userSelect: "none",
                zIndex: 10,
              }}
            >
              {config.stampUrl ? <img src={config.stampUrl as string} alt="Razítko" style={{ maxWidth: STAMP_W, maxHeight: STAMP_H, objectFit: "contain", pointerEvents: "none" }} draggable={false} /> : <div style={{ width: STAMP_W, height: STAMP_H, background: "#f3f4f6", borderRadius: 4, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 8, color: "#9ca3af" }}>Razítko</div>}
            </div>
          )}
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
          {signatureBlockIds.map((blockId, idx) => {
            const pos = signatureDragState?.blockId === blockId ? signatureDragState : (signaturePositions[blockId] ?? { x: 50, y: 500 + idx * 40 });
            const label = (customBlocks[blockId]?.content as string)?.trim() || "podpis";
            const isDragging = signatureDraggingBlockId === blockId;
            return (
              <div
                key={blockId}
                role="button"
                tabIndex={0}
                title="Tažením přesunete řádek na podpis"
                onMouseDown={(e) => {
                  if (e.button !== 0 || !onSignaturePositionChange) return;
                  e.preventDefault();
                  const cur = signaturePositions[blockId] ?? { x: 50, y: 500 + idx * 40 };
                  signatureDragStartRef.current = { clientX: e.clientX, clientY: e.clientY, x: cur.x, y: cur.y, blockId };
                  setSignatureDraggingBlockId(blockId);
                  setSignatureDragState({ blockId, x: cur.x, y: cur.y });
                }}
                onClick={(e) => { e.stopPropagation(); onSectionSelect?.(`custom-${blockId}`); }}
                style={{
                  position: "absolute",
                  left: pos.x,
                  top: pos.y,
                  width: SIGNATURE_LINE_W,
                  cursor: isDragging ? "grabbing" : "grab",
                  userSelect: "none",
                  zIndex: 10,
                }}
              >
                <div style={{ width: "100%", borderBottom: `1px solid ${(styles.contentColor as string) ?? "#171717"}`, marginBottom: 2 }} />
                <div style={{ fontSize: 9, color: (styles.contentColor as string) ?? "#171717" }}>{label}</div>
              </div>
            );
          })}
        </div>
          );
        })()}

        {/* Sortable sections + drop zones (for palette); DndContext from parent when externalDnd */}
        {externalDnd ? sectionsContent : (
          <DndContext sensors={sensors} collisionDetection={pointerWithin} onDragEnd={handleDragEnd}>
            {sectionsContent}
          </DndContext>
        )}

        {/* Legal text */}
        {legalText && (
          <div style={{ marginTop: 12, padding: 10, background: styles.sectionBg, borderRadius: spec.sectionStyle === "underlineTitles" ? 0 : ((styles.sectionRadius as number) ?? 6), fontSize: 9, color: (styles.contentColor as string) ?? "#171717", border: `1px solid ${styles.borderColor}` }}>
            {legalText}
          </div>
        )}

      </div>
    </div>
  );
}

function JobiDocsUpdateCard({
  updateState,
  updateError,
  updateChecking,
  updateDownloading,
  onCheck,
  onDownload,
  onRestart,
}: {
  updateState: { version: string; downloaded: boolean; progress: number } | null;
  updateError: string | null;
  updateChecking: boolean;
  updateDownloading: boolean;
  onCheck: () => Promise<void>;
  onDownload: () => Promise<void>;
  onRestart: () => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {updateError && (
        <div style={{ fontSize: 13, color: "var(--error)" }}>
          Kontrola aktualizací selhala: {updateError}
        </div>
      )}
      {!updateState && !updateChecking && !updateError && (
        <div style={{ fontSize: 13, color: "var(--muted)" }}>
          Aktuálně nemáte k dispozici žádnou novou verzi. Kontrola probíhá automaticky.
        </div>
      )}
      {updateChecking && <div style={{ fontSize: 13, color: "var(--muted)" }}>Kontroluji aktualizace…</div>}
      {updateState && !updateState.downloaded && (
        <>
          <div style={{ fontSize: 13, color: "var(--text)" }}>
            K dispozici je nová verze <strong>{updateState.version}</strong>
          </div>
          {!updateDownloading && updateState.progress === 0 ? (
            <button
              type="button"
              onClick={onDownload}
              style={{
                padding: "10px 20px",
                background: "var(--accent)",
                color: "white",
                border: "none",
                borderRadius: "var(--radius-md)",
                cursor: "pointer",
                fontWeight: 600,
                fontSize: 14,
                alignSelf: "flex-start",
              }}
            >
              Nainstalovat
            </button>
          ) : (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <div
                  style={{
                    flex: 1,
                    height: 8,
                    background: "var(--panel-2)",
                    borderRadius: 4,
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      width: `${updateState.progress}%`,
                      height: "100%",
                      background: "var(--accent)",
                      borderRadius: 4,
                      transition: "width 0.2s ease",
                    }}
                  />
                </div>
                <span style={{ fontSize: 12, color: "var(--muted)", minWidth: 36 }}>{Math.round(updateState.progress)}%</span>
              </div>
              <div style={{ fontSize: 13, color: "var(--muted)" }}>Stahuji…</div>
            </>
          )}
        </>
      )}
      {updateState?.downloaded && (
        <button
          type="button"
          onClick={onRestart}
          style={{
            padding: "10px 20px",
            background: "var(--accent)",
            color: "white",
            border: "none",
            borderRadius: "var(--radius-md)",
            cursor: "pointer",
            fontWeight: 600,
            fontSize: 14,
            alignSelf: "flex-start",
          }}
        >
          Restartovat a nainstalovat
        </button>
      )}
      <button
        type="button"
        onClick={onCheck}
        disabled={updateChecking}
        style={{
          padding: "8px 14px",
          background: "var(--panel-2)",
          color: "var(--text)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-md)",
          cursor: updateChecking ? "not-allowed" : "pointer",
          fontSize: 12,
          alignSelf: "flex-start",
        }}
      >
        {updateChecking ? "Kontroluji…" : "Zkontrolovat aktualizace"}
      </button>
    </div>
  );
}

// Tab key and sidebar navigation (kap. 3 – levý sidebar s ikonami)
type TabKey = "aktivity" | "tiskarna" | "dokumenty" | "o_aplikaci";

const SIDEBAR_TABS: { key: TabKey; label: string; icon: React.ReactNode }[] = [
  { key: "dokumenty", label: "Dokumenty", icon: <DocIcon /> },
  { key: "tiskarna", label: "Nastavení", icon: <PrinterIcon /> },
  { key: "aktivity", label: "Aktivity", icon: <ActivityIcon /> },
  { key: "o_aplikaci", label: "O aplikaci", icon: <InfoIcon /> },
];

function DocIcon() {
  return (
    <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
      <polyline points="10 9 9 9 8 9" />
    </svg>
  );
}
function PrinterIcon() {
  return (
    <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="6 9 6 2 18 2 18 9" />
      <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
      <rect x="6" y="14" width="12" height="8" />
    </svg>
  );
}
function ActivityIcon() {
  return (
    <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
    </svg>
  );
}
function InfoIcon() {
  return (
    <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="16" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
  );
}

function SidebarNav({ active, onChange, updateBadge, compact }: { active: TabKey; onChange: (t: TabKey) => void; updateBadge?: boolean; compact?: boolean }) {
  return (
    <nav style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1 }}>
      {SIDEBAR_TABS.map((t) => {
        const isActive = active === t.key;
        return (
          <button
            key={t.key}
            type="button"
            onClick={() => onChange(t.key)}
            className={`app-sidebar-nav-item ${isActive ? "active" : ""} ${compact ? "compact" : ""}`}
            title={t.label}
          >
            <span className="icon">{t.icon}</span>
            {!compact && <span style={{ flex: 1 }}>{t.label}</span>}
            {!compact && t.key === "o_aplikaci" && updateBadge && (
              <span style={{ width: 8, height: 8, borderRadius: 4, background: "#dc2626", flexShrink: 0 }} title="Dostupná aktualizace" />
            )}
            {compact && t.key === "o_aplikaci" && updateBadge && (
              <span style={{ position: "absolute", top: 6, right: 6, width: 6, height: 6, borderRadius: 3, background: "#dc2626" }} title="Dostupná aktualizace" />
            )}
          </button>
        );
      })}
    </nav>
  );
}

export default function App() {
  const [tab, setTab] = useState<TabKey>("dokumenty");
  const [updateState, setUpdateState] = useState<{ version: string; downloaded: boolean; progress: number } | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [updateChecking, setUpdateChecking] = useState(false);
  const [updateDownloading, setUpdateDownloading] = useState(false);
  const [health, setHealth] = useState<{ ok?: boolean } | null>(null);
  const [printers, setPrinters] = useState<Printer[]>([]);
  const [activities, setActivities] = useState<ActivityEntry[]>([]);
  const [activityFilterStatus, setActivityFilterStatus] = useState<"all" | "errors">("all");
  const [activityFilterTime, setActivityFilterTime] = useState<"all" | "24h">("all");
  const [context, setContext] = useState<{
    services: ServiceEntry[];
    activeServiceId: string | null;
    documentsConfig?: Record<string, unknown> | null;
    companyData?: Record<string, unknown> | null;
    jobidocsLogo?: { background: string; jInner: string; foreground: string } | null;
    /** Má uživatel oprávnění měnit nastavení dokumentů (z Jobi). Když false, customizace jen pro čtení. */
    canManageDocuments?: boolean;
  }>({ services: [], activeServiceId: null, canManageDocuments: true });
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
  const [configUpdatedAt, setConfigUpdatedAt] = useState<string | null>(null);
  const [documentsDragActiveId, setDocumentsDragActiveId] = useState<string | null>(null);
  const [selectedPreviewSectionId, setSelectedPreviewSectionId] = useState<string | null>(null);
  const [selectedAsset, setSelectedAsset] = useState<"logo" | "stamp" | null>(null);
  const [previewMode, setPreviewMode] = useState<"sample" | "template">("sample");
  const [accordionOpen, setAccordionOpen] = useState<Record<string, boolean>>({
    logo: true, design: true, qr: true, sections: true, signatures: true, warranty: true, legal: true,
  });
  const toggleAccordion = (key: string) => setAccordionOpen((prev) => ({ ...prev, [key]: !prev[key] }));
  const [warrantyDurationInput, setWarrantyDurationInput] = useState<string | null>(null);
  const fileInputLogo = useRef<HTMLInputElement>(null);
  const fileInputStamp = useRef<HTMLInputElement>(null);
  const fileInputLetterhead = useRef<HTMLInputElement>(null);
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
  const lastSavedConfigRef = useRef<Record<string, unknown> | null>(null);
  const [pendingNav, setPendingNav] = useState<{ type: "tab"; key: TabKey } | { type: "docType"; key: DocTypeKey } | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [showWizardBanner, setShowWizardBanner] = useState(() => typeof window !== "undefined" && !localStorage.getItem(WIZARD_STORAGE_KEY));
  const [showWizardModal, setShowWizardModal] = useState(false);
  const [wizardStep, setWizardStep] = useState(1);
  const [isNarrow, setIsNarrow] = useState(() => typeof window !== "undefined" && window.matchMedia("(max-width: 768px)").matches);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 768px)");
    const onChange = () => setIsNarrow(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const hasUnsavedConfigChanges =
    tab === "dokumenty" &&
    serviceId &&
    lastSavedConfigRef.current != null &&
    JSON.stringify(config) !== JSON.stringify(lastSavedConfigRef.current);

  const applyPendingNav = useCallback(() => {
    if (!pendingNav) return;
    if (pendingNav.type === "tab") {
      setTab(pendingNav.key);
      if (isNarrow) setSidebarOpen(false);
    } else setDocType(pendingNav.key);
    setPendingNav(null);
  }, [pendingNav, isNarrow]);

  const requestTabChange = useCallback(
    (t: TabKey) => {
      if (hasUnsavedConfigChanges) setPendingNav({ type: "tab", key: t });
      else {
        setTab(t);
        if (isNarrow) setSidebarOpen(false);
      }
    },
    [hasUnsavedConfigChanges, isNarrow]
  );

  const requestDocTypeChange = useCallback(
    (dt: DocTypeKey) => {
      if (hasUnsavedConfigChanges) setPendingNav({ type: "docType", key: dt });
      else setDocType(dt);
    },
    [hasUnsavedConfigChanges]
  );

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
        canManageDocuments: d.canManageDocuments !== false,
      });
      // Nepřepisujeme config z kontextu – uživatelské změny (viditelné sekce, šířky) by se jinak každé 2 s ztratily.
      // Config se načítá jen z fetchDocumentsConfig při výběru servisu.
    } catch {
      setContext({ services: [], activeServiceId: null, jobidocsLogo: null, canManageDocuments: true });
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

  const filteredActivities = useMemo(() => {
    let list = activities;
    if (activityFilterStatus === "errors") list = list.filter((a) => a.status === "error");
    if (activityFilterTime === "24h") {
      const since = Date.now() - 24 * 60 * 60 * 1000;
      list = list.filter((a) => new Date(a.ts).getTime() >= since);
    }
    return list;
  }, [activities, activityFilterStatus, activityFilterTime]);

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
    setConfigUpdatedAt(null);
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
        const merged = { ...defaultDocumentsConfig(), ...raw };
        lastSavedConfigRef.current = JSON.parse(JSON.stringify(merged));
        setConfig(merged);
        setConfigUpdatedAt(typeof d.updated_at === "string" ? d.updated_at : null);
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

  useEffect(() => {
    const upd = window.electron?.update;
    if (!upd) return;
    upd.getState().then(setUpdateState);
    upd.getError?.().then((err) => setUpdateError(err ?? null));
    const unsubState = upd.onState(setUpdateState);
    const unsubError = upd.onError?.(setUpdateError);
    return () => {
      unsubState();
      unsubError?.();
    };
  }, []);

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
      const res = await r.json();
      lastSavedConfigRef.current = JSON.parse(JSON.stringify(config));
      if (typeof res.updated_at === "string") setConfigUpdatedAt(res.updated_at);
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
      const html = generateDocumentHtml(config, docType, context.companyData || {}, undefined, {
        variables: getSampleVariablesForPreview(context.companyData || {}),
        templateMode: previewMode === "template",
      });
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 60000);
      const r = await fetch(`${API_BASE}/v1/render`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          html,
          letterhead_pdf_url: (config.letterheadPdfUrl as string) || undefined,
        }),
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
  }, [config, docType, context.companyData, previewMode]);

  const handlePrintToQueue = useCallback(async () => {
    setPrintToQueueError(null);
    setPrintToQueueLoading(true);
    try {
      const html = generateDocumentHtml(config, docType, context.companyData || {}, undefined, { variables: getSampleVariablesForPreview(context.companyData || {}) });
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
      const html = generateDocumentHtml(config, docType, context.companyData || {}, undefined, { variables: getSampleVariablesForPreview(context.companyData || {}) });
      const r = await fetch(`${API_BASE}/v1/export`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          html,
          target_path: path,
          letterhead_pdf_url: (config.letterheadPdfUrl as string) || undefined,
        }),
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

  const handleFileLetterhead = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => setConfig((prev) => ({ ...prev, letterheadPdfUrl: reader.result as string }));
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
        : docType === "prijemka_reklamace"
          ? [
              { key: "includeServiceInfo", label: "Údaje o servisu" },
              { key: "includeCustomerInfo", label: "Údaje o zákazníkovi" },
              { key: "includeDeviceInfo", label: "Údaje o zařízení" },
              { key: "includeDates", label: "Data" },
            ]
          : docType === "vydejka_reklamace"
            ? [
                { key: "includeServiceInfo", label: "Údaje o servisu" },
                { key: "includeCustomerInfo", label: "Údaje o zákazníkovi" },
                { key: "includeDeviceInfo", label: "Údaje o zařízení" },
                { key: "includeRepairs", label: "Provedené opravy" },
                { key: "includeDates", label: "Data" },
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

  const documentsSectionOrder = useMemo(() => {
    const order = docConfig?.sectionOrder as string[] | undefined;
    const defaultOrder = DEFAULT_SECTION_ORDER[DOC_TYPE_TO_UI[docType]];
    let list = (order && Array.isArray(order)) ? [...order] : defaultOrder;
    if (docType === "zarucni_list" && !list.includes("warranty")) {
      const idx = list.indexOf("dates");
      if (idx >= 0) list = [...list.slice(0, idx), "warranty", ...list.slice(idx)];
      else list = [...list, "warranty"];
    }
    return list;
  }, [docConfig?.sectionOrder, docType]);

  const sectionKeyToIncludeDoc = SECTION_KEY_TO_INCLUDE_BY_DOC[docType];
  const documentsOrderedSections = useMemo(() => {
    return documentsSectionOrder.filter((key) => {
      if (key.startsWith("custom-")) return true;
      const includeKey = sectionKeyToIncludeDoc[key];
      if (!includeKey) return false;
      const val = docConfig?.[includeKey];
      if (key === "warranty" && docType === "zarucni_list" && val === undefined) return true;
      return (val as boolean) !== false;
    });
  }, [documentsSectionOrder, docConfig, sectionKeyToIncludeDoc, docType]);

  const documentsSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 10 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const handleSectionAdd = useCallback(
    (sectionKey: string, index: number) => {
      const includeKey = sectionKeyToIncludeDoc[sectionKey];
      if (!includeKey) return;
      updateDocConfig([includeKey], true);
      let fullOrder = [...documentsSectionOrder];
      if (!fullOrder.includes(sectionKey)) {
        fullOrder.splice(index, 0, sectionKey);
      } else {
        fullOrder = fullOrder.filter((k) => k !== sectionKey);
        fullOrder.splice(index, 0, sectionKey);
      }
      updateDocConfig(["sectionOrder"], fullOrder);
    },
    [docType, documentsSectionOrder, sectionKeyToIncludeDoc, updateDocConfig]
  );

  const handleDocumentsDragStart = useCallback((event: DragStartEvent) => {
    setDocumentsDragActiveId(String(event.active.id));
  }, []);

  const handleDocumentsDragEnd = useCallback(
    (event: DragEndEvent) => {
      setDocumentsDragActiveId(null);
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      const aid = String(active.id);
      const oid = String(over.id);
      if (oid.startsWith("drop-")) {
        const match = oid.match(/^drop-(\d+)(?:-(left|right))?$/);
        const dropIndex = match ? parseInt(match[1], 10) : parseInt(oid.replace("drop-", ""), 10);
        const side = (match && (match[2] === "left" || match[2] === "right")) ? match[2] as "left" | "right" : undefined;
        if (Number.isNaN(dropIndex) || dropIndex < 0) return;
        const docConf = config[DOC_TYPE_TO_UI[docType]] as Record<string, unknown> | undefined;
        const sectionWidthsDoc = (docConf?.sectionWidths || {}) as Record<string, string>;
        if (aid.startsWith("palette-")) {
          if (aid === PALETTE_CUSTOM_TEXT_ID || aid === PALETTE_CUSTOM_HEADING_ID || aid === PALETTE_CUSTOM_SEPARATOR_ID || aid === PALETTE_CUSTOM_SPACER_ID || aid === PALETTE_SIGNATURE_LINE_ID) {
            const newId = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `cb-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
            const customKey = `custom-${newId}`;
            const type = aid === PALETTE_CUSTOM_TEXT_ID ? "text" : aid === PALETTE_CUSTOM_HEADING_ID ? "heading" : aid === PALETTE_CUSTOM_SEPARATOR_ID ? "separator" : aid === PALETTE_CUSTOM_SPACER_ID ? "spacer" : "signature";
            const content = type === "heading" ? "Nadpis" : type === "spacer" ? "24" : type === "signature" ? "podpis" : "";
            updateDocConfig(["customBlocks", newId], { type, content });
            const fullOrder = [...documentsSectionOrder];
            fullOrder.splice(dropIndex, 0, customKey);
            updateDocConfig(["sectionOrder"], fullOrder);
          } else {
            const sectionKey = aid.replace("palette-", "");
            handleSectionAdd(sectionKey, dropIndex);
            if (side && sectionWidthsDoc[sectionKey] === "half") {
              const sides = { ...(docConf?.sectionSide as Record<string, string> || {}), [sectionKey]: side };
              updateDocConfig(["sectionSide"], sides);
            }
          }
          return;
        }
        if (documentsOrderedSections.includes(aid)) {
          const oldIdx = documentsSectionOrder.indexOf(aid);
          if (oldIdx === -1) return;
          const targetFullIdx =
            dropIndex >= documentsOrderedSections.length
              ? documentsSectionOrder.length - 1
              : documentsSectionOrder.indexOf(documentsOrderedSections[dropIndex]);
          if (targetFullIdx === -1) return;
          const newFullOrder = arrayMove(documentsSectionOrder, oldIdx, targetFullIdx);
          updateDocConfig(["sectionOrder"], newFullOrder);
          if (side && !aid.startsWith("custom-") && sectionWidthsDoc[aid] === "half") {
            const sides = { ...(docConf?.sectionSide as Record<string, string> || {}), [aid]: side };
            updateDocConfig(["sectionSide"], sides);
          }
          return;
        }
      }
      if (documentsOrderedSections.includes(aid) && documentsOrderedSections.includes(oid)) {
        const oldIdx = documentsSectionOrder.indexOf(aid);
        const newIdx = documentsSectionOrder.indexOf(oid);
        if (oldIdx === -1 || newIdx === -1) return;
        const newFullOrder = arrayMove(documentsSectionOrder, oldIdx, newIdx);
        updateDocConfig(["sectionOrder"], newFullOrder);
      }
    },
    [config, docType, documentsSectionOrder, documentsOrderedSections, handleSectionAdd, updateDocConfig]
  );

  const jobiConnected = context.activeServiceId && context.services.some((s) => s.service_id === context.activeServiceId);
  const jobiServiceName = jobiConnected ? context.services.find((s) => s.service_id === context.activeServiceId)?.service_name : null;

  const sidebarNarrow = !isNarrow && sidebarCollapsed;

  return (
    <div className="app-layout">
      {isNarrow && (
        <div
          className={`app-sidebar-overlay ${sidebarOpen ? "visible" : ""}`}
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
      )}
      <aside
        className={`app-sidebar ${isNarrow && sidebarOpen ? "open" : ""} ${sidebarNarrow ? "narrow" : ""}`}
        onMouseEnter={!isNarrow && sidebarNarrow ? () => setSidebarCollapsed(false) : undefined}
        onMouseLeave={!isNarrow && !sidebarNarrow ? () => setSidebarCollapsed(true) : undefined}
      >
        <div style={{ marginBottom: sidebarNarrow ? 12 : 16, display: "flex", alignItems: "center", justifyContent: sidebarNarrow ? "center" : "space-between", gap: 8 }}>
          <AppLogo size={sidebarNarrow ? 32 : 40} colors={context.jobidocsLogo ?? undefined} modern />
        </div>
        <SidebarNav active={tab} onChange={requestTabChange} updateBadge={!!updateState} compact={sidebarNarrow} />
      </aside>
      <main className="app-main">
        <div className="page-container">
          <header style={{ marginBottom: 24, display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
            {isNarrow && (
              <button
                type="button"
                onClick={() => setSidebarOpen(true)}
                title="Otevřít menu"
                style={{
                  padding: 8,
                  border: "none",
                  background: "transparent",
                  color: "var(--text)",
                  cursor: "pointer",
                  borderRadius: 8,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
                aria-label="Otevřít menu"
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="3" y1="6" x2="21" y2="6" />
                  <line x1="3" y1="12" x2="21" y2="12" />
                  <line x1="3" y1="18" x2="21" y2="18" />
                </svg>
              </button>
            )}
            <div>
              <h1 style={{ fontSize: 24, fontWeight: 800, marginBottom: 4, color: "var(--text)" }}>
                JobiDocs <span style={{ fontWeight: 600, color: "var(--muted)", fontSize: "0.65em" }}>{packageJson.version}</span>
              </h1>
              <p style={{ color: "var(--muted)", fontSize: 14 }}>Tisk a export dokumentů z Jobi.</p>
            </div>
            <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 12 }}>
              <span
                title={jobiConnected ? `Připojeno k servisu ${jobiServiceName ?? context.activeServiceId}` : "Nepřipojeno k Jobi – spusťte Jobi a vyberte servis"}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "6px 12px",
                  borderRadius: 20,
                  background: jobiConnected ? "rgba(34,197,94,0.15)" : "rgba(148,163,184,0.2)",
                  color: jobiConnected ? "#15803d" : "var(--muted)",
                  fontSize: 13,
                  fontWeight: 500,
                }}
              >
                <span style={{ width: 8, height: 8, borderRadius: 4, background: jobiConnected ? "#22c55e" : "#94a3b8" }} />
                {jobiConnected ? `Připojeno: ${jobiServiceName ?? "Servis"}` : "Nepřipojeno"}
              </span>
            </div>
          </header>

          {showWizardBanner && (
            <div
              style={{
                marginBottom: 20,
                padding: "14px 18px",
                borderRadius: 12,
                background: "var(--accent-soft)",
                border: "1px solid var(--border)",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                flexWrap: "wrap",
                gap: 12,
              }}
            >
              <span style={{ fontSize: 14, color: "var(--text)" }}>První spuštění? Projděte si nastavení v třech krocích.</span>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  type="button"
                  onClick={() => {
                    setShowWizardModal(true);
                    setWizardStep(1);
                  }}
                  style={{ padding: "8px 16px", borderRadius: 10, border: "none", background: "var(--accent)", color: "white", fontWeight: 600, fontSize: 13, cursor: "pointer" }}
                >
                  Průvodce nastavením
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (typeof window !== "undefined") localStorage.setItem(WIZARD_STORAGE_KEY, "1");
                    setShowWizardBanner(false);
                  }}
                  style={{ padding: "8px 16px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--panel)", color: "var(--text)", fontSize: 13, cursor: "pointer" }}
                >
                  Přeskočit
                </button>
              </div>
            </div>
          )}

        {tab === "aktivity" && (
          <>
            <Breadcrumbs items={[{ label: "Aktivity", current: true }]} />
            <section className="glass-panel">
            <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 12, color: "var(--text)" }}>Aktivity</h2>
            <p style={{ fontSize: 12, color: "var(--muted)", marginBottom: 12 }}>Tisk a export z Jobi – čas, akce, stav a detail.</p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginBottom: 12, alignItems: "center" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ fontSize: 12, color: "var(--muted)" }}>Stav:</span>
                <select
                  value={activityFilterStatus}
                  onChange={(e) => setActivityFilterStatus(e.target.value as "all" | "errors")}
                  style={{ padding: "6px 10px", fontSize: 12, borderRadius: 8, border: "1px solid var(--border)", background: "var(--panel)", color: "var(--text)" }}
                >
                  <option value="all">Vše</option>
                  <option value="errors">Jen chyby</option>
                </select>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ fontSize: 12, color: "var(--muted)" }}>Období:</span>
                <select
                  value={activityFilterTime}
                  onChange={(e) => setActivityFilterTime(e.target.value as "all" | "24h")}
                  style={{ padding: "6px 10px", fontSize: 12, borderRadius: 8, border: "1px solid var(--border)", background: "var(--panel)", color: "var(--text)" }}
                >
                  <option value="all">Všechny</option>
                  <option value="24h">Posledních 24 h</option>
                </select>
              </div>
              <button
                type="button"
                onClick={() => fetchActivity()}
                style={{ padding: "6px 12px", fontSize: 12, borderRadius: 8, border: "1px solid var(--border)", background: "var(--panel-2)", color: "var(--text)", cursor: "pointer" }}
              >
                Obnovit
              </button>
            </div>
            <div style={{ borderRadius: 12, border: "1px solid var(--border)", overflow: "hidden", background: "var(--panel-2)", maxHeight: 400, overflowY: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--border)", background: "var(--panel)" }}>
                    <th style={{ textAlign: "left", padding: "10px 12px", fontWeight: 600, color: "var(--muted)" }}>Čas</th>
                    <th style={{ textAlign: "left", padding: "10px 12px", fontWeight: 600, color: "var(--muted)" }}>Akce</th>
                    <th style={{ textAlign: "left", padding: "10px 12px", fontWeight: 600, color: "var(--muted)" }}>Stav</th>
                    <th style={{ textAlign: "left", padding: "10px 12px", fontWeight: 600, color: "var(--muted)" }}>Detail</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredActivities.length === 0 && (
                    <tr>
                      <td colSpan={4} style={{ padding: 16, color: "var(--muted)" }}>{activities.length === 0 ? "Žádné požadavky zatím" : "Žádné záznamy podle filtru"}</td>
                    </tr>
                  )}
                  {filteredActivities.map((a, i) => (
                    <tr key={`${a.ts}-${i}`} style={{ borderBottom: "1px solid var(--border)" }}>
                      <td style={{ padding: "10px 12px", color: "var(--muted)", whiteSpace: "nowrap" }}>{new Date(a.ts).toLocaleString("cs-CZ")}</td>
                      <td style={{ padding: "10px 12px", fontWeight: 600, color: a.action === "print" ? "#2563eb" : "#059669" }}>{a.action === "print" ? "Tisk" : "Export"}</td>
                      <td style={{ padding: "10px 12px", color: a.status === "ok" ? "#16a34a" : a.status === "error" ? "#dc2626" : "#ca8a04", fontWeight: a.status === "error" ? 600 : 400 }}>
                        {a.status === "ok" ? "✓ OK" : a.status === "error" ? "✗ Chyba" : "… Zpracovává se"}
                      </td>
                      <td style={{ padding: "10px 12px", color: "var(--text)", maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis" }}>{a.detail ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          </>
        )}

        {tab === "tiskarna" && (
          <>
            <Breadcrumbs items={[{ label: "Nastavení" }, { label: "Tiskárna", current: true }]} />
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
          </>
        )}

        {tab === "dokumenty" && (
          <DndContext
              sensors={documentsSensors}
              collisionDetection={pointerWithin}
              onDragStart={handleDocumentsDragStart}
              onDragEnd={handleDocumentsDragEnd}
              onDragCancel={() => setDocumentsDragActiveId(null)}
            >
            <Breadcrumbs items={[{ label: "Dokumenty" }, { label: DOC_TYPE_LABELS[docType], current: true }]} />
            <DocumentTypePicker value={docType} onChange={requestDocTypeChange} />
            <div style={{ display: "grid", gridTemplateColumns: "minmax(320px, 1fr) 1fr", gap: 24, alignItems: "start" }}>
              <div className={`glass-panel docs-split-left`} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                <h2 style={{ fontSize: 18, fontWeight: 700, color: "var(--text)", marginBottom: 0 }}>Nastavení</h2>

                <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", padding: "10px 0", borderBottom: "1px solid var(--border)" }}>
                  <span style={{ fontSize: 12, color: "var(--muted)", marginRight: 4 }}>Logo a razítko:</span>
                  <button type="button" onClick={() => fileInputLogo.current?.click()} style={{ padding: "8px 14px", borderRadius: 10, border: "1px solid var(--border)", background: config.logoUrl ? "var(--accent-soft)" : "var(--panel-2)", color: "var(--text)", fontSize: 12, cursor: "pointer", fontWeight: 500 }}>
                    {config.logoUrl ? "✓ Změnit logo" : "Nahrát logo"}
                  </button>
                  <button type="button" onClick={() => fileInputStamp.current?.click()} style={{ padding: "8px 14px", borderRadius: 10, border: "1px solid var(--border)", background: config.stampUrl ? "var(--accent-soft)" : "var(--panel-2)", color: "var(--text)", fontSize: 12, cursor: "pointer", fontWeight: 500 }}>
                    {config.stampUrl ? "✓ Změnit razítko / podpis" : "Nahrát razítko / podpis"}
                  </button>
                </div>

                <div style={{ padding: "14px 0" }}>
                  <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 6, color: "var(--text)" }}>Paleta sekcí</div>
                  <p style={{ fontSize: 12, color: "var(--muted)", marginBottom: 10 }}>Přetáhněte sekci do náhledu vpravo. ✓ = již v dokumentu.</p>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                    {(DEFAULT_SECTION_ORDER[DOC_TYPE_TO_UI[docType]] ?? []).map((sectionKey) => (
                      <SectionPaletteItem
                        key={sectionKey}
                        sectionKey={sectionKey}
                        inDocument={documentsOrderedSections.includes(sectionKey)}
                        docConfig={docConfig}
                      />
                    ))}
                    {[
                    { id: PALETTE_CUSTOM_TEXT_ID, label: "Vlastní text" },
                    { id: PALETTE_CUSTOM_HEADING_ID, label: "Vlastní nadpis" },
                    { id: PALETTE_CUSTOM_SEPARATOR_ID, label: "Oddělovač" },
                    { id: PALETTE_CUSTOM_SPACER_ID, label: "Prázdný řádek" },
                    { id: PALETTE_SIGNATURE_LINE_ID, label: "Řádek na podpis" },
                  ].map(({ id, label }) => {
                    const wantType = PALETTE_CUSTOM_ID_TO_TYPE[id];
                    const blocks = (docConfig.customBlocks as Record<string, { type?: string }>) || {};
                    const hasAny = wantType ? documentsSectionOrder.some((k) => k.startsWith("custom-") && blocks[k.slice(7)]?.type === wantType) : false;
                    return <PaletteCustomBlockItem key={id} id={id} label={label} hasAny={hasAny} />;
                  })}
                  </div>
                </div>

                {selectedAsset && (
                  <div style={{ position: "relative", padding: "10px 12px", borderRadius: 10, border: "1px solid var(--accent)", background: "var(--accent-soft)", display: "flex", flexDirection: "column", gap: 8 }}>
                    <button type="button" onClick={() => setSelectedAsset(null)} style={{ position: "absolute", top: 6, right: 6, padding: 2, border: "none", background: "none", cursor: "pointer", color: "var(--muted)", fontSize: 14 }} aria-label="Zavřít">×</button>
                    <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text)" }}>
                      {selectedAsset === "logo" ? "Upravit: Logo" : "Upravit: Razítko / podpis"}
                    </div>
                    {selectedAsset === "logo" && (
                      <>
                        <input ref={fileInputLogo} type="file" accept="image/*" onChange={handleFileLogo} style={{ display: "none" }} />
                        <button type="button" onClick={() => fileInputLogo.current?.click()} style={{ padding: "8px 14px", borderRadius: 10, border: "1px solid var(--border)", background: config.logoUrl ? "var(--accent-soft)" : "var(--panel-2)", color: "var(--text)", fontSize: 12, cursor: "pointer", fontWeight: 500 }}>
                          {config.logoUrl ? "Změnit logo" : "Nahrát logo"}
                        </button>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                          <span style={{ fontSize: 12, color: "var(--muted)" }}>Velikost: {((config.logoSize as number) ?? 100)}%</span>
                          <input type="range" min={50} max={150} value={((config.logoSize as number) ?? 100)} onChange={(e) => setConfig((prev) => ({ ...prev, logoSize: Number(e.target.value) }))} style={{ flex: 1, minWidth: 80 }} />
                        </div>
                        {(config.logoPosition as { x: number; y: number } | undefined) && (
                          <button type="button" onClick={() => setConfig((prev) => ({ ...prev, logoPosition: undefined }))} style={{ fontSize: 11, color: "var(--accent)", background: "none", border: "none", cursor: "pointer", padding: 0, textAlign: "left" }}>
                            Vrátit logo do hlavičky
                          </button>
                        )}
                      </>
                    )}
                    {selectedAsset === "stamp" && (
                      <>
                        <input ref={fileInputStamp} type="file" accept="image/*" onChange={handleFileStamp} style={{ display: "none" }} />
                        <button type="button" onClick={() => fileInputStamp.current?.click()} style={{ padding: "8px 14px", borderRadius: 10, border: "1px solid var(--border)", background: config.stampUrl ? "var(--accent-soft)" : "var(--panel-2)", color: "var(--text)", fontSize: 12, cursor: "pointer", fontWeight: 500 }}>
                          {config.stampUrl ? "Změnit razítko / podpis" : "Nahrát razítko / podpis"}
                        </button>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                          <span style={{ fontSize: 12, color: "var(--muted)" }}>Velikost: {((config.stampSize as number) ?? 100)}%</span>
                          <input type="range" min={50} max={250} value={((config.stampSize as number) ?? 100)} onChange={(e) => setConfig((prev) => ({ ...prev, stampSize: Number(e.target.value) }))} style={{ flex: 1, minWidth: 80 }} />
                        </div>
                        {(config.stampPosition as { x: number; y: number } | undefined) && (
                          <button type="button" onClick={() => setConfig((prev) => ({ ...prev, stampPosition: undefined }))} style={{ fontSize: 11, color: "var(--accent)", background: "none", border: "none", cursor: "pointer", padding: 0, textAlign: "left" }}>
                            Vrátit razítko do řádku podpisů
                          </button>
                        )}
                      </>
                    )}
                  </div>
                )}

                {selectedPreviewSectionId && (
                  <div style={{ position: "relative", padding: "10px 12px", borderRadius: 10, border: "1px solid var(--accent)", background: "var(--accent-soft)", display: "flex", flexDirection: "column", gap: 8 }}>
                    <button type="button" onClick={() => setSelectedPreviewSectionId(null)} style={{ position: "absolute", top: 6, right: 6, padding: 2, border: "none", background: "none", cursor: "pointer", color: "var(--muted)", fontSize: 14 }} aria-label="Zavřít">×</button>
                    <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text)" }}>
                      Upravit sekci: {getSectionDragLabel(selectedPreviewSectionId, docConfig)}
                    </div>
                    {selectedPreviewSectionId.startsWith("custom-") && (() => {
                      const blockId = selectedPreviewSectionId.slice(7);
                      const blocks = (docConfig?.customBlocks as Record<string, CustomBlockData>) || {};
                      const block: CustomBlockData = blocks[blockId] || { type: "text", content: "" };
                      const customType = block.type || "text";
                      if (customType === "signature") {
                        const cur = (block.content as string) ?? "";
                        return (
                          <>
                            <label style={{ fontSize: 11, fontWeight: 500, color: "var(--text)", marginBottom: 4, display: "block" }}>Text pod řádkem</label>
                            <input
                              type="text"
                              value={cur}
                              onChange={(e) => updateDocConfig(["customBlocks", blockId], { ...block, content: e.target.value })}
                              placeholder="podpis"
                              style={{ width: "100%", padding: 8, borderRadius: 8, border: "1px solid var(--border)", background: "var(--panel)", color: "var(--text)", fontSize: 12, boxSizing: "border-box" }}
                            />
                          </>
                        );
                      }
                      if (customType === "text" || customType === "heading") {
                        const cur = (block.content as string) ?? "";
                        return (
                          <>
                            {customType === "text" && (
                              <>
                                <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: 12, color: "var(--text)" }}>
                                  <input
                                    type="checkbox"
                                    checked={(block.showHeading as boolean) !== false}
                                    onChange={(e) => updateDocConfig(["customBlocks", blockId], { ...block, showHeading: e.target.checked })}
                                    style={{ accentColor: "var(--accent)" }}
                                  />
                                  Zobrazit nadpis
                                </label>
                                <div>
                                  <label style={{ fontSize: 11, fontWeight: 500, color: "var(--text)", marginBottom: 4, display: "block" }}>Nadpis</label>
                                  <input
                                    type="text"
                                    value={(block.headingText as string) ?? ""}
                                    onChange={(e) => updateDocConfig(["customBlocks", blockId], { ...block, headingText: e.target.value })}
                                    placeholder="Vlastní text"
                                    style={{ width: "100%", padding: 6, borderRadius: 8, border: "1px solid var(--border)", background: "var(--panel)", color: "var(--text)", fontSize: 12, boxSizing: "border-box" }}
                                  />
                                </div>
                                <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: 12, color: "var(--text)" }}>
                                  <input
                                    type="checkbox"
                                    checked={(block.showHeadingLine as boolean) !== false}
                                    onChange={(e) => updateDocConfig(["customBlocks", blockId], { ...block, showHeadingLine: e.target.checked })}
                                    style={{ accentColor: "var(--accent)" }}
                                  />
                                  Čára pod nadpisem
                                </label>
                              </>
                            )}
                            <label style={{ fontSize: 11, fontWeight: 500, color: "var(--text)", display: customType === "heading" ? "block" : "none" }}>{customType === "heading" ? "Nadpis" : ""}</label>
                            {customType === "text" ? (
                              <CustomTextEditor
                                value={cur}
                                onChange={(html) => updateDocConfig(["customBlocks", blockId], { ...block, content: html })}
                              />
                            ) : (
                              <>
                                <input
                                  type="text"
                                  value={cur}
                                  onChange={(e) => updateDocConfig(["customBlocks", blockId], { ...block, content: e.target.value })}
                                  placeholder="Nadpis"
                                  style={{ width: "100%", padding: 8, borderRadius: 8, border: "1px solid var(--border)", background: "var(--panel)", color: "var(--text)", fontSize: 12, boxSizing: "border-box" }}
                                />
                                <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 2 }}>Vložit proměnnou:</div>
                                <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                                  {Object.entries(CUSTOM_TEXT_VARIABLES).map(([key, label]) => (
                                    <button
                                      key={key}
                                      type="button"
                                      onClick={() => {
                                        const next = cur + (cur && !cur.endsWith(" ") ? " " : "") + "{{" + key + "}}";
                                        updateDocConfig(["customBlocks", blockId], { ...block, content: next });
                                      }}
                                      style={{ padding: "3px 6px", fontSize: 10, borderRadius: 4, border: "1px solid var(--border)", background: "var(--panel)", color: "var(--text)", cursor: "pointer" }}
                                      title={`{{${key}}}`}
                                    >
                                      {label}
                                    </button>
                                  ))}
                                </div>
                              </>
                            )}
                          </>
                        );
                      }
                      return null;
                    })()}
                    {selectedPreviewSectionId === "warranty" && docType === "zarucni_list" && (
                      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 4 }}>
                        <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 12, color: "var(--text)" }}>
                          <input
                            type="checkbox"
                            checked={(docConfig.sectionVisibility as Record<string, string> | undefined)?.warranty === "when_repair_date_set"}
                            onChange={(e) => {
                              const prev = (docConfig.sectionVisibility as Record<string, string> | undefined) ?? {};
                              const next = { ...prev };
                              if (e.target.checked) next.warranty = "when_repair_date_set";
                              else delete next.warranty;
                              updateDocConfig(["sectionVisibility"], next);
                            }}
                            style={{ accentColor: "var(--accent)" }}
                          />
                          Zobrazit jen když je datum opravy
                        </label>
                        <div>
                          <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text)", marginBottom: 4 }}>Délka záruky</div>
                          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
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
                              style={{ width: 52, padding: "6px 8px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--panel)", color: "var(--text)", fontSize: 12, textAlign: "center" }}
                            />
                            {(["days", "months", "years"] as const).map((u) => {
                              const isActive = (docConfig.warrantyUnifiedUnit as string) === u;
                              return (
                                <button
                                  key={u}
                                  type="button"
                                  onClick={() => updateDocConfig(["warrantyUnifiedUnit"], u)}
                                  style={{ padding: "4px 10px", fontSize: 11, borderRadius: 6, border: "1px solid var(--border)", background: isActive ? "var(--accent)" : "var(--panel)", color: isActive ? "white" : "var(--text)", cursor: "pointer" }}
                                >
                                  {u === "days" ? "dny" : u === "months" ? "měs." : "roky"}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                        <div>
                          <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text)", marginBottom: 4 }}>V dokumentu zobrazit</div>
                          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                            <label style={{ display: "flex", alignItems: "center", gap: 4, cursor: "pointer", fontSize: 11, color: "var(--text)" }}>
                              <input type="radio" name="warrantyDisplayEdit" checked={(docConfig.warrantyShowEndDate as boolean) !== false} onChange={() => updateDocConfig(["warrantyShowEndDate"], true)} style={{ accentColor: "var(--accent)" }} />
                              Do data
                            </label>
                            <label style={{ display: "flex", alignItems: "center", gap: 4, cursor: "pointer", fontSize: 11, color: "var(--text)" }}>
                              <input type="radio" name="warrantyDisplayEdit" checked={(docConfig.warrantyShowEndDate as boolean) === false} onChange={() => updateDocConfig(["warrantyShowEndDate"], false)} style={{ accentColor: "var(--accent)" }} />
                              Jen délka
                            </label>
                          </div>
                        </div>
                        <div>
                          <label style={{ display: "block", fontSize: 11, fontWeight: 600, marginBottom: 4, color: "var(--text)" }}>Dodatečné informace</label>
                          <textarea
                            value={(docConfig.warrantyExtraText as string) ?? ""}
                            onChange={(e) => updateDocConfig(["warrantyExtraText"], e.target.value)}
                            placeholder="Volitelný text pod zárukou…"
                            rows={2}
                            style={{ width: "100%", padding: "6px 8px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--panel)", color: "var(--text)", fontSize: 12, resize: "vertical", boxSizing: "border-box" }}
                          />
                        </div>
                        <div>
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                            <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text)" }}>Další záruky</span>
                            <button
                              type="button"
                              onClick={() => {
                                const list = (docConfig.warrantyItems as Array<{ label: string; duration: number; unit: string }>) ?? [];
                                updateDocConfig(["warrantyItems"], [...list, { label: "Záruka na díly", duration: 12, unit: "months", showEndDate: true }]);
                              }}
                              style={{ padding: "4px 8px", fontSize: 10, borderRadius: 6, border: "1px solid var(--accent)", background: "var(--accent-soft)", color: "var(--accent)", fontWeight: 600, cursor: "pointer" }}
                            >
                              + Přidat
                            </button>
                          </div>
                          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                            {((docConfig.warrantyItems as Array<{ label: string; duration: number; unit: string; showEndDate?: boolean }>) ?? []).map((item, index) => (
                              <div key={index} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6, padding: 6, borderRadius: 8, border: "1px solid var(--border)", background: "var(--panel)" }}>
                                <input
                                  type="text"
                                  value={item.label}
                                  onChange={(e) => {
                                    const list = [...((docConfig.warrantyItems as Array<{ label: string; duration: number; unit: string; showEndDate?: boolean }>) ?? [])];
                                    list[index] = { ...list[index], label: e.target.value };
                                    updateDocConfig(["warrantyItems"], list);
                                  }}
                                  placeholder="Název"
                                  style={{ flex: "1 1 80px", minWidth: 60, padding: "4px 6px", fontSize: 11, borderRadius: 6, border: "1px solid var(--border)", background: "var(--panel-2)", color: "var(--text)", boxSizing: "border-box" }}
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
                                  style={{ width: 40, padding: "4px 4px", fontSize: 11, borderRadius: 6, border: "1px solid var(--border)", background: "var(--panel-2)", color: "var(--text)", textAlign: "center" }}
                                />
                                <select
                                  value={item.unit}
                                  onChange={(e) => {
                                    const list = [...((docConfig.warrantyItems as Array<{ label: string; duration: number; unit: string; showEndDate?: boolean }>) ?? [])];
                                    list[index] = { ...list[index], unit: e.target.value };
                                    updateDocConfig(["warrantyItems"], list);
                                  }}
                                  style={{ padding: "4px 6px", fontSize: 11, borderRadius: 6, border: "1px solid var(--border)", background: "var(--panel-2)", color: "var(--text)" }}
                                >
                                  <option value="days">dny</option>
                                  <option value="months">měs.</option>
                                  <option value="years">roky</option>
                                </select>
                                <label style={{ display: "flex", alignItems: "center", gap: 2, cursor: "pointer", fontSize: 10, color: "var(--text)" }}>
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
                                  Do data
                                </label>
                                <button type="button" onClick={() => { const list = ((docConfig.warrantyItems as Array<{ label: string; duration: number; unit: string; showEndDate?: boolean }>) ?? []).filter((_, i) => i !== index); updateDocConfig(["warrantyItems"], list); }} style={{ padding: "2px 6px", fontSize: 10, borderRadius: 4, border: "1px solid var(--border)", background: "transparent", color: "var(--muted)", cursor: "pointer" }}>Odebrat</button>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}
                    {selectedPreviewSectionId === "repairs" && (() => {
                      const repairsColumns = (docConfig?.repairsTableColumns as string[] | undefined) ?? ["name", "price"];
                      const REPAIRS_COL_LABELS: Record<string, string> = { name: "Název", price: "Cena", quantity: "Množství", unit: "Jednotka", total: "Celkem" };
                      return (
                        <div style={{ padding: "8px 0" }}>
                          <div style={{ fontSize: 11, fontWeight: 600, color: "var(--muted)", marginBottom: 6 }}>Sloupce tabulky (Jobi pošle <code style={{ fontSize: 10 }}>repair_items</code>):</div>
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                            {(["name", "price", "quantity", "unit", "total"] as const).map((col) => {
                              const checked = repairsColumns.includes(col);
                              return (
                                <label key={col} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, cursor: "pointer" }}>
                                  <input
                                    type="checkbox"
                                    checked={checked}
                                    onChange={() => {
                                      const next = checked ? repairsColumns.filter((c) => c !== col) : [...repairsColumns, col];
                                      updateDocConfig(["repairsTableColumns"], next.length ? next : ["name", "price"]);
                                    }}
                                    style={{ accentColor: "var(--accent)" }}
                                  />
                                  {REPAIRS_COL_LABELS[col]}
                                </label>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })()}
                    {selectedPreviewSectionId && SECTION_FIELDS_BY_KEY[selectedPreviewSectionId] && (() => {
                      const sectionKey = selectedPreviewSectionId;
                      const fieldConfig = SECTION_FIELDS_BY_KEY[sectionKey];
                      const sectionFieldsRaw = (docConfig?.sectionFields as Record<string, Record<string, boolean>> | undefined)?.[sectionKey];
                      const sectionFields = sectionFieldsRaw ?? fieldConfig?.defaultFields ?? {};
                      return (
                        <div style={{ padding: "8px 0" }}>
                          <div style={{ fontSize: 11, fontWeight: 600, color: "var(--muted)", marginBottom: 6 }}>Zobrazit v sekci:</div>
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                            {fieldConfig.fields.map(({ key, label: flabel }) => (
                              <label key={key} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, cursor: "pointer" }}>
                                <input
                                  type="checkbox"
                                  checked={(sectionFields[key] ?? true) as boolean}
                                  onChange={(e) => {
                                    const next = { ...sectionFields, [key]: e.target.checked };
                                    updateDocConfig(["sectionFields", sectionKey], next);
                                  }}
                                  style={{ accentColor: "var(--accent)" }}
                                />
                                {flabel}
                              </label>
                            ))}
                          </div>
                        </div>
                      );
                    })()}
                    {!selectedPreviewSectionId.startsWith("custom-") && (
                      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                        <span style={{ fontSize: 11, color: "var(--muted)" }}>Šířka:</span>
                        {(["full", "half"] as const).map((w) => {
                          const sw = (docConfig?.sectionWidths as Record<string, SectionWidth>) || {};
                          const cur = sw[selectedPreviewSectionId] ?? DEFAULT_SECTION_WIDTHS[selectedPreviewSectionId] ?? "full";
                          return (
                            <button
                              key={w}
                              type="button"
                              onClick={() => updateDocConfig(["sectionWidths", selectedPreviewSectionId], w)}
                              style={{ padding: "4px 10px", fontSize: 11, borderRadius: 6, border: "1px solid var(--border)", background: cur === w ? "var(--accent)" : "var(--panel)", color: cur === w ? "white" : "var(--text)", cursor: "pointer", fontWeight: 500 }}
                            >
                              {w === "full" ? "Celá" : "Polovina"}
                            </button>
                          );
                        })}
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        updateDocConfig(["sectionOrder"], documentsSectionOrder.filter((x) => x !== selectedPreviewSectionId));
                        setSelectedPreviewSectionId(null);
                      }}
                      style={{ padding: "6px 10px", fontSize: 11, borderRadius: 6, border: "1px solid var(--border)", background: "transparent", color: "var(--muted)", cursor: "pointer", alignSelf: "flex-start" }}
                    >
                      Odebrat z dokumentu
                    </button>
                  </div>
                )}

                <div style={{ padding: "12px 0" }}>
                  <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, color: "var(--text)" }}>Vzhled hlavičky</div>
                  <p style={{ fontSize: 12, color: "var(--muted)", marginBottom: 10 }}>Velikosti textů v hlavičce (název dokumentu, kód zakázky, název servisu). Prázdné = výchozí z designu.</p>
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    <div>
                      <label style={{ display: "block", fontSize: 12, fontWeight: 500, marginBottom: 4, color: "var(--text)" }}>Velikost – název dokumentu (px)</label>
                      <input
                        type="number"
                        min={10}
                        max={24}
                        value={(docConfig?.headerTitleFontSize as number) ?? ""}
                        onChange={(e) => { const v = e.target.value === "" ? undefined : parseInt(e.target.value, 10); updateDocConfig(["headerTitleFontSize"], Number.isNaN(v) || v == null ? undefined : v); }}
                        placeholder="14"
                        style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--panel)", color: "var(--text)", fontSize: 13, boxSizing: "border-box" }}
                      />
                    </div>
                    {docType === "zakazkovy_list" && (
                      <div>
                        <label style={{ display: "block", fontSize: 12, fontWeight: 500, marginBottom: 4, color: "var(--text)" }}>Velikost – kód zakázky (px)</label>
                        <input
                          type="number"
                          min={12}
                          max={24}
                          value={(docConfig?.headerTicketCodeFontSize as number) ?? ""}
                          onChange={(e) => { const v = e.target.value === "" ? undefined : parseInt(e.target.value, 10); updateDocConfig(["headerTicketCodeFontSize"], Number.isNaN(v) || v == null ? undefined : v); }}
                          placeholder="18"
                          style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--panel)", color: "var(--text)", fontSize: 13, boxSizing: "border-box" }}
                        />
                      </div>
                    )}
                    <div>
                      <label style={{ display: "block", fontSize: 12, fontWeight: 500, marginBottom: 4, color: "var(--text)" }}>Velikost – název servisu (px)</label>
                      <input
                        type="number"
                        min={10}
                        max={24}
                        value={(docConfig?.headerSubtitleFontSize as number) ?? ""}
                        onChange={(e) => { const v = e.target.value === "" ? undefined : parseInt(e.target.value, 10); updateDocConfig(["headerSubtitleFontSize"], Number.isNaN(v) || v == null ? undefined : v); }}
                        placeholder="14"
                        style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--panel)", color: "var(--text)", fontSize: 13, boxSizing: "border-box" }}
                      />
                      <p style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>Název servisu se bere z Údaje o servisu (Jobi).</p>
                    </div>
                  </div>
                </div>

                <Accordion title="Logo a razítko" open={accordionOpen.logo} onToggle={() => toggleAccordion("logo")}>
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <p style={{ fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>Logo a razítko lze v náhledu vpravo chytit a přetáhnout na libovolné místo.</p>
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
                {(config.logoPosition as { x: number; y: number } | undefined) && (
                  <button type="button" onClick={() => setConfig((prev) => ({ ...prev, logoPosition: undefined }))} style={{ marginTop: 6, fontSize: 11, color: "var(--accent)", background: "none", border: "none", cursor: "pointer", padding: 0 }}>
                    Vrátit logo do hlavičky
                  </button>
                )}
              </div>

              <div>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10, color: "var(--text)" }}>Razítko / podpis</div>
                <input ref={fileInputStamp} type="file" accept="image/*" onChange={handleFileStamp} style={{ display: "none" }} />
                <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                  <button type="button" onClick={() => fileInputStamp.current?.click()} style={{ padding: "10px 16px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--panel)", color: "var(--text)", fontSize: 13, cursor: "pointer" }}>
                    {config.stampUrl ? "Změnit razítko / podpis" : "Nahrát razítko / podpis"}
                  </button>
                  <span style={{ fontSize: 12, color: "var(--muted)" }}>Velikost: {((config.stampSize as number) ?? 100)}%</span>
                  <input type="range" min={50} max={250} value={((config.stampSize as number) ?? 100)} onChange={(e) => setConfig((prev) => ({ ...prev, stampSize: Number(e.target.value) }))} style={{ flex: 1 }} />
                </div>
                {(config.stampPosition as { x: number; y: number } | undefined) && (
                  <button type="button" onClick={() => setConfig((prev) => ({ ...prev, stampPosition: undefined }))} style={{ marginTop: 6, fontSize: 11, color: "var(--accent)", background: "none", border: "none", cursor: "pointer", padding: 0 }}>
                    Vrátit razítko do řádku podpisů
                  </button>
                )}
              </div>

              <div>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10, color: "var(--text)" }}>Předtištěné PDF (hlavičkový papír)</div>
                <p style={{ fontSize: 12, color: "var(--muted)", marginBottom: 8 }}>Nahrajte PDF – při tisku se dokument vykreslí na toto pozadí (první stránka PDF).</p>
                <input ref={fileInputLetterhead} type="file" accept=".pdf,application/pdf" onChange={handleFileLetterhead} style={{ display: "none" }} />
                <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                  <button type="button" onClick={() => fileInputLetterhead.current?.click()} style={{ padding: "10px 16px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--panel)", color: "var(--text)", fontSize: 13, cursor: "pointer" }}>
                    {(config.letterheadPdfUrl as string | undefined) ? "Změnit PDF" : "Nahrát PDF"}
                  </button>
                  {(config.letterheadPdfUrl as string | undefined) ? (
                    <button type="button" onClick={() => setConfig((prev) => ({ ...prev, letterheadPdfUrl: undefined }))} style={{ padding: "8px 12px", borderRadius: 10, border: "1px solid var(--border)", background: "transparent", color: "var(--muted)", fontSize: 12, cursor: "pointer" }}>
                      Odebrat
                    </button>
                  ) : null}
                </div>
              </div>
                  </div>
                </Accordion>

              <Accordion title="Viditelné sekce a pořadí" open={accordionOpen.sections} onToggle={() => toggleAccordion("sections")}>
              <div>
                {documentsSectionOrder.filter((k) => k.startsWith("custom-")).length > 0 && (
                  <>
                    <div style={{ fontSize: 13, fontWeight: 600, marginTop: 14, marginBottom: 8, color: "var(--text)" }}>Vlastní bloky</div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                      {documentsSectionOrder
                        .filter((k) => k.startsWith("custom-"))
                        .map((customKey) => {
                          const blockId = customKey.slice(7);
                          const blocks = (docConfig.customBlocks as Record<string, CustomBlockData>) || {};
                          const block = blocks[blockId] || { type: "text", content: "" };
                          const blockType = block.type || "text";
                          const typeLabels: Record<string, string> = { text: "Vlastní text", heading: "Vlastní nadpis", separator: "Oddělovač", spacer: "Prázdný řádek", signature: "Řádek na podpis" };
                          const removeBtn = (
                            <button
                              type="button"
                              onClick={() => {
                                const order = documentsSectionOrder.filter((k) => k !== customKey);
                                updateDocConfig(["sectionOrder"], order);
                                const next = { ...blocks };
                                delete next[blockId];
                                updateDocConfig(["customBlocks"], next);
                              }}
                              title="Odebrat blok"
                              style={{ padding: "4px 8px", borderRadius: 8, border: "1px solid var(--border)", background: "transparent", color: "var(--muted)", fontSize: 11, cursor: "pointer" }}
                            >
                              Odebrat
                            </button>
                          );
                          const blockLabel = getSectionDragLabel(customKey, docConfig);
                          return (
                            <div key={customKey} style={{ padding: 10, borderRadius: 12, border: "1px solid var(--border)", background: "var(--panel)" }}>
                              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: blockType === "separator" || blockType === "spacer" ? 0 : 6 }}>
                                <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text)" }}>{blockLabel}</span>
                                {removeBtn}
                              </div>
                              {blockType === "text" && (
                                <>
                                  <textarea
                                    value={(block.content as string) ?? ""}
                                    onChange={(e) => updateDocConfig(["customBlocks", blockId], { ...block, content: e.target.value })}
                                    placeholder="Sem napište text… Můžete vložit proměnné tlačítky níže."
                                    rows={2}
                                    style={{ width: "100%", padding: 8, borderRadius: 8, border: "1px solid var(--border)", background: "var(--panel-2)", color: "var(--text)", fontSize: 12, resize: "vertical", boxSizing: "border-box", marginTop: 6 }}
                                  />
                                  <div style={{ marginTop: 6, fontSize: 11, color: "var(--muted)", marginBottom: 4 }}>Vložit proměnnou:</div>
                                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                                    {Object.entries(CUSTOM_TEXT_VARIABLES).map(([key, label]) => (
                                      <button
                                        key={key}
                                        type="button"
                                        onClick={() => {
                                          const cur = (block.content as string) ?? "";
                                          updateDocConfig(["customBlocks", blockId], { ...block, content: cur + (cur && !cur.endsWith(" ") ? " " : "") + "{{" + key + "}}" });
                                        }}
                                        style={{ padding: "4px 8px", fontSize: 10, borderRadius: 6, border: "1px solid var(--border)", background: "var(--panel-2)", color: "var(--text)", cursor: "pointer" }}
                                        title={`{{${key}}}`}
                                      >
                                        {label}
                                      </button>
                                    ))}
                                  </div>
                                </>
                              )}
                              {blockType === "heading" && (
                                <>
                                  <input
                                    type="text"
                                    value={(block.content as string) ?? ""}
                                    onChange={(e) => updateDocConfig(["customBlocks", blockId], { ...block, content: e.target.value })}
                                    placeholder="Nadpis"
                                    style={{ width: "100%", padding: 8, borderRadius: 8, border: "1px solid var(--border)", background: "var(--panel-2)", color: "var(--text)", fontSize: 12, boxSizing: "border-box", marginTop: 6 }}
                                  />
                                  <div style={{ marginTop: 6, fontSize: 11, color: "var(--muted)", marginBottom: 4 }}>Vložit proměnnou:</div>
                                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                                    {Object.entries(CUSTOM_TEXT_VARIABLES).map(([key, label]) => (
                                      <button
                                        key={key}
                                        type="button"
                                        onClick={() => {
                                          const cur = (block.content as string) ?? "";
                                          updateDocConfig(["customBlocks", blockId], { ...block, content: cur + (cur && !cur.endsWith(" ") ? " " : "") + "{{" + key + "}}" });
                                        }}
                                        style={{ padding: "4px 8px", fontSize: 10, borderRadius: 6, border: "1px solid var(--border)", background: "var(--panel-2)", color: "var(--text)", cursor: "pointer" }}
                                        title={`{{${key}}}`}
                                      >
                                        {label}
                                      </button>
                                    ))}
                                  </div>
                                </>
                              )}
                              {blockType === "spacer" && (
                                <div style={{ marginTop: 6, display: "flex", alignItems: "center", gap: 8 }}>
                                  <label style={{ fontSize: 12, color: "var(--muted)" }}>Výška (px):</label>
                                  <input
                                    type="number"
                                    min={8}
                                    max={200}
                                    value={Math.max(8, parseInt(String(block.content || "24"), 10) || 24)}
                                    onChange={(e) => {
                                      const v = parseInt(e.target.value, 10);
                                      updateDocConfig(["customBlocks", blockId], { ...block, content: Number.isNaN(v) || v < 8 ? "24" : String(v) });
                                    }}
                                    style={{ width: 72, padding: "6px 8px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--panel-2)", color: "var(--text)", fontSize: 12, boxSizing: "border-box" }}
                                  />
                                </div>
                              )}
                            </div>
                          );
                        })}
                    </div>
                  </>
                )}
                <div style={{ fontSize: 13, fontWeight: 600, marginTop: 14, marginBottom: 10, color: "var(--text)" }}>Viditelné sekce</div>
                <div style={{ display: "grid", gap: 8 }}>
                  {sectionFields.map((f) => (
                    <ModernCheckbox key={f.key} checked={(docConfig[f.key] as boolean) !== false} onChange={(checked) => updateDocConfig([f.key], checked)} label={f.label} />
                  ))}
                </div>
              </div>
              </Accordion>

              {docType === "zakazkovy_list" && (
                <Accordion title="Podpisy" open={accordionOpen.signatures} onToggle={() => toggleAccordion("signatures")}>
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
                </Accordion>
              )}

              <Accordion title="Design a barvy" open={accordionOpen.design} onToggle={() => toggleAccordion("design")}>
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
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

              {(docType === "prijemka_reklamace" || docType === "vydejka_reklamace") && (
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10, color: "var(--text)" }}>Právní / doplňkový text</div>
                  <textarea
                    value={String(docConfig.legalText ?? "")}
                    onChange={(e) => updateDocConfig(["legalText"], e.target.value)}
                    placeholder={docType === "prijemka_reklamace" ? "Příjemka reklamace potvrzuje převzetí reklamovaného zboží." : "Výdejka reklamace potvrzuje vyzvednutí po vyřízení reklamace."}
                    rows={2}
                    style={{ width: "100%", padding: "10px 12px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--panel)", color: "var(--text)", fontSize: 13, resize: "vertical", boxSizing: "border-box" }}
                  />
                </div>
              )}

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
              </div>
              </Accordion>

              {docType === "zarucni_list" && (docConfig.includeWarranty as boolean) === true && (
                <Accordion title="Záruka" open={accordionOpen.warranty} onToggle={() => toggleAccordion("warranty")}>
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
                  <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      checked={(docConfig.sectionVisibility as Record<string, string> | undefined)?.warranty === "when_repair_date_set"}
                      onChange={(e) => {
                        const prev = (docConfig.sectionVisibility as Record<string, string> | undefined) ?? {};
                        const next = { ...prev };
                        if (e.target.checked) next.warranty = "when_repair_date_set";
                        else delete next.warranty;
                        updateDocConfig(["sectionVisibility"], next);
                      }}
                      style={{ accentColor: "var(--accent)", width: 18, height: 18 }}
                    />
                    <span style={{ fontSize: 13, color: "var(--text)" }}>Zobrazit sekci Záruka jen když je vyplněno datum opravy</span>
                  </label>
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
                </Accordion>
              )}

              <div>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10, color: "var(--text)" }}>Styl sekcí</div>
                <p style={{ fontSize: 12, color: "var(--muted)", marginBottom: 8 }}>Vzhled jednotlivých sekcí (přepíše výchozí styl designu).</p>
                <div style={{ display: "grid", gap: 8 }}>
                  {sectionFields.filter((f) => INCLUDE_KEY_TO_SECTION_KEY[f.key]).map((f) => {
                    const sectionKey = INCLUDE_KEY_TO_SECTION_KEY[f.key];
                    const sectionStyles = (docConfig.sectionStyles as Record<string, string>) || {};
                    const value = (sectionStyles[sectionKey] as "" | SectionStyle) ?? "";
                    return (
                      <div key={f.key} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ fontSize: 12, color: "var(--text)", flex: "1 1 0" }}>{f.label}</span>
                        <select
                          value={value}
                          onChange={(e) => {
                            const next = { ...sectionStyles };
                            const v = e.target.value as "" | SectionStyle;
                            if (v === "") delete next[sectionKey];
                            else next[sectionKey] = v;
                            updateDocConfig(["sectionStyles"], next);
                          }}
                          style={{ padding: "6px 10px", fontSize: 12, borderRadius: 8, border: "1px solid var(--border)", background: "var(--panel)", color: "var(--text)", minWidth: 160 }}
                        >
                          {SECTION_STYLE_OPTIONS.map((opt) => (
                            <option key={opt.value || "default"} value={opt.value}>{opt.label}</option>
                          ))}
                        </select>
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
                  placeholder="Vlastní text zobrazený na dokumentu… Můžete vložit proměnné tlačítky níže."
                />
                <div style={{ marginTop: 8, fontSize: 11, color: "var(--muted)", marginBottom: 4 }}>Vložit proměnnou:</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {Object.entries(CUSTOM_TEXT_VARIABLES).map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => {
                        const cur = (docConfig.legalText as string) ?? "";
                        updateDocConfig(["legalText"], cur + (cur && !cur.endsWith(" ") ? " " : "") + "{{" + key + "}}");
                      }}
                      style={{ padding: "4px 8px", fontSize: 10, borderRadius: 6, border: "1px solid var(--border)", background: "var(--panel-2)", color: "var(--text)", cursor: "pointer" }}
                      title={`{{${key}}}`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
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
              </div>
              <Accordion title="QR kód" open={accordionOpen.qr} onToggle={() => toggleAccordion("qr")}>
              <div>
                <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 8, color: "var(--text)" }}>Zobrazit QR na dokumentech</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <ModernCheckbox checked={(config.qrOnTicketList as boolean) === true} onChange={(v) => setConfig((prev) => ({ ...prev, qrOnTicketList: v }))} label="Zakázkový list" />
                  <ModernCheckbox checked={(config.qrOnDiagnostic as boolean) === true} onChange={(v) => setConfig((prev) => ({ ...prev, qrOnDiagnostic: v }))} label="Diagnostický protokol" />
                  <ModernCheckbox checked={(config.qrOnWarranty as boolean) !== false} onChange={(v) => setConfig((prev) => ({ ...prev, qrOnWarranty: v }))} label="Záruční list" />
                  <ModernCheckbox checked={(config.qrOnPrijemka as boolean) === true} onChange={(v) => setConfig((prev) => ({ ...prev, qrOnPrijemka: v }))} label="Příjemka reklamace" />
                  <ModernCheckbox checked={(config.qrOnVydejka as boolean) === true} onChange={(v) => setConfig((prev) => ({ ...prev, qrOnVydejka: v }))} label="Výdejka reklamace" />
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 10 }}>
                  <span style={{ fontSize: 12, color: "var(--muted)" }}>Velikost QR: {((config.qrCodeSize as number) ?? 120)} px</span>
                  <input type="range" min={80} max={200} value={((config.qrCodeSize as number) ?? 120)} onChange={(e) => setConfig((prev) => ({ ...prev, qrCodeSize: Number(e.target.value) }))} style={{ flex: 1 }} />
                </div>
                <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 8 }}>Pozici QR kódu změníte tažením v náhledu dokumentu vpravo.</p>
              </div>
              </Accordion>

              <p style={{ fontSize: 12, color: "var(--muted)" }}>Pořadí sekcí upravíte tažením přímo v dokumentu vpravo. Poloviční sekce se zobrazí dvě vedle sebe.</p>

              {context.canManageDocuments === false && (
                <p style={{ fontSize: 13, color: "var(--muted)", padding: "10px 14px", background: "var(--panel)", borderRadius: 12, border: "1px solid var(--border)", marginBottom: 12 }}>
                  Nemáte oprávnění měnit nastavení dokumentů. Nastavení můžete pouze prohlížet. Změny v náhledu se neukládají.
                </p>
              )}
              {configUpdatedAt && (
                <p style={{ fontSize: 12, color: "var(--muted)", marginBottom: 8 }}>
                  Naposledy upraveno: {new Date(configUpdatedAt).toLocaleString("cs-CZ", { day: "numeric", month: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                </p>
              )}
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
                <button
                  onClick={handleSaveConfig}
                  disabled={configLoading || !serviceId || context.canManageDocuments === false}
                  style={{ padding: "14px 24px", borderRadius: 12, border: "none", background: configSaved ? "#16a34a" : "var(--accent)", color: "white", fontWeight: 700, fontSize: 14, cursor: configLoading || !serviceId || context.canManageDocuments === false ? "not-allowed" : "pointer", opacity: context.canManageDocuments === false ? 0.6 : 1 }}
                >
                  {configLoading ? "Ukládám…" : configSaved ? "Uloženo ✓" : "Uložit nastavení dokumentů"}
                </button>
              </div>
            </div>

            <section className="glass-panel document-preview-section" style={{ overflow: "hidden" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12, marginBottom: 12 }}>
                <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0, color: "var(--text)" }}>Náhled dokumentu</h2>
                <div style={{ display: "flex", borderRadius: 10, overflow: "hidden", border: "1px solid var(--border)" }}>
                  <button
                    type="button"
                    onClick={() => setPreviewMode("sample")}
                    style={{
                      padding: "8px 14px",
                      fontSize: 12,
                      fontWeight: 600,
                      border: "none",
                      background: previewMode === "sample" ? "var(--accent)" : "var(--panel)",
                      color: previewMode === "sample" ? "white" : "var(--text)",
                      cursor: "pointer",
                    }}
                  >
                    Náhled
                  </button>
                  <button
                    type="button"
                    onClick={() => setPreviewMode("template")}
                    style={{
                      padding: "8px 14px",
                      fontSize: 12,
                      fontWeight: 600,
                      border: "none",
                      borderLeft: "1px solid var(--border)",
                      background: previewMode === "template" ? "var(--accent)" : "var(--panel)",
                      color: previewMode === "template" ? "white" : "var(--text)",
                      cursor: "pointer",
                    }}
                  >
                    Šablona
                  </button>
                </div>
              </div>
              <p style={{ fontSize: 12, color: "var(--muted)", marginBottom: 12 }}>Přetáhněte sekce pro změnu pořadí. Šablona zobrazí placeholdery typu {"{{customer_name}}"}, {"{{ticket_code}}"}.</p>
              <DocumentPreview docType={docType} config={config} companyData={companyData} onSectionOrderChange={handleSectionOrderChange} onQrPositionChange={(pos) => setConfig((prev) => ({ ...prev, qrPosition: pos }))} onLogoPositionChange={(pos) => setConfig((prev) => ({ ...prev, logoPosition: pos ?? undefined }))} onStampPositionChange={(pos) => setConfig((prev) => ({ ...prev, stampPosition: pos ?? undefined }))} onSignaturePositionChange={(blockId, pos) => { const docKey = DOC_TYPE_TO_UI[docType]; const doc = config[docKey] as Record<string, unknown> | undefined; const current = (doc?.signaturePositions || {}) as Record<string, { x: number; y: number }>; const merged = { ...current }; if (pos == null) delete merged[blockId]; else merged[blockId] = pos; updateDocConfig(["signaturePositions"], merged); }} onLogoSelect={() => { setSelectedPreviewSectionId(null); setSelectedAsset("logo"); }} onStampSelect={() => { setSelectedPreviewSectionId(null); setSelectedAsset("stamp"); }} externalDnd sectionOrder={documentsSectionOrder} orderedSections={documentsOrderedSections} previewMode={previewMode} selectedSectionId={selectedPreviewSectionId} onSectionSelect={(id) => { setSelectedPreviewSectionId(id); setSelectedAsset(null); }} />
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
            <DragOverlay dropAnimation={null}>
              {documentsDragActiveId ? (
                documentsDragActiveId.startsWith("palette-") ? (
                  <div
                    style={{
                      padding: "10px 14px",
                      borderRadius: 10,
                      border: "2px solid var(--accent)",
                      background: "var(--panel)",
                      color: "var(--text)",
                      fontSize: 13,
                      fontWeight: 600,
                      cursor: "grabbing",
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      boxShadow: "0 8px 24px rgba(0,0,0,0.15)",
                    }}
                  >
                    <span style={{ opacity: 0.6 }}>⋮⋮</span>
                    {documentsDragActiveId.startsWith("palette-")
                      ? getSectionDragLabel(documentsDragActiveId.replace("palette-", ""), docConfig)
                      : getPaletteDragLabel(documentsDragActiveId)}
                  </div>
                ) : documentsOrderedSections.includes(documentsDragActiveId) ? (
                  <div
                    style={{
                      padding: "10px 14px",
                      borderRadius: 10,
                      border: "2px solid var(--accent)",
                      background: "var(--panel)",
                      color: "var(--text)",
                      fontSize: 13,
                      fontWeight: 600,
                      cursor: "grabbing",
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      boxShadow: "0 8px 24px rgba(0,0,0,0.15)",
                    }}
                  >
                    <span style={{ opacity: 0.6 }}>⋮⋮</span>
                    {getSectionDragLabel(documentsDragActiveId, docConfig)}
                  </div>
                ) : null
              ) : null}
            </DragOverlay>
          </DndContext>
        )}

        {tab === "o_aplikaci" && (
          <>
            <Breadcrumbs items={[{ label: "O aplikaci", current: true }]} />
            <section className="glass-panel" style={{ maxWidth: 520 }}>
            <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 16, color: "var(--text)" }}>O aplikaci</h2>

            <div style={{ marginBottom: 24 }}>
              <h3 style={{ fontSize: 13, fontWeight: 600, color: "var(--muted)", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.04em" }}>Verze</h3>
              <p style={{ fontSize: 15, fontWeight: 600, color: "var(--text)", margin: 0 }}>JobiDocs {packageJson.version}</p>
            </div>

            <div style={{ marginBottom: 24 }}>
              <h3 style={{ fontSize: 13, fontWeight: 600, color: "var(--muted)", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.04em" }}>Stav API</h3>
              <p style={{ fontSize: 13, color: "var(--text)", margin: 0 }}>
                {health?.ok && "✓ API běží na portu 3847"}
                {error && <span style={{ color: "#dc2626" }}>Chyba API: {error}</span>}
                {!health && !error && "Načítám stav API…"}
              </p>
            </div>

            <div style={{ marginBottom: 24 }}>
              <h3 style={{ fontSize: 13, fontWeight: 600, color: "var(--muted)", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.04em" }}>Aktualizace</h3>
              {window.electron?.update ? (
                <JobiDocsUpdateCard
                  updateState={updateState}
                  updateError={updateError}
                  updateChecking={updateChecking}
                  updateDownloading={updateDownloading}
                  onCheck={async () => {
                    setUpdateError(null);
                    setUpdateChecking(true);
                    try {
                      await window.electron!.update!.check();
                    } finally {
                      setUpdateChecking(false);
                    }
                  }}
                  onDownload={async () => {
                    setUpdateDownloading(true);
                    try {
                      await window.electron!.update!.download();
                    } finally {
                      setUpdateDownloading(false);
                    }
                  }}
                  onRestart={() => window.electron!.update!.quitAndInstall()}
                />
              ) : (
                <p style={{ fontSize: 13, color: "var(--muted)", margin: 0 }}>Aktualizace jsou dostupné pouze v zabalené aplikaci.</p>
              )}
            </div>

          </section>
          </>
        )}
        </div>
      </main>

      {showWizardModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="wizard-dialog-title"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 9997,
            background: "rgba(0,0,0,0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 24,
            boxSizing: "border-box",
          }}
          onClick={() => {
            if (typeof window !== "undefined") localStorage.setItem(WIZARD_STORAGE_KEY, "1");
            setShowWizardBanner(false);
            setShowWizardModal(false);
          }}
        >
          <div
            style={{
              background: "var(--panel)",
              borderRadius: "var(--radius-lg)",
              padding: 28,
              maxWidth: 420,
              width: "100%",
              border: "1px solid var(--border)",
              boxShadow: "var(--shadow)",
              position: "relative",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => {
                if (typeof window !== "undefined") localStorage.setItem(WIZARD_STORAGE_KEY, "1");
                setShowWizardBanner(false);
                setShowWizardModal(false);
              }}
              aria-label="Zavřít"
              style={{ position: "absolute", top: 12, right: 12, padding: 4, border: "none", background: "none", color: "var(--muted)", cursor: "pointer", fontSize: 18, lineHeight: 1 }}
            >
              ×
            </button>
            <h2 id="wizard-dialog-title" style={{ fontSize: 18, fontWeight: 700, marginBottom: 20, color: "var(--text)", paddingRight: 28 }}>
              Průvodce nastavením
            </h2>
            {wizardStep === 1 && (
              <>
                <p style={{ fontSize: 14, color: "var(--text)", marginBottom: 8, lineHeight: 1.5 }}>
                  <strong>Krok 1: Servis</strong>
                </p>
                <p style={{ fontSize: 13, color: "var(--muted)", marginBottom: 20, lineHeight: 1.5 }}>
                  Spusťte Jobi a vyberte servis. JobiDocs pak zobrazí data servisu a uloží nastavení dokumentů do vašeho účtu.
                </p>
                <button
                  type="button"
                  onClick={() => setWizardStep(2)}
                  style={{ padding: "10px 20px", borderRadius: 10, border: "none", background: "var(--accent)", color: "white", fontWeight: 600, fontSize: 14, cursor: "pointer" }}
                >
                  Další
                </button>
              </>
            )}
            {wizardStep === 2 && (
              <>
                <p style={{ fontSize: 14, color: "var(--text)", marginBottom: 8, lineHeight: 1.5 }}>
                  <strong>Krok 2: Tiskárna</strong>
                </p>
                <p style={{ fontSize: 13, color: "var(--muted)", marginBottom: 20, lineHeight: 1.5 }}>
                  Vyberte preferovanou tiskárnu pro tisk dokumentů. Nastavení se ukládá podle servisu.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setWizardStep(3);
                    setTab("tiskarna");
                    if (isNarrow) setSidebarOpen(false);
                  }}
                  style={{ padding: "10px 20px", borderRadius: 10, border: "none", background: "var(--accent)", color: "white", fontWeight: 600, fontSize: 14, cursor: "pointer" }}
                >
                  Další
                </button>
              </>
            )}
            {wizardStep === 3 && (
              <>
                <p style={{ fontSize: 14, color: "var(--text)", marginBottom: 8, lineHeight: 1.5 }}>
                  <strong>Krok 3: Vzor dokumentu</strong>
                </p>
                <p style={{ fontSize: 13, color: "var(--muted)", marginBottom: 20, lineHeight: 1.5 }}>
                  Upravte vzhled a sekce dokumentů (zakázkový list, záruční list, diagnostický protokol atd.). Přetahujte sekce a nastavte logo, razítko a design.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    if (typeof window !== "undefined") localStorage.setItem(WIZARD_STORAGE_KEY, "1");
                    setShowWizardBanner(false);
                    setShowWizardModal(false);
                    setTab("dokumenty");
                    if (isNarrow) setSidebarOpen(false);
                  }}
                  style={{ padding: "10px 20px", borderRadius: 10, border: "none", background: "var(--accent)", color: "white", fontWeight: 600, fontSize: 14, cursor: "pointer" }}
                >
                  Dokončit
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {pendingNav && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="unsaved-dialog-title"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 9998,
            background: "rgba(0,0,0,0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 24,
            boxSizing: "border-box",
          }}
        >
          <div
            style={{
              background: "var(--panel)",
              borderRadius: "var(--radius-lg)",
              padding: 24,
              maxWidth: 400,
              width: "100%",
              border: "1px solid var(--border)",
              boxShadow: "var(--shadow)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="unsaved-dialog-title" style={{ fontSize: 18, fontWeight: 700, marginBottom: 12, color: "var(--text)" }}>
              Neuložené změny
            </h2>
            <p style={{ fontSize: 14, color: "var(--muted)", marginBottom: 20 }}>
              Chcete uložit změny v nastavení dokumentů před přepnutím?
            </p>
            <div style={{ display: "flex", gap: 12, justifyContent: "flex-end", flexWrap: "wrap" }}>
              <button
                type="button"
                onClick={() => setPendingNav(null)}
                style={{ padding: "10px 18px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--panel-2)", color: "var(--text)", fontWeight: 600, cursor: "pointer", fontSize: 14 }}
              >
                Zrušit
              </button>
              <button
                type="button"
                onClick={() => {
                  applyPendingNav();
                  setPendingNav(null);
                }}
                style={{ padding: "10px 18px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--panel-2)", color: "var(--text)", fontWeight: 600, cursor: "pointer", fontSize: 14 }}
              >
                Neukládat
              </button>
              <button
                type="button"
                onClick={async () => {
                  await handleSaveConfig();
                  applyPendingNav();
                  setPendingNav(null);
                }}
                disabled={configLoading}
                style={{ padding: "10px 18px", borderRadius: 10, border: "none", background: "var(--accent)", color: "white", fontWeight: 600, cursor: configLoading ? "not-allowed" : "pointer", fontSize: 14 }}
              >
                {configLoading ? "Ukládám…" : "Uložit"}
              </button>
            </div>
          </div>
        </div>
      )}

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
                      const html = generateDocumentHtml(config, docType, context.companyData || {}, undefined, { variables: getSampleVariablesForPreview(context.companyData || {}) });
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
