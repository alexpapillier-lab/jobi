import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { nactiServiceConfig } from "../lib/serviceSettingsSync";
import { normalizujOdmeny } from "../lib/odmeny";
import { XIcon } from "./icons";
import type { Pruvodce, StavPruvodcu } from "../lib/pruvodci";

/**
 * Panel nápovědy (otazník v postranním panelu).
 *
 * Nahoře průvodce k místu, kde uživatel právě je, a neprošlé novinky; dole
 * agent: otázka česky, odpověď z katalogu průvodců a popisu funkcí (edge
 * funkce napoveda-agent). Agent umí rovnou spustit průvodce nebo otevřít
 * nastavení – panel akci provede a zavře se. Do modelu jde jen stránka,
 * role, moduly a hrubá nastavení servisu, nikdy zakázky ani zákazníci.
 *
 * Když agent není zapnutý (bez klíče na serveru), panel ukáže jen průvodce.
 */

export type KontextAgenta = {
  role: string;
  web: boolean;
  moduly: string[];
  stranky: string[];
};

type Zprava = { role: "user" | "assistant"; content: string; akce?: Array<{ typ: string; [k: string]: unknown }> };

const KLIC_NENASTAVENO = "jobsheet_napoveda_agent_vypnuty";

/**
 * Agent je vypnutý natvrdo: každý dotaz stojí peníze za Claude API a majitel
 * aplikace se rozhodl neplatit. Panel je tak jen rozcestník průvodců
 * a novinek. Zapnutí = VITE_NAPOVEDA_AGENT=1 při buildu a klíč
 * ANTHROPIC_API_KEY v secrets edge funkce napoveda-agent.
 */
const AGENT_ZAPNUTY = import.meta.env.VITE_NAPOVEDA_AGENT === "1";

export function NapovedaPanel({
  open,
  onClose,
  activeServiceId,
  page,
  subsection,
  pruvodceMisto,
  stav,
  kontext,
  onSpustitPruvodce,
  onOtevritNastaveni,
  onOtevritStranku,
  onVsichniPruvodci,
}: {
  open: boolean;
  onClose: () => void;
  activeServiceId: string | null;
  page: string;
  subsection: string | null;
  pruvodceMisto: Pruvodce | null;
  stav: StavPruvodcu;
  kontext: KontextAgenta;
  onSpustitPruvodce: (id: string) => void;
  onOtevritNastaveni: (subsection: string) => void;
  onOtevritStranku: (page: string) => void;
  onVsichniPruvodci: () => void;
}) {
  const [zpravy, setZpravy] = useState<Zprava[]>([]);
  const [text, setText] = useState("");
  const [posilam, setPosilam] = useState(false);
  const [agentVypnuty, setAgentVypnuty] = useState(() => {
    if (!AGENT_ZAPNUTY) return true;
    try {
      const t = Number(localStorage.getItem(KLIC_NENASTAVENO) ?? 0);
      return Date.now() - t < 24 * 3600_000;
    } catch {
      return false;
    }
  });
  const seznamRef = useRef<HTMLDivElement>(null);
  const vstupRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => vstupRef.current?.focus(), 50);
    return () => window.clearTimeout(t);
  }, [open]);

  useEffect(() => {
    seznamRef.current?.scrollTo({ top: seznamRef.current.scrollHeight });
  }, [zpravy, posilam]);

  const provedAkce = useCallback((akce: Array<{ typ: string; [k: string]: unknown }> | undefined) => {
    if (!akce || akce.length === 0) return;
    const a = akce[0];
    if (a.typ === "spustit_pruvodce" && typeof a.id === "string") {
      onClose();
      onSpustitPruvodce(a.id);
    } else if (a.typ === "otevrit_nastaveni" && typeof a.subsection === "string") {
      onClose();
      onOtevritNastaveni(a.subsection);
    } else if (a.typ === "otevrit_stranku" && typeof a.page === "string") {
      onClose();
      onOtevritStranku(a.page);
    }
  }, [onClose, onSpustitPruvodce, onOtevritNastaveni, onOtevritStranku]);

  const odeslat = useCallback(async () => {
    const otazka = text.trim();
    if (!otazka || posilam || !supabase || !activeServiceId) return;
    setText("");
    const historie = zpravy.slice(-8).map((z) => ({ role: z.role, content: z.content }));
    setZpravy((z) => [...z, { role: "user", content: otazka }]);
    setPosilam(true);
    try {
      // Hrubá nastavení servisu pro kontext – žádná data zákazníků.
      const cfg = await nactiServiceConfig(activeServiceId);
      const c = cfg.stav === "ok" ? cfg.config : {};
      const nastaveni = {
        hodinova_prace: typeof c.hodinova_sazba === "number" && c.hodinova_sazba > 0,
        pridelovani_technika: c.pridelovani_technika !== false,
        cas_na_oprave: c.cas_na_oprave === true,
        chat_tymu: c.chat !== false,
        zasilky: c.zasilky === true,
        online_rezervace: !!(c.rezervace && typeof c.rezervace === "object" && (c.rezervace as { zapnuto?: boolean }).zapnuto),
        prednastavene_slevy: Array.isArray(c.prednastavene_slevy) ? c.prednastavene_slevy.length : 0,
        kontrolni_seznamy: Array.isArray(c.kontrolniSeznamy) ? c.kontrolniSeznamy.length : 0,
        nahradni_zarizeni: Array.isArray(c.nahradniZarizeni) ? c.nahradniZarizeni.length : 0,
        odmeny_pravidla: normalizujOdmeny(c.odmeny).pravidla.filter((p) => p.aktivni).length,
        report_statistik: !!(c.statistiky_report && typeof c.statistiky_report === "object" && (c.statistiky_report as { zapnuto?: boolean }).zapnuto),
        ukazkova_data: !!c.demo_data,
      };
      const pruvodci = stav.dostupne.map((p) => ({
        id: p.id, nazev: p.nazev, popis: p.popis, page: p.page, settingsSubsection: p.settingsSubsection,
        kroky: p.kroky.map((k) => ({ title: k.title, description: k.description })),
      }));
      const { data, error } = await supabase.functions.invoke("napoveda-agent", {
        body: { service_id: activeServiceId, otazka, historie, kontext: { page, subsection, ...kontext, nastaveni }, pruvodci },
      });
      // deno-lint-ignore no-explicit-any
      const d = (data ?? {}) as any;
      if (error || d.error) {
        // Podrobnost chyby posílá funkce v těle i při ne-2xx; supabase-js ji schová do error.context.
        let telo = d;
        if (error && !d.error) {
          try {
            // deno-lint-ignore no-explicit-any
            telo = await (error as any).context?.json?.();
          } catch {
            telo = null;
          }
        }
        if (telo?.error === "nenastaveno") {
          setAgentVypnuty(true);
          try { localStorage.setItem(KLIC_NENASTAVENO, String(Date.now())); } catch { /* ignorovat */ }
          setZpravy((z) => [...z, { role: "assistant", content: "Agent nápovědy zatím není zapnutý. Použijte průvodce výše, nebo napište na podpora@appjobi.com." }]);
          return;
        }
        const detail = telo?.detail ?? telo?.error ?? error?.message ?? "Neznámá chyba";
        setZpravy((z) => [...z, { role: "assistant", content: `Nepodařilo se odpovědět: ${detail}` }]);
        return;
      }
      const akce = Array.isArray(d.akce) ? d.akce : [];
      setZpravy((z) => [...z, { role: "assistant", content: String(d.odpoved ?? ""), akce }]);
      provedAkce(akce);
    } catch (e) {
      setZpravy((z) => [...z, { role: "assistant", content: `Nepodařilo se odpovědět: ${e instanceof Error ? e.message : String(e)}` }]);
    } finally {
      setPosilam(false);
    }
  }, [text, posilam, activeServiceId, zpravy, stav.dostupne, page, subsection, kontext, provedAkce]);

  if (!open) return null;

  const border = "1px solid var(--border)";
  const novinky = stav.dostupne.filter((p) => stav.novinky.includes(p.id));
  const tlacitko: React.CSSProperties = { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, width: "100%", padding: "10px 12px", borderRadius: 12, border, background: "var(--panel-2)", color: "var(--text)", fontSize: 13, fontWeight: 600, cursor: "pointer", textAlign: "left", fontFamily: "inherit" };
  const uzky = typeof window !== "undefined" && window.innerWidth < 720;

  return (
    <div
      role="dialog"
      aria-label="Průvodce a nápověda"
      style={{
        position: "fixed",
        zIndex: 1180,
        ...(uzky
          ? { left: 8, right: 8, bottom: "calc(var(--bottom-nav-h, 56px) + var(--safe-bottom, 0px) + 8px)", maxHeight: "75vh" }
          : { left: "50%", transform: "translateX(-50%)", bottom: 24, width: 420, maxWidth: "calc(100vw - 32px)", maxHeight: "72vh" }),
        display: "flex",
        flexDirection: "column",
        background: "var(--panel)",
        border,
        borderRadius: 16,
        boxShadow: "var(--shadow)",
        overflow: "hidden",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", borderBottom: border }}>
        <div style={{ fontWeight: 900, fontSize: 14, flex: 1 }}>Průvodce a nápověda</div>
        <button type="button" onClick={onClose} aria-label="Zavřít nápovědu" style={{ border: "none", background: "transparent", color: "var(--muted)", cursor: "pointer", padding: 4, display: "inline-flex" }}>
          <XIcon size={16} />
        </button>
      </div>

      <div ref={seznamRef} style={{ overflowY: "auto", padding: 12, display: "grid", gap: 8, flex: 1, minHeight: 0 }}>
        {pruvodceMisto && (
          <button type="button" style={tlacitko} onClick={() => { onClose(); onSpustitPruvodce(pruvodceMisto.id); }}>
            <span>
              <span style={{ display: "block", fontSize: 11, color: "var(--muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em" }}>Průvodce touto stránkou</span>
              {pruvodceMisto.nazev}
            </span>
            <span style={{ color: "var(--accent)" }}>Spustit ›</span>
          </button>
        )}
        {novinky.slice(0, 3).map((p) => (
          <button key={p.id} type="button" style={{ ...tlacitko, background: "var(--accent-soft)", borderColor: "var(--accent)" }} onClick={() => { onClose(); onSpustitPruvodce(p.id); }}>
            <span>
              <span style={{ display: "block", fontSize: 11, color: "var(--accent)", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.04em" }}>Novinka</span>
              {p.nazev}
              <span style={{ display: "block", fontSize: 12, color: "var(--muted)", fontWeight: 500 }}>{p.popis}</span>
            </span>
            <span style={{ color: "var(--accent)" }}>Projít ›</span>
          </button>
        ))}
        <button type="button" style={{ ...tlacitko, background: "transparent" }} onClick={() => { onClose(); onVsichniPruvodci(); }}>
          <span>Všichni průvodci a novinky</span>
          <span style={{ color: "var(--muted)" }}>{stav.dostupne.length}</span>
        </button>

        {zpravy.length > 0 && <div style={{ borderTop: border, marginTop: 4 }} />}
        {zpravy.map((z, i) => (
          <div key={i} style={{ display: "flex", justifyContent: z.role === "user" ? "flex-end" : "flex-start" }}>
            <div style={{ maxWidth: "88%", padding: "8px 12px", borderRadius: 12, fontSize: 13, lineHeight: 1.45, whiteSpace: "pre-wrap", background: z.role === "user" ? "var(--accent)" : "var(--panel-2)", color: z.role === "user" ? "#fff" : "var(--text)" }}>
              {z.content}
              {z.akce && z.akce.length > 0 && (
                <div style={{ marginTop: 6, display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {z.akce.map((a, j) => (
                    <button key={j} type="button" onClick={() => provedAkce([a])} style={{ padding: "4px 10px", borderRadius: 999, border: "1px solid var(--accent)", background: "transparent", color: "var(--accent)", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>
                      {a.typ === "spustit_pruvodce" ? "Spustit průvodce znovu" : a.typ === "otevrit_nastaveni" ? "Otevřít nastavení" : "Otevřít stránku"}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
        {posilam && <div style={{ fontSize: 12, color: "var(--muted)" }}>Hledám odpověď…</div>}
      </div>

      {!agentVypnuty && (
        <div style={{ display: "flex", gap: 8, padding: 10, borderTop: border, alignItems: "flex-end" }}>
          <textarea
            ref={vstupRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void odeslat();
              }
            }}
            placeholder="Zeptejte se, jak se v Jobi něco dělá…"
            rows={1}
            aria-label="Dotaz na nápovědu"
            style={{ flex: 1, resize: "none", padding: "9px 12px", borderRadius: 12, border, background: "var(--panel-2)", color: "var(--text)", font: "inherit", fontSize: 13, lineHeight: 1.35, outline: "none", maxHeight: 120 }}
          />
          <button
            type="button"
            onClick={() => void odeslat()}
            disabled={!text.trim() || posilam}
            aria-label="Odeslat dotaz"
            style={{ border: "none", borderRadius: 12, width: 38, height: 38, display: "inline-flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "#fff", background: text.trim() && !posilam ? "linear-gradient(135deg, var(--accent), var(--accent-hover))" : "color-mix(in srgb, var(--accent) 45%, var(--panel))", flex: "0 0 auto" }}
          >
            <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M22 2L11 13M22 2l-7 20-4-9-9-4z" />
            </svg>
          </button>
        </div>
      )}
      <div style={{ padding: "0 12px 8px", fontSize: 11, color: "var(--muted)" }}>
        {agentVypnuty ? "Nenašli jste odpověď? Napište nám v Nastavení → Nápověda a podpora." : "Odpovídá z nápovědy Jobi; nevidí vaše zakázky ani zákazníky."}
      </div>
    </div>
  );
}
