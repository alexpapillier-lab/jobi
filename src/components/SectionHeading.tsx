import type { ReactNode } from "react";

/**
 * Hlavička sekce – ikona + název.
 *
 * Audit UI našel v jediné obrazovce tři různé způsoby, jak napsat nadpis
 * sekce: emoji s tučným textem, verzálky drobně šedě, a prosté tučné.
 * Tahle komponenta je sjednocuje na jeden.
 *
 * Používá tokeny ze škál (--text-*, --space-*), takže velikost a rozestup
 * nejsou další dvě čísla navíc.
 */
export function SectionHeading({
  icon,
  children,
  size = "md",
  barva,
}: {
  /** Ikona ze src/components/icons.tsx. Nepovinná. */
  icon?: ReactNode;
  children: ReactNode;
  /** "md" pro sekce v kartách, "sm" pro vnořené bloky. */
  size?: "sm" | "md";
  /**
   * Barva sekce (detail zakázky): ikona se posadí do podbarveného čtverečku
   * v té barvě. Sekce se tak od sebe poznají i při rychlém scrollování.
   */
  barva?: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--space-2)",
        fontWeight: 950,
        fontSize: size === "md" ? "var(--text-lg)" : "var(--text-base)",
        color: "var(--text)",
        marginBottom: "var(--space-3)",
      }}
    >
      {icon && barva ? (
        <span
          aria-hidden="true"
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: size === "md" ? 26 : 22,
            height: size === "md" ? 26 : 22,
            borderRadius: size === "md" ? 8 : 6,
            background: `${barva}22`,
            color: barva,
            flexShrink: 0,
          }}
        >
          {icon}
        </span>
      ) : (
        icon
      )}
      <span>{children}</span>
    </div>
  );
}
