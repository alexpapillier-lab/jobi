import type { CSSProperties } from "react";
import { Button } from "../../components/ui";

type Pojmenovane = { id: string; name: string };

/**
 * Filtr produktů podle zařízení: Značka → Kategorie → Model v jednom řádku.
 *
 * Nahrazuje tři karty se seznamy, které zabíraly půl obrazovky nad
 * produkty. Kaskáda zůstává: kategorie jde vybrat až po značce, model až
 * po kategorii; změna výš maže výběr níž. Samotné značky, kategorie a
 * modely se spravují na stránce Zařízení.
 */
export function DeviceFilter({
  brands,
  categories,
  models,
  brandId,
  categoryId,
  modelId,
  onBrand,
  onCategory,
  onModel,
  onClear,
}: {
  brands: Pojmenovane[];
  categories: (Pojmenovane & { brandId: string })[];
  models: (Pojmenovane & { categoryId: string })[];
  brandId: string | null;
  categoryId: string | null;
  modelId: string | null;
  onBrand: (id: string | null) => void;
  onCategory: (id: string | null) => void;
  onModel: (id: string | null) => void;
  onClear: () => void;
}) {
  const kategorie = brandId ? categories.filter((c) => c.brandId === brandId) : [];
  const modely = categoryId ? models.filter((m) => m.categoryId === categoryId) : [];
  const aktivni = Boolean(brandId || categoryId || modelId);

  const select: CSSProperties = {
    width: "auto",
    minWidth: 140,
    maxWidth: 220,
    padding: "6px var(--space-3)",
    fontSize: "var(--text-sm)",
    fontWeight: 600,
  };

  return (
    <div
      style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", flexWrap: "wrap", minWidth: 0 }}
      title="Značky, kategorie a modely se spravují na stránce Zařízení."
    >
      <span style={{ fontSize: "var(--text-xs)", fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
        Zařízení
      </span>
      <select
        className="ui-input"
        aria-label="Značka"
        value={brandId ?? ""}
        onChange={(e) => onBrand(e.target.value || null)}
        style={select}
        disabled={brands.length === 0}
      >
        <option value="">Značka: vše</option>
        {brands.map((b) => (
          <option key={b.id} value={b.id}>{b.name}</option>
        ))}
      </select>
      <span aria-hidden="true" style={{ color: "var(--muted)" }}>·</span>
      <select
        className="ui-input"
        aria-label="Kategorie zařízení"
        value={categoryId ?? ""}
        onChange={(e) => onCategory(e.target.value || null)}
        style={select}
        disabled={!brandId || kategorie.length === 0}
        title={!brandId ? "Nejdřív vyberte značku" : undefined}
      >
        <option value="">Kategorie: vše</option>
        {kategorie.map((c) => (
          <option key={c.id} value={c.id}>{c.name}</option>
        ))}
      </select>
      <span aria-hidden="true" style={{ color: "var(--muted)" }}>·</span>
      <select
        className="ui-input"
        aria-label="Model"
        value={modelId ?? ""}
        onChange={(e) => onModel(e.target.value || null)}
        style={select}
        disabled={!categoryId || modely.length === 0}
        title={!categoryId ? "Nejdřív vyberte kategorii" : undefined}
      >
        <option value="">Model: vše</option>
        {modely.map((m) => (
          <option key={m.id} value={m.id}>{m.name}</option>
        ))}
      </select>
      {aktivni && (
        <Button variant="ghost" size="sm" onClick={onClear}>
          Vymazat filtr
        </Button>
      )}
    </div>
  );
}
