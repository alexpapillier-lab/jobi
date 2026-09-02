import type { MutableRefObject } from "react";

/** Když uživatel čte daný chat – potlačení rušení u badge / panelu SMS */
export const smsDoNotNotifyRef = {
  conversationId: null as string | null,
  panelTicketId: null as string | null,
  panelCustomerPhoneNorm: null as string | null,
};

/**
 * Dříve realtime → OS notifikace (Tauri invoke). Vypnuto – v aplikaci zůstávají jen badge a SMS UI.
 */
export function useSmsNotifications(
  _activeServiceId: string | null,
  _smsPanelTicketIdRef: MutableRefObject<string | null> | null,
  _onNotificationTicketClick: (ticketId: string) => void
) {
  /* no-op */
}
