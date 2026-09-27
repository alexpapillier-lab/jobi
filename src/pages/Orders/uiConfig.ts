/**
 * Osobní předvolby rozhraní (localStorage) tak, jak je čte stránka Zakázky.
 * Vyneseno z Orders.tsx beze změny obsahu.
 */
import { STORAGE_KEYS } from "../../constants/storageKeys";
import { jeZvyrazneni, VYCHOZI_ZVYRAZNENI } from "../../lib/zvyrazneniStavu";
import type { DisplayMode, UIConfig } from "./typy";

export const VALID_PAGE_SIZES = [0, 25, 50, 100, 200] as const;
export const VALID_DISPLAY_MODES: DisplayMode[] = ["list", "grid", "compact", "compact-extra", "timeline", "stripe", "status-grouped"];
export function defaultUIConfig(): UIConfig {
  return {
    app: { fabNewOrderEnabled: true, uiScale: 1, postupZakazky: true },
    sidebar: { position: "left" },
    home: { orderFilters: { selectedQuickStatusFilters: [] } },
    orders: { displayMode: "list", pageSize: 50, customerPhoneRequired: true, zvyrazneniStavu: VYCHOZI_ZVYRAZNENI },
  };
}
export function safeLoadUIConfig(): UIConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.UI_SETTINGS);
    if (!raw) return defaultUIConfig();
    const parsed = JSON.parse(raw);

    const d = defaultUIConfig();
    const quick = parsed?.home?.orderFilters?.selectedQuickStatusFilters;
    const fab = parsed?.app?.fabNewOrderEnabled;
    const scale = parsed?.app?.uiScale;
    const displayMode = parsed?.orders?.displayMode;
    const pageSize = parsed?.orders?.pageSize;
    const customerPhoneRequired = parsed?.orders?.customerPhoneRequired;
    const validPageSize = typeof pageSize === "number" && (VALID_PAGE_SIZES as readonly number[]).includes(pageSize)
      ? pageSize
      : d.orders.pageSize;

    const sidebarPos = parsed?.sidebar?.position;
    return {
      app: {
        fabNewOrderEnabled: typeof fab === "boolean" ? !!fab : d.app.fabNewOrderEnabled,
        uiScale: typeof scale === "number" && scale >= 0.85 && scale <= 1.35 ? scale : d.app.uiScale,
        postupZakazky: typeof parsed?.app?.postupZakazky === "boolean" ? parsed.app.postupZakazky : d.app.postupZakazky,
      },
      sidebar: {
        position: (["left", "right", "bottom"] as const).includes(sidebarPos) ? sidebarPos : d.sidebar.position,
      },
      home: {
        orderFilters: {
          selectedQuickStatusFilters: Array.isArray(quick)
            ? quick.filter((x: any) => typeof x === "string")
            : d.home.orderFilters.selectedQuickStatusFilters,
        },
      },
      orders: {
        displayMode: VALID_DISPLAY_MODES.includes(displayMode) ? displayMode : d.orders.displayMode,
        pageSize: validPageSize,
        customerPhoneRequired: typeof customerPhoneRequired === "boolean" ? customerPhoneRequired : d.orders.customerPhoneRequired,
        statusGroupedOrder: Array.isArray(parsed?.orders?.statusGroupedOrder) ? parsed.orders.statusGroupedOrder.filter((x: any) => typeof x === "string") : undefined,
        // Bez tohohle řádku se volba z Nastavení sem nikdy nedostala a karty
        // dostaly vždy výchozí „jemné“ – „Výrazné“ i „Plné“ nedělaly nic.
        zvyrazneniStavu: jeZvyrazneni(parsed?.orders?.zvyrazneniStavu) ? parsed.orders.zvyrazneniStavu : VYCHOZI_ZVYRAZNENI,
      },
    };
  } catch {
    return defaultUIConfig();
  }
}
/**
 * Křížek na asistentovi postupu: vypne ho v osobních předvolbách, stejně jako
 * přepínač v Nastavení → Rozhraní. Zapisuje se přímo do uloženého JSON, aby se
 * nepřepsaly předvolby, které tahle stránka nečte (např. reducedEffects).
 */
export function skrytPostupZakazky(): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.UI_SETTINGS);
    const parsed = raw ? JSON.parse(raw) : {};
    const next = { ...parsed, app: { ...(parsed?.app ?? {}), postupZakazky: false } };
    localStorage.setItem(STORAGE_KEYS.UI_SETTINGS, JSON.stringify(next));
    window.dispatchEvent(new CustomEvent("jobsheet:ui-updated"));
  } catch {
    /* předvolby se neuložily – asistent zůstane, nic horšího se nestane */
  }
}
