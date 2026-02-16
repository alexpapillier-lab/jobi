/**
 * Sdílený modul designu dokumentů – tokeny + layout spec.
 * Používá documentToHtml (PDF) i App.tsx (náhled).
 * Design = tokeny (barvy, radius, border). Layout = struktura (headerLayout, sectionStyle, …).
 * BW režim zachovává rozdíly tvarů (linky, nadpisy), ne jen jednu šedou.
 * Accent se aplikuje per-design (Classic: nadpisy; Modern: pruh + chips; Professional: tenká linka; Minimal: jedno podtržení).
 */

export type DocumentDesign = "classic" | "modern" | "minimal" | "professional";

export type HeaderLayout = "classicRow" | "letterhead" | "splitBox" | "receipt";
export type SectionStyle = "boxed" | "ruled" | "cards" | "underlineTitles" | "leftStripe";
export type TableStyle = "zebra" | "ledgerLines" | "minimalist";
export type MetaStyle = "chips" | "inline" | "leftColumn";
export type Density = "compact" | "normal";

/** BW: styl linek – zachová rozdíly bez barvy */
export type LineStyle = "solid" | "double" | "dashed" | "hairline";
/** BW: motiv nadpisu sekce */
export type SectionHeaderStyle = "underline" | "capsule" | "leftStripe" | "uppercase";

export interface LayoutSpec {
  headerLayout: HeaderLayout;
  sectionStyle: SectionStyle;
  tableStyle: TableStyle;
  metaStyle: MetaStyle;
  density: Density;
  /** BW: styl hlavních linek (header border, section borders) */
  lineStyle: LineStyle;
  /** BW: motiv nadpisu sekce */
  sectionHeaderStyle: SectionHeaderStyle;
  /** BW: tloušťka / výraznost linek (px) */
  lineWeight: number;
}

export interface DesignTokens {
  primaryColor: string;
  secondaryColor: string;
  contentColor: string;
  headerBg: string;
  headerText: string;
  sectionBg: string;
  sectionBorder: string;
  headerBorder: string;
  sectionRadius: number;
  /** Kde se má použít accent (barva) – pro šablonu */
  accentUsage: "sectionTitlesOnly" | "stripeAndChips" | "headerLineOnly" | "singleUnderline" | "none";
  /** Pro UI náhled (borderColor, accentColor atd.) */
  accentColor: string;
  borderColor: string;
  borderWidth: number;
}

export interface DesignStylesResult {
  tokens: DesignTokens;
  spec: LayoutSpec;
}

export interface DesignColorOverrides {
  primary?: string;
  secondary?: string;
  headerBg?: string;
  sectionBorder?: string;
}

function isValidHex(s: string | undefined): boolean {
  return !!s && /^#[0-9a-fA-F]{6}$/.test(s);
}

const LAYOUT_BY_DESIGN: Record<DocumentDesign, LayoutSpec> = {
  classic: {
    headerLayout: "classicRow",
    sectionStyle: "ruled",
    tableStyle: "ledgerLines",
    metaStyle: "inline",
    density: "normal",
    lineStyle: "solid",
    sectionHeaderStyle: "uppercase",
    lineWeight: 1,
  },
  modern: {
    headerLayout: "splitBox",
    sectionStyle: "cards",
    tableStyle: "zebra",
    metaStyle: "chips",
    density: "normal",
    lineStyle: "solid",
    sectionHeaderStyle: "capsule",
    lineWeight: 2,
  },
  minimal: {
    headerLayout: "classicRow",
    sectionStyle: "underlineTitles",
    tableStyle: "minimalist",
    metaStyle: "inline",
    density: "compact",
    lineStyle: "hairline",
    sectionHeaderStyle: "underline",
    lineWeight: 1,
  },
  professional: {
    headerLayout: "letterhead",
    sectionStyle: "leftStripe",
    tableStyle: "ledgerLines",
    metaStyle: "leftColumn",
    density: "normal",
    lineStyle: "solid",
    sectionHeaderStyle: "leftStripe",
    lineWeight: 2,
  },
};

const COLOR_BY_DESIGN: Record<
  DocumentDesign,
  {
    primaryColor: string;
    secondaryColor: string;
    headerBg: string;
    headerText: string;
    sectionBorder: string;
    headerBorder: string;
    sectionRadius: number;
  }
> = {
  classic: {
    primaryColor: "#1f2937",
    secondaryColor: "#4b5563",
    headerBg: "#f9fafb",
    headerText: "#1f2937",
    sectionBorder: "1px solid #e5e7eb",
    headerBorder: "2px solid #d1d5db",
    sectionRadius: 8,
  },
  modern: {
    primaryColor: "#0c4a6e",
    secondaryColor: "#0284c7",
    headerBg: "linear-gradient(135deg, #f0f9ff 0%, #e0f2fe 100%)",
    headerText: "#0c4a6e",
    sectionBorder: "1px solid #bae6fd",
    headerBorder: "2px solid #38bdf8",
    sectionRadius: 12,
  },
  minimal: {
    primaryColor: "#171717",
    secondaryColor: "#525252",
    headerBg: "transparent",
    headerText: "#171717",
    sectionBorder: "1px solid #e5e5e5",
    headerBorder: "1px solid #d4d4d4",
    sectionRadius: 0,
  },
  professional: {
    primaryColor: "#1e3a5f",
    secondaryColor: "#334155",
    headerBg: "linear-gradient(180deg, #f8fafc 0%, #f1f5f9 100%)",
    headerText: "#1e3a5f",
    sectionBorder: "1px solid #cbd5e1",
    headerBorder: "2px solid #94a3b8",
    sectionRadius: 6,
  },
};

/** BW: per-design greyscale – zachovává rozdíly (lineStyle, sectionHeaderStyle, lineWeight) */
const BW_COLORS: Record<DocumentDesign, { headerBg: string; headerBorder: string; sectionBorder: string }> = {
  classic: { headerBg: "#fafafa", headerBorder: "1px solid #d4d4d4", sectionBorder: "1px solid #e5e5e5" },
  modern: { headerBg: "#f5f5f5", headerBorder: "2px solid #a3a3a3", sectionBorder: "1px solid #d4d4d4" },
  minimal: { headerBg: "transparent", headerBorder: "1px solid #e5e5e5", sectionBorder: "1px solid #f0f0f0" },
  professional: { headerBg: "#f8f8f8", headerBorder: "1px solid #94a3b8", sectionBorder: "1px solid #cbd5e1" },
};

const ACCENT_USAGE_BY_DESIGN: Record<DocumentDesign, DesignTokens["accentUsage"]> = {
  classic: "sectionTitlesOnly",
  modern: "stripeAndChips",
  minimal: "singleUnderline",
  professional: "headerLineOnly",
};

export function getDesignStyles(
  design: DocumentDesign,
  colorMode: "color" | "bw" = "color",
  accentOverride?: string,
  colorOverrides?: DesignColorOverrides
): DesignStylesResult {
  const rawBase = COLOR_BY_DESIGN[design];
  const applyOverrides = (design === "modern" || design === "professional") && colorOverrides;
  const ov = colorOverrides;
  const base = {
    primaryColor: (applyOverrides && ov && isValidHex(ov.primary) ? ov.primary : rawBase.primaryColor) as string,
    secondaryColor: (applyOverrides && ov && isValidHex(ov.secondary) ? ov.secondary : rawBase.secondaryColor) as string,
    headerBg: (applyOverrides && ov && isValidHex(ov.headerBg) ? ov.headerBg : rawBase.headerBg) as string,
    headerText: (applyOverrides && ov && isValidHex(ov.primary) ? ov.primary : rawBase.headerText) as string,
    sectionBorder: (applyOverrides && ov && isValidHex(ov.sectionBorder) ? `1px solid ${ov.sectionBorder}` : rawBase.sectionBorder) as string,
    headerBorder: (applyOverrides && ov && isValidHex(ov.sectionBorder) ? `2px solid ${ov.sectionBorder}` : rawBase.headerBorder) as string,
    sectionRadius: rawBase.sectionRadius,
  };
  const spec = LAYOUT_BY_DESIGN[design];
  const accentUsage = ACCENT_USAGE_BY_DESIGN[design];

  const isBw = colorMode === "bw";
  const bw = BW_COLORS[design];

  let primaryColor: string;
  let secondaryColor: string;
  let headerBg: string;
  let headerText: string;
  let sectionBorder: string;
  let headerBorder: string;
  let sectionRadius: number;
  let accentColor: string;
  let borderColor: string;
  let borderWidth: number;

  if (isBw) {
    primaryColor = "#171717";
    secondaryColor = "#525252";
    headerBg = bw.headerBg;
    headerText = "#171717";
    sectionBorder = bw.sectionBorder;
    headerBorder = bw.headerBorder;
    sectionRadius = base.sectionRadius;
    accentColor = "#737373";
    borderColor = "#d4d4d4";
    borderWidth = spec.lineWeight;
  } else {
    if (accentUsage === "sectionTitlesOnly" && accentOverride) {
      primaryColor = base.primaryColor;
      secondaryColor = accentOverride;
      headerBg = base.headerBg;
      headerText = base.headerText;
      sectionBorder = base.sectionBorder;
      headerBorder = base.headerBorder;
      sectionRadius = base.sectionRadius;
      accentColor = accentOverride;
      borderColor = base.sectionBorder.replace(/^1px solid /, "");
      borderWidth = 2;
    } else if (accentUsage === "stripeAndChips" && accentOverride) {
      primaryColor = base.primaryColor;
      secondaryColor = base.secondaryColor;
      headerBg = base.headerBg;
      headerText = base.headerText;
      sectionBorder = `1px solid ${accentOverride}99`;
      headerBorder = `2px solid ${accentOverride}`;
      sectionRadius = base.sectionRadius;
      accentColor = accentOverride;
      borderColor = `${accentOverride}99`;
      borderWidth = 2;
    } else if (accentUsage === "headerLineOnly" && accentOverride) {
      primaryColor = base.primaryColor;
      secondaryColor = base.secondaryColor;
      headerBg = base.headerBg;
      headerText = base.headerText;
      sectionBorder = base.sectionBorder;
      headerBorder = `2px solid ${accentOverride}`;
      sectionRadius = base.sectionRadius;
      accentColor = accentOverride;
      borderColor = base.sectionBorder.replace(/^1px solid /, "");
      borderWidth = 2;
    } else if (accentUsage === "singleUnderline" && accentOverride) {
      primaryColor = base.primaryColor;
      secondaryColor = accentOverride;
      headerBg = base.headerBg;
      headerText = base.headerText;
      sectionBorder = base.sectionBorder;
      headerBorder = base.headerBorder;
      sectionRadius = base.sectionRadius;
      accentColor = accentOverride;
      borderColor = base.sectionBorder.replace(/^1px solid /, "");
      borderWidth = 1;
    } else {
      primaryColor = accentOverride || base.primaryColor;
      secondaryColor = accentOverride ? primaryColor : base.secondaryColor;
      headerBg = base.headerBg;
      headerText = primaryColor;
      sectionBorder = base.sectionBorder;
      headerBorder = base.headerBorder;
      sectionRadius = base.sectionRadius;
      accentColor = accentOverride || (design === "modern" ? "#38bdf8" : design === "professional" ? "#94a3b8" : "#6b7280");
      borderColor = base.sectionBorder.replace(/^1px solid /, "");
      borderWidth = spec.lineWeight;
    }
  }

  const tokens: DesignTokens = {
    primaryColor,
    secondaryColor,
    contentColor: "#171717",
    headerBg,
    headerText,
    sectionBg: "#ffffff",
    sectionBorder,
    headerBorder,
    sectionRadius,
    accentUsage: isBw ? "none" : accentUsage,
    accentColor,
    borderColor,
    borderWidth,
  };

  return { tokens, spec };
}

/** Pro zpětnou kompatibilitu: vrací plochý objekt jako dříve getDesignStyles (barvy + sectionRadius jako number). */
export function getDesignStylesFlat(
  design: DocumentDesign,
  colorMode: "color" | "bw" = "color",
  accentOverride?: string
): DesignTokens & { spec: LayoutSpec } {
  const { tokens, spec } = getDesignStyles(design, colorMode, accentOverride);
  return { ...tokens, spec };
}
