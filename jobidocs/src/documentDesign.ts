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
    primaryColor: "#111827",
    secondaryColor: "#374151",
    headerBg: "#f9fafb",
    headerText: "#111827",
    sectionBorder: "1px solid #e5e7eb",
    headerBorder: "2px solid #111827",
    sectionRadius: 0,
  },
  modern: {
    primaryColor: "#0c4a6e",
    secondaryColor: "#0284c7",
    headerBg: "linear-gradient(135deg, #f0f9ff 0%, #e0f2fe 100%)",
    headerText: "#0c4a6e",
    sectionBorder: "1px solid #e2e8f0",
    headerBorder: "2px solid #38bdf8",
    sectionRadius: 8,
  },
  minimal: {
    primaryColor: "#0a0a0a",
    secondaryColor: "#404040",
    headerBg: "transparent",
    headerText: "#0a0a0a",
    sectionBorder: "1px solid #e5e5e5",
    headerBorder: "1px solid #d4d4d4",
    sectionRadius: 0,
  },
  professional: {
    primaryColor: "#1e293b",
    secondaryColor: "#334155",
    headerBg: "#f8fafc",
    headerText: "#1e293b",
    sectionBorder: "1px solid #e2e8f0",
    headerBorder: "2px solid #334155",
    sectionRadius: 4,
  },
};

/** BW: per-design greyscale – zachovává rozdíly (lineStyle, sectionHeaderStyle, lineWeight) */
const BW_COLORS: Record<DocumentDesign, { headerBg: string; headerBorder: string; sectionBorder: string }> = {
  classic: { headerBg: "transparent", headerBorder: "2px solid #171717", sectionBorder: "1px solid #e5e5e5" },
  modern: { headerBg: "#fafafa", headerBorder: "2px solid #404040", sectionBorder: "1px solid #e5e5e5" },
  minimal: { headerBg: "transparent", headerBorder: "1px solid #d4d4d4", sectionBorder: "1px solid #f0f0f0" },
  professional: { headerBg: "transparent", headerBorder: "2px solid #1e293b", sectionBorder: "1px solid #e2e8f0" },
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
