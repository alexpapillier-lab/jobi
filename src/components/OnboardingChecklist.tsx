import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { loadServiceConfig, mergeServiceConfig, subscribeServiceConfig, type ServiceConfig } from "../lib/serviceSettingsSync";
import { CheckIcon, XIcon } from "./icons";
import { demoStopa, smazatDemoData, vytvoritDemoData } from "../lib/demoData";
import { showToast } from "./Toast";
import { isDesktop } from "../lib/platform";
import { isJobiDocsRunning, JOBIDOCS_DOWNLOAD_URL } from "../lib/jobidocs";
import { onboardingKroky, pocetHotovych, vsePovinneHotovo as vsePovinneHotovoZ } from "../lib/onboardingKroky";

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
export function OnboardingChecklist({ activeServiceId, ticketCount }: { activeServiceId: string; ticketCount: number }) {
  const [config, setConfig] = useState<ServiceConfig | null>(null);
  const [clenu, setClenu] = useState(1);
  const [skryto, setSkryto] = useState(false);
  const [maDemo, setMaDemo] = useState(false);
  const [demoBezi, setDemoBezi] = useState(false);
  const [jobiDocsBezi, setJobiDocsBezi] = useState(false);

  // Tisk dokumentů jde jen přes JobiDocs a nový servis o něm nemá jak vědět –
  // první tisk zakázkového listu pak skončí u dialogu prohlížeče. Krok se
  // odškrtne sám, jakmile JobiDocs běží. Ve webové verzi se dotaz na
  // localhost přeskakuje (viz jobidocs.ts), takže tam zůstane nesplněný.
  useEffect(() => {
    if (!isDesktop()) return;
    let cancelled = false;
    const zjisti = () => { void isJobiDocsRunning().then((ok) => { if (!cancelled) setJobiDocsBezi(ok); }); };
    zjisti();
    const t = window.setInterval(zjisti, 15_000);
    return () => { cancelled = true; window.clearInterval(t); };
  }, []);

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
      // Skryté členství majitele aplikace se do „kolik nás tu je" nepočítá.
      .eq("skryty", false)
      .then(({ count }: { count: number | null }) => { if (!cancelled) setClenu(count ?? 1); }, () => {});
    return () => { cancelled = true; };
  }, [activeServiceId]);

  useEffect(() => {
    let cancelled = false;
    void demoStopa(activeServiceId).then((st) => { if (!cancelled) setMaDemo(!!st); });
    return () => { cancelled = true; };
  }, [activeServiceId, config]);

  const prepnoutDemo = useCallback(async () => {
    setDemoBezi(true);
    const res = maDemo ? await smazatDemoData(activeServiceId) : await vytvoritDemoData(activeServiceId);
    setDemoBezi(false);
    if (res.error) {
      showToast(res.error, "error");
      return;
    }
    setMaDemo((p) => !p);
    showToast(maDemo ? "Ukázková data smazána" : "Ukázková data přidána – najdete je v Zařízeních a v Zakázkách", "success");
    // Ceník i seznam zakázek se překreslí z realtime; sklad si načte své.
  }, [activeServiceId, maDemo]);

  const kroky = useMemo(
    () =>
      onboardingKroky({
        config,
        zakazek: ticketCount,
        clenu,
        jobiDocsBezi,
        desktop: isDesktop(),
        odkazJobiDocs: JOBIDOCS_DOWNLOAD_URL,
      }),
    [config, ticketCount, clenu, jobiDocsBezi],
  );

  const hotovych = pocetHotovych(kroky);
  const vsePovinneHotovo = vsePovinneHotovoZ(kroky);

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
            {!k.hotovo && (k.cil || k.odkaz) && (
              <button
                type="button"
                onClick={() => (k.odkaz ? window.open(k.odkaz, "_blank", "noopener") : jdi(k.cil))}
                style={{ flex: "0 0 auto", padding: "5px 12px", borderRadius: 999, border: "1px solid var(--accent)", background: "var(--panel)", color: "var(--accent)", fontSize: 12, fontWeight: 700, cursor: "pointer" }}
              >
                {k.akce ?? "Otevřít"}
              </button>
            )}
          </div>
        ))}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", borderTop: "1px solid var(--border)", paddingTop: 10 }}>
        <span style={{ fontSize: 12, color: "var(--muted)", flex: 1, minWidth: 180 }}>
          {maDemo
            ? "Ukázkový ceník a zakázka jsou v aplikaci. Až si vše vyzkoušíte, smažte je jedním klikem."
            : "Nechcete zkoušet na ostrých datech? Přidáme pár zařízení s cenami a jednu vzorovou zakázku."}
        </span>
        <button
          type="button"
          onClick={() => void prepnoutDemo()}
          disabled={demoBezi}
          style={{ padding: "5px 12px", borderRadius: 999, border: "1px solid var(--border)", background: "var(--panel)", color: "var(--text)", fontSize: 12, fontWeight: 700, cursor: demoBezi ? "wait" : "pointer" }}
        >
          {demoBezi ? "Pracuji…" : maDemo ? "Smazat ukázková data" : "Přidat ukázková data"}
        </button>
      </div>
    </div>
  );
}
