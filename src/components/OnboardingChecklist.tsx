import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { loadServiceConfig, mergeServiceConfig, subscribeServiceConfig, type ServiceConfig } from "../lib/serviceSettingsSync";
import { CheckIcon, XIcon } from "./icons";

/**
 * První kroky nového servisu.
 *
 * Po založení servisu je aplikace prázdná a není poznat, čím začít – hlavně
 * firemní údaje chybí tam, kde jsou nejvíc vidět, totiž na vytištěné
 * příjemce. Seznam se ukazuje jen majiteli a správci, sám se odškrtává
 * podle skutečného stavu a po dokončení (nebo skrytí) se schová natrvalo.
 * Příznak leží v nastavení servisu, ne v prohlížeči, takže se kolegům
 * neukazuje znovu na každém počítači.
 */
type Krok = {
  id: string;
  label: string;
  popis: string;
  hotovo: boolean;
  /** Kam odskočit; podsekce Nastavení. */
  cil?: string;
  akce?: string;
  volitelny?: boolean;
};

function jeVyplneno(v: unknown): boolean {
  return typeof v === "string" && v.trim().length > 0;
}

export function OnboardingChecklist({ activeServiceId, ticketCount }: { activeServiceId: string; ticketCount: number }) {
  const [config, setConfig] = useState<ServiceConfig | null>(null);
  const [clenu, setClenu] = useState(1);
  const [skryto, setSkryto] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void loadServiceConfig(activeServiceId).then((c) => { if (!cancelled) setConfig(c ?? {}); });
    const off = subscribeServiceConfig(activeServiceId, (c) => setConfig(c));
    return () => { cancelled = true; off(); };
  }, [activeServiceId]);

  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    void (supabase.from("service_memberships") as any)
      .select("user_id", { count: "exact", head: true })
      .eq("service_id", activeServiceId)
      .then(({ count }: { count: number | null }) => { if (!cancelled) setClenu(count ?? 1); }, () => {});
    return () => { cancelled = true; };
  }, [activeServiceId]);

  const kroky = useMemo<Krok[]>(() => {
    const cd = (config?.companyData ?? {}) as Record<string, unknown>;
    const zkratka = jeVyplneno(config?.abbreviation) || jeVyplneno(cd.abbreviation);
    return [
      {
        id: "firma",
        label: "Vyplňte údaje firmy",
        popis: "Název, IČO a adresa se tisknou v hlavičce příjemky a faktury.",
        hotovo: jeVyplneno(cd.name) && jeVyplneno(cd.ico) && jeVyplneno(cd.addressStreet) && jeVyplneno(cd.addressCity),
        cil: "service_basic",
        akce: "Doplnit údaje",
      },
      {
        id: "zkratka",
        label: "Nastavte zkratku servisu",
        popis: "Je z ní číslo zakázky, například SRV26000001.",
        hotovo: zkratka,
        cil: "service_basic",
        akce: "Nastavit zkratku",
      },
      {
        id: "kontakt",
        label: "Doplňte telefon a e-mail",
        popis: "Zákazník je uvidí na dokumentech i v odkazu na stav zakázky.",
        hotovo: jeVyplneno(cd.phone) || jeVyplneno(cd.email),
        cil: "service_contact",
        akce: "Doplnit kontakt",
      },
      {
        id: "zakazka",
        label: "Založte první zakázku",
        popis: "Vyzkoušejte si příjem i tisk, než přijde první zákazník.",
        hotovo: ticketCount > 0,
      },
      {
        id: "tym",
        label: "Pozvěte kolegu",
        popis: "Každý uvidí stejné zakázky a je poznat, kdo co udělal.",
        hotovo: clenu > 1,
        cil: "service_team",
        akce: "Pozvat",
        volitelny: true,
      },
    ];
  }, [config, ticketCount, clenu]);

  const hotovych = kroky.filter((k) => k.hotovo).length;
  const vsePovinneHotovo = kroky.every((k) => k.hotovo || k.volitelny);

  const schovat = useCallback(async () => {
    setSkryto(true);
    await mergeServiceConfig(activeServiceId, { onboarding_hidden: true });
  }, [activeServiceId]);

  // Jakmile je hotovo všechno povinné, seznam se schová sám (a už se nevrátí).
  useEffect(() => {
    if (config && vsePovinneHotovo && config.onboarding_hidden !== true) {
      void mergeServiceConfig(activeServiceId, { onboarding_hidden: true });
    }
  }, [config, vsePovinneHotovo, activeServiceId]);

  if (!config || skryto || config.onboarding_hidden === true) return null;

  const jdi = (subsection?: string) => {
    if (!subsection) return;
    window.dispatchEvent(new CustomEvent("jobsheet:navigate", { detail: { page: "settings", subsection } }));
  };

  return (
    <div
      style={{
        border: "1px solid var(--accent)",
        background: "var(--accent-soft)",
        borderRadius: 14,
        padding: "14px 16px",
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <div style={{ fontWeight: 900, fontSize: 15, color: "var(--text)", flex: 1, minWidth: 0 }}>
          První kroky
          <span style={{ marginLeft: 8, fontWeight: 700, fontSize: 13, color: "var(--muted)", fontVariantNumeric: "tabular-nums" }}>
            {hotovych} z {kroky.length}
          </span>
        </div>
        <button
          type="button"
          onClick={() => void schovat()}
          title="Skrýt první kroky"
          aria-label="Skrýt první kroky"
          style={{ border: "none", background: "transparent", color: "var(--muted)", cursor: "pointer", display: "inline-flex", padding: 4 }}
        >
          <XIcon size={16} />
        </button>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {kroky.map((k) => (
          <div key={k.id} style={{ display: "flex", alignItems: "center", gap: 10, opacity: k.hotovo ? 0.6 : 1 }}>
            <span
              aria-hidden
              style={{
                width: 20,
                height: 20,
                borderRadius: "50%",
                flex: "0 0 auto",
                display: "grid",
                placeItems: "center",
                background: k.hotovo ? "var(--accent)" : "transparent",
                border: k.hotovo ? "none" : "2px solid var(--border)",
                color: "#fff",
              }}
            >
              {k.hotovo && <CheckIcon size={12} />}
            </span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: "block", fontSize: 13, fontWeight: 700, color: "var(--text)", textDecoration: k.hotovo ? "line-through" : "none" }}>
                {k.label}
                {k.volitelny && <span style={{ fontWeight: 500, color: "var(--muted)" }}> · nepovinné</span>}
              </span>
              <span style={{ display: "block", fontSize: 12, color: "var(--muted)" }}>{k.popis}</span>
            </span>
            {!k.hotovo && k.cil && (
              <button
                type="button"
                onClick={() => jdi(k.cil)}
                style={{ flex: "0 0 auto", padding: "5px 12px", borderRadius: 999, border: "1px solid var(--accent)", background: "var(--panel)", color: "var(--accent)", fontSize: 12, fontWeight: 700, cursor: "pointer" }}
              >
                {k.akce ?? "Otevřít"}
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
