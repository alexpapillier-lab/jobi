import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { Button, Card, Input, Label, MenuItem } from "../../components/ui";
import { SectionHeading } from "../../components/SectionHeading";
import { ChevronDownIcon, DocumentIcon, PlusIcon, UserIcon, XIcon } from "../../components/icons";
import { CustomerAutocomplete, type CustomerMatch } from "../../components/orders/CustomerAutocomplete";
import { emptyLineItem, formatCurrency, type InvoiceLineItem, type InvoiceTotals } from "../../lib/invoiceMath";
import { StatusPill } from "./InvoiceList";
import { formatDate, type EditorLineItem, type Invoice } from "./types";

/** Zákazník z našeptávače včetně údajů, které faktura potřebuje navíc. */
export type InvoiceCustomerMatch = CustomerMatch & {
  ico?: string | null;
  dic?: string | null;
  address?: string | null;
};

/**
 * Editor faktury – jedna stránka, pořadí podle toho, co uživatel řeší
 * nejdřív: komu fakturuje, co fakturuje, a teprve pak čísla a data, která
 * jsou předvyplněná. Spodní lišta drží součet a akce, takže jsou po ruce
 * i u dlouhé faktury.
 *
 * Stav drží rodič (Invoices.tsx); sem chodí hodnoty a zpětná volání.
 */
export function InvoiceEditor({
  invoice,
  setInvoice,
  items,
  setItems,
  totals,
  saving,
  isNew,
  dirty,
  vatRate,
  searchCustomers,
  onSave,
  onIssue,
  onCancel,
}: {
  invoice: Partial<Invoice>;
  setInvoice: (i: Partial<Invoice>) => void;
  items: EditorLineItem[];
  setItems: (items: EditorLineItem[]) => void;
  totals: InvoiceTotals;
  saving: boolean;
  isNew: boolean;
  dirty: boolean;
  /** Sazba pro nové položky podle nastavení servisu (neplátce 0). */
  vatRate: number;
  searchCustomers: (q: string) => Promise<InvoiceCustomerMatch[]>;
  /** Uloží bez změny stavu (koncept zůstane konceptem). */
  onSave: () => void;
  /** Uloží a nastaví stav „vystaveno“. */
  onIssue: () => void;
  onCancel: () => void;
}) {
  const isDraft = (invoice.status || "draft") === "draft";
  const [customerMode, setCustomerMode] = useState<"card" | "form">(invoice.customer_name ? "card" : "form");

  const updateField = <K extends keyof Invoice>(field: K, value: Invoice[K]) => {
    setInvoice({ ...invoice, [field]: value });
  };

  const updateItem = <K extends keyof InvoiceLineItem>(index: number, field: K, value: InvoiceLineItem[K]) => {
    const next = items.map((it, i) => (i === index ? { ...it, [field]: value } : it));
    setItems(next);
  };

  const addItem = () => setItems([...items, emptyLineItem(vatRate)]);

  const removeItem = (index: number) => {
    if (items.length <= 1) {
      setItems([emptyLineItem(vatRate)]);
      return;
    }
    setItems(items.filter((_, i) => i !== index));
  };

  const applyCustomer = (m: InvoiceCustomerMatch) => {
    setInvoice({
      ...invoice,
      customer_id: m.id,
      customer_name: m.name || m.company || "",
      customer_email: m.email || "",
      customer_phone: m.phone || "",
      customer_ico: m.ico || "",
      customer_dic: m.dic || "",
      customer_address: m.address || "",
    });
    setCustomerMode("card");
  };

  // ⌘/Ctrl+S uloží, dokud je co ukládat.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (dirty && !saving) onSave();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dirty, saving, onSave]);

  const title = isNew ? "Nová faktura" : `Faktura ${invoice.number || ""}`;

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      {/* Hlavička */}
      <div
        style={{
          padding: "var(--space-3) var(--space-6)",
          borderBottom: "1px solid var(--border)",
          display: "flex",
          alignItems: "center",
          gap: "var(--space-3)",
          flexShrink: 0,
          background: "var(--panel)",
        }}
      >
        <Button variant="ghost" iconOnly aria-label="Zpět na seznam faktur" title="Zpět" icon={<BackIcon />} onClick={onCancel} />
        <h2 style={{ margin: 0, fontSize: "var(--text-xl)", fontWeight: 800, color: "var(--text)", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {title}
        </h2>
        {!isNew && invoice.status && <StatusPill status={invoice.status} />}
        {dirty && (
          <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: "var(--space-2)", fontSize: "var(--text-sm)", color: "var(--muted)", whiteSpace: "nowrap" }}>
            <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: "var(--radius-pill)", background: "var(--warning)" }} />
            Neuložené změny
          </span>
        )}
      </div>

      {/* Tělo */}
      <div style={{ flex: 1, overflow: "auto", padding: "var(--space-5) var(--space-6) var(--space-8)" }}>
        <div style={{ maxWidth: 960, margin: "0 auto", display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
          {/* Odběratel */}
          <Card>
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "var(--space-3)" }}>
              <SectionHeading icon={<UserIcon size={18} />}>Odběratel</SectionHeading>
              {customerMode === "card" && (
                <Button variant="soft" size="sm" onClick={() => setCustomerMode("form")}>
                  Změnit
                </Button>
              )}
            </div>

            {customerMode === "card" ? (
              <CustomerCard invoice={invoice} />
            ) : (
              <>
                <div style={{ marginBottom: "var(--space-3)" }}>
                  <Label>Zákazník</Label>
                  <div style={{ marginTop: 4 }}>
                    <CustomerAutocomplete
                      id="invoice-customer"
                      value={invoice.customer_name || ""}
                      onChange={(text) => setInvoice({ ...invoice, customer_name: text, customer_id: null })}
                      onSelect={(m) => applyCustomer(m as InvoiceCustomerMatch)}
                      search={searchCustomers}
                      placeholder="Začněte psát jméno, firmu, telefon, e-mail nebo IČO"
                      inputStyle={inputStyle}
                      autoFocus={isNew && !invoice.customer_name}
                    />
                  </div>
                  <div style={{ fontSize: "var(--text-xs)", color: "var(--muted)", marginTop: 4 }}>
                    Výběr ze seznamu vyplní údaje níže. Nového odběratele stačí vypsat.
                  </div>
                </div>
                <FieldGrid>
                  <Field label="IČO" value={invoice.customer_ico || ""} onChange={(v) => updateField("customer_ico", v)} />
                  <Field label="DIČ" value={invoice.customer_dic || ""} onChange={(v) => updateField("customer_dic", v)} />
                </FieldGrid>
                <Field label="Adresa" value={invoice.customer_address || ""} onChange={(v) => updateField("customer_address", v)} placeholder="Ulice, město, PSČ" />
                <FieldGrid>
                  <Field label="E-mail" type="email" value={invoice.customer_email || ""} onChange={(v) => updateField("customer_email", v)} />
                  <Field label="Telefon" type="tel" value={invoice.customer_phone || ""} onChange={(v) => updateField("customer_phone", v)} />
                </FieldGrid>
                {invoice.customer_name && (
                  <div style={{ display: "flex", justifyContent: "flex-end" }}>
                    <Button variant="soft" size="sm" onClick={() => setCustomerMode("card")}>
                      Hotovo
                    </Button>
                  </div>
                )}
              </>
            )}
          </Card>

          {/* Položky */}
          <Card>
            <SectionHeading icon={<DocumentIcon size={18} />}>Položky</SectionHeading>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 620 }}>
                <thead>
                  <tr style={{ borderBottom: "2px solid var(--border)" }}>
                    <th style={thStyle}>Název</th>
                    <th style={{ ...thStyle, width: 90, textAlign: "right" }}>Množství</th>
                    <th style={{ ...thStyle, width: 64, textAlign: "center" }}>Jedn.</th>
                    <th style={{ ...thStyle, width: 120, textAlign: "right" }}>Cena / jedn.</th>
                    <th style={{ ...thStyle, width: 84, textAlign: "right" }}>DPH</th>
                    <th style={{ ...thStyle, width: 120, textAlign: "right" }}>Celkem</th>
                    <th style={{ ...thStyle, width: 40 }} aria-label="Akce" />
                  </tr>
                </thead>
                <tbody>
                  {items.map((item, idx) => {
                    const lineTotal = Math.round(item.qty * item.unit_price * 100) / 100;
                    return (
                      <tr key={item.id ?? idx} style={{ borderBottom: "1px solid var(--border)" }}>
                        <td style={tdStyle}>
                          <input
                            value={item.name}
                            onChange={(e) => updateItem(idx, "name", e.target.value)}
                            placeholder="Název položky"
                            aria-label={`Název položky ${idx + 1}`}
                            style={cellInput}
                          />
                        </td>
                        <td style={tdStyle}>
                          <input
                            type="number"
                            inputMode="decimal"
                            value={item.qty}
                            onChange={(e) => updateItem(idx, "qty", parseFloat(e.target.value) || 0)}
                            aria-label="Množství"
                            style={{ ...cellInput, textAlign: "right" }}
                            step="0.001"
                            min="0"
                          />
                        </td>
                        <td style={tdStyle}>
                          <input
                            value={item.unit}
                            onChange={(e) => updateItem(idx, "unit", e.target.value)}
                            aria-label="Jednotka"
                            style={{ ...cellInput, textAlign: "center" }}
                          />
                        </td>
                        <td style={tdStyle}>
                          <input
                            type="number"
                            inputMode="decimal"
                            value={item.unit_price}
                            onChange={(e) => updateItem(idx, "unit_price", parseFloat(e.target.value) || 0)}
                            aria-label="Cena za jednotku"
                            style={{ ...cellInput, textAlign: "right" }}
                            step="0.01"
                            min="0"
                            onKeyDown={(e) => {
                              // Enter na poslední ceně přidá další řádek – jako v tabulce.
                              if (e.key === "Enter" && idx === items.length - 1) {
                                e.preventDefault();
                                addItem();
                              }
                            }}
                          />
                        </td>
                        <td style={tdStyle}>
                          <select
                            value={item.vat_rate}
                            onChange={(e) => updateItem(idx, "vat_rate", parseFloat(e.target.value))}
                            aria-label="Sazba DPH"
                            style={{ ...cellInput, textAlign: "right", cursor: "pointer" }}
                          >
                            <option value="0">0 %</option>
                            <option value="12">12 %</option>
                            <option value="21">21 %</option>
                          </select>
                        </td>
                        <td style={{ ...tdStyle, textAlign: "right", fontWeight: 600, fontVariantNumeric: "tabular-nums", fontSize: "var(--text-base)", color: "var(--text)", whiteSpace: "nowrap" }}>
                          {formatCurrency(lineTotal)}
                        </td>
                        <td style={{ ...tdStyle, textAlign: "center" }}>
                          <Button
                            variant="ghost"
                            size="sm"
                            iconOnly
                            aria-label="Odebrat položku"
                            title="Odebrat položku"
                            icon={<XIcon size={14} />}
                            onClick={() => removeItem(idx)}
                            style={{ color: "var(--muted)" }}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={7} style={{ padding: "var(--space-2) 0 var(--space-3)" }}>
                      <Button variant="soft" size="sm" icon={<PlusIcon size={14} />} onClick={addItem}>
                        Přidat položku
                      </Button>
                    </td>
                  </tr>
                  <TotalRow label="Základ" value={formatCurrency(totals.subtotal)} />
                  {totals.vat_breakdown.map((v) => (
                    <TotalRow key={v.rate} label={`DPH ${v.rate} %`} value={formatCurrency(v.vat)} />
                  ))}
                  {totals.rounding !== 0 && <TotalRow label="Zaokrouhlení" value={formatCurrency(totals.rounding)} />}
                  <TotalRow label="Celkem" value={formatCurrency(totals.total_rounded)} strong />
                </tfoot>
              </table>
            </div>
          </Card>

          {/* Údaje dokladu */}
          <Collapsible
            title="Údaje dokladu"
            summary={[
              invoice.number,
              invoice.issue_date ? `vystaveno ${formatDate(invoice.issue_date)}` : null,
              invoice.due_date ? `splatnost ${formatDate(invoice.due_date)}` : null,
            ]
              .filter(Boolean)
              .join(" · ")}
            defaultOpen={!isNew}
          >
            <FieldGrid>
              <Field label="Číslo faktury" value={invoice.number || ""} onChange={(v) => updateField("number", v)} />
              <Field label="Variabilní symbol" value={invoice.variable_symbol || ""} onChange={(v) => updateField("variable_symbol", v)} />
            </FieldGrid>
            <FieldGrid columns={3}>
              <Field label="Datum vystavení" type="date" value={invoice.issue_date || ""} onChange={(v) => updateField("issue_date", v)} />
              <Field label="Datum splatnosti" type="date" value={invoice.due_date || ""} onChange={(v) => updateField("due_date", v)} />
              <Field label="DUZP" type="date" value={invoice.taxable_date || ""} onChange={(v) => updateField("taxable_date", v)} />
            </FieldGrid>
            <FieldGrid>
              <Field label="Měna" value={invoice.currency || "CZK"} onChange={(v) => updateField("currency", v.toUpperCase())} />
            </FieldGrid>
          </Collapsible>

          {/* Dodavatel */}
          <Collapsible title="Dodavatel" summary={invoice.supplier_name || "Údaje z nastavení servisu"} defaultOpen={false}>
            <Field label="Název" value={invoice.supplier_name || ""} onChange={(v) => updateField("supplier_name", v)} />
            <FieldGrid>
              <Field label="IČO" value={invoice.supplier_ico || ""} onChange={(v) => updateField("supplier_ico", v)} />
              <Field label="DIČ" value={invoice.supplier_dic || ""} onChange={(v) => updateField("supplier_dic", v)} />
            </FieldGrid>
            <Field label="Adresa" value={invoice.supplier_address || ""} onChange={(v) => updateField("supplier_address", v)} />
            <FieldGrid>
              <Field label="E-mail" type="email" value={invoice.supplier_email || ""} onChange={(v) => updateField("supplier_email", v)} />
              <Field label="Telefon" type="tel" value={invoice.supplier_phone || ""} onChange={(v) => updateField("supplier_phone", v)} />
            </FieldGrid>
            <Field label="Číslo účtu" value={invoice.supplier_bank_account || ""} onChange={(v) => updateField("supplier_bank_account", v)} />
            <FieldGrid>
              <Field label="IBAN" value={invoice.supplier_iban || ""} onChange={(v) => updateField("supplier_iban", v)} />
              <Field label="SWIFT" value={invoice.supplier_swift || ""} onChange={(v) => updateField("supplier_swift", v)} />
            </FieldGrid>
          </Collapsible>

          {/* Poznámky */}
          <Card>
            <SectionHeading>Poznámky</SectionHeading>
            <Label>Text na faktuře</Label>
            <textarea
              value={invoice.notes || ""}
              onChange={(e) => updateField("notes", e.target.value)}
              rows={3}
              placeholder="Např. způsob úhrady nebo poděkování"
              style={textareaStyle}
            />
            <div style={{ marginTop: "var(--space-3)" }}>
              <Label>Interní poznámka</Label>
              <textarea
                value={invoice.internal_note || ""}
                onChange={(e) => updateField("internal_note", e.target.value)}
                rows={2}
                placeholder="Jen pro vás, na faktuře se netiskne"
                style={textareaStyle}
              />
            </div>
          </Card>
        </div>
      </div>

      {/* Spodní lišta */}
      <div
        style={{
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "var(--space-3)",
          flexWrap: "wrap",
          padding: "var(--space-3) var(--space-6)",
          borderTop: "1px solid var(--border)",
          background: "var(--panel)",
          backdropFilter: "var(--blur)",
        }}
      >
        <div style={{ display: "flex", alignItems: "baseline", gap: "var(--space-2)", minWidth: 0 }}>
          <span style={{ fontSize: "var(--text-sm)", color: "var(--muted)", fontWeight: 700 }}>Celkem</span>
          <span style={{ fontSize: "var(--text-xl)", fontWeight: 800, color: "var(--text)", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
            {formatCurrency(totals.total_rounded, invoice.currency || "CZK")}
          </span>
        </div>
        <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap", justifyContent: "flex-end" }}>
          <Button variant="ghost" onClick={onCancel} disabled={saving}>
            Zrušit
          </Button>
          {isDraft ? (
            <>
              <Button variant="soft" onClick={onSave} disabled={saving} title="⌘/Ctrl+S">
                {saving ? "Ukládám…" : "Uložit koncept"}
              </Button>
              <Button variant="primary" onClick={onIssue} disabled={saving}>
                Vystavit
              </Button>
            </>
          ) : (
            <Button variant="primary" onClick={onSave} disabled={saving || !dirty} title="⌘/Ctrl+S">
              {saving ? "Ukládám…" : "Uložit"}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Kompaktní karta odběratele ─────────────────────────────

function CustomerCard({ invoice }: { invoice: Partial<Invoice> }) {
  const ids = [invoice.customer_ico ? `IČO ${invoice.customer_ico}` : null, invoice.customer_dic ? `DIČ ${invoice.customer_dic}` : null].filter(Boolean).join(" · ");
  const contact = [invoice.customer_email, invoice.customer_phone].filter(Boolean).join(" · ");
  return (
    <div
      style={{
        display: "flex",
        gap: "var(--space-3)",
        alignItems: "flex-start",
        padding: "var(--space-3) var(--space-4)",
        borderRadius: "var(--radius-sm)",
        background: "var(--panel-2)",
        border: "1px solid var(--border)",
      }}
    >
      <span style={{ color: "var(--muted)", display: "inline-flex", marginTop: 2 }}>
        <UserIcon size={18} />
      </span>
      <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 2, fontSize: "var(--text-base)" }}>
        <div style={{ fontWeight: 800, color: "var(--text)" }}>{invoice.customer_name}</div>
        {ids && <div style={{ color: "var(--muted)", fontSize: "var(--text-sm)" }}>{ids}</div>}
        {invoice.customer_address && <div style={{ color: "var(--muted)", fontSize: "var(--text-sm)" }}>{invoice.customer_address}</div>}
        {contact && <div style={{ color: "var(--muted)", fontSize: "var(--text-sm)" }}>{contact}</div>}
      </div>
    </div>
  );
}

// ─── Sbalitelná sekce ────────────────────────────────────────

function Collapsible({
  title,
  summary,
  defaultOpen,
  children,
}: {
  title: string;
  summary?: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen ?? false);
  return (
    <Card flush>
      <MenuItem layout="between" size="md" onClick={() => setOpen((o) => !o)} aria-expanded={open} style={{ borderRadius: "var(--radius-lg)" }}>
        <span style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", minWidth: 0 }}>
          <span style={{ fontWeight: 950, fontSize: "var(--text-lg)", color: "var(--text)", whiteSpace: "nowrap" }}>{title}</span>
          {summary && !open && (
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--muted)", fontSize: "var(--text-sm)" }}>{summary}</span>
          )}
        </span>
        <span style={{ flexShrink: 0, color: "var(--muted)", display: "inline-flex", transform: open ? "rotate(180deg)" : "none", transition: "transform 0.2s" }}>
          <ChevronDownIcon size={16} />
        </span>
      </MenuItem>
      {open && <div style={{ padding: "0 var(--pad-16) var(--pad-16)", borderTop: "1px solid var(--border)", paddingTop: "var(--space-3)" }}>{children}</div>}
    </Card>
  );
}

// ─── Pole ────────────────────────────────────────────────────

function FieldGrid({ children, columns = 2 }: { children: ReactNode; columns?: 2 | 3 }) {
  const min = columns === 3 ? 160 : 220;
  return <div style={{ display: "grid", gridTemplateColumns: `repeat(auto-fit, minmax(min(100%, ${min}px), 1fr))`, gap: "0 var(--space-3)" }}>{children}</div>;
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <div style={{ marginBottom: "var(--space-3)" }}>
      <Label>{label}</Label>
      <div style={{ marginTop: 4 }}>
        <Input type={type} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      </div>
    </div>
  );
}

function TotalRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <tr style={strong ? { borderTop: "2px solid var(--border)" } : undefined}>
      <td colSpan={5} style={{ padding: strong ? "var(--space-2) 6px 0" : "3px 6px", textAlign: "right", color: strong ? "var(--text)" : "var(--muted)", fontSize: strong ? "var(--text-base)" : "var(--text-sm)", fontWeight: strong ? 800 : 500 }}>
        {label}
      </td>
      <td colSpan={2} style={{ padding: strong ? "var(--space-2) 6px 0" : "3px 6px", textAlign: "right", color: "var(--text)", fontWeight: strong ? 800 : 600, fontSize: strong ? "var(--text-lg)" : "var(--text-sm)", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
        {value}
      </td>
    </tr>
  );
}

function BackIcon() {
  return (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M19 12H5M12 19l-7-7 7-7" />
    </svg>
  );
}

// ─── Styly ───────────────────────────────────────────────────

const inputStyle: CSSProperties = {
  width: "100%",
  padding: "10px var(--space-3)",
  borderRadius: "var(--radius-sm)",
  border: "1px solid var(--border)",
  background: "var(--panel)",
  color: "var(--text)",
  fontFamily: "inherit",
  fontSize: "var(--text-base)",
  outline: "none",
};

const textareaStyle: CSSProperties = {
  width: "100%",
  marginTop: 4,
  padding: "10px var(--space-3)",
  borderRadius: "var(--radius-sm)",
  border: "1px solid var(--border)",
  background: "var(--panel)",
  color: "var(--text)",
  outline: "none",
  resize: "vertical",
  fontSize: "var(--text-base)",
  fontFamily: "inherit",
};

const thStyle: CSSProperties = {
  textAlign: "left",
  padding: "var(--space-2) 6px",
  fontSize: "var(--text-xs)",
  fontWeight: 700,
  color: "var(--muted)",
  textTransform: "uppercase",
  letterSpacing: "0.03em",
  whiteSpace: "nowrap",
};

const tdStyle: CSSProperties = {
  padding: "4px 6px",
};

const cellInput: CSSProperties = {
  width: "100%",
  padding: "7px 8px",
  borderRadius: "var(--radius-xs)",
  border: "1px solid var(--border)",
  background: "var(--panel-2)",
  color: "var(--text)",
  fontFamily: "inherit",
  fontSize: "var(--text-base)",
  outline: "none",
};
