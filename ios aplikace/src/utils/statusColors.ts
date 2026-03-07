// Paleta různých barev pro statusy zakázek
// Seřazeno podle barevného spektra (duha: červená → oranžová → žlutá → zelená → modrá → indigo → fialová → růžová → neutrální)
// V rámci každé kategorie od světlé k tmavé pro plynulý přechod
// Celkem: 75 barev
export const STATUS_COLOR_PALETTE = [
  // Červené (chyba, problém) - 6 barev (od světlé k tmavé)
  { bg: "#F87171", fg: "#7F1D1D", name: "Světle červená" },
  { bg: "#EF4444", fg: "#7F1D1D", name: "Červená" },
  { bg: "#F43F5E", fg: "#FFF1F2", name: "Rose" },
  { bg: "#DC2626", fg: "#FEF2F2", name: "Tmavě červená" },
  { bg: "#BE123C", fg: "#FFF1F2", name: "Červená růže" },
  { bg: "#B91C1C", fg: "#FEF2F2", name: "Červená krev" },
  
  // Oranžové (pozornost, varování) - 5 barev (od světlé k tmavé)
  { bg: "#FB923C", fg: "#7C2D12", name: "Světle oranžová" },
  { bg: "#FF6B35", fg: "#7C2D12", name: "Jasně oranžová" },
  { bg: "#F97316", fg: "#7C2D12", name: "Oranžová" },
  { bg: "#EA580C", fg: "#FFF7ED", name: "Tmavě oranžová" },
  { bg: "#C2410C", fg: "#FFF7ED", name: "Oranžová západ" },
  
  // Žluté/Amber (pozornost) - 5 barev (od světlé k tmavé)
  { bg: "#FCD34D", fg: "#78350F", name: "Jasně žlutá" },
  { bg: "#FBBF24", fg: "#78350F", name: "Zlatá" },
  { bg: "#F59E0B", fg: "#78350F", name: "Amber" },
  { bg: "#EAB308", fg: "#78350F", name: "Žlutá" },
  { bg: "#CA8A04", fg: "#FEF9C3", name: "Tmavě žlutá" },
  
  // Limetkové/Zelené světlé - 5 barev (od světlé k tmavé)
  { bg: "#D9F99D", fg: "#365314", name: "Limetková tráva" },
  { bg: "#BEF264", fg: "#365314", name: "Světle limetková" },
  { bg: "#A3E635", fg: "#365314", name: "Lime" },
  { bg: "#84CC16", fg: "#365314", name: "Limetková" },
  { bg: "#65A30D", fg: "#F7FEE7", name: "Tmavě limetková" },
  
  // Zelené (úspěch, hotovo) - 6 barev (od světlé k tmavé)
  { bg: "#4ADE80", fg: "#14532D", name: "Jasně zelená" },
  { bg: "#22C55E", fg: "#14532D", name: "Zelená" },
  { bg: "#16A34A", fg: "#14532D", name: "Zelená tráva" },
  { bg: "#10B981", fg: "#064E3B", name: "Emerald" },
  { bg: "#059669", fg: "#F0FDF4", name: "Tmavě zelená" },
  { bg: "#15803D", fg: "#F0FDF4", name: "Zelená les" },
  
  // Tyrkysové/Teal (modro-zelená) - 5 barev (od světlé k tmavé)
  { bg: "#2DD4BF", fg: "#134E4A", name: "Světle tyrkysová" },
  { bg: "#14B8A6", fg: "#F0FDFA", name: "Tyrkysová" },
  { bg: "#0D9488", fg: "#F0FDFA", name: "Teal" },
  { bg: "#0F766E", fg: "#F0FDFA", name: "Tmavě teal" },
  { bg: "#115E59", fg: "#F0FDFA", name: "Teal tmavá" },
  
  // Cyan/Sky (azurová, nebeská) - 5 barev (od světlé k tmavé)
  { bg: "#67E8F9", fg: "#164E63", name: "Světle cyan" },
  { bg: "#06B6D4", fg: "#F0F9FF", name: "Cyan" },
  { bg: "#0EA5E9", fg: "#F0F9FF", name: "Sky" },
  { bg: "#0891B2", fg: "#F0F9FF", name: "Tmavě cyan" },
  { bg: "#155E75", fg: "#F0F9FF", name: "Cyan tmavá" },
  
  // Modré (v procesu, aktivní) - 6 barev (od světlé k tmavé)
  { bg: "#93C5FD", fg: "#1E3A8A", name: "Nebeská modrá" },
  { bg: "#60A5FA", fg: "#1E40AF", name: "Světle modrá" },
  { bg: "#3B82F6", fg: "#1E3A8A", name: "Modrá" },
  { bg: "#2563EB", fg: "#1E3A8A", name: "Tmavě modrá" },
  { bg: "#1D4ED8", fg: "#EFF6FF", name: "Námořní modrá" },
  { bg: "#1E3A8A", fg: "#EFF6FF", name: "Tmavá modrá" },
  
  // Indigo (modro-fialová) - 5 barev (od světlé k tmavé)
  { bg: "#818CF8", fg: "#312E81", name: "Světle indigo" },
  { bg: "#6366F1", fg: "#EEF2FF", name: "Indigo" },
  { bg: "#4F46E5", fg: "#EEF2FF", name: "Tmavě indigo" },
  { bg: "#4338CA", fg: "#EEF2FF", name: "Indigo květ" },
  { bg: "#312E81", fg: "#EEF2FF", name: "Indigo tmavá" },
  
  // Fialové/Violet (čekání, pending) - 6 barev (od světlé k tmavé)
  { bg: "#C4B5FD", fg: "#4C1D95", name: "Lavendrová" },
  { bg: "#A855F7", fg: "#4C1D95", name: "Purple" },
  { bg: "#8B5CF6", fg: "#4C1D95", name: "Fialová" },
  { bg: "#7C3AED", fg: "#F5F3FF", name: "Violet" },
  { bg: "#9333EA", fg: "#F5F3FF", name: "Tmavě fialová" },
  { bg: "#6D28D9", fg: "#F5F3FF", name: "Fialová tmavá" },
  
  // Růžové (speciální) - 6 barev (od světlé k tmavé)
  { bg: "#F9A8D4", fg: "#831843", name: "Růžová světlá" },
  { bg: "#F472B6", fg: "#831843", name: "Světle růžová" },
  { bg: "#EC4899", fg: "#FFF1F2", name: "Růžová" },
  { bg: "#DB2777", fg: "#FFF1F2", name: "Tmavě růžová" },
  { bg: "#BE185D", fg: "#FFF1F2", name: "Růžová květ" },
  { bg: "#9F1239", fg: "#FFF1F2", name: "Růžová tmavá" },
  
  // Šedé/neutrální (od světlé k tmavé) - 15 barev
  { bg: "#FFFFFF", fg: "#111827", name: "Bílá" },
  { bg: "#F9FAFB", fg: "#111827", name: "Bílá šedá" },
  { bg: "#F3F4F6", fg: "#374151", name: "Světle šedá" },
  { bg: "#E5E7EB", fg: "#4B5563", name: "Šedá střední" },
  { bg: "#D1D5DB", fg: "#374151", name: "Šedá světlá" },
  { bg: "#9CA3AF", fg: "#F9FAFB", name: "Tmavě šedá" },
  { bg: "#6B7280", fg: "#F9FAFB", name: "Šedá" },
  { bg: "#4B5563", fg: "#F9FAFB", name: "Šedo-modrá" },
  { bg: "#475569", fg: "#F1F5F9", name: "Slate" },
  { bg: "#374151", fg: "#F9FAFB", name: "Šedá tmavá" },
  { bg: "#78716C", fg: "#FAFAF9", name: "Stone" },
  { bg: "#1F2937", fg: "#F9FAFB", name: "Šedo-černá" },
  { bg: "#111827", fg: "#F9FAFB", name: "Tmavě šedá" },
  { bg: "#0F172A", fg: "#F9FAFB", name: "Tmavě šedo-modrá" },
  { bg: "#000000", fg: "#FFFFFF", name: "Černá" },
];

// Funkce pro výpočet kontrastní barvy textu na základě pozadí
export function getContrastText(bgColor: string): string {
  // Pokud je barva světlá, vrať tmavý text, jinak světlý
  const hex = bgColor.replace("#", "");
  const r = parseInt(hex.substr(0, 2), 16);
  const g = parseInt(hex.substr(2, 2), 16);
  const b = parseInt(hex.substr(4, 2), 16);
  
  // Vypočti relativní luminance
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  
  return luminance > 0.5 ? "#111827" : "#F9FAFB";
}
