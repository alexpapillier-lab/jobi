import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Card, Input, Label, Pill } from "../ui";
import { SectionHeading } from "../SectionHeading";
import { CheckIcon, ClockIcon, CoinsIcon, EditIcon, HistoryIcon, LinkIcon, XIcon } from "../icons";
import { showToast } from "../Toast";
import { reportError, reportSilent } from "../../lib/reportError";
import { supabase } from "../../lib/supabaseClient";
import { normalizePhone } from "../../lib/phone";
import {
  cancelQuote,
  ensurePortalToken,
  formatPortalDateTime,
  loadPortalEvents,
  loadPortalTicketFields,
  logPortalEvent,
  mapPortalEventRow,
  portalEventLabel,
  portalUrl,
  sendPortalSms,
  sendQuote,
  type PortalEvent,
  type QuoteItem,
  type PortalTicketFields,
} from "../../lib/portal";
import type { PerformedRepair } from "./types";
import type { DeviceRepair } from "../../lib/catalogStorage";
import { QuoteBuilder, soucetPolozek } from "./QuoteBuilder";

/**
 * Karta „Zákaznický portál“ v detailu zakázky.
 *
 * Portálová pole zakázky se načítají zvlášť (sloupce nemusí na serveru
 * ještě existovat) a drží se v lokálním stavu. Z props se přebírají jen
 * tehdy, když v nich skutečně jsou – hlavní selecty zakázek je nevracejí,
 * takže po uložení detailu by jinak zmizely.
 */
export type PortalCardTicket = PortalTicketFields & {
  id: string;
  code: string | null;
  customerPhone?: string;
  estimatedPrice?: number;
  performedRepairs?: PerformedRepair[];
};

const POLL_MS = 60_000;

/** Rozpis odeslané nabídky. Bez položek ukáže aspoň částku – starší nabídky rozpis nemají. */
function QuoteSummary({ items, amount }: { items?: QuoteItem[]; amount?: number }) {
  const celkem = amount ?? soucetPolozek(items ?? []);
  if ((items ?? []).length === 0) {
    return amount === undefined ? null : <span style={{ fontWeight: 700 }}>{celkem.toLocaleString("cs-CZ")} Kč</span>;
  }
  return (
    <div style={{ display: "grid", gap: 3, fontSize: "var(--text-sm)" }}>
      {(items ?? []).map((i) => (
        <div key={i.id} style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
          <span style={{ color: "var(--text)" }}>{i.name}</span>
          <span style={{ color: "var(--muted)", whiteSpace: "nowrap" }}>{(Number(i.price) || 0).toLocaleString("cs-CZ")} Kč</span>
        </div>
      ))}
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, borderTop: "1px solid var(--border)", paddingTop: 3, fontWeight: 800 }}>
        <span>Celkem</span>
        <span style={{ whiteSpace: "nowrap" }}>{celkem.toLocaleString("cs-CZ")} Kč</span>
      </div>
    </div>
  );
}

function hasAnyPortalField(t: PortalTicketFields): boolean {
  return (
    t.portalToken !== undefined ||
    t.quoteStatus !== undefined ||
    t.quoteSentAt !== undefined ||
    t.quoteDecidedAt !== undefined ||
    t.intakeSignatureUrl !== undefined ||
    t.portalLastOpenedAt !== undefined
  );
}

function pickPortalFields(t: PortalCardTicket): PortalTicketFields {
  const {
    portalToken,
    quoteAmount,
    quoteNote,
    quoteStatus,
    quoteSentAt,
    quoteDecidedAt,
    quoteDecisionMeta,
    intakeSignatureUrl,
    intakeSignedAt,
    portalLastOpenedAt,
  } = t;
  return {
    portalToken,
    quoteAmount,
    quoteNote,
    quoteStatus,
    quoteSentAt,
    quoteDecidedAt,
    quoteDecisionMeta,
    intakeSignatureUrl,
    intakeSignedAt,
    portalLastOpenedAt,
  };
}

export function PortalCard({
  ticket,
  serviceId,
  smsAvailable,
  availableRepairs,
  onQuoteApprovedRepairs,
  onFieldsChange,
  style,
}: {
  ticket: PortalCardTicket;
  serviceId: string;
  /** SMS brána je pro servis aktivní – jinak jsou tlačítka na SMS vypnutá. */
  smsAvailable: boolean;
  /** Ceník oprav pro zařízení zakázky – z něj se skládá rozpis nabídky. */
  availableRepairs?: DeviceRepair[];
  /** Přenese schválené položky do provedených oprav zakázky. */
  onQuoteApprovedRepairs?: (ticketId: string, repairs: PerformedRepair[]) => void | Promise<void>;
  /** Promítne načtená/změněná portálová pole do stavu zakázek nadřazené stránky. */
  onFieldsChange?: (ticketId: string, fields: PortalTicketFields) => void;
  style?: React.CSSProperties;
}) {
  const ticketId = ticket.id;
  const [fields, setFields] = useState<PortalTicketFields>(() => pickPortalFields(ticket));
  const [token, setToken] = useState<string | null>(ticket.portalToken ?? null);
  const [serverOff, setServerOff] = useState(false);
  const [tokenLoading, setTokenLoading] = useState(false);
  const [tokenAttempt, setTokenAttempt] = useState(0);
  const [events, setEvents] = useState<PortalEvent[]>([]);
  const [busy, setBusy] = useState<null | "sms" | "quote" | "cancel" | "prenest">(null);
  const [itemy, setItemy] = useState<QuoteItem[]>([]);
  const [composing, setComposing] = useState(false);
  const [noteInput, setNoteInput] = useState("");
  const onFieldsChangeRef = useRef(onFieldsChange);
  onFieldsChangeRef.current = onFieldsChange;

  const applyFields = useCallback(
    (next: PortalTicketFields, propagate = true) => {
      setFields((prev) => ({ ...prev, ...next }));
      if (next.portalToken) setToken(next.portalToken);
      if (propagate) onFieldsChangeRef.current?.(ticketId, next);
    },
    [ticketId]
  );

  // Změna zakázky → reset lokálního stavu.
  useEffect(() => {
    setFields(pickPortalFields(ticket));
    setToken(ticket.portalToken ?? null);
    setServerOff(false);
    setEvents([]);
    setComposing(false);
    setBusy(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticketId]);

  // Realtime na `tickets` posílá celý řádek včetně portálových sloupců – převzít, když v props něco je.
  const propFields = pickPortalFields(ticket);
  const propKey = JSON.stringify(propFields);
  useEffect(() => {
    if (hasAnyPortalField(propFields)) {
      setFields((prev) => ({ ...prev, ...propFields }));
      if (propFields.portalToken) setToken(propFields.portalToken);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [propKey]);

  const refreshFields = useCallback(async () => {
    const loaded = await loadPortalTicketFields(ticketId);
    if (loaded) applyFields(loaded);
  }, [ticketId, applyFields]);

  const refreshEvents = useCallback(async () => {
    const list = await loadPortalEvents(ticketId);
    setEvents(list);
  }, [ticketId]);

  // Token (líně, jednou na zakázku) + portálová pole + události.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!token) {
        setTokenLoading(true);
        try {
          const t = await ensurePortalToken(ticketId);
          if (cancelled) return;
          setToken(t);
          setServerOff(false);
          applyFields({ portalToken: t });
        } catch (error) {
          if (cancelled) return;
          setServerOff(true);
          reportSilent({ code: "portal.ensure_token_failed", error, source: "PortalCard", serviceId, context: { ticketId } });
        } finally {
          if (!cancelled) setTokenLoading(false);
        }
      }
      if (cancelled) return;
      await Promise.all([refreshFields(), refreshEvents()]);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticketId, tokenAttempt]);

  // Realtime na události portálu + záložní dotaz jednou za minutu (kdyby tabulka nebyla v publikaci realtime).
  useEffect(() => {
    if (!supabase || serverOff) return;
    const channel = supabase
      .channel(`portal-events:${ticketId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "ticket_portal_events", filter: `ticket_id=eq.${ticketId}` },
        (payload) => {
          const ev = mapPortalEventRow(payload.new as Record<string, unknown>);
          setEvents((prev) => (prev.some((e) => e.id === ev.id) ? prev : [ev, ...prev].slice(0, 20)));
          // Událost od zákazníka mění i pole zakázky (otevření, rozhodnutí, podpis).
          void refreshFields();
        }
      )
      .subscribe();
    const timer = window.setInterval(() => {
      void refreshEvents();
      void refreshFields();
    }, POLL_MS);
    return () => {
      window.clearInterval(timer);
      supabase?.removeChannel(channel);
    };
  }, [ticketId, serverOff, refreshEvents, refreshFields]);

  const url = token ? portalUrl(token) : "";
  const code = ticket.code ?? "";
  const phoneNorm = normalizePhone(ticket.customerPhone);
  const smsDisabledReason = !phoneNorm
    ? "Zákazník nemá telefonní číslo"
    : !smsAvailable
      ? "SMS nejsou pro tento servis aktivované"
      : null;

  const quoteStatus = fields.quoteStatus ?? "none";
  const decisionNote = fields.quoteDecisionMeta?.note?.trim() || "";

  /**
   * Čím se formulář předvyplní: dřív poslaný rozpis, jinak opravy už zapsané
   * na zakázce. Technik tak většinou jen zkontroluje a odešle.
   */
  const navrhItemu = useMemo<QuoteItem[]>(() => {
    if ((fields.quoteItems ?? []).length > 0) return fields.quoteItems ?? [];
    const zOprav = (ticket.performedRepairs ?? []).map((r) => ({
      id: r.id,
      name: r.name,
      price: Number(r.price) || 0,
      costs: r.costs,
      estimatedTime: r.estimatedTime,
      productIds: r.productIds,
      repairId: r.repairId,
      type: r.type,
    }));
    if (zOprav.length > 0) return zOprav;
    const odhad = ticket.estimatedPrice ?? 0;
    if (odhad > 0) return [{ id: "odhad", name: "Oprava", price: odhad, type: "manual" as const }];
    return [];
  }, [fields.quoteItems, ticket.performedRepairs, ticket.estimatedPrice]);

  const showQuoteForm = quoteStatus === "none" || (quoteStatus === "rejected" && composing);

  useEffect(() => {
    if (!showQuoteForm) return;
    setItemy(navrhItemu);
    setNoteInput(fields.quoteNote ?? "");
    // Předvyplnit jen při otevření formuláře; další změny opravují text ručně.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showQuoteForm, ticketId]);

  const copyLink = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      showToast("Odkaz zkopírován", "success");
    } catch (error) {
      reportError({ code: "portal.copy_failed", error, userMessage: "Odkaz se nepodařilo zkopírovat", source: "PortalCard", serviceId });
    }
  };

  const sendLinkSms = async () => {
    if (!url || !phoneNorm || busy) return;
    setBusy("sms");
    try {
      await sendPortalSms({ serviceId, to: phoneNorm, body: `Stav zakázky ${code} sledujete zde: ${url}`, ticketId });
      await logPortalEvent(ticketId, serviceId, "link_sent", { to: phoneNorm });
      showToast("SMS s odkazem odeslána", "success");
      void refreshEvents();
    } catch (error) {
      reportError({ code: "portal.link_sms_failed", error, source: "PortalCard", serviceId, context: { ticketId } });
    } finally {
      setBusy(null);
    }
  };

  /**
   * Po schválení přepíše rozpis do provedených oprav. Bez toho by technik
   * přepisoval ručně to, co zákazník právě odsouhlasil.
   */
  const prenestDoOprav = async () => {
    const polozky = fields.quoteItems ?? [];
    if (polozky.length === 0 || !onQuoteApprovedRepairs) return;
    setBusy("prenest");
    try {
      await onQuoteApprovedRepairs(
        ticketId,
        polozky.map((i) => ({
          id: i.id,
          name: i.name,
          type: i.type === "selected" ? "selected" : "manual",
          repairId: i.repairId,
          price: i.price,
          costs: i.costs,
          estimatedTime: i.estimatedTime,
          productIds: i.productIds,
        })),
      );
      showToast("Položky přeneseny do provedených oprav", "success");
    } catch (error) {
      reportError({
        code: "portal.quote_transfer_failed",
        error,
        userMessage: "Položky se nepodařilo uložit. Zkuste to znovu.",
        source: "PortalCard",
        serviceId,
        context: { ticketId },
      });
    } finally {
      setBusy(null);
    }
  };

  const submitQuote = async () => {
    if (busy) return;
    const polozky = itemy.filter((i) => i.name.trim() !== "");
    const amount = soucetPolozek(polozky);
    if (polozky.length === 0) {
      showToast("Přidejte do nabídky aspoň jednu položku", "error");
      return;
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      showToast("Nabídka musí mít cenu větší než nula", "error");
      return;
    }
    setBusy("quote");
    try {
      const next = await sendQuote({ ticketId, amount, note: noteInput, items: polozky });
      applyFields(next);
      setComposing(false);
      await logPortalEvent(ticketId, serviceId, "quote_sent", { amount, items: polozky.length, note: noteInput.trim() || undefined });
      if (phoneNorm && smsAvailable && url) {
        try {
          await sendPortalSms({
            serviceId,
            to: phoneNorm,
            body: `Cenová nabídka k zakázce ${code}: ${amount} Kč. Schválit nebo zamítnout můžete zde: ${url}`,
            ticketId,
          });
          showToast("Nabídka odeslána", "success");
        } catch (error) {
          reportError({
            code: "portal.quote_sms_failed",
            error,
            userMessage: "Nabídka je uložena, ale SMS se nepodařilo odeslat. Pošlete zákazníkovi odkaz ručně.",
            source: "PortalCard",
            serviceId,
            context: { ticketId },
          });
        }
      } else {
        showToast("Nabídka uložena. Odkaz na portál pošlete zákazníkovi ručně.", "info");
      }
      void refreshEvents();
    } catch (error) {
      reportError({ code: "portal.quote_send_failed", error, userMessage: "Nabídku se nepodařilo odeslat", source: "PortalCard", serviceId, context: { ticketId } });
    } finally {
      setBusy(null);
    }
  };

  const withdrawQuote = async () => {
    if (busy) return;
    setBusy("cancel");
    try {
      const next = await cancelQuote(ticketId);
      applyFields(next);
      showToast("Nabídka zrušena", "success");
    } catch (error) {
      reportError({ code: "portal.quote_cancel_failed", error, userMessage: "Nabídku se nepodařilo zrušit", source: "PortalCard", serviceId, context: { ticketId } });
    } finally {
      setBusy(null);
    }
  };

  const muted: React.CSSProperties = { color: "var(--muted)", fontSize: "var(--text-sm)" };
  const block: React.CSSProperties = { paddingTop: "var(--space-3)", marginTop: "var(--space-3)", borderTop: "1px solid var(--border)" };

  return (
    <Card style={style}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "var(--space-3)", flexWrap: "wrap" }}>
        <SectionHeading icon={<LinkIcon size={16} />}>Zákaznický portál</SectionHeading>
        {!serverOff && (
          <div style={{ ...muted, marginBottom: "var(--space-3)" }}>
            {fields.portalLastOpenedAt ? `Naposledy otevřeno ${formatPortalDateTime(fields.portalLastOpenedAt)}` : "Zákazník odkaz zatím neotevřel"}
          </div>
        )}
      </div>

      {serverOff ? (
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", flexWrap: "wrap" }}>
          <span style={muted}>Portál není na serveru zapnutý.</span>
          <Button size="sm" variant="ghost" onClick={() => setTokenAttempt((n) => n + 1)} disabled={tokenLoading}>
            Zkusit znovu
          </Button>
        </div>
      ) : (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", flexWrap: "wrap" }}>
            <a
              href={url || undefined}
              target="_blank"
              rel="noreferrer"
              title={url}
              style={{
                flex: "1 1 200px",
                minWidth: 0,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                fontSize: "var(--text-sm)",
                color: url ? "var(--accent)" : "var(--muted)",
                textDecoration: "none",
              }}
            >
              {url || (tokenLoading ? "Vytvářím odkaz…" : "Odkaz není k dispozici")}
            </a>
            <Button size="sm" icon={<LinkIcon size={14} />} onClick={copyLink} disabled={!url}>
              Kopírovat
            </Button>
            <Button
              size="sm"
              onClick={sendLinkSms}
              disabled={!url || !!smsDisabledReason || busy !== null}
              title={smsDisabledReason ?? "Odešle zákazníkovi SMS s odkazem na portál"}
            >
              {busy === "sms" ? "Odesílám…" : "Poslat SMS"}
            </Button>
          </div>

          <div style={block}>
            <SectionHeading size="sm" icon={<CoinsIcon size={14} />}>Cenová nabídka</SectionHeading>
            {quoteStatus === "sent" && (
              <div style={{ display: "grid", gap: "var(--space-2)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", flexWrap: "wrap" }}>
                  <Pill color="var(--warning-text)" icon={<ClockIcon size={12} />}>
                    Čeká na schválení{fields.quoteSentAt ? ` · odesláno ${formatPortalDateTime(fields.quoteSentAt)}` : ""}
                  </Pill>
                  {fields.quoteNote && <span style={muted}>{fields.quoteNote}</span>}
                  <Button size="sm" variant="ghost" onClick={withdrawQuote} disabled={busy !== null}>
                    {busy === "cancel" ? "Ruším…" : "Zrušit nabídku"}
                  </Button>
                </div>
                <QuoteSummary items={fields.quoteItems} amount={fields.quoteAmount} />
              </div>
            )}
            {quoteStatus === "approved" && (
              <div style={{ display: "grid", gap: "var(--space-2)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", flexWrap: "wrap" }}>
                  <Pill color="var(--success-text)" icon={<CheckIcon size={12} />}>
                    Schváleno{fields.quoteDecidedAt ? ` ${formatPortalDateTime(fields.quoteDecidedAt)}` : ""}
                  </Pill>
                  {decisionNote && <span style={muted}>„{decisionNote}“</span>}
                  {(fields.quoteItems ?? []).length > 0 && onQuoteApprovedRepairs && (
                    <Button size="sm" variant="soft" onClick={prenestDoOprav} disabled={busy !== null}>
                      {busy === "prenest" ? "Přenáším…" : "Přenést do provedených oprav"}
                    </Button>
                  )}
                </div>
                <QuoteSummary items={fields.quoteItems} amount={fields.quoteAmount} />
              </div>
            )}
            {quoteStatus === "rejected" && !composing && (
              <div style={{ display: "grid", gap: "var(--space-2)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", flexWrap: "wrap" }}>
                  <Pill color="var(--danger-text)" icon={<XIcon size={12} />}>
                    Zamítnuto{fields.quoteDecidedAt ? ` ${formatPortalDateTime(fields.quoteDecidedAt)}` : ""}
                  </Pill>
                  {fields.quoteAmount !== undefined && <span style={{ fontWeight: 700, textDecoration: "line-through", color: "var(--muted)" }}>{fields.quoteAmount} Kč</span>}
                  {decisionNote && <span style={muted}>„{decisionNote}“</span>}
                  <Button size="sm" variant="primary" onClick={() => setComposing(true)}>
                    Poslat novou nabídku
                  </Button>
                </div>
              </div>
            )}
            {showQuoteForm && (
              <div style={{ display: "grid", gap: "var(--space-3)" }}>
                <div>
                  <Label>Rozpis</Label>
                  <QuoteBuilder items={itemy} onChange={setItemy} availableRepairs={availableRepairs} />
                </div>
                <div>
                  <Label>Poznámka pro zákazníka</Label>
                  <Input value={noteInput} onChange={(e) => setNoteInput(e.target.value)} placeholder="Např. displej je originální, oprava do dvou dnů" />
                </div>
                <div style={{ display: "flex", gap: "var(--space-2)", justifyContent: "flex-end" }}>
                  {quoteStatus === "rejected" && (
                    <Button size="sm" variant="ghost" onClick={() => setComposing(false)} disabled={busy !== null}>
                      Zpět
                    </Button>
                  )}
                  <Button variant="primary" onClick={submitQuote} disabled={busy !== null || !url}>
                    {busy === "quote" ? "Odesílám…" : "Poslat ke schválení"}
                  </Button>
                </div>
              </div>
            )}
          </div>

          <div style={block}>
            <SectionHeading size="sm" icon={<EditIcon size={14} />}>Podpis</SectionHeading>
            {fields.intakeSignatureUrl ? (
              <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", flexWrap: "wrap" }}>
                <a href={fields.intakeSignatureUrl} target="_blank" rel="noreferrer" title="Otevřít podpis v novém okně">
                  <img
                    src={fields.intakeSignatureUrl}
                    alt="Podpis zákazníka"
                    style={{ height: 48, maxWidth: 200, objectFit: "contain", background: "var(--panel-2)", borderRadius: "var(--radius-sm)", border: "1px solid var(--border)", display: "block" }}
                  />
                </a>
                <span style={muted}>Podepsáno {formatPortalDateTime(fields.intakeSignedAt)}</span>
              </div>
            ) : (
              <span style={muted}>Zatím nepodepsáno</span>
            )}
          </div>

          <div style={block}>
            <SectionHeading size="sm" icon={<HistoryIcon size={14} />}>Události</SectionHeading>
            {events.length === 0 ? (
              <span style={muted}>Zatím žádné události</span>
            ) : (
              <div style={{ display: "grid", gap: "var(--space-1)" }}>
                {events.map((ev) => {
                  const note = typeof ev.meta?.note === "string" ? ev.meta.note.trim() : "";
                  return (
                    <div key={ev.id} style={{ display: "flex", gap: "var(--space-2)", alignItems: "baseline", fontSize: "var(--text-sm)" }}>
                      <span style={{ ...muted, flexShrink: 0, minWidth: 92 }}>{formatPortalDateTime(ev.createdAt)}</span>
                      <span>
                        {portalEventLabel(ev.type)}
                        {note && <span style={muted}> – „{note}“</span>}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}
    </Card>
  );
}
