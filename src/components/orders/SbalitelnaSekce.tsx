import { useEffect, useState, type ReactNode } from "react";
import { SectionHeading } from "../SectionHeading";
import { ChevronDownIcon } from "../icons";

/**
 * Sbalitelná hlavička sekce v detailu zakázky.
 *
 * Zákaznický portál a Diagnostika mají v detailu dohromady přes obrazovku
 * obsahu, který se při běžné práci nečte – k opravám a stavu se muselo
 * scrollovat. Sekce jsou proto výchozím stavem sbalené a rozbalí se
 * kliknutím; stav se pamatuje na zařízení, kdo je chce pořád otevřené,
 * otevře je jednou.
 */
export function useSbaleno(klic: string, vychoziOtevreno = false): [boolean, () => void, (otevreno: boolean) => void] {
  const [otevreno, setOtevreno] = useState<boolean>(() => {
    try {
      const v = localStorage.getItem(klic);
      return v === null ? vychoziOtevreno : v === "1";
    } catch {
      return vychoziOtevreno;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(klic, otevreno ? "1" : "0");
    } catch {
      /* bez úložiště se stav jen nepamatuje */
    }
  }, [klic, otevreno]);
  return [otevreno, () => setOtevreno((v) => !v), setOtevreno];
}

export function SbalitelnaHlavicka({
  icon,
  title,
  otevreno,
  onToggle,
  ovlada,
  souhrn,
  vpravo,
}: {
  icon?: ReactNode;
  title: ReactNode;
  otevreno: boolean;
  onToggle: () => void;
  /** id rozbaleného obsahu (aria-controls). */
  ovlada: string;
  /** Krátký text vedle nadpisu, když je sekce sbalená. */
  souhrn?: ReactNode;
  /** Prvek vpravo v hlavičce (viditelný vždy). */
  vpravo?: ReactNode;
}) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "var(--space-3)", flexWrap: "wrap" }}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={otevreno}
        aria-controls={ovlada}
        style={{ display: "flex", alignItems: "center", gap: 8, background: "none", border: "none", padding: 0, cursor: "pointer", color: "var(--text)", textAlign: "left", minWidth: 0 }}
      >
        <span style={{ display: "inline-flex", color: "var(--muted)", transform: otevreno ? "rotate(180deg)" : "none", transition: "transform 120ms ease", marginBottom: "var(--space-3)" }}>
          <ChevronDownIcon size={16} />
        </span>
        <SectionHeading icon={icon}>{title}</SectionHeading>
        {!otevreno && souhrn && (
          <span style={{ color: "var(--muted)", fontSize: "var(--text-sm)", marginBottom: "var(--space-3)", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {souhrn}
          </span>
        )}
      </button>
      {vpravo}
    </div>
  );
}
