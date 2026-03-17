export interface DesignPreset {
  name: string;
  description: string;
  values: {
    designAccentColor: string;
    designPrimaryColor: string;
    designSecondaryColor: string;
    designHeaderBg: string;
    designSectionBorder: string;
    colorMode?: "color" | "bw";
  };
}

export const DESIGN_PRESETS: DesignPreset[] = [
  {
    name: "Profesionální",
    description: "Modrá, čistý a seriózní vzhled",
    values: {
      designAccentColor: "#2563eb",
      designPrimaryColor: "#1e293b",
      designSecondaryColor: "#475569",
      designHeaderBg: "#f8fafc",
      designSectionBorder: "#e2e8f0",
      colorMode: "color",
    },
  },
  {
    name: "Moderní",
    description: "Fialová, elegantní kontrast",
    values: {
      designAccentColor: "#7c3aed",
      designPrimaryColor: "#1e1b4b",
      designSecondaryColor: "#6366f1",
      designHeaderBg: "#faf5ff",
      designSectionBorder: "#e9d5ff",
      colorMode: "color",
    },
  },
  {
    name: "Minimalistický",
    description: "Černobílý, čistý a přehledný",
    values: {
      designAccentColor: "#374151",
      designPrimaryColor: "#111827",
      designSecondaryColor: "#6b7280",
      designHeaderBg: "#f9fafb",
      designSectionBorder: "#e5e7eb",
      colorMode: "bw",
    },
  },
  {
    name: "Teplý",
    description: "Oranžové akcenty, přátelský",
    values: {
      designAccentColor: "#ea580c",
      designPrimaryColor: "#292524",
      designSecondaryColor: "#78716c",
      designHeaderBg: "#fffbeb",
      designSectionBorder: "#fed7aa",
      colorMode: "color",
    },
  },
  {
    name: "Přírodní",
    description: "Zelená, klidný a svěží",
    values: {
      designAccentColor: "#059669",
      designPrimaryColor: "#064e3b",
      designSecondaryColor: "#6b7280",
      designHeaderBg: "#f0fdf4",
      designSectionBorder: "#bbf7d0",
      colorMode: "color",
    },
  },
  {
    name: "Korporátní",
    description: "Tmavě modrý, formální styl",
    values: {
      designAccentColor: "#1e40af",
      designPrimaryColor: "#0f172a",
      designSecondaryColor: "#334155",
      designHeaderBg: "#eff6ff",
      designSectionBorder: "#bfdbfe",
      colorMode: "color",
    },
  },
  {
    name: "Růžový",
    description: "Jemný, moderní dojem",
    values: {
      designAccentColor: "#db2777",
      designPrimaryColor: "#1f2937",
      designSecondaryColor: "#6b7280",
      designHeaderBg: "#fdf2f8",
      designSectionBorder: "#fbcfe8",
      colorMode: "color",
    },
  },
  {
    name: "Tmavý bronz",
    description: "Luxusní, prémiový vzhled",
    values: {
      designAccentColor: "#92400e",
      designPrimaryColor: "#1c1917",
      designSecondaryColor: "#57534e",
      designHeaderBg: "#fefce8",
      designSectionBorder: "#d6d3d1",
      colorMode: "color",
    },
  },
];
