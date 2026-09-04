import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { Button } from "../../components/ui";
import { CheckIcon, EditIcon, LinkIcon, MailIcon, TrashIcon, XIcon } from "../../components/icons";
import { OverflowMenu, type OverflowMenuItem } from "../../components/orders/OverflowMenu";
import { formatCurrency } from "../../lib/invoiceMath";
import { InvoicePrintMenu } from "./InvoicePrintMenu";
import { StatusPill } from "./InvoiceList";
import {
  STATUS_LABELS,
  asStatus,
  daysOverdue,
  formatDate,
  formatDateTime,
  pluralDny,
  type Invoice,
  type InvoiceEvent,
  type InvoiceItem,
} from "./types";

/**
 * Detail faktury – boční panel. Hlavička nese číslo, stav, odběratele
 * a částku; akce mají hierarchii: jedna hlavní podle stavu, Tisk, E-mail,
 * a méně časté věci v nabídce „⋯“.
 *
 * Portál do body: <main> má transform kvůli plynulému posouvání, což z něj
 * dělá vztažný rámec pro position: fixed – panel by jinak ležel uvnitř jeho
 * vrstvy a spodní navigace by se přes něj vykreslila.
 */
export function InvoiceDetail({
  invoice: inv,
  items,
  events,
  onClose,
  onEdit,
  onPrint,
  onExport,
  onPreview,
  onSend,
  onIssue,
  onMarkPaid,
  onDuplicate,
  onCancelInvoice,
  onDelete,
  onOpenTicket,
}: {
  invoice: Invoice;
  items: InvoiceItem[];
  events: InvoiceEvent[];
  onClose: () => void;
  onEdit: () => void;
  onPrint: () => void;
  onExport: () => void;
  onPreview: () => void;
  onSend: () => void;
  onIssue: () => void;
  onMarkPaid: () => void;
  onDuplicate: () => void;
  onCancelInvoice: () => void;
  onDelete: () => void;
  onOpenTicket?: () => void;
}) {
  const status = asStatus(inv.status);
  const isDraft = status === "draft";
  const awaitingPayment = status === "issued" || status === "sent" || status === "overdue";
  const overdueDays = status === "overdue" ? daysOverdue(inv.due_date) : 0;

  const menuItems: OverflowMenuItem[] = [];
  if (isDraft) menuItems.push({ label: "Upravit", icon: <EditIcon size={15} />, onSelect: onEdit });
  menuItems.push({ label: "Duplikovat", onSelect: onDuplicate });
  if (onOpenTicket) menuItems.push({ label: "Přejít na zakázku", icon: <LinkIcon size={15} />, onSelect: onOpenTicket });
  if (status !== "cancelled" && status !== "paid") {
    menuItems.push({ label: "Stornovat", danger: true, dividerBefore: true, onSelect: onCancelInvoice });
  }
  if (isDraft) {
    menuItems.push({ label: "Smazat koncept", icon: <TrashIcon size={15} />, danger: true, onSelect: onDelete });
  }

  return createPortal(
    <div style={{ position: "fixed", inset: 0, display: "flex", zIndex: 9990 }}>
      <div style={{ flex: 1, background: "rgba(0,0,0,0.4)" }} onClick={onClose} />
      <div
        role="dialog"
        aria-label={`Faktura ${inv.number}`}
        style={{
          width: 520,
          maxWidth: "92vw",
          background: "var(--panel)",
          borderLeft: "1px solid var(--border)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {/* Hlavička */}
        <div style={{ padding: "var(--space-5) var(--space-6) var(--space-4)", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "var(--space-3)", marginBottom: "var(--space-2)" }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", flexWrap: "wrap" }}>
                <h2 style={{ margin: 0, fontSize: "var(--text-xl)", fontWeight: 800, color: "var(--text)" }}>{inv.number}</h2>
                <StatusPill status={status} />
              </div>
              <div style={{ marginTop: 4, fontSize: "var(--text-base)", color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {inv.customer_name || "Bez odběratele"}
              </div>
            </div>
            <Button variant="ghost" iconOnly aria-label="Zavřít" title="Zavřít" icon={<XIcon size={16} />} onClick={onClose} />
          </div>

          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "var(--space-3)", flexWrap: "wrap" }}>
            <div style={{ fontSize: "var(--text-2xl)", fontWeight: 800, color: "var(--text)", fontVariantNumeric: "tabular-nums", textDecoration: status === "cancelled" ? "line-through" : undefined }}>
              {formatCurrency(inv.total, inv.currency)}
            </div>
            <div style={{ fontSize: "var(--text-sm)", color: overdueDays > 0 ? "var(--danger-text)" : "var(--muted)", textAlign: "right" }}>
              {status === "paid"
                ? `Zaplaceno ${formatDate(inv.paid_at) || ""}`.trim()
                : overdueDays > 0
                  ? `Splatnost ${formatDate(inv.due_date)} · po splatnosti o ${pluralDny(overdueDays)}`
                  : `Splatnost ${formatDate(inv.due_date)}`}
            </div>
          </div>

          {/* Akce */}
          <div style={{ display: "flex", gap: "var(--space-2)", marginTop: "var(--space-4)", flexWrap: "wrap", alignItems: "center" }}>
            {isDraft && (
              <Button variant="primary" icon={<CheckIcon size={16} />} onClick={onIssue}>
                Vystavit
              </Button>
            )}
            {awaitingPayment && (
              <Button variant="primary" icon={<CheckIcon size={16} />} onClick={onMarkPaid}>
                Označit zaplacenou
              </Button>
            )}
            <InvoicePrintMenu onPrint={onPrint} onExport={onExport} onPreview={onPreview} />
            <Button variant="soft" icon={<MailIcon size={16} />} onClick={onSend} title={isDraft ? "Koncept lze odeslat až po vystavení" : undefined} disabled={isDraft}>
              Odeslat e-mailem
            </Button>
            <OverflowMenu items={menuItems} />
          </div>
        </div>

        {/* Obsah */}
        <div style={{ flex: 1, overflow: "auto", padding: "var(--space-4) var(--space-6)" }}>
          <DetailSection title="Odběratel">
            <DetailRow label="Název" value={inv.customer_name} />
            <DetailRow label="IČO" value={inv.customer_ico} />
            <DetailRow label="DIČ" value={inv.customer_dic} />
            <DetailRow label="Adresa" value={inv.customer_address} />
            <DetailRow label="E-mail" value={inv.customer_email} />
            <DetailRow label="Telefon" value={inv.customer_phone} />
          </DetailSection>

          <DetailSection title="Údaje dokladu">
            <DetailRow label="Datum vystavení" value={formatDate(inv.issue_date)} />
            <DetailRow label="Datum splatnosti" value={formatDate(inv.due_date)} />
            <DetailRow label="DUZP" value={formatDate(inv.taxable_date)} />
            <DetailRow label="Variabilní symbol" value={inv.variable_symbol} />
            <DetailRow label="Měna" value={inv.currency} />
          </DetailSection>

          <DetailSection title="Položky">
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "var(--text-sm)" }}>
                <thead>
                  <tr style={{ borderBottom: "2px solid var(--border)" }}>
                    <th style={{ ...thStyle, textAlign: "left", paddingLeft: 0 }}>Položka</th>
                    <th style={thStyle}>Množství</th>
                    <th style={thStyle}>Cena / jedn.</th>
                    <th style={thStyle}>DPH</th>
                    <th style={{ ...thStyle, paddingRight: 0 }}>Celkem</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((it) => (
                    <tr key={it.id} style={{ borderBottom: "1px solid var(--border)" }}>
                      <td style={{ padding: "6px 4px 6px 0", color: "var(--text)" }}>{it.name}</td>
                      <td style={numCell}>
                        {it.qty} {it.unit}
                      </td>
                      <td style={numCell}>{formatCurrency(it.unit_price, inv.currency)}</td>
                      <td style={{ ...numCell, color: "var(--muted)" }}>{it.vat_rate} %</td>
                      <td style={{ ...numCell, paddingRight: 0, fontWeight: 600 }}>{formatCurrency(it.line_total, inv.currency)}</td>
                    </tr>
                  ))}
                  {items.length === 0 && (
                    <tr>
                      <td colSpan={5} style={{ padding: "var(--space-2) 0", color: "var(--muted)" }}>
                        Faktura nemá žádné položky.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </DetailSection>

          <DetailSection title="Souhrn">
            <DetailRow label="Základ" value={formatCurrency(inv.subtotal, inv.currency)} />
            <DetailRow label="DPH" value={formatCurrency(inv.vat_amount, inv.currency)} />
            {inv.rounding !== 0 && <DetailRow label="Zaokrouhlení" value={formatCurrency(inv.rounding, inv.currency)} />}
            <div style={{ borderTop: "2px solid var(--border)", marginTop: 6, paddingTop: 6, display: "flex", justifyContent: "space-between" }}>
              <span style={{ fontWeight: 800, color: "var(--text)", fontSize: "var(--text-base)" }}>Celkem</span>
              <span style={{ fontWeight: 800, fontSize: "var(--text-lg)", color: "var(--text)", fontVariantNumeric: "tabular-nums" }}>{formatCurrency(inv.total, inv.currency)}</span>
            </div>
          </DetailSection>

          {inv.notes && (
            <DetailSection title="Poznámky">
              <p style={{ margin: 0, fontSize: "var(--text-base)", color: "var(--text)", whiteSpace: "pre-wrap" }}>{inv.notes}</p>
            </DetailSection>
          )}
          {inv.internal_note && (
            <DetailSection title="Interní poznámka">
              <p style={{ margin: 0, fontSize: "var(--text-base)", color: "var(--muted)", whiteSpace: "pre-wrap" }}>{inv.internal_note}</p>
            </DetailSection>
          )}

          <DetailSection title="Historie">
            {events.length === 0 ? (
              <p style={{ margin: 0, fontSize: "var(--text-sm)", color: "var(--muted)" }}>Žádné události.</p>
            ) : (
              <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column" }}>
                {events.map((ev, i) => (
                  <li key={ev.id} style={{ display: "flex", gap: "var(--space-3)", position: "relative", paddingBottom: i === events.length - 1 ? 0 : "var(--space-3)" }}>
                    <span style={{ display: "flex", flexDirection: "column", alignItems: "center", flex: "0 0 auto", width: 10 }}>
                      <span aria-hidden="true" style={{ width: 8, height: 8, marginTop: 5, borderRadius: "50%", background: "var(--accent)", flexShrink: 0 }} />
                      {i < events.length - 1 && <span aria-hidden="true" style={{ flex: 1, width: 1, background: "var(--border)", marginTop: 4 }} />}
                    </span>
                    <span style={{ minWidth: 0, fontSize: "var(--text-sm)" }}>
                      <span style={{ display: "block", color: "var(--text)", fontWeight: 600 }}>{describeEvent(ev)}</span>
                      <span style={{ display: "block", color: "var(--muted)", fontVariantNumeric: "tabular-nums" }}>{formatDateTime(ev.created_at)}</span>
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </DetailSection>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ─── Popis události ──────────────────────────────────────────

function describeEvent(ev: InvoiceEvent): string {
  const p = (ev.payload && typeof ev.payload === "object" && !Array.isArray(ev.payload) ? ev.payload : {}) as Record<string, unknown>;
  switch (ev.type) {
    case "created":
      return p.duplicated_from ? "Vytvořeno duplikací" : "Vytvořeno";
    case "updated":
      return "Upraveno";
    case "status_changed": {
      const to = typeof p.to === "string" ? STATUS_LABELS[asStatus(p.to)] : null;
      return to ? `Stav změněn na ${to.toLowerCase()}` : "Stav změněn";
    }
    case "sent":
      return typeof p.recipient === "string" ? `Odesláno na ${p.recipient}` : "Odesláno e-mailem";
    case "deleted":
      return "Smazáno";
    default:
      return ev.type;
  }
}

// ─── Drobné části ────────────────────────────────────────────

function DetailSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div style={{ marginBottom: "var(--space-5)" }}>
      <div style={{ fontSize: "var(--text-xs)", fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "var(--space-2)" }}>{title}</div>
      {children}
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: "var(--space-3)", fontSize: "var(--text-base)", padding: "3px 0" }}>
      <span style={{ color: "var(--muted)", flexShrink: 0 }}>{label}</span>
      <span style={{ color: "var(--text)", fontWeight: 500, textAlign: "right", minWidth: 0, overflowWrap: "anywhere" }}>{value}</span>
    </div>
  );
}

const thStyle = {
  textAlign: "right" as const,
  padding: "6px 4px",
  color: "var(--muted)",
  fontWeight: 600,
  fontSize: "var(--text-xs)",
  whiteSpace: "nowrap" as const,
};

const numCell = {
  textAlign: "right" as const,
  padding: "6px 4px",
  color: "var(--text)",
  fontVariantNumeric: "tabular-nums" as const,
  whiteSpace: "nowrap" as const,
};
