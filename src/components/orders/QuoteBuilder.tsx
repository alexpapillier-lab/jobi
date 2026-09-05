import { useState } from "react";
import { RepairPicker } from "./RepairPicker";
import { XIcon } from "../icons";
import type { QuoteItem } from "../../lib/portal";
import type { DeviceRepair } from "../../lib/catalogStorage";

/**
 * Rozpis cenové nabídky.
 *
 * Nabídka byla dřív jedna částka a zákazník u ní neviděl, za co platí.
 * Tady se skládá z ceníku (opravy k danému zařízení) nebo ručně, ceny jdou
 * u každé položky přepsat – ceníková cena je návrh, ne dogma.
 *
 * Součet se nikde neukládá zvlášť, počítá se z položek; volající ho posílá
 * do `quote_amount`, ze kterého čte portál, SMS i faktura.
 */
export function soucetPolozek(items: QuoteItem[]): number {
  return items.reduce((sum, i) => sum + (Number(i.price) || 0), 0);
}

function noveId(): string {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function QuoteBuilder({
  items,
  onChange,
  availableRepairs = [],
}: {
  items: QuoteItem[];
  onChange: (items: QuoteItem[]) => void;
  availableRepairs?: DeviceRepair[];
}) {
  const [vybranaOprava, setVybranaOprava] = useState("");
  const [rucniNazev, setRucniNazev] = useState("");
  const [rucniCena, setRucniCena] = useState("");

  const border = "1px solid var(--border)";
  const vstup = {
    padding: "8px 10px",
    borderRadius: 8,
    border,
    background: "var(--panel)",
    color: "var(--text)",
    fontSize: 13,
    fontFamily: "inherit",
    minWidth: 0,
  } as const;

  const pridatZCeniku = (repairId: string) => {
    const r = availableRepairs.find((x) => x.id === repairId);
    if (!r) return;
    onChange([
      ...items,
      {
        id: noveId(),
        name: r.name,
        price: r.price || 0,
        costs: r.costs,
        estimatedTime: r.estimatedTime,
        productIds: r.productIds,
        repairId: r.id,
        type: "selected",
      },
    ]);
    setVybranaOprava("");
  };

  const pridatRucne = () => {
    const nazev = rucniNazev.trim();
    if (!nazev) return;
    const cena = Number(rucniCena.replace(/\s/g, "").replace(",", "."));
    onChange([...items, { id: noveId(), name: nazev, price: Number.isFinite(cena) ? cena : 0, type: "manual" }]);
    setRucniNazev("");
    setRucniCena("");
  };

  const upravit = (id: string, zmena: Partial<QuoteItem>) => {
    onChange(items.map((i) => (i.id === id ? { ...i, ...zmena } : i)));
  };

  return (
    <div style={{ display: "grid", gap: 10 }}>
      {items.length > 0 && (
        <div style={{ display: "grid", gap: 6 }}>
          {items.map((polozka) => (
            <div
              key={polozka.id}
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 110px 28px",
                gap: 8,
                alignItems: "center",
              }}
            >
              <input
                type="text"
                value={polozka.name}
                onChange={(e) => upravit(polozka.id, { name: e.target.value })}
                aria-label="Název položky"
                style={vstup}
              />
              <input
                type="number"
                inputMode="decimal"
                value={polozka.price ?? 0}
                onChange={(e) => upravit(polozka.id, { price: Number(e.target.value) || 0 })}
                aria-label={`Cena položky ${polozka.name}`}
                style={{ ...vstup, textAlign: "right" }}
              />
              <button
                type="button"
                onClick={() => onChange(items.filter((i) => i.id !== polozka.id))}
                aria-label={`Odebrat ${polozka.name}`}
                title="Odebrat položku"
                style={{
                  width: 28,
                  height: 28,
                  display: "grid",
                  placeItems: "center",
                  borderRadius: 8,
                  border,
                  background: "var(--panel-2)",
                  color: "var(--muted)",
                  cursor: "pointer",
                }}
              >
                <XIcon size={13} />
              </button>
            </div>
          ))}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              paddingTop: 6,
              borderTop: border,
              fontSize: 13,
              fontWeight: 800,
              color: "var(--text)",
            }}
          >
            <span>Celkem</span>
            <span>{soucetPolozek(items).toLocaleString("cs-CZ")} Kč</span>
          </div>
        </div>
      )}

      {availableRepairs.length > 0 && (
        <RepairPicker
          value={vybranaOprava}
          repairs={availableRepairs.map((r) => ({ id: r.id, name: r.name, price: r.price || 0 }))}
          placeholder="Přidat z ceníku…"
          onChange={pridatZCeniku}
        />
      )}

      {/*
        Dřív to byl grid „1fr 110px auto". Na telefonu měla cena napevno
        110 px a tlačítko svou šířku, takže na název položky zbylo 86 px –
        míň než na cenu, přitom se do něj píše text.

        Flex se zalomením se řídí skutečně dostupnou šířkou, ne šířkou okna:
        na úzké kartě spadne cena s tlačítkem pod název, na široké zůstanou
        všechny tři na jednom řádku. Rozhodovat to podle useIsNarrow by
        nešlo – na tabletu je okno úzké, ale karta má místa dost.
      */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        <input
          type="text"
          value={rucniNazev}
          onChange={(e) => setRucniNazev(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              pridatRucne();
            }
          }}
          placeholder="Vlastní položka"
          aria-label="Název vlastní položky"
          style={{ ...vstup, flex: "1 1 160px", minWidth: 0 }}
        />
        <input
          type="number"
          inputMode="decimal"
          value={rucniCena}
          onChange={(e) => setRucniCena(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              pridatRucne();
            }
          }}
          placeholder="Kč"
          aria-label="Cena vlastní položky"
          style={{ ...vstup, textAlign: "right", flex: "1 1 110px", minWidth: 0, maxWidth: 160 }}
        />
        <button
          type="button"
          onClick={pridatRucne}
          disabled={!rucniNazev.trim()}
          style={{
            padding: "8px 14px",
            borderRadius: 8,
            border,
            background: rucniNazev.trim() ? "var(--panel-2)" : "var(--panel)",
            color: rucniNazev.trim() ? "var(--text)" : "var(--muted)",
            fontSize: 13,
            fontWeight: 700,
            cursor: rucniNazev.trim() ? "pointer" : "not-allowed",
            whiteSpace: "nowrap",
          }}
        >
          Přidat
        </button>
      </div>
    </div>
  );
}
