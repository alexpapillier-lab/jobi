import { STORAGE_KEYS } from "../constants/storageKeys";

// Keys that are not in STORAGE_KEYS but are used in the app
const ADDITIONAL_KEYS = {
  NEW_ORDER_DRAFT: "jobsheet_new_order_draft_v1",
  CUSTOMERS: "jobsheet_customers_v1",
  COMMENTS: "jobsheet_ticket_comments_v1",
  TICKETS: "jobsheet_tickets_v1",
  STATUSES: "jobsheet_statuses_v1",
  PENDING_INVITE_TOKEN: "jobsheet_pending_invite_token",
  THEME: "jobsheet_theme",
  INVENTORY_DISPLAY_MODE: "jobsheet_inventory_display_mode",
} as const;

/**
 * Clear all business data and drafts from localStorage on sign out.
 * Keeps UI preferences (theme, UI settings, display modes).
 */
export function clearOnSignOut(): void {
  try {
    // Business data and service-scoped data
    localStorage.removeItem(STORAGE_KEYS.COMPANY);
    localStorage.removeItem(STORAGE_KEYS.DOCUMENTS_CONFIG);
    localStorage.removeItem(STORAGE_KEYS.INVENTORY);
    localStorage.removeItem(STORAGE_KEYS.DEVICES);
    localStorage.removeItem(STORAGE_KEYS.ACTIVE_SERVICE_ID);
    
    // Additional business data
    localStorage.removeItem(ADDITIONAL_KEYS.CUSTOMERS);
    localStorage.removeItem(ADDITIONAL_KEYS.TICKETS);
    localStorage.removeItem(ADDITIONAL_KEYS.COMMENTS);
    localStorage.removeItem(ADDITIONAL_KEYS.NEW_ORDER_DRAFT);
    localStorage.removeItem(ADDITIONAL_KEYS.STATUSES);
    localStorage.removeItem(ADDITIONAL_KEYS.PENDING_INVITE_TOKEN);
    
    // UI preferences are kept:
    // - STORAGE_KEYS.UI_SETTINGS
    // - ADDITIONAL_KEYS.THEME
    // - ADDITIONAL_KEYS.INVENTORY_DISPLAY_MODE
  } catch (err) {
    console.error("[storageInvalidation] Error clearing on sign out:", err);
  }
}

/**
 * Clear service-scoped data from localStorage when activeServiceId changes.
 * Only clears if the service ID actually changed (not null -> null or same -> same).
 * 
 * @param prevServiceId Previous service ID (can be null)
 * @param nextServiceId Next service ID (can be null)
 */
export function clearOnServiceChange(prevServiceId: string | null, nextServiceId: string | null): void {
  // Only clear if service actually changed (both non-null and different)
  if (!prevServiceId || !nextServiceId || prevServiceId === nextServiceId) {
    return;
  }
  
  try {
    // Service-scoped data (business data tied to a specific service)
    localStorage.removeItem(STORAGE_KEYS.COMPANY);
    localStorage.removeItem(STORAGE_KEYS.DOCUMENTS_CONFIG);
    localStorage.removeItem(STORAGE_KEYS.INVENTORY);
    localStorage.removeItem(STORAGE_KEYS.DEVICES);
    
    // Additional service-scoped data
    localStorage.removeItem(ADDITIONAL_KEYS.CUSTOMERS);
    localStorage.removeItem(ADDITIONAL_KEYS.TICKETS);
    localStorage.removeItem(ADDITIONAL_KEYS.COMMENTS);
    localStorage.removeItem(ADDITIONAL_KEYS.NEW_ORDER_DRAFT);
    localStorage.removeItem(ADDITIONAL_KEYS.STATUSES);
    
    // Note: ACTIVE_SERVICE_ID is updated (not cleared) in App.tsx
    // UI preferences are kept:
    // - STORAGE_KEYS.UI_SETTINGS
    // - ADDITIONAL_KEYS.THEME
    // - ADDITIONAL_KEYS.INVENTORY_DISPLAY_MODE
  } catch (err) {
    console.error("[storageInvalidation] Error clearing on service change:", err);
  }
}

