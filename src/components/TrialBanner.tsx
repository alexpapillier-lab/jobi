import { useEntitlements } from "../hooks/useEntitlements";

/**
 * Proužek se zkušebním obdobím.
 *
 * Nový servis dostane placené moduly na 30 dní. Bez tohohle by po vypršení
 * beze slova zmizely Faktury i pobočky a nikdo by nevěděl proč. Proužek
 * proto poslední týden odpočítává a po vypršení řekne, co se stalo a co dál.
 * Servisům s trvalými nároky (tedy platícím) se neukazuje vůbec.
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
          ? "Zkušební období skončilo. Faktury, pobočky a napojení na účetnictví jsou vypnuté, zakázky a sklad fungují dál."
          : `Zkušební období končí za ${dny(trialDaysLeft)}. Pak se vypnou Faktury, pobočky a napojení na účetnictví.`}
      </span>
      <a
        href="mailto:podpora@appjobi.com?subject=Jobi%20%E2%80%93%20pokra%C4%8Dov%C3%A1n%C3%AD%20po%20zku%C5%A1ebn%C3%ADm%20obdob%C3%AD"
        style={{ color: "inherit", fontWeight: 800, textDecoration: "underline" }}
      >
        Chci pokračovat
      </a>
    </div>
  );
}
