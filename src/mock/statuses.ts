// ✅ dynamické keys (nutné pro CRUD v Settings)
export type PrimaryStatusKey = string;

export type PrimaryStatus = {
  key: PrimaryStatusKey;
  label: string;
  bg?: string;
  fg?: string;
  isFinal?: boolean;
};

export const PRIMARY_STATUSES: PrimaryStatus[] = [
  // Výraznější modrá pro "Přijato"
  { key: "received", label: "Přijato", bg: "#3B82F6", fg: "#EFF6FF", isFinal: false },
  // Výraznější fialová pro "V opravě"
  { key: "in_progress", label: "V opravě", bg: "#8B5CF6", fg: "#F5F3FF", isFinal: false },
  // Výraznější oranžová pro "Čeká na zákazníka"
  { key: "waiting_customer", label: "Čeká na zákazníka", bg: "#F97316", fg: "#FFF7ED", isFinal: false },
  // Výraznější červená pro "Čeká na díl"
  { key: "waiting_part", label: "Čeká na díl", bg: "#EF4444", fg: "#FEF2F2", isFinal: false },
  // Výraznější zelená pro "Připraveno k vyzvednutí"
  { key: "ready", label: "Připraveno k vyzvednutí", bg: "#22C55E", fg: "#F0FDF4", isFinal: false },

  // ✅ finální defaulty - výraznější
  { key: "done", label: "Vydáno / Hotovo", bg: "#10B981", fg: "#F0FDF4", isFinal: true },
  { key: "cancelled", label: "Zrušeno", bg: "#DC2626", fg: "#FEF2F2", isFinal: true },
];
