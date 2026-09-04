import { useState } from "react";
import { Button, Segmented } from "../../components/ui";
import { InboxIcon, WarningIcon } from "../../components/icons";
import { SectionHeading } from "../../components/SectionHeading";
import type { Product, Warehouse } from "../../lib/inventoryDb";
import { HLASKA_NEDOSTUPNE, type PurchaseOrder, type PurchaseOrderStatus, type Supplier } from "../../lib/purchaseOrders";
import { OrderDetail, StavPill, formatDatum } from "./OrderDetail";

const formatKc = new Intl.NumberFormat("cs-CZ", { style: "currency", currency: "CZK", maximumFractionDigits: 0 });

type Filtr = "active" | PurchaseOrderStatus | "all";

function sklonuj(n: number, tvary: [string, string, string]) {
  const t = n === 1 ? tvary[0] : n >= 2 && n <= 4 ? tvary[1] : tvary[2];
  return `${n} ${t}`;
}

/**
 * Záložka Objednávky: čísla nahoře, návrh objednávky pod minimem, seznam
 * a detail. Data i zápisy drží rodič (Inventory.tsx) – tady je jen
 * zobrazení a otevřený detail.
 */
export function OrdersTab({
  orders,
  suppliers,
  products,
  warehouses,
  nedostupne,
  podMinimem,
  navrhuji,
  onNavrhnout,
  onReloadOrders,
  onReloadInventory,
}: {
  orders: PurchaseOrder[];
  suppliers: Supplier[];
  products: Product[];
  warehouses: Warehouse[];
  nedostupne: boolean;
  /** Kolik produktů je teď pod minimem i po započtení kusů na cestě. */
  podMinimem: number;
  navrhuji: boolean;
  onNavrhnout: () => Promise<void>;
  onReloadOrders: () => Promise<void>;
  onReloadInventory: () => Promise<void>;
}) {
  const [otevrenaId, setOtevrenaId] = useState<string | null>(null);
  const [filtr, setFiltr] = useState<Filtr>("active");

  const navrhy = orders.filter((o) => o.status === "draft").length;
  const objednane = orders.filter((o) => o.status === "ordered");
  const naCeste = objednane.reduce((a, o) => a + o.items.reduce((b, it) => b + Math.max(0, it.qty - it.receivedQty), 0), 0);

  const dodavatel = (id: string | null) => (id ? suppliers.find((s) => s.id === id)?.name ?? "Neznámý dodavatel" : "Bez dodavatele");
  const celkem = (o: PurchaseOrder) => o.items.reduce((a, it) => a + it.qty * (it.unitPrice ?? 0), 0);

  const zobrazene = orders.filter((o) => {
    if (filtr === "all") return true;
    if (filtr === "active") return o.status === "draft" || o.status === "ordered";
    return o.status === filtr;
  });

  const otevrena = otevrenaId ? orders.find((o) => o.id === otevrenaId) ?? null : null;

  const kpi: React.CSSProperties = {
    display: "flex",
    flexDirection: "column",
    gap: "var(--space-1)",
    padding: "var(--space-3) var(--space-4)",
    borderRadius: "var(--radius-md)",
    border: "1px solid var(--border)",
    background: "var(--panel)",
    boxShadow: "var(--shadow-soft)",
    minWidth: 0,
  };
  const kpiPopisek: React.CSSProperties = {
    fontSize: "var(--text-xs)",
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: "0.04em",
    color: "var(--muted)",
  };
  const kpiHodnota: React.CSSProperties = { fontSize: "var(--text-xl)", fontWeight: 900, color: "var(--text)", lineHeight: 1.1 };

  return (
    <>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "var(--space-3)" }}>
        <div style={kpi} title="Rozpracované objednávky, které ještě nebyly odeslány dodavateli.">
          <span style={kpiPopisek}>Návrhy</span>
          <span style={kpiHodnota}>{navrhy}</span>
        </div>
        <div style={kpi} title="Objednávky odeslané dodavateli, které čekají na přijetí.">
          <span style={kpiPopisek}>Objednáno</span>
          <span style={{ ...kpiHodnota, color: objednane.length > 0 ? "var(--info-text)" : "var(--text)" }}>{objednane.length}</span>
        </div>
        <div style={kpi} title="Součet kusů z objednaných a dosud nepřijatých položek.">
          <span style={kpiPopisek}>Kusů na cestě</span>
          <span style={kpiHodnota}>{naCeste}</span>
        </div>
      </div>

      <div className="ui-card" style={{ display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", flexWrap: "wrap" }}>
          <SectionHeading icon={<InboxIcon size={16} />}>Objednávky</SectionHeading>
          <div style={{ marginLeft: "auto", marginBottom: "var(--space-3)", display: "flex", gap: "var(--space-2)", alignItems: "center", flexWrap: "wrap" }}>
            {podMinimem > 0 && !nedostupne && (
              <span style={{ fontSize: "var(--text-xs)", color: "var(--warning-text)", display: "inline-flex", alignItems: "center", gap: 4 }}>
                <WarningIcon size={12} />
                {sklonuj(podMinimem, ["produkt", "produkty", "produktů"])} pod minimem
              </span>
            )}
            <Button
              variant="primary"
              disabled={nedostupne || navrhuji || podMinimem === 0}
              title={
                nedostupne
                  ? HLASKA_NEDOSTUPNE
                  : podMinimem === 0
                    ? "Žádný produkt není pod minimem – není co navrhnout."
                    : "Pro každý produkt pod minimem doplní návrh objednávky u jeho dodavatele."
              }
              onClick={() => void onNavrhnout()}
            >
              {navrhuji ? "Navrhuji…" : "Navrhnout objednávku pod minimem"}
            </Button>
          </div>
        </div>

        {nedostupne && (
          <div style={{ fontSize: "var(--text-sm)", color: "var(--muted)", marginBottom: "var(--space-3)" }}>{HLASKA_NEDOSTUPNE}</div>
        )}

        {orders.length === 0 ? (
          <div style={{ padding: "var(--space-6) var(--space-4)", textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: "var(--space-2)" }}>
            <span style={{ color: "var(--muted)", display: "inline-flex" }}>
              <InboxIcon size={28} />
            </span>
            <div style={{ fontSize: "var(--text-lg)", fontWeight: 800, color: "var(--text)" }}>Zatím žádná objednávka</div>
            <div style={{ fontSize: "var(--text-base)", color: "var(--muted)", maxWidth: 460 }}>
              Nastavte produktům minimální zásobu a dodavatele. Tlačítko „Navrhnout objednávku pod minimem“ pak připraví návrh pro každého
              dodavatele; návrh upravíte, označíte jako objednaný a po dodání ho jedním kliknutím přijmete na sklad. Jednotlivý díl přidáte
              do návrhu i tlačítkem „Objednat“ u produktu.
            </div>
          </div>
        ) : (
          <>
            <div style={{ marginBottom: "var(--space-3)" }}>
              <Segmented
                size="sm"
                ariaLabel="Filtr objednávek"
                value={filtr}
                onChange={setFiltr}
                options={[
                  { value: "active", label: "Rozpracované" },
                  { value: "draft", label: "Návrhy" },
                  { value: "ordered", label: "Objednané" },
                  { value: "received", label: "Přijaté" },
                  { value: "cancelled", label: "Zrušené" },
                  { value: "all", label: "Vše" },
                ]}
              />
            </div>
            {zobrazene.length === 0 ? (
              <div style={{ padding: "var(--space-5)", textAlign: "center", color: "var(--muted)", fontSize: "var(--text-base)" }}>
                Žádná objednávka v tomhle stavu.
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
                {zobrazene.map((o) => {
                  const kusy = o.items.reduce((a, it) => a + it.qty, 0);
                  return (
                    <button
                      key={o.id}
                      type="button"
                      onClick={() => setOtevrenaId(o.id)}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "var(--space-3)",
                        flexWrap: "wrap",
                        width: "100%",
                        textAlign: "left",
                        padding: "var(--space-3)",
                        borderRadius: "var(--radius-sm)",
                        border: "1px solid var(--border)",
                        background: "var(--panel-2)",
                        color: "var(--text)",
                        fontFamily: "inherit",
                        cursor: "pointer",
                      }}
                    >
                      <div style={{ flex: "1 1 200px", minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", flexWrap: "wrap" }}>
                          <span style={{ fontWeight: 800, fontSize: "var(--text-base)", fontVariantNumeric: "tabular-nums" }}>{o.number}</span>
                          <StavPill status={o.status} />
                        </div>
                        <div style={{ fontSize: "var(--text-xs)", color: "var(--muted)", marginTop: 2 }}>{dodavatel(o.supplierId)}</div>
                      </div>
                      <div style={{ fontSize: "var(--text-xs)", color: "var(--muted)", whiteSpace: "nowrap" }}>
                        {sklonuj(o.items.length, ["položka", "položky", "položek"])} · {kusy} ks
                      </div>
                      <div style={{ fontSize: "var(--text-sm)", fontWeight: 800, whiteSpace: "nowrap", minWidth: 90, textAlign: "right" }}>
                        {formatKc.format(celkem(o))}
                      </div>
                      <div style={{ fontSize: "var(--text-xs)", color: "var(--muted)", whiteSpace: "nowrap", minWidth: 150, textAlign: "right" }}>
                        {o.status === "draft" && `Vytvořeno ${formatDatum(o.createdAt)}`}
                        {o.status === "ordered" && `Objednáno ${formatDatum(o.orderedAt)}${o.expectedAt ? ` · očekáváno ${formatDatum(o.expectedAt)}` : ""}`}
                        {o.status === "received" && `Přijato ${formatDatum(o.receivedAt)}`}
                        {o.status === "cancelled" && `Zrušeno ${formatDatum(o.updatedAt)}`}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>

      {otevrena && (
        <OrderDetail
          key={otevrena.id}
          order={otevrena}
          suppliers={suppliers}
          products={products}
          warehouses={warehouses}
          onClose={() => setOtevrenaId(null)}
          onChanged={onReloadOrders}
          onReceived={async () => {
            await onReloadOrders();
            await onReloadInventory();
          }}
        />
      )}
    </>
  );
}
