export type PerformedRepair = {
  id: string;
  name: string;
  type: "selected" | "manual";
  repairId?: string;
  price?: number; // cena opravy (lze upravit)
  costs?: number; // náklady (lze upravit)
  estimatedTime?: number; // čas (lze upravit)
  productIds?: string[]; // produkty (lze upravit)
};
