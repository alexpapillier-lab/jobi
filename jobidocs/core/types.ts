/**
 * JobiDocs core – typy.
 *
 * Čisté TypeScript bez závislosti na Node, Electronu nebo Reactu. Používá ho
 * editor (náhled), Electron (tisk) i webová verze Jobi (tisk z prohlížeče),
 * takže všude vzniká stejné HTML.
 *
 * Tři věci se tu potkávají:
 *  - DocumentData  … co se tiskne (data zakázky / reklamace / faktury z Jobi)
 *  - Template      … jak se to tiskne (bloky v toku + sloty v hlavičce a dole)
 *  - Brand / Theme … vzhled společný pro všechny dokumenty servisu
 */

export type DocType =
  | "zakazkovy_list"
  | "zarucni_list"
  | "diagnosticky_protokol"
  | "prijemka_reklamace"
  | "vydejka_reklamace"
  | "faktura";

export const DOC_TYPES: DocType[] = [
  "zakazkovy_list",
  "zarucni_list",
  "diagnosticky_protokol",
  "prijemka_reklamace",
  "vydejka_reklamace",
  "faktura",
];

export const DOC_TYPE_LABELS: Record<DocType, string> = {
  zakazkovy_list: "Zakázkový list",
  zarucni_list: "Záruční list",
  diagnosticky_protokol: "Diagnostika zařízení",
  prijemka_reklamace: "Příjemka reklamace",
  vydejka_reklamace: "Výdejka reklamace",
  faktura: "Faktura",
};

// ---------------------------------------------------------------------------
// Data dokumentu (posílá Jobi při tisku)
// ---------------------------------------------------------------------------

export type Party = {
  name?: string;
  /** Kontaktní osoba / majitel (u servisu „iSwap Repair Point – Jakub Zima“). */
  person?: string;
  company?: string;
  ico?: string;
  dic?: string;
  address?: string;
  phone?: string;
  email?: string;
  web?: string;
  /** Poznámka k zákazníkovi (customerInfo). */
  note?: string;
};

export type LineItem = {
  name: string;
  description?: string;
  qty?: number;
  unit?: string;
  unitPrice?: number;
  vatRate?: number;
  total?: number;
};

export type DocumentData = {
  /**
   * Nadpis dokladu, když se liší od názvu typu – „Faktura – daňový doklad“,
   * „Zálohová faktura“, „Dobropis“. Má přednost před textem v šabloně,
   * protože o druhu dokladu rozhodují data, ne vzhled.
   */
  title?: string;
  /** Číslo dokumentu: kód zakázky, reklamace nebo faktury. */
  number?: string;
  /** Související číslo (u reklamace původní zakázka, u faktury zakázka). */
  relatedNumber?: string;
  /** PIN zakázky pro zákaznický portál, pokud existuje. */
  pin?: string;
  /** Odkaz na zákaznický portál (stav zakázky online) – vzniká v Jobi při tisku. */
  portalUrl?: string;
  service: Party;
  customer?: Party;
  device?: {
    name?: string;
    brand?: string;
    model?: string;
    serial?: string;
    imei?: string;
    passcode?: string;
    condition?: string;
    accessories?: string;
    /** Požadovaná oprava / popis závady. */
    issue?: string;
    note?: string;
  };
  /** Data jako ISO řetězce nebo už naformátovaná (renderer pozná). */
  dates?: {
    received?: string;
    eta?: string;
    completed?: string;
    diagnosed?: string;
    released?: string;
    issued?: string;
    due?: string;
    taxable?: string;
  };
  handoff?: { receive?: string; return?: string };
  items?: LineItem[];
  discount?: { type: "percentage" | "amount"; value: number };
  totals?: {
    subtotal?: number;
    vat?: number;
    total?: number;
    rounding?: number;
    currency?: string;
    /** false = servis není plátce DPH; DPH řádky se netisknou. */
    vatPayer?: boolean;
    estimated?: number;
  };
  diagnostic?: string;
  /** Kontrola po opravě: co technik ověřil před předáním (ok / fail / skipped). */
  checklist?: { title?: string; items: Array<{ text: string; status?: "ok" | "fail" | "skipped" | null; note?: string }> };
  note?: string;
  /** URL fotek (https nebo data URL). */
  photos?: string[];
  warranty?: { months?: number; until?: string; text?: string };
  payment?: { account?: string; iban?: string; swift?: string; vs?: string; spayd?: string };
  /** Cokoli dalšího, na co se dá v textu odkázat přes {{extra.klic}}. */
  extra?: Record<string, string>;
};

// ---------------------------------------------------------------------------
// Šablona
// ---------------------------------------------------------------------------

/** Řádek tabulky údajů: štítek + hodnota s proměnnými {{…}}. */
export type FieldRow = {
  id: string;
  label: string;
  value: string;
  /** Prázdný řádek se vynechá (výchozí true). */
  hideEmpty?: boolean;
};

export type ItemsColumn = "name" | "qty" | "unit" | "unitPrice" | "vatRate" | "total";

export type BlockWhen = "always" | "notEmpty";

export type Block =
  | { id: string; type: "fields"; title?: string; rows: FieldRow[]; layout?: "grid" | "table"; when?: BlockWhen }
  | { id: string; type: "items"; title?: string; columns: ItemsColumn[]; showTotal?: boolean; when?: BlockWhen }
  | { id: string; type: "text"; title?: string; content: string; size?: "normal" | "small"; align?: "left" | "justify" | "center"; columns?: 1 | 2; when?: BlockWhen }
  | { id: string; type: "heading"; text: string; level?: 1 | 2 }
  | { id: string; type: "divider" }
  | { id: string; type: "spacer"; height: number }
  | { id: string; type: "columns"; left: Block[]; right: Block[] }
  | { id: string; type: "signature"; label: string; align?: "left" | "center" | "right"; width?: number }
  | { id: string; type: "photos"; title?: string; mode: "pages" | "grid"; when?: BlockWhen }
  | { id: string; type: "warranty"; title?: string; when?: BlockWhen }
  | { id: string; type: "vatSummary"; when?: BlockWhen }
  | { id: string; type: "payment"; title?: string; showQr?: boolean; when?: BlockWhen };

export type BlockType = Block["type"];

/** Prvek ve slotu (hlavička / spodek stránky). */
export type SlotItem =
  | { id: string; type: "title"; text?: string; style?: "box" | "plain"; showNumber?: boolean; showDate?: boolean }
  | { id: string; type: "brand"; showContact?: boolean }
  | { id: string; type: "logo"; height?: number }
  | { id: string; type: "stamp"; label?: string; height?: number }
  /** QR kód: `review` = odkaz na hodnocení ze Značky, `portal` = odkaz na stav zakázky online (z dat dokumentu). */
  | { id: string; type: "qr"; source?: "review" | "portal"; text?: string; size?: number }
  | { id: string; type: "signature"; label: string; width?: number }
  | { id: string; type: "text"; content: string; size?: "normal" | "small" }
  | { id: string; type: "contact" }
  | { id: string; type: "pageNumber" };

export type SlotItemType = SlotItem["type"];

export type HeaderSlot = "headerLeft" | "headerRight";
export type BottomSlot = "bottomLeft" | "bottomCenter" | "bottomRight";
export type SlotName = HeaderSlot | BottomSlot;

export const SLOT_NAMES: SlotName[] = ["headerLeft", "headerRight", "bottomLeft", "bottomCenter", "bottomRight"];

export const SLOT_LABELS: Record<SlotName, string> = {
  headerLeft: "Hlavička vlevo",
  headerRight: "Hlavička vpravo",
  bottomLeft: "Dole vlevo",
  bottomCenter: "Dole uprostřed",
  bottomRight: "Dole vpravo",
};

export type Template = {
  schemaVersion: 2;
  docType: DocType;
  page: {
    /** Okraje v mm. */
    margins: { top: number; right: number; bottom: number; left: number };
    /** onePage = zmenšovat písmo, dokud se dokument nevejde na jednu stranu. */
    fit: "onePage" | "auto";
    /** Základní velikost písma v pt. */
    fontSize: number;
  };
  slots: Record<SlotName, SlotItem[]>;
  blocks: Block[];
};

// ---------------------------------------------------------------------------
// Značka a motiv (per servis, společné pro všechny dokumenty)
// ---------------------------------------------------------------------------

export type Brand = {
  logoUrl?: string;
  stampUrl?: string;
  /** Předtištěný hlavičkový papír, sloučí se pod každou stranu. */
  letterheadPdfUrl?: string;
  reviewUrl?: string;
  reviewText?: string;
};

export type ThemeStyle = "modern" | "plain" | "form";

export type Theme = {
  /** Celkový vzhled: moderní (výchozí), strohý, formulář. */
  style: ThemeStyle;
  font: "roboto" | "inter" | "system";
  /** Barva rámečku nadpisu a linek nadpisů. */
  accent: string;
  /** Linky v tabulce údajů. */
  tableLines: "all" | "rows" | "none";
  /** Barevný nebo černobílý tisk (obrázky se převedou do šedi). */
  color: "color" | "bw";
};

/** Kompletní nastavení dokumentů servisu, uložené v service_document_settings.config.v2. */
export type DocumentsV2 = {
  schemaVersion: 2;
  brand: Brand;
  theme: Theme;
  templates: Partial<Record<DocType, Template>>;
};

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

export type RenderMode = "print" | "editor";

export type RenderOptions = {
  mode: RenderMode;
  /** V editoru: zástupné texty {{…}} místo hodnot. */
  showPlaceholders?: boolean;
};
