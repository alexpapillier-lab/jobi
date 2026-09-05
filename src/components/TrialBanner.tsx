import { useEntitlements } from "../hooks/useEntitlements";

/**
 * Proužek se zkušebním obdobím.
 *
 * Nový servis má celou aplikaci na 30 dní; po vypršení se zamkne (viz
 * TrialEnded), dokud si servis nevybere plán. Aby to nepřišlo bez varování,
 * poslední týden se odpočítává. Servisům s trvalými nároky (tedy platícím)
 * se proužek neukazuje vůbec.
 */
const DNY_UPOZORNENI = 7;

function dny(n: number): string {
  const a = Math.abs(n);
  if (a === 1) return "1 den";
  if (a < 5) return `${a} dny`;
  return `${a} dní`;
}

export function TrialBanner({ activeServiceId }: { activeServiceId: string | null }) {
  const { trialEndsAt, trialDaysLeft, loading } = useEntitlements(activeServiceId);
  if (loading || !activeServiceId || trialEndsAt === null || trialDaysLeft === null) return null;

  const skoncilo = trialDaysLeft <= 0;
  // Do posledního týdne nikoho neotravovat.
  if (!skoncilo && trialDaysLeft > DNY_UPOZORNENI) return null;

  const barva = skoncilo ? "var(--danger-text)" : "var(--warning-text)";
  const pozadi = skoncilo ? "var(--danger-soft)" : "var(--warning-soft, var(--accent-soft))";

  return (
    <div
      role="status"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        flexWrap: "wrap",
        padding: "8px 14px",
        background: pozadi,
        color: barva,
        fontSize: 13,
        fontWeight: 600,
        borderBottom: "1px solid var(--border)",
      }}
    >
      <span>
        {skoncilo
          ? "Zkušební období skončilo. Vyberte si tarif, ať můžete pokračovat."
          : `Zkušební období končí za ${dny(trialDaysLeft)}. Pak si vyberte tarif, jinak se aplikace zamkne. Data zůstanou uložená.`}
      </span>
      {/* Dřív tu byl e-mail na podporu. Obrazovka Předplatné už existuje,
          tak vede odkaz rovnou tam – člověk si tarif vybere sám. */}
      <button
        type="button"
        onClick={() =>
          window.dispatchEvent(
            new CustomEvent("jobsheet:navigate", { detail: { page: "settings", subsection: "service_subscription" } }),
          )
        }
        style={{ border: "none", background: "transparent", padding: 0, color: "inherit", fontWeight: 800, textDecoration: "underline", cursor: "pointer", font: "inherit" }}
      >
        Vybrat tarif
      </button>
    </div>
  );
}
