export type PerformedRepair = {
  id: string;
  name: string;
  /** selected = z ceníku, manual = ručně, hourly = hodinová práce (cena = hodiny × sazba). */
  type: "selected" | "manual" | "hourly";
  repairId?: string;
  /** Hodinová práce: odpracované hodiny (i 0,25), sazba Kč/h a kdo pracoval. */
  hodiny?: number;
  sazba?: number;
  technik?: string;
  /** Účet technika, když je to přihlášený člověk (jméno jde přepsat, účet zůstává pro KPI). */
  technikUserId?: string;
  /** Hodinová práce vznikla z karty „Čas na opravě“ – aby se z měření nepřidala dvakrát. */
  zMereni?: boolean;
  price?: number; // cena opravy (lze upravit)
  costs?: number; // náklady (lze upravit)
  estimatedTime?: number; // čas (lze upravit)
  productIds?: string[]; // produkty (lze upravit)
};
