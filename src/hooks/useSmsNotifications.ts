import { useEffect, useRef } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import { supabase } from "../lib/supabaseClient";

function isTauri(): boolean {
  return typeof window !== "undefined" && !!(window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
}

export type SmsNotificationPayload = {
  conversationId: string;
  ticketId: string | null;
  customerName: string | null;
  customerPhone: string;
  body: string;
};

/**
 * Global ref: when user focuses the app after a notification was shown, we open that ticket.
 * Set when we show a notification, cleared when we handle focus or open that ticket's SMS panel.
 */
const pendingNotificationTicketIdRef: { current: string | null } = { current: null };

export function getPendingNotificationTicketId(): string | null {
  return pendingNotificationTicketIdRef.current;
}

export function clearPendingNotificationTicketId(): void {
  pendingNotificationTicketIdRef.current = null;
}

function truncateBody(body: string, maxLen: number): string {
  if (body.length <= maxLen) return body;
  const cut = body.slice(0, maxLen);
  const lastSpace = cut.lastIndexOf(" ");
  const end = lastSpace > maxLen * 0.6 ? lastSpace : maxLen;
  return cut.slice(0, end).trim() + "…";
}

/**
 * Hook: subscribe to Supabase Realtime INSERT on sms_messages (inbound), show OS notification.
 * When user focuses the app after a notification, onNotificationTicketClick(ticketId) is called
 * so the app can navigate to Orders and open that ticket's SMS panel.
 */
export function useSmsNotifications(
  activeServiceId: string | null,
  smsPanelTicketIdRef: React.MutableRefObject<string | null> | null,
  onNotificationTicketClick: (ticketId: string) => void
) {
  const onNotificationTicketClickRef = useRef(onNotificationTicketClick);
  onNotificationTicketClickRef.current = onNotificationTicketClick;

  useEffect(() => {
    if (!isTauri() || !activeServiceId || !supabase) return;

    const topic = `sms_notifications:${activeServiceId}`;
    const channel = supabase
      .channel(topic)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "sms_messages" },
        async (payload) => {
          const row = payload.new as Record<string, unknown>;
          if (row.direction !== "inbound") return;

          const conversationId = row.conversation_id as string;
          const body = (row.body as string) ?? "";

          const { data: conv } = await supabase
            .from("sms_conversations")
            .select("service_id, ticket_id, customer_name, customer_phone")
            .eq("id", conversationId)
            .single();

          if (!conv || conv.service_id !== activeServiceId) return;

          const ticketId = conv.ticket_id as string | null;
          if (smsPanelTicketIdRef?.current === ticketId) return;

          let ticketCode = "";
          if (ticketId) {
            const { data: ticket } = await supabase
              .from("tickets")
              .select("code")
              .eq("id", ticketId)
              .single();
            ticketCode = ticket?.code ?? "";
          }

          const customerName = (conv.customer_name as string) ?? null;
          const customerPhone = (conv.customer_phone as string) ?? "";
          const title = `SMS od ${customerName || customerPhone}`;
          const subtitle = ticketCode ? `Zakázka ${ticketCode}` : "";
          const bodyText = truncateBody(body, 100);

          let granted = await isPermissionGranted();
          if (!granted) {
            const permission = await requestPermission();
            granted = permission === "granted";
          }
          if (!granted) return;

          sendNotification({
            title,
            body: subtitle ? `${subtitle}\n${bodyText}` : bodyText,
          });

          if (ticketId) pendingNotificationTicketIdRef.current = ticketId;
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [activeServiceId, smsPanelTicketIdRef]);

  useEffect(() => {
    if (!isTauri()) return;

    const handleFocus = () => {
      const ticketId = pendingNotificationTicketIdRef.current;
      if (!ticketId) return;
      pendingNotificationTicketIdRef.current = null;
      getCurrentWindow().setFocus().catch(() => {});
      onNotificationTicketClickRef.current(ticketId);
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") handleFocus();
    };

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", handleFocus);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", handleFocus);
    };
  }, []);
}
