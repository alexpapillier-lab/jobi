import { Button } from "../ui";
import type { ClenServisu } from "../../hooks/useClenoveServisu";

/**
 * Karta „Technik“ v detailu zakázky: kdo zakázku dělá. Výběr ze členů
 * servisu a zkratka „Přidělit mně“ – u pultu se většinou přiděluje sám sobě.
 */
export function TechnikZakazky({ clenove, hodnota, jaId, onChange }: {
  clenove: ClenServisu[];
  hodnota: string | null | undefined;
  jaId: string | null;
  onChange: (userId: string | null) => void;
}) {
  const vybrany = hodnota ? clenove.find((c) => c.userId === hodnota) : undefined;
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      <select
        aria-label="Přidělený technik"
        value={hodnota ?? ""}
        onChange={(e) => onChange(e.target.value || null)}
        style={{ minWidth: 180 }}
      >
        <option value="">— nepřidělena —</option>
        {clenove.map((c) => (
          <option key={c.userId} value={c.userId}>{c.jmeno}{c.userId === jaId ? " (já)" : ""}</option>
        ))}
        {/* Technik, který už v servisu není, zůstane v historii vidět. */}
        {hodnota && !vybrany && <option value={hodnota}>Bývalý člen</option>}
      </select>
      {jaId && hodnota !== jaId && (
        <Button size="sm" variant="soft" onClick={() => onChange(jaId)}>Přidělit mně</Button>
      )}
      {hodnota && (
        <Button size="sm" variant="ghost" onClick={() => onChange(null)}>Odebrat</Button>
      )}
    </div>
  );
}
