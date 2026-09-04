import { useMemo, useState } from "react";
import { Button, Label, Pill } from "../../components/ui";
import { MailIcon, PlusIcon, TrashIcon } from "../../components/icons";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { InventoryDialog } from "./InventoryDialog";
import { showToast } from "../../components/Toast";
import { reportError } from "../../lib/reportError";
import type { Product, Warehouse } from "../../lib/inventoryDb";
import { vychoziSklad } from "../../lib/inventoryDb";
import {
  deleteOrder, receiveOrder, textObjednavky, updateItems, updateOrder,
  type OrderItemInput, type PurchaseOrder, type PurchaseOrderStatus, type Supplier,
} from "../../lib/purchaseOrders";

const formatKc = new Intl.NumberFormat("cs-CZ", { style: "currency", currency: "CZK", maximumFractionDigits: 0 });

export const STAV_OBJEDNAVKY: Record<PurchaseOrderStatus, { popisek: string; barva?: string }> = {
  draft: { popisek: "Návrh" },
  ordered: { popisek: "Objednáno", barva: "var(--info-text)" },
  received: { popisek: "Přijato", barva: "var(--success-text)" },
  cancelled: { popisek: "Zrušeno", barva: "var(--danger-text)" },
};

export function StavPill({ status }: { status: PurchaseOrderStatus }) {
  const s = STAV_OBJEDNAVKY[status];
  return (
    <Pill color={s.barva} dot>
      {s.popisek}
    </Pill>
  );
}

export function formatDatum(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("cs-CZ");
}

type LokalniPolozka = { id: string; productId: string; qty: string; unitPrice: string; receivedQty: number };

function zPolozek(order: PurchaseOrder): LokalniPolozka[] {
  return order.items.map((it) => ({
    id: it.id,
    productId: it.productId,
    qty: String(it.qty),
    unitPrice: it.unitPrice === null ? "" : String(it.unitPrice),
    receivedQty: it.receivedQty,
  }));
}

function naVstup(items: LokalniPolozka[]): OrderItemInput[] {
  return items.map((it) => {
    const cena = it.unitPrice.trim() === "" ? null : parseFloat(it.unitPrice);
    return {
      id: it.id,
      productId: it.productId,
      qty: parseInt(it.qty, 10) || 0,
      unitPrice: cena === null || !Number.isFinite(cena) ? null : cena,
      receivedQty: it.receivedQty,
    };
  });
}

function uuid() {
  return typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}_${Math.random()}`;
}

/**
 * Detail objednávky. Položky se v návrhu upravují přímo v tabulce a
 * ukládají při opuštění pole; přechody stavu jsou tlačítka dole podle
 * stavu. Přijetí na sklad jde přes RPC v databázi, aby zásoba a stav
 * objednávky změnily najednou.
 */
export function OrderDetail({
  order,
  suppliers,
  products,
  warehouses,
  onClose,
  onChanged,
  onReceived,
}: {
  order: PurchaseOrder;
  suppliers: Supplier[];
  products: Product[];
  warehouses: Warehouse[];
  onClose: () => void;
  /** Po každé změně – rodič přenačte objednávky. */
  onChanged: () => Promise<void>;
  /** Po přijetí na sklad – rodič přenačte i zásobu. */
  onReceived: () => Promise<void>;
}) {
  const [items, setItems] = useState<LokalniPolozka[]>(() => zPolozek(order));
  const [note, setNote] = useState(order.note ?? "");
  const [expectedAt, setExpectedAt] = useState(order.expectedAt ? order.expectedAt.slice(0, 10) : "");
  const [hledani, setHledani] = useState("");
  const [skladId, setSkladId] = useState<string>("");
  const [potvrditPrijem, setPotvrditPrijem] = useState(false);
  const [potvrditZruseni, setPotvrditZruseni] = useState(false);
  const [potvrditSmazani, setPotvrditSmazani] = useState(false);
  const [pracuje, setPracuje] = useState(false);

  const supplier = suppliers.find((s) => s.id === order.supplierId) ?? null;
  const produktPodleId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const navrh = order.status === "draft";
  const objednano = order.status === "ordered";
  const jenCteni = !navrh && !objednano;

  const celkem = items.reduce((a, it) => {
    const q = parseInt(it.qty, 10) || 0;
    const c = parseFloat(it.unitPrice);
    return a + q * (Number.isFinite(c) ? c : 0);
  }, 0);

  const chyba = (kod: string, e: string | undefined, text: string) =>
    reportError({ code: `inventory.po.${kod}`, error: e, userMessage: `${text}: ${e ?? "neznámá chyba"}`, source: "OrderDetail" });

  const ulozitPolozky = async (nove: LokalniPolozka[]) => {
    const r = await updateItems(order.id, naVstup(nove));
    if (r.error && !r.nedostupne) {
      chyba("items_failed", r.error, "Položky se nepodařilo uložit");
      return false;
    }
    await onChanged();
    return true;
  };

  const zmenitPolozku = (id: string, patch: Partial<LokalniPolozka>) =>
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));

  const odebrat = async (id: string) => {
    const nove = items.filter((it) => it.id !== id);
    setItems(nove);
    await ulozitPolozky(nove);
  };

  const pridatProdukt = async (p: Product) => {
    const existujici = items.find((it) => it.productId === p.id);
    const nove = existujici
      ? items.map((it) => (it.id === existujici.id ? { ...it, qty: String((parseInt(it.qty, 10) || 0) + 1) } : it))
      : [...items, { id: uuid(), productId: p.id, qty: "1", unitPrice: p.purchasePrice == null ? "" : String(p.purchasePrice), receivedQty: 0 }];
    setItems(nove);
    setHledani("");
    await ulozitPolozky(nove);
  };

  const ulozitPoznamku = async () => {
    if ((order.note ?? "") === note.trim()) return;
    const r = await updateOrder(order, { note });
    if (r.error && !r.nedostupne) chyba("note_failed", r.error, "Poznámku se nepodařilo uložit");
    else await onChanged();
  };

  const ulozitTermin = async (hodnota: string) => {
    setExpectedAt(hodnota);
    const r = await updateOrder(order, { expectedAt: hodnota ? new Date(`${hodnota}T12:00:00`).toISOString() : null });
    if (r.error && !r.nedostupne) chyba("expected_failed", r.error, "Termín se nepodařilo uložit");
    else await onChanged();
  };

  const oznacitObjednano = async () => {
    const platne = items.filter((it) => (parseInt(it.qty, 10) || 0) > 0);
    if (platne.length === 0) {
      showToast("Objednávka nemá žádnou položku", "error");
      return;
    }
    setPracuje(true);
    const ok = await ulozitPolozky(items);
    if (!ok) {
      setPracuje(false);
      return;
    }
    const r = await updateOrder(order, { status: "ordered" });
    setPracuje(false);
    if (r.error) {
      chyba("order_failed", r.error, "Objednávku se nepodařilo označit");
      return;
    }
    showToast(`Objednávka ${order.number} označena jako objednaná`, "success");
    await onChanged();
  };

  const zrusit = async () => {
    const r = await updateOrder(order, { status: "cancelled" });
    if (r.error) {
      chyba("cancel_failed", r.error, "Objednávku se nepodařilo zrušit");
      return;
    }
    showToast(`Objednávka ${order.number} zrušena`, "success");
    setPotvrditZruseni(false);
    await onChanged();
  };

  const smazat = async () => {
    const r = await deleteOrder(order);
    if (r.error) {
      chyba("delete_failed", r.error, "Návrh se nepodařilo smazat");
      return;
    }
    showToast("Návrh objednávky smazán", "success");
    setPotvrditSmazani(false);
    onClose();
    await onChanged();
  };

  const prijmout = async () => {
    const cil = skladId || vychoziSklad(warehouses);
    if (!cil) {
      showToast("Servis nemá žádný sklad", "error");
      return;
    }
    const r = await receiveOrder(order.id, cil);
    if (r.error || !r.data) {
      chyba("receive_failed", r.error, "Přijetí na sklad se nepodařilo");
      return;
    }
    const kusy = order.items.reduce((a, it) => a + Math.max(0, it.qty - it.receivedQty), 0);
    const kam = warehouses.length > 1 ? ` do skladu ${warehouses.find((w) => w.id === cil)?.name ?? ""}` : "";
    showToast(`Přijato ${kusy} ks${kam}`, "success");
    setPotvrditPrijem(false);
    await onReceived();
  };

  const text = () =>
    textObjednavky(
      { number: order.number, note: note.trim() || null, items: naVstup(items).filter((it) => it.qty > 0) },
      supplier,
      produktPodleId,
    );

  const kopirovat = async () => {
    try {
      await navigator.clipboard.writeText(text());
      showToast("Objednávka zkopírována do schránky", "success");
    } catch (e) {
      reportError({ code: "inventory.po.clipboard_failed", error: e, userMessage: "Do schránky se nepodařilo zapsat", source: "OrderDetail" });
    }
  };

  const mailto = supplier?.email
    ? `mailto:${encodeURIComponent(supplier.email)}?subject=${encodeURIComponent(`Objednávka ${order.number}`)}&body=${encodeURIComponent(text())}`
    : null;

  const hledane = hledani.trim().toLowerCase();
  const nalezene = hledane
    ? products
        .filter((p) => p.name.toLowerCase().includes(hledane) || (p.sku ?? "").toLowerCase().includes(hledane) || (p.supplierSku ?? "").toLowerCase().includes(hledane))
        .slice(0, 8)
    : [];

  const bunka: React.CSSProperties = { padding: "6px var(--space-2)", fontSize: "var(--text-sm)", color: "var(--text)", verticalAlign: "middle" };
  const hlavicka: React.CSSProperties = { ...bunka, fontSize: "var(--text-xs)", fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.04em", textAlign: "left", borderBottom: "1px solid var(--border)" };
  const uzkyVstup: React.CSSProperties = { width: 84, padding: "4px var(--space-2)", textAlign: "right", fontSize: "var(--text-sm)" };

  return (
    <InventoryDialog
      open
      onClose={onClose}
      width={760}
      title={
        <span style={{ display: "inline-flex", alignItems: "center", gap: "var(--space-2)", flexWrap: "wrap" }}>
          <span>Objednávka {order.number}</span>
          <StavPill status={order.status} />
        </span>
      }
      subtitle={
        supplier
          ? [supplier.name, supplier.email, supplier.phone].filter(Boolean).join(" · ")
          : "Bez dodavatele – produktům přiřaďte dodavatele v editoru, ať se objednávka dá poslat."
      }
    >
      <div style={{ display: "grid", gap: "var(--space-4)" }}>
        <div style={{ display: "flex", gap: "var(--space-4)", flexWrap: "wrap", fontSize: "var(--text-sm)", color: "var(--muted)" }}>
          <span>Vytvořeno {formatDatum(order.createdAt)}</span>
          {order.orderedAt && <span>Objednáno {formatDatum(order.orderedAt)}</span>}
          {order.receivedAt && <span>Přijato {formatDatum(order.receivedAt)}</span>}
          {!jenCteni ? (
            <label style={{ display: "inline-flex", alignItems: "center", gap: "var(--space-2)" }}>
              <span>Očekáváno</span>
              <input
                type="date"
                className="ui-input"
                value={expectedAt}
                onChange={(e) => void ulozitTermin(e.target.value)}
                style={{ width: "auto", padding: "4px var(--space-2)", fontSize: "var(--text-sm)" }}
              />
            </label>
          ) : (
            order.expectedAt && <span>Očekáváno {formatDatum(order.expectedAt)}</span>
          )}
        </div>

        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={hlavicka}>Produkt</th>
                <th style={{ ...hlavicka, textAlign: "right" }}>{objednano ? "Přijato / ks" : "Množství"}</th>
                <th style={{ ...hlavicka, textAlign: "right" }}>Cena / ks</th>
                <th style={{ ...hlavicka, textAlign: "right" }}>Celkem</th>
                {navrh && <th style={hlavicka} aria-label="Akce" />}
              </tr>
            </thead>
            <tbody>
              {items.length === 0 && (
                <tr>
                  <td colSpan={navrh ? 5 : 4} style={{ ...bunka, color: "var(--muted)", textAlign: "center", padding: "var(--space-4)" }}>
                    Objednávka zatím nemá položky. Přidejte produkt níže.
                  </td>
                </tr>
              )}
              {items.map((it) => {
                const p = produktPodleId.get(it.productId);
                const q = parseInt(it.qty, 10) || 0;
                const c = parseFloat(it.unitPrice);
                const radek = q * (Number.isFinite(c) ? c : 0);
                return (
                  <tr key={it.id} style={{ borderBottom: "1px solid var(--border)" }}>
                    <td style={bunka}>
                      <div style={{ fontWeight: 700 }}>{p?.name ?? "Neznámý produkt"}</div>
                      <div style={{ fontSize: "var(--text-xs)", color: "var(--muted)" }}>
                        {p?.supplierSku ? `Kód u dodavatele: ${p.supplierSku}` : p?.sku ? `SKU: ${p.sku}` : "Bez kódu"}
                        {p ? ` · skladem ${p.stock} ks` : ""}
                      </div>
                    </td>
                    <td style={{ ...bunka, textAlign: "right", whiteSpace: "nowrap" }}>
                      {navrh ? (
                        <input
                          type="number"
                          min={0}
                          className="ui-input"
                          aria-label="Množství"
                          value={it.qty}
                          onChange={(e) => zmenitPolozku(it.id, { qty: e.target.value })}
                          onBlur={() => void ulozitPolozky(items)}
                          style={uzkyVstup}
                        />
                      ) : objednano ? (
                        `${it.receivedQty} / ${q} ks`
                      ) : (
                        `${q} ks`
                      )}
                    </td>
                    <td style={{ ...bunka, textAlign: "right", whiteSpace: "nowrap" }}>
                      {navrh ? (
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          className="ui-input"
                          aria-label="Cena za kus"
                          placeholder="—"
                          value={it.unitPrice}
                          onChange={(e) => zmenitPolozku(it.id, { unitPrice: e.target.value })}
                          onBlur={() => void ulozitPolozky(items)}
                          style={uzkyVstup}
                        />
                      ) : Number.isFinite(c) ? (
                        formatKc.format(c)
                      ) : (
                        "—"
                      )}
                    </td>
                    <td style={{ ...bunka, textAlign: "right", whiteSpace: "nowrap", fontWeight: 700 }}>{formatKc.format(radek)}</td>
                    {navrh && (
                      <td style={{ ...bunka, textAlign: "right" }}>
                        <Button variant="ghost" size="sm" iconOnly aria-label="Odebrat položku" title="Odebrat" icon={<TrashIcon size={14} />} onClick={() => void odebrat(it.id)} />
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={navrh ? 3 : 3} style={{ ...bunka, textAlign: "right", color: "var(--muted)" }}>
                  Celkem bez DPH
                </td>
                <td style={{ ...bunka, textAlign: "right", fontWeight: 900, whiteSpace: "nowrap" }}>{formatKc.format(celkem)}</td>
                {navrh && <td />}
              </tr>
            </tfoot>
          </table>
        </div>

        {navrh && (
          <div style={{ position: "relative" }}>
            <Label>Přidat produkt</Label>
            <input
              className="ui-input"
              placeholder="Hledat produkt podle názvu, SKU nebo kódu u dodavatele…"
              value={hledani}
              onChange={(e) => setHledani(e.target.value)}
              style={{ marginTop: "var(--space-1)" }}
            />
            {nalezene.length > 0 && (
              <div
                style={{
                  position: "absolute",
                  left: 0,
                  right: 0,
                  zIndex: 20,
                  marginTop: 4,
                  background: "var(--panel)",
                  border: "1px solid var(--border)",
                  borderRadius: "var(--radius-sm)",
                  boxShadow: "var(--shadow-soft)",
                  maxHeight: 240,
                  overflowY: "auto",
                }}
              >
                {nalezene.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className="ui-menu-item ui-menu-item--between"
                    onClick={() => void pridatProdukt(p)}
                  >
                    <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>
                      <span style={{ fontWeight: 700 }}>{p.name}</span>
                      {p.supplierSku && <span style={{ color: "var(--muted)", marginLeft: 6, fontSize: "var(--text-xs)" }}>{p.supplierSku}</span>}
                    </span>
                    <span style={{ color: "var(--muted)", fontSize: "var(--text-xs)", whiteSpace: "nowrap" }}>
                      skladem {p.stock} ks
                    </span>
                  </button>
                ))}
              </div>
            )}
            {hledane && nalezene.length === 0 && (
              <div style={{ fontSize: "var(--text-xs)", color: "var(--muted)", marginTop: "var(--space-1)" }}>Žádný produkt neodpovídá hledání.</div>
            )}
          </div>
        )}

        <div>
          <Label>Poznámka</Label>
          <textarea
            className="ui-input"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onBlur={() => void ulozitPoznamku()}
            disabled={jenCteni}
            placeholder="Např. dodat do pátku, fakturovat na IČO…"
            style={{ marginTop: "var(--space-1)", minHeight: 56, resize: "vertical" }}
          />
        </div>

        {objednano && warehouses.length > 1 && (
          <div>
            <Label>Přijmout do skladu</Label>
            <select className="ui-input" value={skladId} onChange={(e) => setSkladId(e.target.value)} style={{ marginTop: "var(--space-1)" }}>
              <option value="">Výchozí ({warehouses.find((w) => w.isDefault)?.name ?? warehouses[0]?.name})</option>
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>{w.name}</option>
              ))}
            </select>
          </div>
        )}

        <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap", justifyContent: "flex-end", borderTop: "1px solid var(--border)", paddingTop: "var(--space-3)" }}>
          {navrh && (
            <Button variant="danger" onClick={() => setPotvrditSmazani(true)} style={{ marginRight: "auto" }}>
              Smazat návrh
            </Button>
          )}
          {objednano && (
            <Button variant="danger" onClick={() => setPotvrditZruseni(true)} style={{ marginRight: "auto" }}>
              Zrušit objednávku
            </Button>
          )}
          {!jenCteni && (
            <Button variant="soft" onClick={() => void kopirovat()} disabled={items.length === 0}>
              Kopírovat objednávku
            </Button>
          )}
          {!jenCteni && mailto && (
            <Button variant="soft" icon={<MailIcon size={14} />} onClick={() => window.open(mailto, "_self")} disabled={items.length === 0}>
              Poslat e-mailem
            </Button>
          )}
          {navrh && (
            <Button variant="primary" onClick={() => void oznacitObjednano()} disabled={pracuje || items.length === 0}>
              Označit jako objednáno
            </Button>
          )}
          {objednano && (
            <Button variant="primary" icon={<PlusIcon size={14} />} onClick={() => setPotvrditPrijem(true)}>
              Přijmout na sklad
            </Button>
          )}
          {jenCteni && (
            <Button variant="soft" onClick={onClose}>
              Zavřít
            </Button>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={potvrditPrijem}
        title="Přijmout objednávku na sklad?"
        message={`Kusy z objednávky ${order.number} se přičtou do skladu „${warehouses.find((w) => w.id === (skladId || vychoziSklad(warehouses)))?.name ?? ""}“ a objednávka se označí jako přijatá.`}
        confirmLabel="Přijmout"
        cancelLabel="Zrušit"
        onConfirm={prijmout}
        onCancel={() => setPotvrditPrijem(false)}
      />
      <ConfirmDialog
        open={potvrditZruseni}
        title="Zrušit objednávku?"
        message={`Objednávka ${order.number} se označí jako zrušená. Na sklad se nic nepřičte.`}
        confirmLabel="Zrušit objednávku"
        cancelLabel="Zpět"
        variant="danger"
        onConfirm={zrusit}
        onCancel={() => setPotvrditZruseni(false)}
      />
      <ConfirmDialog
        open={potvrditSmazani}
        title="Smazat návrh?"
        message={`Návrh ${order.number} i s položkami se odstraní.`}
        confirmLabel="Smazat"
        cancelLabel="Zrušit"
        variant="danger"
        onConfirm={smazat}
        onCancel={() => setPotvrditSmazani(false)}
      />
    </InventoryDialog>
  );
}
