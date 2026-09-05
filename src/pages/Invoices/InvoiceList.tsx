import { useMemo, type CSSProperties, type ReactNode } from "react";
import { Button, Card, Input, PageHeader, Pill, Segmented, Toolbar } from "../../components/ui";
import { DocumentIcon, PlusIcon } from "../../components/icons";
import { formatCurrency } from "../../lib/invoiceMath";
import {
  KIND_COLORS,
  KIND_LABELS,
  STATUS_COLORS,
  STATUS_LABELS,
  UNPAID_STATUSES,
  addDaysIso,
  asKind,
  asStatus,
  daysOverdue,
  formatDate,
  matchesFilter,
  matchesKind,
  pluralDny,
  pluralFaktury,
  todayIso,
  type Invoice,
  type InvoiceKind,
  type InvoiceStatus,
  type KindFilter,
  type ListFilter,
} from "./types";

const KIND_FILTER_OPTIONS: { value: KindFilter; label: string }[] = [
  { value: "all", label: "Vše" },
  { value: "invoice", label: "Faktury" },
  { value: "proforma", label: "Zálohové" },
  { value: "credit_note", label: "Dobropisy" },
];

/**
 * Seznam faktur: hlavička, přehledové dlaždice, filtr a řádky.
 *
 * Data a akce drží rodič (Invoices.tsx); tady se jen odvozují součty
 * a vykresluje. Dlaždice i filtr se ukazují teprve, když nějaká faktura
 * existuje – prázdná obrazovka místo nul říká, co udělat.
 */
export function InvoiceList({
  invoices,
  loading,
  filter,
  onFilterChange,
  kindFilter,
  onKindFilterChange,
  search,
  onSearchChange,
  onNew,
  onOpen,
}: {
  invoices: Invoice[];
  loading: boolean;
  filter: ListFilter;
  onFilterChange: (f: ListFilter) => void;
  kindFilter: KindFilter;
  onKindFilterChange: (f: KindFilter) => void;
  search: string;
  onSearchChange: (q: string) => void;
  onNew: () => void;
  onOpen: (inv: Invoice) => void;
}) {
  const today = todayIso();

  const stats = useMemo(() => {
    const unpaidList = invoices.filter((i) => UNPAID_STATUSES.includes(asStatus(i.status)));
    const overdueList = invoices.filter((i) => i.status === "overdue");
    const since = addDaysIso(today, -30);
    const paidRecent = invoices.filter((i) => {
      if (i.status !== "paid") return false;
      const when = (i.paid_at || i.updated_at || i.issue_date || "").slice(0, 10);
      return when >= since;
    });
    const counts: Record<ListFilter, number> = {
      all: invoices.length,
      draft: invoices.filter((i) => i.status === "draft").length,
      issued: invoices.filter((i) => i.status === "issued" || i.status === "sent").length,
      paid: invoices.filter((i) => i.status === "paid").length,
      overdue: overdueList.length,
      cancelled: invoices.filter((i) => i.status === "cancelled").length,
    };
    return {
      unpaidSum: unpaidList.reduce((s, i) => s + i.total, 0),
      unpaidCount: unpaidList.length,
      overdueSum: overdueList.reduce((s, i) => s + i.total, 0),
      overdueCount: overdueList.length,
      paidRecentSum: paidRecent.reduce((s, i) => s + i.total, 0),
      paidRecentCount: paidRecent.length,
      counts,
    };
  }, [invoices, today]);

  const filtered = useMemo(() => {
    let list = invoices.filter((i) => matchesFilter(i, filter) && matchesKind(i, kindFilter));
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (i) =>
          (i.number || "").toLowerCase().includes(q) ||
          (i.customer_name || "").toLowerCase().includes(q) ||
          (i.variable_symbol || "").toLowerCase().includes(q),
      );
    }
    return list;
  }, [invoices, filter, kindFilter, search]);

  const hasAny = invoices.length > 0;
  // Filtr druhu se ukáže, teprve když servis zálohy nebo dobropisy skutečně používá.
  const maDruhy = invoices.some((i) => asKind(i) !== "invoice");

  const filterOptions: { value: ListFilter; label: ReactNode }[] = (
    [
      ["all", "Vše"],
      ["draft", "Koncepty"],
      ["issued", "Vystavené"],
      ["paid", "Zaplacené"],
      ["overdue", "Po splatnosti"],
      ["cancelled", "Stornované"],
    ] as [ListFilter, string][]
  ).map(([value, label]) => ({
    value,
    label: (
      <>
        {label}
        <span style={{ marginLeft: "var(--space-1)", color: "var(--muted)", fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
          {stats.counts[value]}
        </span>
      </>
    ),
  }));

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div style={{ padding: "var(--space-5) var(--space-6) 0", flexShrink: 0 }}>
        <PageHeader
          title="Faktury"
          subtitle={hasAny ? `${pluralFaktury(invoices.length)} · ${formatCurrency(stats.unpaidSum)} nezaplaceno` : undefined}
          actions={
            <Button variant="primary" icon={<PlusIcon size={16} />} onClick={onNew}>
              Nová faktura
            </Button>
          }
        />

        {hasAny && (
          <>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 180px), 1fr))",
                gap: "var(--space-3)",
                margin: "var(--space-4) 0",
              }}
            >
              <StatTile
                label="Nezaplaceno"
                value={formatCurrency(stats.unpaidSum)}
                meta={pluralFaktury(stats.unpaidCount)}
                active={filter === "issued"}
                onClick={() => onFilterChange("issued")}
              />
              <StatTile
                label="Po splatnosti"
                value={formatCurrency(stats.overdueSum)}
                meta={pluralFaktury(stats.overdueCount)}
                tone={stats.overdueCount > 0 ? "danger" : undefined}
                active={filter === "overdue"}
                onClick={() => onFilterChange("overdue")}
              />
              <StatTile
                label="Zaplaceno za 30 dní"
                value={formatCurrency(stats.paidRecentSum)}
                meta={pluralFaktury(stats.paidRecentCount)}
                tone="success"
                active={filter === "paid"}
                onClick={() => onFilterChange("paid")}
              />
              <StatTile
                label="Koncepty"
                value={String(stats.counts.draft)}
                meta={stats.counts.draft === 0 ? "žádné rozpracované" : "rozpracované"}
                active={filter === "draft"}
                onClick={() => onFilterChange("draft")}
              />
            </div>

            <Toolbar style={{ marginBottom: "var(--space-3)" }}>
              <div style={{ flex: "1 1 220px", minWidth: 0 }}>
                <Input
                  type="search"
                  placeholder="Hledat číslo, odběratele nebo VS"
                  aria-label="Hledat faktury"
                  value={search}
                  onChange={(e) => onSearchChange(e.target.value)}
                />
              </div>
              <Segmented size="sm" ariaLabel="Filtr podle stavu" value={filter} options={filterOptions} onChange={onFilterChange} />
              {maDruhy && <Segmented size="sm" ariaLabel="Filtr podle druhu" value={kindFilter} options={KIND_FILTER_OPTIONS} onChange={onKindFilterChange} />}
            </Toolbar>
          </>
        )}
      </div>

      <div style={{ flex: 1, overflow: "auto", padding: "0 var(--space-6) var(--space-6)" }}>
        {loading && !hasAny ? (
          <div style={{ textAlign: "center", padding: "var(--space-8)", color: "var(--muted)", fontSize: "var(--text-base)" }}>Načítám…</div>
        ) : !hasAny ? (
          <EmptyState onNew={onNew} />
        ) : filtered.length === 0 ? (
          <div style={{ textAlign: "center", padding: "var(--space-8)", color: "var(--muted)", display: "flex", flexDirection: "column", alignItems: "center", gap: "var(--space-3)" }}>
            <div style={{ fontSize: "var(--text-base)" }}>Nic neodpovídá filtru</div>
            <Button
              variant="soft"
              size="sm"
              onClick={() => {
                onFilterChange("all");
                onKindFilterChange("all");
                onSearchChange("");
              }}
            >
              Vymazat
            </Button>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
            {filtered.map((inv) => (
              <InvoiceRow key={inv.id} invoice={inv} today={today} onOpen={() => onOpen(inv)} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Dlaždice ────────────────────────────────────────────────

function StatTile({
  label,
  value,
  meta,
  tone,
  active,
  onClick,
}: {
  label: string;
  value: string;
  meta?: string;
  tone?: "danger" | "success";
  active?: boolean;
  onClick?: () => void;
}) {
  const color = tone === "danger" ? "var(--danger-text)" : tone === "success" ? "var(--success-text)" : "var(--text)";
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      style={{
        textAlign: "left",
        fontFamily: "inherit",
        cursor: onClick ? "pointer" : "default",
        background: tone === "danger" ? "var(--danger-soft)" : "var(--panel)",
        border: `1px solid ${active ? "var(--accent)" : "var(--border)"}`,
        boxShadow: active ? "0 0 0 3px var(--accent-soft)" : "none",
        borderRadius: "var(--radius-md)",
        padding: "var(--space-3) var(--space-4)",
        display: "flex",
        flexDirection: "column",
        gap: 2,
        minWidth: 0,
      }}
    >
      <span style={{ fontSize: "var(--text-xs)", fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
        {label}
      </span>
      <span style={{ fontSize: "var(--text-xl)", fontWeight: 800, color, fontVariantNumeric: "tabular-nums", lineHeight: 1.2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {value}
      </span>
      {meta && <span style={{ fontSize: "var(--text-sm)", color: tone === "danger" ? "var(--danger-text)" : "var(--muted)" }}>{meta}</span>}
    </button>
  );
}

// ─── Prázdný stav ────────────────────────────────────────────

function EmptyState({ onNew }: { onNew: () => void }) {
  return (
    <div style={{ display: "flex", justifyContent: "center", paddingTop: "var(--space-8)" }}>
      <Card style={{ maxWidth: 440, width: "100%", textAlign: "center", padding: "var(--space-8) var(--space-6)" }}>
        <div style={{ display: "inline-flex", padding: "var(--space-3)", borderRadius: "var(--radius-pill)", background: "var(--accent-soft)", color: "var(--accent)", marginBottom: "var(--space-3)" }}>
          <DocumentIcon size={28} />
        </div>
        <div style={{ fontSize: "var(--text-lg)", fontWeight: 800, color: "var(--text)", marginBottom: "var(--space-2)" }}>Zatím žádné faktury</div>
        <p style={{ margin: "0 0 var(--space-5)", fontSize: "var(--text-base)", color: "var(--muted)", lineHeight: 1.5 }}>
          Fakturu vystavíte tlačítkem Nová faktura, nebo přímo z dokončené zakázky tlačítkem Vystavit fakturu.
        </p>
        <Button variant="primary" icon={<PlusIcon size={16} />} onClick={onNew}>
          Nová faktura
        </Button>
      </Card>
    </div>
  );
}

// ─── Řádek ───────────────────────────────────────────────────

export function StatusPill({ status }: { status: string }) {
  const s = asStatus(status);
  const c = STATUS_COLORS[s];
  return (
    <Pill color={c.fg} style={{ background: c.bg, borderColor: "transparent" }}>
      {STATUS_LABELS[s]}
    </Pill>
  );
}

/** Štítek druhu dokladu – u běžné faktury se nezobrazuje, ta je výchozí. */
export function KindPill({ kind }: { kind: InvoiceKind }) {
  const c = KIND_COLORS[kind];
  return (
    <Pill color={c.fg} style={{ background: c.bg, borderColor: "transparent" }}>
      {KIND_LABELS[kind]}
    </Pill>
  );
}

function InvoiceRow({ invoice: inv, today, onOpen }: { invoice: Invoice; today: string; onOpen: () => void }) {
  const status: InvoiceStatus = asStatus(inv.status);
  const kind = asKind(inv);
  const overdueDays = status === "overdue" ? daysOverdue(inv.due_date, today) : 0;
  const isOverdue = status === "overdue";

  const rowStyle: CSSProperties = {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: "var(--space-3)",
    padding: "var(--space-3) var(--space-4)",
    background: "var(--panel)",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius-sm)",
    boxShadow: isOverdue ? "inset 3px 0 0 var(--danger)" : undefined,
    cursor: "pointer",
    textAlign: "left",
    fontFamily: "inherit",
    color: "var(--text)",
    width: "100%",
    opacity: status === "cancelled" ? 0.7 : 1,
  };

  return (
    <button type="button" onClick={onOpen} style={rowStyle} aria-label={`${KIND_LABELS[kind]} ${inv.number}`}>
      <div style={{ flex: "1 1 180px", minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", marginBottom: 2, flexWrap: "wrap" }}>
          <span style={{ fontWeight: 700, fontSize: "var(--text-base)", whiteSpace: "nowrap" }}>{inv.number}</span>
          {kind !== "invoice" && <KindPill kind={kind} />}
          <StatusPill status={status} />
        </div>
        <div style={{ fontSize: "var(--text-sm)", color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {inv.customer_name || "Bez odběratele"}
          <span aria-hidden="true"> · </span>
          {status === "draft" ? `koncept z ${formatDate(inv.created_at ?? inv.issue_date)}` : `vystaveno ${formatDate(inv.issue_date)}`}
        </div>
      </div>

      <div style={{ flex: "0 1 150px", minWidth: 110, fontSize: "var(--text-sm)", color: "var(--muted)" }}>
        <div>Splatnost {formatDate(inv.due_date)}</div>
        {overdueDays > 0 && (
          <div style={{ color: "var(--danger-text)", fontWeight: 700 }}>po splatnosti o {pluralDny(overdueDays)}</div>
        )}
        {status === "paid" && inv.paid_at && <div style={{ color: "var(--success-text)" }}>zaplaceno {formatDate(inv.paid_at)}</div>}
      </div>

      <div
        style={{
          flex: "0 0 auto",
          marginLeft: "auto",
          minWidth: 110,
          textAlign: "right",
          fontWeight: 800,
          fontSize: "var(--text-lg)",
          fontVariantNumeric: "tabular-nums",
          whiteSpace: "nowrap",
          textDecoration: status === "cancelled" ? "line-through" : undefined,
        }}
      >
        {formatCurrency(inv.total, inv.currency)}
      </div>
    </button>
  );
}
