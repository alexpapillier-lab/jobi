import { useCallback, useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Button, Card, Input, SettingRow, SettingRows, useSavedHint } from "../../components/ui";
import { showToast } from "../../components/Toast";
import { supabase, supabaseUrl, supabaseFetch } from "../../lib/supabaseClient";
import { nactiServiceConfig, subscribeServiceConfig } from "../../lib/serviceSettingsSync";
import { useConfigNacteno } from "./useConfigNacteno";
import {
  MAX_POCET_LET,
  MIN_POCET_LET,
  POTVRZOVACI_SLOVO,
  VYCHOZI_POCET_LET,
  jePotvrzeni,
  nastaveniAnonymizaceZConfigu,
  pocetSouboru,
  pocetZakazek,
  pocetZakazniku,
} from "../../lib/anonymizace";

/**
 * Nastavení → Firma → Ochrana údajů.
 *
 * Pravidlo „zákazníka bez zakázky mladší než N let anonymizovat“. Počet let
 * se ukládá do service_settings.config.gdpr.anonymizacePoLetech přes RPC
 * anonymizace_nastavit (jen správce). Anonymizace je nevratná, proto:
 * náhled (kdo a kolik) → dialog se seznamem → napsat slovo ANONYMIZOVAT.
 * Denní úloha pak pokračuje sama, ale jen když správce aspoň jednou
 * potvrdil ručně stejné nebo přísnější pravidlo. Co přesně se maže:
 * docs/GDPR_ANONYMIZACE.md.
 */

type Nahled = {
  poLetech: number;
  nastaveno: number | null;
  hranice: string;
  pocetZakazniku: number;
  pocetZakazekBezKarty: number;
  pocetZakazek: number;
  pocetSouboru: number;
  zakaznici: Array<{ id: string; jmeno: string; posledni: string; zakazek: number }>;
  zakazkyBezKarty: Array<{ id: string; jmeno: string | null; kod: string | null; posledni: string }>;
  potvrzenoRucne: boolean;
  automatickyBezi: boolean;
};

type Beh = {
  id: string;
  spustenoAt: string;
  zdroj: "rucne" | "cron";
  spustil: string | null;
  poLetech: number;
  pocetZakazniku: number;
  pocetZakazekBezKarty: number;
  pocetZakazek: number;
  pocetSmsKonverzaci: number;
  pocetSouboru: number;
  souboruCeka: number;
  souboryHotovo: string | null;
  chybaSouboru: string | null;
};

/** Stejný nadpis karty jako v Settings.tsx (tam je jen místní funkce). */
function CardHeader({ title, description, right }: { title: ReactNode; description?: ReactNode; right?: ReactNode }) {
  return (
    <div style={{ marginBottom: "var(--space-3)" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--space-2)" }}>
        <div style={{ fontWeight: 900, fontSize: "var(--text-base)", color: "var(--text)" }}>{title}</div>
        {right}
      </div>
      {description ? <div style={{ fontSize: "var(--text-sm)", color: "var(--muted)", marginTop: 2, lineHeight: 1.5 }}>{description}</div> : null}
    </div>
  );
}

const datum = (s: string | null | undefined) => (s ? new Date(s).toLocaleDateString("cs-CZ", { day: "numeric", month: "numeric", year: "numeric" }) : "–");
const datumCas = (s: string) => new Date(s).toLocaleString("cs-CZ", { day: "numeric", month: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" });
const LETA = Array.from({ length: MAX_POCET_LET - MIN_POCET_LET + 1 }, (_, i) => MIN_POCET_LET + i);

/**
 * Spuštění: přes edge funkci (běží pod service_role bez 8s limitu dotazu
 * a rovnou smaže soubory). Když funkce ještě není nasazená, přímo přes RPC
 * – databáze se anonymizuje stejně, soubory počkají ve frontě na denní úlohu.
 */
async function spustitAnonymizaci(serviceId: string, potvrzeni: string): Promise<{ pocetZakazniku: number; pocetZakazekBezKarty: number; souboryCekaji: boolean }> {
  if (!supabase) throw new Error("Aplikace není připojená ke cloudu.");
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  if (!token) throw new Error("Nejste přihlášeni.");

  let res: Response | null = null;
  if (supabaseUrl) {
    try {
      res = await supabaseFetch(`${supabaseUrl}/functions/v1/gdpr-anonymizace`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ serviceId, potvrzeni }),
      });
    } catch {
      res = null;
    }
  }
  if (res && res.status !== 404) {
    const raw = await res.text();
    const odpoved = raw ? JSON.parse(raw) : {};
    if (!res.ok) throw new Error(odpoved?.error ?? `Chyba ${res.status}`);
    return {
      pocetZakazniku: Number(odpoved.pocetZakazniku) || 0,
      pocetZakazekBezKarty: Number(odpoved.pocetZakazekBezKarty) || 0,
      souboryCekaji: Boolean(odpoved.chybaSouboru) || (Number(odpoved.pocetSouboru) || 0) > (Number(odpoved.smazanoSouboru) || 0),
    };
  }

  const { data: vysledek, error } = await (supabase as any).rpc("anonymizace_spustit", { p_service_id: serviceId, p_potvrzeni: potvrzeni });
  if (error) throw new Error(error.message);
  const v = (vysledek ?? {}) as { pocetZakazniku?: number; pocetZakazekBezKarty?: number; soubory?: string[] };
  return { pocetZakazniku: v.pocetZakazniku ?? 0, pocetZakazekBezKarty: v.pocetZakazekBezKarty ?? 0, souboryCekaji: (v.soubory?.length ?? 0) > 0 };
}

export function GdprAnonymizaceSection({ activeServiceId }: { activeServiceId: string | null }) {
  const [poLetech, setPoLetech] = useState<number | null>(null);
  const [vybranyPocet, setVybranyPocet] = useState<number>(VYCHOZI_POCET_LET);
  const { nacteno, oznacNacteno } = useConfigNacteno(activeServiceId);
  const [chybaNacteni, setChybaNacteni] = useState(false);
  /** Nejpřísnější ručně potvrzené pravidlo (počet let); denní úloha běží pro stejné nebo mírnější. */
  const [potvrzenoLet, setPotvrzenoLet] = useState<number | null>(null);
  const [protokol, setProtokol] = useState<Beh[]>([]);
  const [nahled, setNahled] = useState<Nahled | null>(null);
  const [nacitamNahled, setNacitamNahled] = useState(false);
  const hint = useSavedHint();

  const nactiProtokol = useCallback(async () => {
    if (!supabase || !activeServiceId) return;
    const { data, error } = await (supabase as any).rpc("anonymizace_protokol", { p_service_id: activeServiceId, p_limit: 10 });
    if (error || !data) return;
    const d = data as { behy?: Beh[]; potvrzenoLet?: number | null };
    setProtokol(d.behy ?? []);
    setPotvrzenoLet(typeof d.potvrzenoLet === "number" ? d.potvrzenoLet : null);
  }, [activeServiceId]);

  useEffect(() => {
    if (!activeServiceId) return;
    let zruseno = false;
    nactiServiceConfig(activeServiceId).then((r) => {
      if (zruseno) return;
      if (r.stav === "chyba") {
        setChybaNacteni(true);
        return;
      }
      setChybaNacteni(false);
      const n = nastaveniAnonymizaceZConfigu(r.stav === "ok" ? r.config.gdpr : undefined);
      setPoLetech(n.anonymizacePoLetech);
      if (n.anonymizacePoLetech) setVybranyPocet(n.anonymizacePoLetech);
      oznacNacteno();
    });
    const unsubscribe = subscribeServiceConfig(activeServiceId, (config) => {
      const n = nastaveniAnonymizaceZConfigu(config.gdpr);
      setPoLetech(n.anonymizacePoLetech);
      if (n.anonymizacePoLetech) setVybranyPocet(n.anonymizacePoLetech);
    }, "gdpr-anonymizace");
    void nactiProtokol();
    return () => { zruseno = true; unsubscribe(); };
  }, [activeServiceId, oznacNacteno, nactiProtokol]);

  const ulozit = useCallback(async (next: number | null) => {
    if (!nacteno || !activeServiceId || !supabase) return;
    const predtim = poLetech;
    setPoLetech(next);
    if (next) setVybranyPocet(next);
    const { error } = await (supabase as any).rpc("anonymizace_nastavit", { p_service_id: activeServiceId, p_po_letech: next });
    if (error) {
      setPoLetech(predtim);
      showToast(`Uložení selhalo: ${error.message}`, "error");
      return;
    }
    hint.show();
  }, [nacteno, activeServiceId, poLetech, hint]);

  const otevritNahled = async () => {
    if (!supabase || !activeServiceId) return;
    setNacitamNahled(true);
    try {
      const { data, error } = await (supabase as any).rpc("anonymizace_nahled", { p_service_id: activeServiceId, p_po_letech: vybranyPocet });
      if (error) throw new Error(error.message);
      setNahled(data as Nahled);
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Náhled se nepodařilo načíst.", "error");
    } finally {
      setNacitamNahled(false);
    }
  };

  const zapnuto = poLetech != null;
  const automatickyBezi = zapnuto && potvrzenoLet != null && potvrzenoLet <= poLetech;
  const popisStavu = !zapnuto
    ? "Vypnuto – nic se neanonymizuje."
    : automatickyBezi
      ? `Každou noc se anonymizují zákazníci bez zakázky za posledních ${poLetech} let.`
      : potvrzenoLet != null
        ? `Pravidlo je přísnější, než jste potvrdili (${potvrzenoLet} let) – čeká na nové ruční spuštění, do té doby se nic neanonymizuje.`
        : "Zapnuto, ale čeká na první ruční spuštění – do té doby se nic neanonymizuje. Otevřete náhled a potvrďte ho.";

  return (
    <>
      <Card data-tour="settings-gdpr-anonymizace">
        <CardHeader
          title="Anonymizace starých zákazníků"
          description="Osobní údaje zákazníků se nesmí držet napořád. Zákazník, který u vás nemá žádnou zakázku mladší než zvolený počet let, se anonymizuje: jméno nahradí „Anonymizovaný zákazník“, kontakty, adresa a poznámky zmizí, stejně jako fotky a podpisy u jeho zakázek a SMS s ním. Zakázky zůstanou (čísla, zařízení, opravy, ceny) a faktury se nemění vůbec – účetní doklady musíte archivovat 10 let."
          right={hint.node}
        />

        {chybaNacteni && (
          <div role="alert" style={{ padding: 12, borderRadius: 10, border: "1px solid rgba(239,68,68,0.3)", background: "rgba(239,68,68,0.08)", fontSize: 13, marginBottom: 12 }}>
            Nastavení se nepodařilo načíst – změny se teď neukládají.
          </div>
        )}

        <SettingRows>
          <SettingRow
            clickable
            dataTour="gdpr-zapnout"
            label="Anonymizovat zákazníky bez nedávné zakázky"
            description={popisStavu}
            control={
              <input
                type="checkbox"
                aria-label="Anonymizovat zákazníky bez nedávné zakázky"
                checked={zapnuto}
                disabled={!nacteno || chybaNacteni}
                onChange={(e) => void ulozit(e.target.checked ? vybranyPocet : null)}
              />
            }
          />
          <SettingRow
            dataTour="gdpr-roky"
            label="Po kolika letech"
            description="Počítá se od poslední zakázky (přijetí i vydání), reklamace nebo faktury – ne od úpravy karty. Zákazník s rozpracovanou zakázkou nebo nezaplacenou fakturou se neanonymizuje nikdy."
            control={
              <select
                aria-label="Po kolika letech anonymizovat"
                className="ui-input"
                style={{ width: "auto", minWidth: 110 }}
                value={vybranyPocet}
                disabled={!nacteno || chybaNacteni}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  setVybranyPocet(n);
                  if (zapnuto) void ulozit(n);
                }}
              >
                {LETA.map((n) => <option key={n} value={n}>{n} let{n === VYCHOZI_POCET_LET ? " (doporučeno)" : ""}</option>)}
              </select>
            }
          />
        </SettingRows>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: "var(--space-4)" }}>
          <Button data-tour="gdpr-nahled" size="sm" variant="soft" onClick={() => void otevritNahled()} disabled={nacitamNahled || !activeServiceId}>
            {nacitamNahled ? "Počítám…" : "Zobrazit náhled"}
          </Button>
          <span style={{ fontSize: 12, color: "var(--muted)" }}>Náhled nic nemění – ukáže, koho by se anonymizace dotkla.</span>
        </div>

        <details data-tour="gdpr-co-se-smaze" style={{ marginTop: "var(--space-4)", fontSize: 13, color: "var(--muted)", lineHeight: 1.55 }}>
          <summary style={{ cursor: "pointer", color: "var(--text)", fontWeight: 600 }}>Co přesně se smaže a co zůstane</summary>
          <div style={{ marginTop: 8, display: "grid", gap: 6 }}>
            <div><b>Smaže se:</b> jméno (nahradí ho „Anonymizovaný zákazník #…“), telefon, e-mail, adresa, poznámka a historie změn karty; na zakázkách a reklamacích totéž plus kód k zařízení, podpis převzetí, fotky, odkaz do portálu a otisk schválení nabídky (IP adresa); z historie zakázky osobní údaje; SMS konverzace, ve kterých se od hranice nic nedělo; telefon a e-mail z logu automatizací.</div>
            <div><b>Zůstane:</b> faktury beze změny (zákon o účetnictví a o DPH), zakázka jako záznam – číslo, zařízení včetně IMEI a sériového čísla, opravy, ceny a stavy pro statistiky; IČO, DIČ a název firmy (údaje z veřejného rejstříku, které jsou stejně na fakturách); interní komentáře a poznámky technika, které Jobi neumí rozebrat – osobní údaje do nich nepište.</div>
          </div>
        </details>
      </Card>

      <Card data-tour="gdpr-protokol" style={{ marginTop: "var(--space-4)" }}>
        <CardHeader
          title="Protokol anonymizace"
          description="Posledních 10 běhů. Denní úloha se zapisuje, jen když někoho anonymizovala."
        />
        {protokol.length === 0 ? (
          <div style={{ fontSize: "var(--text-sm)", color: "var(--muted)" }}>Zatím neproběhla žádná anonymizace.</div>
        ) : (
          <div style={{ display: "grid", gap: 4 }}>
            {protokol.map((b) => (
              <div key={b.id} style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "baseline", fontSize: "var(--text-sm)", padding: "6px 0", borderTop: "1px solid var(--border)" }}>
                <span style={{ color: "var(--muted)", whiteSpace: "nowrap" }}>{datumCas(b.spustenoAt)}</span>
                <span style={{ fontWeight: 600 }}>{b.zdroj === "cron" ? "automaticky" : `ručně${b.spustil ? ` (${b.spustil})` : ""}`}</span>
                <span>
                  {pocetZakazniku(b.pocetZakazniku)}
                  {b.pocetZakazekBezKarty > 0 ? ` + ${pocetZakazek(b.pocetZakazekBezKarty)} bez karty` : ""}
                  <span style={{ color: "var(--muted)" }}> · po {b.poLetech} letech · {pocetZakazek(b.pocetZakazek)}, {b.pocetSmsKonverzaci} SMS konverzací</span>
                </span>
                <span style={{ color: b.chybaSouboru ? "var(--danger, #dc2626)" : b.souboruCeka > 0 ? "var(--warning-text, #b45309)" : "var(--muted)" }}>
                  {b.pocetSouboru === 0
                    ? "bez souborů"
                    : b.souboruCeka > 0
                      ? `${pocetSouboru(b.souboruCeka)} čeká na smazání${b.chybaSouboru ? ` – ${b.chybaSouboru}` : " (dočistí noční úloha)"}`
                      : `${pocetSouboru(b.pocetSouboru)} smazáno`}
                </span>
              </div>
            ))}
          </div>
        )}
      </Card>

      {nahled && activeServiceId && (
        <NahledDialog
          nahled={nahled}
          ulozenoLet={poLetech}
          onZavrit={() => setNahled(null)}
          onSpustit={async (potvrzeni) => {
            const v = await spustitAnonymizaci(activeServiceId, potvrzeni);
            setNahled(null);
            showToast(
              `Anonymizováno: ${pocetZakazniku(v.pocetZakazniku)}${v.pocetZakazekBezKarty ? ` a ${pocetZakazek(v.pocetZakazekBezKarty)} bez karty` : ""}.${v.souboryCekaji ? " Soubory dočistí noční úloha." : ""}`,
              "success",
            );
            void nactiProtokol();
          }}
        />
      )}
    </>
  );
}

function NahledDialog({
  nahled,
  ulozenoLet,
  onZavrit,
  onSpustit,
}: {
  nahled: Nahled;
  ulozenoLet: number | null;
  onZavrit: () => void;
  onSpustit: (potvrzeni: string) => Promise<void>;
}) {
  const [slovo, setSlovo] = useState("");
  const [bezi, setBezi] = useState(false);
  const [chyba, setChyba] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !bezi) { e.preventDefault(); onZavrit(); }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onZavrit, bezi]);

  const celkem = nahled.pocetZakazniku + nahled.pocetZakazekBezKarty;
  // Spouští se podle uloženého pravidla – náhled s jiným počtem let je jen „co kdyby“.
  const jinePravidlo = ulozenoLet == null || ulozenoLet !== nahled.poLetech;
  const lzeSpustit = celkem > 0 && !jinePravidlo && jePotvrzeni(slovo) && !bezi;
  const zbyva = nahled.pocetZakazniku - nahled.zakaznici.length;

  const spustit = async () => {
    if (!lzeSpustit) return;
    setBezi(true);
    setChyba(null);
    try {
      await onSpustit(slovo);
    } catch (e) {
      setChyba(e instanceof Error ? e.message : String(e));
      setBezi(false);
    }
  };

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="gdpr-nahled-title"
      onClick={() => { if (!bezi) onZavrit(); }}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 10000, padding: 16 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--panel)", borderRadius: "var(--radius-md)", padding: "var(--space-6)",
          maxWidth: 640, width: "100%", maxHeight: "90vh", display: "flex", flexDirection: "column",
          boxShadow: "var(--shadow)", border: "1px solid var(--border)",
        }}
      >
        <div id="gdpr-nahled-title" style={{ fontWeight: 900, fontSize: "var(--text-lg)", marginBottom: "var(--space-2)", color: "var(--text)" }}>
          {celkem === 0 ? "Není koho anonymizovat" : `Anonymizace se dotkne: ${pocetZakazniku(nahled.pocetZakazniku)}`}
        </div>
        <div style={{ fontSize: "var(--text-sm)", color: "var(--muted)", marginBottom: "var(--space-3)", lineHeight: 1.5 }}>
          Bez zakázky od {datum(nahled.hranice)} (pravidlo {nahled.poLetech} let).
          {nahled.pocetZakazekBezKarty > 0 && <> Navíc {pocetZakazek(nahled.pocetZakazekBezKarty)} bez karty zákazníka (jméno jen na zakázce).</>}
          {celkem > 0 && <> Celkem {pocetZakazek(nahled.pocetZakazek)} přijde o osobní údaje a smaže se {pocetSouboru(nahled.pocetSouboru)} (fotky, podpisy).</>}
        </div>

        {celkem > 0 && (
          <div style={{ overflow: "auto", flex: "1 1 auto", minHeight: 80, border: "1px solid var(--border)", borderRadius: 10, marginBottom: "var(--space-3)" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr>
                  {["Zákazník", "Poslední aktivita", "Zakázek"].map((h) => (
                    <th key={h} style={{ position: "sticky", top: 0, background: "var(--panel)", textAlign: "left", padding: "6px 10px", borderBottom: "1px solid var(--border)", color: "var(--muted)", fontSize: 12, fontWeight: 600 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {nahled.zakaznici.map((z) => (
                  <tr key={z.id}>
                    <td style={{ padding: "5px 10px", borderBottom: "1px solid var(--border)" }}>{z.jmeno}</td>
                    <td style={{ padding: "5px 10px", borderBottom: "1px solid var(--border)", whiteSpace: "nowrap" }}>{datum(z.posledni)}</td>
                    <td style={{ padding: "5px 10px", borderBottom: "1px solid var(--border)" }}>{z.zakazek}</td>
                  </tr>
                ))}
                {zbyva > 0 && (
                  <tr><td colSpan={3} style={{ padding: "6px 10px", color: "var(--muted)" }}>… a dalších {pocetZakazniku(zbyva)}</td></tr>
                )}
                {nahled.zakazkyBezKarty.map((z) => (
                  <tr key={z.id}>
                    <td style={{ padding: "5px 10px", borderBottom: "1px solid var(--border)" }}>
                      {z.jmeno || "bez jména"} <span style={{ color: "var(--muted)" }}>(zakázka {z.kod ?? "bez čísla"}, bez karty)</span>
                    </td>
                    <td style={{ padding: "5px 10px", borderBottom: "1px solid var(--border)", whiteSpace: "nowrap" }}>{datum(z.posledni)}</td>
                    <td style={{ padding: "5px 10px", borderBottom: "1px solid var(--border)" }}>1</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {celkem > 0 && jinePravidlo && (
          <div role="alert" style={{ fontSize: 13, marginBottom: "var(--space-3)", padding: 10, borderRadius: 8, background: "var(--warning-soft, rgba(245,158,11,0.12))" }}>
            {ulozenoLet == null
              ? "Pravidlo je vypnuté. Zapněte ho (s tímto počtem let) a náhled otevřete znovu – spouští se vždy podle uloženého pravidla."
              : `Uložené pravidlo je ${ulozenoLet} let, náhled je pro ${nahled.poLetech}. Uložte počet let a náhled otevřete znovu.`}
          </div>
        )}

        {celkem > 0 && !jinePravidlo && (
          <div style={{ marginBottom: "var(--space-3)" }}>
            <div style={{ fontSize: 13, marginBottom: 6, lineHeight: 1.5 }}>
              <b>Nevratné.</b> Údaje nepůjde obnovit ani ze zálohy aplikace. Po tomhle potvrzení bude pravidlo každou noc pokračovat samo.
              Pro potvrzení napište <b>{POTVRZOVACI_SLOVO}</b>:
            </div>
            <Input
              aria-label="Potvrzovací slovo"
              value={slovo}
              onChange={(e) => setSlovo(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void spustit(); } }}
              placeholder={POTVRZOVACI_SLOVO}
              autoComplete="off"
              spellCheck={false}
              style={{ maxWidth: 260 }}
            />
          </div>
        )}

        {chyba && (
          <div role="alert" style={{ color: "var(--danger-text)", fontSize: 13, marginBottom: "var(--space-3)", padding: "var(--space-3)", background: "var(--danger-soft)", borderRadius: "var(--radius-xs)" }}>
            {chyba}
          </div>
        )}

        <div style={{ display: "flex", gap: "var(--space-2)", justifyContent: "flex-end", flexWrap: "wrap" }}>
          <Button variant="ghost" onClick={onZavrit} disabled={bezi}>{celkem > 0 ? "Zrušit" : "Zavřít"}</Button>
          {celkem > 0 && (
            <Button variant="danger" onClick={() => void spustit()} disabled={!lzeSpustit}>
              {bezi ? "Anonymizuji…" : `Anonymizovat ${pocetZakazniku(nahled.pocetZakazniku)}${nahled.pocetZakazekBezKarty ? ` + ${pocetZakazek(nahled.pocetZakazekBezKarty)}` : ""}`}
            </Button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
