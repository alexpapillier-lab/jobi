import { useBranches } from "../context/BranchContext";
import { Segmented } from "../components/ui";

/**
 * Lišta s aktivní pobočkou nad obsahem stránky.
 *
 * Přepínač poboček dosud bydlel jen dole v boční liště pod servisem – tedy
 * na místě, které je ve sbalené liště skryté a na které se člověk nedívá.
 * Kdo má právo přepínat pobočky, pak často nevěděl, na které zrovna je,
 * a zakládal zakázky do špatné.
 *
 * Tahle lišta je vidět na každé stránce a přepíná jedním kliknutím.
 * Ukazuje se jen servisu s modulem Pobočky a víc než jednou viditelnou
 * pobočkou (`isMulti`) – člen omezený na jednu pobočku nemá co přepínat
 * a jednopobočkový servis lištu nepotřebuje.
 *
 * Přepínač v boční liště zůstává; tady je totéž, jen na očích.
 */
const VSECHNY = "__vsechny__";

export function BranchBar({ narrow = false }: { narrow?: boolean }) {
  const { isMulti, branches, activeBranchId, setActiveBranchId, activeBranch } = useBranches();
  if (!isMulti) return null;

  const options = [
    { value: VSECHNY, label: "Všechny pobočky" },
    ...branches.map((b) => ({ value: b.id, label: b.name })),
  ];

  return (
    <div
      role="region"
      aria-label="Aktivní pobočka"
      data-testid="branch-bar"
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--space-3)",
        flexWrap: "wrap",
        padding: narrow ? "6px var(--pad-12)" : "6px var(--pad-24)",
        borderBottom: "1px solid var(--border)",
        background: "var(--panel)",
        minHeight: 40,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", minWidth: 0, color: activeBranch ? "var(--accent)" : "var(--muted)" }}>
        <span aria-hidden style={{ display: "flex", flexShrink: 0 }}>
          <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0 1 18 0z" />
            <circle cx="12" cy="10" r="3" />
          </svg>
        </span>
        <span style={{ fontSize: "var(--text-xs)", fontWeight: 600, whiteSpace: "nowrap" }}>Pobočka</span>
        <span style={{ fontSize: "var(--text-sm)", fontWeight: 800, color: "var(--text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {activeBranch?.name ?? "Všechny pobočky"}
        </span>
      </div>
      <div style={{ marginLeft: narrow ? 0 : "auto", minWidth: 0, maxWidth: "100%", overflowX: "auto" }}>
        <Segmented<string>
          size="sm"
          ariaLabel="Přepnout pobočku"
          value={activeBranchId ?? VSECHNY}
          onChange={(v) => setActiveBranchId(v === VSECHNY ? null : v)}
          options={options}
        />
      </div>
    </div>
  );
}
