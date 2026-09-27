import { useEffect, useState } from "react";
import { Button } from "../ui";
import { InventoryDialog } from "../../pages/Inventory/InventoryDialog";
import { showToast, showPersistentToast } from "../Toast";
import type { Product } from "../../lib/inventoryDb";
import {
  HLASKA_NEDOSTUPNE,
  loadSuppliers,
  objednatDilProZakazku,
  type Supplier,
  type TicketOrderItem,
  type TicketReservation,
} from "../../lib/purchaseOrders";

/** Přepne Sklad na záložku Objednávky (Inventory.tsx poslouchá `subsection`). */
export function otevritObjednavkyVeSkladu(orderId?: string) {
  window.dispatchEvent(new CustomEvent("jobsheet:navigate", { detail: { page: "inventory", subsection: "orders", openOrderId: orderId } }));
}

/** Srozumitelná hláška místo textu z Postgresu: technik bez práva na sklad se nemá co dozvědět o RLS. */
function hlaskaChyby(err: string | undefined): string {
  const e = (err ?? "").toLowerCase();
  if (e.includes("row-level security") || e.includes("oprávnění") || e.includes("permission")) {
    return "Na objednávky dílů nemáte oprávnění – požádejte správce skladu.";
  }
  return `Díl se nepodařilo přidat do objednávky: ${err ?? "neznámá chyba"}`;
}

/**
 * Řádek „Díly: …“ pod provedenou opravou v detailu zakázky.
 *
 * U dílu, který po rezervaci není skladem (živé rezervace přes všechny
 * zakázky převyšují stav), nabídne „Objednat u dodavatele“: přidá díl do
 * rozpracovaného návrhu objednávky u obvyklého dodavatele produktu, s
 * `ticket_id`, ať sklad ví, komu díl patří. Produkt bez dodavatele dostane
 * malý výběr dodavatele – hádat by znamenalo poslat objednávku jinam.
 * Díl, který už v objednávce pro tuhle zakázku je, tlačítko nemá; místo
 * něj je vidět číslo a stav objednávky.
 */
export function DilyOpravy({
  ticketId,
  serviceId,
  rows,
  produkty,
  rezervovanoCelkem,
  objednano,
  muzeObjednat,
  onObjednano,
}: {
  ticketId: string;
  serviceId: string | null;
  /** Rezervace této opravy (bez uvolněných). */
  rows: TicketReservation[];
  /** Sklad z databáze: stav, dodavatel, nákupní cena. Prázdné = ještě nenačteno. */
  produkty: ReadonlyMap<string, Product>;
  /** Živé rezervace po produktech přes všechny zakázky servisu. */
  rezervovanoCelkem: ReadonlyMap<string, number>;
  /** Položky objednávek, které pro tuhle zakázku už existují. */
  objednano: TicketOrderItem[];
  /** Právo upravovat sklad (RLS by zápis stejně odmítla, ale bez tlačítka je to jasné hned). */
  muzeObjednat: boolean;
  /** Po přidání do objednávky – rodič si přenačte položky zakázky. */
  onObjednano: () => void;
}) {
  const [vyberDodavatele, setVyberDodavatele] = useState<{ row: TicketReservation; product: Product } | null>(null);
  const [pracuje, setPracuje] = useState<string | null>(null);

  if (rows.length === 0) return null;

  /** Kolik kusů z rezervace chybí; 0 = díl je skladem. */
  const chybiKusu = (r: TicketReservation): number => {
    if (r.status !== "reserved") return 0;
    const p = produkty.get(r.productId);
    if (!p) return 0;
    const reserved = rezervovanoCelkem.get(r.productId) ?? r.qty;
    const schodek = reserved - p.stock;
    return schodek > 0 ? Math.min(r.qty, schodek) : 0;
  };

  const vObjednavce = (productId: string) =>
    objednano.find((o) => o.productId === productId && (o.orderStatus === "draft" || o.orderStatus === "ordered"));

  const objednat = async (r: TicketReservation, p: Product, supplierId: string | null) => {
    if (!serviceId) return;
    setPracuje(r.id);
    const res = await objednatDilProZakazku(serviceId, supplierId, {
      productId: r.productId,
      qty: Math.max(1, chybiKusu(r)),
      unitPrice: p.purchasePrice ?? null,
      ticketId,
    });
    setPracuje(null);
    if (res.nedostupne) {
      showToast(HLASKA_NEDOSTUPNE, "info");
      return;
    }
    if (res.error || !res.data) {
      showToast(hlaskaChyby(res.error), "error");
      return;
    }
    const cislo = res.data.number;
    const orderId = res.data.id;
    showPersistentToast(`Díl „${p.name}“ přidán do objednávky ${cislo}`, "success", {
      actionLabel: "Sklad → Objednávky",
      onAction: () => otevritObjednavkyVeSkladu(orderId),
      secondaryLabel: "Zavřít",
      onSecondaryAction: () => {},
      subtitle: "Návrh objednávky upravíte a odešlete ve Skladu.",
    });
    onObjednano();
  };

  const klik = (r: TicketReservation) => {
    const p = produkty.get(r.productId);
    if (!p) return;
    if (p.supplierId) void objednat(r, p, p.supplierId);
    else setVyberDodavatele({ row: r, product: p });
  };

  return (
    <div style={{ color: "var(--muted)", fontSize: 12, paddingLeft: 12, display: "flex", flexWrap: "wrap", alignItems: "center", gap: "4px 8px" }}>
      <span>Díly:</span>
      {rows.map((r) => {
        const chybi = chybiKusu(r);
        const obj = vObjednavce(r.productId);
        return (
          <span key={r.id} style={{ display: "inline-flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            <span>
              {r.productName} ×{r.qty} ({r.status === "consumed" ? "odečteno" : "rezervováno"})
              {chybi > 0 && <span style={{ color: "var(--warning-text)", fontWeight: 700 }}> · není skladem</span>}
            </span>
            {chybi > 0 && obj && (
              <span title={obj.orderStatus === "ordered" ? "Objednáno u dodavatele, čeká se na dodání." : "Je v návrhu objednávky ve Skladu."}>
                · v objednávce{" "}
                <button
                  type="button"
                  onClick={() => otevritObjednavkyVeSkladu(obj.orderId)}
                  style={{ background: "none", border: "none", padding: 0, color: "var(--accent)", fontWeight: 700, cursor: "pointer", fontSize: 12, fontFamily: "inherit" }}
                >
                  {obj.orderNumber}
                </button>{" "}
                ({obj.orderStatus === "ordered" ? "objednáno" : "návrh"})
              </span>
            )}
            {chybi > 0 && !obj && muzeObjednat && (
              <Button
                variant="soft"
                size="sm"
                disabled={pracuje === r.id}
                title="Přidá díl do návrhu objednávky u dodavatele ve Skladu, s číslem této zakázky."
                onClick={() => klik(r)}
              >
                {pracuje === r.id ? "Přidávám…" : "Objednat u dodavatele"}
              </Button>
            )}
          </span>
        );
      })}
      {vyberDodavatele && (
        <VyberDodavatele
          serviceId={serviceId}
          productName={vyberDodavatele.product.name}
          onZrusit={() => setVyberDodavatele(null)}
          onVybrat={(supplierId) => {
            const v = vyberDodavatele;
            setVyberDodavatele(null);
            void objednat(v.row, v.product, supplierId);
          }}
        />
      )}
    </div>
  );
}

/**
 * Malý výběr dodavatele pro produkt, který obvyklého dodavatele nemá.
 * „Bez dodavatele“ založí návrh bez adresáta – sklad ho doplní, než ho pošle.
 */
function VyberDodavatele({
  serviceId,
  productName,
  onZrusit,
  onVybrat,
}: {
  serviceId: string | null;
  productName: string;
  onZrusit: () => void;
  onVybrat: (supplierId: string | null) => void;
}) {
  const [dodavatele, setDodavatele] = useState<Supplier[] | null>(null);
  const [vybrany, setVybrany] = useState<string>("");

  useEffect(() => {
    let zruseno = false;
    void loadSuppliers(serviceId).then((res) => {
      if (zruseno) return;
      setDodavatele(res.data);
      if (res.data.length > 0) setVybrany(res.data[0].id);
    });
    return () => {
      zruseno = true;
    };
  }, [serviceId]);

  return (
    <InventoryDialog
      open
      width={420}
      title="Objednat u dodavatele"
      subtitle={`Produkt „${productName}“ nemá nastaveného dodavatele. Vyberte, komu díl objednat.`}
      onClose={onZrusit}
    >
      <div style={{ display: "grid", gap: "var(--space-3)" }}>
        {dodavatele === null ? (
          <div style={{ fontSize: "var(--text-sm)", color: "var(--muted)" }}>Načítám dodavatele…</div>
        ) : (
          <select className="ui-input" value={vybrany} onChange={(e) => setVybrany(e.target.value)} aria-label="Dodavatel">
            {dodavatele.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
            <option value="">Bez dodavatele (doplní sklad)</option>
          </select>
        )}
        <div style={{ fontSize: "var(--text-xs)", color: "var(--muted)" }}>
          Obvyklého dodavatele produktu nastavíte ve Skladu v úpravě produktu – příště se ptát nebude.
        </div>
        <div style={{ display: "flex", gap: "var(--space-2)", justifyContent: "flex-end" }}>
          <Button variant="soft" onClick={onZrusit}>Zrušit</Button>
          <Button variant="primary" disabled={dodavatele === null} onClick={() => onVybrat(vybrany || null)}>
            Přidat do objednávky
          </Button>
        </div>
      </div>
    </InventoryDialog>
  );
}
