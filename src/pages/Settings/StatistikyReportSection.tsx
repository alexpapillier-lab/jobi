import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Button, Card, Input, Segmented, SettingRow, SettingRows, useSavedHint } from "../../components/ui";
import { showToast } from "../../components/Toast";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { supabase, supabaseUrl, supabaseFetch } from "../../lib/supabaseClient";
import { nactiServiceConfig, mergeServiceConfig } from "../../lib/serviceSettingsSync";
import {
  MAX_PRIJEMCU,
  nastaveniReportuZConfigu,
  platnyEmail,
  type FrekvenceReportu,
  type NastaveniReportu,
} from "../../../supabase/functions/_shared/statistikyReport";

/**
 * Nastavení → Komunikace → Report statistik.
 *
 * Majitel si zapne, že mu jednou za měsíc (nebo týden) přijde e-mailem PDF
 * se statistikami servisu – obrat, zisk, marže, zakázky, opravy, zařízení,
 * zákazníci, technici, pobočky. Posílá to edge funkce
 * `statistics-report-send` z cronu; tady se jen ukládá nastavení do
 * `service_settings.config.statistiky_report` a dají se vyzkoušet tři věci:
 * ukázka PDF, zkušební e-mail na sebe a odeslání příjemcům hned.
 */
type Odeslani = { id: string; sent_at: string; prijemci: string[]; ok: boolean; chyba: string | null; nazev_obdobi: string; planovane: boolean };

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

const HODINY = Array.from({ length: 24 }, (_, h) => h);

async function zavolejReport(serviceId: string, mode: "test" | "now" | "preview", obdobi: "predchozi" | "aktualni") {
  if (!supabase || !supabaseUrl) throw new Error("Aplikace není připojená ke cloudu.");
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  if (!token) throw new Error("Nejste přihlášeni.");
  const res = await supabaseFetch(`${supabaseUrl}/functions/v1/statistics-report-send`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ service_id: serviceId, mode, obdobi }),
  });
  const raw = await res.text();
  const odpoved = raw ? JSON.parse(raw) : {};
  if (!res.ok) throw new Error(odpoved?.error ?? `Chyba ${res.status}`);
  return odpoved as { ok: true; filename?: string; pdf_base64?: string; sent_to?: string[]; obdobi?: string };
}

function stahniPdf(base64: string, nazev: string) {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = nazev;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function StatistikyReportSection({ activeServiceId }: { activeServiceId: string | null }) {
  const [nastaveni, setNastaveni] = useState<NastaveniReportu>(nastaveniReportuZConfigu(undefined));
  const [nacitam, setNacitam] = useState(true);
  const [chybaNacteni, setChybaNacteni] = useState(false);
  const [novyEmail, setNovyEmail] = useState("");
  const [odeslani, setOdeslani] = useState<Odeslani[]>([]);
  const [bezi, setBezi] = useState<"test" | "now" | "preview" | null>(null);
  const [obdobi, setObdobi] = useState<"predchozi" | "aktualni">("predchozi");
  const [potvrditOdeslani, setPotvrditOdeslani] = useState(false);
  const hint = useSavedHint();

  const nactiOdeslani = useCallback(async () => {
    if (!supabase || !activeServiceId) return;
    const { data } = await (supabase.from("statistiky_report_odeslani") as any)
      .select("id,sent_at,prijemci,ok,chyba,nazev_obdobi,planovane")
      .eq("service_id", activeServiceId)
      .order("sent_at", { ascending: false })
      .limit(5);
    setOdeslani((data as Odeslani[] | null) ?? []);
  }, [activeServiceId]);

  useEffect(() => {
    if (!activeServiceId || !supabase) {
      setNacitam(false);
      return;
    }
    let zruseno = false;
    void (async () => {
      const nactene = await nactiServiceConfig(activeServiceId);
      if (zruseno) return;
      if (nactene.stav === "chyba") {
        // Bez načteného nastavení by se přepsali příjemci prázdným seznamem.
        setChybaNacteni(true);
        setNacitam(false);
        return;
      }
      setChybaNacteni(false);
      setNastaveni(nastaveniReportuZConfigu(nactene.stav === "ok" ? nactene.config.statistiky_report : undefined));
      setNacitam(false);
      void nactiOdeslani();
    })();
    return () => { zruseno = true; };
  }, [activeServiceId, nactiOdeslani]);

  const uloz = useCallback(async (next: NastaveniReportu) => {
    setNastaveni(next);
    if (!activeServiceId) return;
    const r = await mergeServiceConfig(activeServiceId, { statistiky_report: next });
    if (r.error) {
      console.error("[StatistikyReport] uložení selhalo", r.error);
      showToast("Nastavení se nepodařilo uložit", "error");
      return;
    }
    hint.show();
  }, [activeServiceId, hint]);

  const pridejEmail = () => {
    const e = novyEmail.trim().toLowerCase();
    if (!platnyEmail(e)) {
      showToast("Zadejte platnou e-mailovou adresu.", "error");
      return;
    }
    if (nastaveni.emaily.includes(e)) {
      setNovyEmail("");
      return;
    }
    if (nastaveni.emaily.length >= MAX_PRIJEMCU) {
      showToast(`Nejvýš ${MAX_PRIJEMCU} příjemců.`, "error");
      return;
    }
    void uloz({ ...nastaveni, emaily: [...nastaveni.emaily, e] });
    setNovyEmail("");
  };

  const spust = async (mode: "test" | "now" | "preview") => {
    if (!activeServiceId) return;
    setBezi(mode);
    try {
      const r = await zavolejReport(activeServiceId, mode, obdobi);
      if (mode === "preview" && r.pdf_base64) {
        stahniPdf(r.pdf_base64, r.filename ?? "jobi-report.pdf");
        showToast(`Ukázka za ${r.obdobi ?? "období"} stažena.`, "success");
      } else if (mode === "test") {
        showToast(`Zkušební report odeslán na ${r.sent_to?.[0] ?? "váš e-mail"}.`, "success");
      } else {
        showToast(`Report za ${r.obdobi ?? "období"} odeslán ${r.sent_to?.length ?? 0} příjemcům.`, "success");
      }
      void nactiOdeslani();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Odeslání selhalo.", "error");
    } finally {
      setBezi(null);
    }
  };

  if (nacitam) return <div style={{ color: "var(--muted)" }}>Načítám…</div>;
  if (chybaNacteni) {
    return (
      <div style={{ color: "var(--danger, #dc2626)" }}>
        Nastavení reportu se nepodařilo načíst. Zkuste to za chvíli – měnit ho teď nejde, přepsali by se příjemci.
      </div>
    );
  }

  const bezPrijemcu = nastaveni.zapnuto && nastaveni.emaily.length === 0;
  const kdy = nastaveni.frekvence === "tydne" ? "každé pondělí" : "1. den v měsíci";

  return (
    <>
      <Card>
        <CardHeader
          title="Report statistik e-mailem"
          description="Jednou za měsíc nebo týden přijde na zadané adresy PDF se statistikami servisu: obrat, zisk a marže, počty zakázek, nejčastější opravy a zařízení, hodnotní a pravidelní zákazníci, technici a pobočky – vždy se srovnáním s předchozím obdobím. Čísla jsou stejná jako na stránce Statistiky."
          right={hint.node}
        />
        <SettingRows>
          <SettingRow
            clickable
            label="Posílat report e-mailem"
            description={nastaveni.zapnuto ? `Odejde ${kdy} v ${nastaveni.hodina}:00 za právě skončené období.` : "Vypnuto – nic se neposílá."}
            control={<input type="checkbox" checked={nastaveni.zapnuto} onChange={(e) => void uloz({ ...nastaveni, zapnuto: e.target.checked })} />}
          />
          <SettingRow
            label="Jak často"
            description={nastaveni.frekvence === "tydne" ? "Každé pondělí za minulý týden (pondělí–neděle)." : "Prvního v měsíci za minulý měsíc."}
            control={
              <Segmented<FrekvenceReportu>
                size="sm"
                ariaLabel="Frekvence reportu"
                value={nastaveni.frekvence}
                onChange={(v) => void uloz({ ...nastaveni, frekvence: v })}
                options={[{ value: "mesicne", label: "Měsíčně" }, { value: "tydne", label: "Týdně" }]}
              />
            }
          />
          <SettingRow
            label="Hodina odeslání"
            description="Pražský čas. Report odejde v první celé hodině od této chvíle."
            control={
              <select
                aria-label="Hodina odeslání"
                value={nastaveni.hodina}
                onChange={(e) => void uloz({ ...nastaveni, hodina: Number(e.target.value) })}
                className="ui-input"
                style={{ width: "auto", minWidth: 90 }}
              >
                {HODINY.map((h) => <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>)}
              </select>
            }
          />
        </SettingRows>

        <div style={{ marginTop: "var(--space-4)" }}>
          <div style={{ fontWeight: 700, fontSize: "var(--text-sm)", marginBottom: 6 }}>Příjemci</div>
          {bezPrijemcu && (
            <div role="alert" style={{ fontSize: "var(--text-sm)", color: "var(--danger, #dc2626)", marginBottom: 8 }}>
              Report je zapnutý, ale nemá komu chodit – přidejte aspoň jednu adresu.
            </div>
          )}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
            {nastaveni.emaily.length === 0 && <span style={{ fontSize: "var(--text-sm)", color: "var(--muted)" }}>Zatím žádná adresa.</span>}
            {nastaveni.emaily.map((e) => (
              <span key={e} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 8px 4px 10px", borderRadius: 999, border: "1px solid var(--border)", background: "var(--panel-2)", fontSize: "var(--text-sm)" }}>
                {e}
                <button
                  type="button"
                  aria-label={`Odebrat ${e}`}
                  title="Odebrat"
                  onClick={() => void uloz({ ...nastaveni, emaily: nastaveni.emaily.filter((x) => x !== e) })}
                  style={{ border: "none", background: "none", cursor: "pointer", color: "var(--muted)", fontSize: 14, lineHeight: 1, padding: 0 }}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
          <form
            onSubmit={(e) => { e.preventDefault(); pridejEmail(); }}
            style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}
          >
            <Input
              type="email"
              aria-label="Nový příjemce"
              placeholder="majitel@servis.cz"
              value={novyEmail}
              onChange={(e) => setNovyEmail(e.target.value)}
              style={{ minWidth: 240, flex: "1 1 240px", maxWidth: 360 }}
            />
            <Button type="submit" size="sm" variant="soft" disabled={!novyEmail.trim()}>Přidat příjemce</Button>
          </form>
        </div>
      </Card>

      <Card style={{ marginTop: "var(--space-4)" }}>
        <CardHeader
          title="Vyzkoušet"
          description="Ukázku PDF si stáhnete hned, zkušební e-mail přijde jen vám. „Poslat teď“ odešle report všem příjemcům mimo plán."
        />
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
          <Segmented<"predchozi" | "aktualni">
            size="sm"
            ariaLabel="Období pro zkušební report"
            value={obdobi}
            onChange={setObdobi}
            options={[
              { value: "predchozi", label: nastaveni.frekvence === "tydne" ? "Minulý týden" : "Minulý měsíc" },
              { value: "aktualni", label: nastaveni.frekvence === "tydne" ? "Tento týden" : "Tento měsíc" },
            ]}
          />
          <Button size="sm" variant="soft" disabled={bezi !== null} onClick={() => void spust("preview")}>
            {bezi === "preview" ? "Připravuji PDF…" : "Stáhnout ukázku PDF"}
          </Button>
          <Button size="sm" variant="soft" disabled={bezi !== null} onClick={() => void spust("test")}>
            {bezi === "test" ? "Odesílám…" : "Poslat zkušební na můj e-mail"}
          </Button>
          <Button size="sm" disabled={bezi !== null || nastaveni.emaily.length === 0} title={nastaveni.emaily.length === 0 ? "Nejdřív přidejte příjemce" : undefined} onClick={() => setPotvrditOdeslani(true)}>
            {bezi === "now" ? "Odesílám…" : "Poslat teď příjemcům"}
          </Button>
        </div>

        {odeslani.length > 0 && (
          <div style={{ marginTop: "var(--space-4)" }}>
            <div style={{ fontWeight: 700, fontSize: "var(--text-sm)", marginBottom: 6 }}>Poslední odeslání</div>
            <div style={{ display: "grid", gap: 4 }}>
              {odeslani.map((o) => (
                <div key={o.id} style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "baseline", fontSize: "var(--text-sm)", padding: "6px 0", borderTop: "1px solid var(--border)" }}>
                  <span style={{ color: o.ok ? "var(--success, #16a34a)" : "var(--danger, #dc2626)", fontWeight: 700 }}>{o.ok ? "✓" : "✕"}</span>
                  <span style={{ color: "var(--muted)", whiteSpace: "nowrap" }}>{new Date(o.sent_at).toLocaleString("cs-CZ", { day: "numeric", month: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
                  <span style={{ fontWeight: 600 }}>{o.nazev_obdobi}</span>
                  <span style={{ color: "var(--muted)" }}>{o.planovane ? "plánované" : "ručně"} · {o.prijemci.join(", ")}</span>
                  {!o.ok && o.chyba && <span style={{ color: "var(--danger, #dc2626)" }}>{o.chyba}</span>}
                </div>
              ))}
            </div>
          </div>
        )}
      </Card>

      <ConfirmDialog
        open={potvrditOdeslani}
        title="Poslat report teď"
        message={`Report za ${obdobi === "aktualni" ? (nastaveni.frekvence === "tydne" ? "tento týden" : "tento měsíc") : (nastaveni.frekvence === "tydne" ? "minulý týden" : "minulý měsíc")} odejde na: ${nastaveni.emaily.join(", ")}.`}
        confirmLabel="Odeslat"
        cancelLabel="Zrušit"
        onConfirm={() => { setPotvrditOdeslani(false); void spust("now"); }}
        onCancel={() => setPotvrditOdeslani(false)}
      />
    </>
  );
}
