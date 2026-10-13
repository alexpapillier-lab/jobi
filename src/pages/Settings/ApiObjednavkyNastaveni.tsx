import { useCallback, useEffect, useState } from "react";
import { supabase, supabaseUrl, supabaseAnonKey, supabaseFetch } from "../../lib/supabaseClient";
import { showToast } from "../../components/Toast";
import { POPIS_UDALOSTI, UDALOSTI, type Udalost } from "../../lib/objednavky";
import { mergeServiceConfig, nactiServiceConfig } from "../../lib/serviceSettingsSync";
import { nastaveniFormulare, type NastaveniFormulare } from "../../../supabase/functions/_shared/objednavky";

const VEREJNE_API = "https://api.appjobi.com/v1";

type Webhook = {
  id: string;
  url: string;
  udalosti: string[];
  aktivni: boolean;
  posledni_uspech_at: string | null;
  posledni_chyba: string | null;
  posledni_chyba_at: string | null;
};

type Doruceni = {
  id: string;
  udalost: string;
  payload: { external_id?: string; ticket_code?: string | null; status?: { label?: string } } | null;
  stav: "ceka" | "odesila" | "odeslano" | "chyba" | "zahozeno";
  pokusy: number;
  http_status: number | null;
  chyba: string | null;
  created_at: string;
  odeslano_at: string | null;
  dalsi_pokus_at: string;
};

type TokenRadek = { id: string; name: string; scopes: string[]; last_used_at: string | null; revoked_at: string | null };

const POPIS_STAVU_DORUCENI: Record<Doruceni["stav"], string> = {
  ceka: "čeká",
  odesila: "odesílá se",
  odeslano: "doručeno",
  chyba: "nedoručeno",
  zahozeno: "neodesláno",
};

function kdy(x: string | null) {
  if (!x) return "nikdy";
  return new Date(x).toLocaleString("cs-CZ", { dateStyle: "short", timeStyle: "short" });
}

/**
 * Nastavení → API → Objednávky z webu.
 *
 * Kam web posílá objednávky (POST /v1/orders s tokenem se scope `orders`),
 * webhook zpět (adresa, události, tajemství pro podpis zobrazené jednou,
 * zkušební webhook) a log posledních doručení. Webhook nastavuje jen
 * majitel/správce – RPC api_webhook_* to hlídají i na serveru.
 */
export function ApiObjednavkyNastaveni({ activeServiceId, tokeny, slug }: { activeServiceId: string | null; tokeny: TokenRadek[]; slug: string | null }) {
  const [formular, setFormular] = useState<NastaveniFormulare | null>(null);
  const [webhook, setWebhook] = useState<Webhook | null>(null);
  const [url, setUrl] = useState("");
  const [udalosti, setUdalosti] = useState<Udalost[]>([...UDALOSTI]);
  const [aktivni, setAktivni] = useState(true);
  const [ukladam, setUkladam] = useState(false);
  const [tajemstvi, setTajemstvi] = useState<string | null>(null);
  const [log, setLog] = useState<Doruceni[]>([]);
  const [zkousim, setZkousim] = useState(false);
  const [vysledekZkousky, setVysledekZkousky] = useState<{ ok: boolean; text: string } | null>(null);

  const nacti = useCallback(async () => {
    if (!activeServiceId || !supabase) return;
    const [w, l] = await Promise.all([
      (supabase.from("api_webhooky" as never) as any)
        .select("id, url, udalosti, aktivni, posledni_uspech_at, posledni_chyba, posledni_chyba_at")
        .eq("service_id", activeServiceId)
        .maybeSingle(),
      (supabase.from("api_webhook_doruceni" as never) as any)
        .select("id, udalost, payload, stav, pokusy, http_status, chyba, created_at, odeslano_at, dalsi_pokus_at")
        .eq("service_id", activeServiceId)
        .order("created_at", { ascending: false })
        .limit(20),
    ]);
    const radek = (w?.data ?? null) as Webhook | null;
    setWebhook(radek);
    if (radek) {
      setUrl(radek.url);
      setUdalosti(radek.udalosti.filter((u): u is Udalost => (UDALOSTI as readonly string[]).includes(u)));
      setAktivni(radek.aktivni);
    }
    setLog(Array.isArray(l?.data) ? (l.data as Doruceni[]) : []);
  }, [activeServiceId]);

  useEffect(() => { void nacti(); }, [nacti]);

  /* Vložitelný formulář Jobi: service_settings.config.objednavky.formular.
     Bez načteného nastavení se nic neukládá (přepsalo by úvodní text). */
  useEffect(() => {
    if (!activeServiceId) return;
    let zruseno = false;
    void nactiServiceConfig(activeServiceId).then((n) => {
      if (zruseno) return;
      if (n.stav === "chyba") { setFormular(null); return; }
      const cfg = n.stav === "ok" ? (n.config as Record<string, unknown>) : {};
      setFormular(nastaveniFormulare((cfg.objednavky as Record<string, unknown> | undefined)?.formular));
    });
    return () => { zruseno = true; };
  }, [activeServiceId]);

  const ulozFormular = useCallback(async (dalsi: NastaveniFormulare) => {
    if (!activeServiceId) return;
    if (dalsi.podminkyUrl && !/^https:\/\/\S+$/i.test(dalsi.podminkyUrl)) {
      showToast("Odkaz na podmínky musí začínat https://", "error");
      return;
    }
    setFormular(dalsi);
    const r = await mergeServiceConfig(activeServiceId, { objednavky: { formular: dalsi } } as never);
    if (r.error) showToast(`Nastavení formuláře se nepodařilo uložit: ${r.error}`, "error");
  }, [activeServiceId]);

  const uloz = useCallback(async () => {
    if (!activeServiceId || !supabase) return;
    const adresa = url.trim();
    if (!/^https:\/\/[^\s/?#]+/i.test(adresa)) {
      showToast("Adresa musí začínat https://", "error");
      return;
    }
    setUkladam(true);
    const { data, error } = await (supabase as any).rpc("api_webhook_ulozit", {
      p_service_id: activeServiceId, p_url: adresa, p_udalosti: udalosti, p_aktivni: aktivni,
    });
    setUkladam(false);
    if (error) { showToast(`Webhook se nepodařilo uložit: ${error.message}`, "error"); return; }
    const t = (data as { tajemstvi?: string } | null)?.tajemstvi;
    if (t) setTajemstvi(t);
    showToast("Webhook uložen", "success");
    void nacti();
  }, [activeServiceId, url, udalosti, aktivni, nacti]);

  const noveTajemstvi = useCallback(async () => {
    if (!activeServiceId || !supabase) return;
    if (!window.confirm("Vyměnit tajemství? Staré přestane platit hned – web musí dostat nové, jinak podpis neověří.")) return;
    const { data, error } = await (supabase as any).rpc("api_webhook_nove_tajemstvi", { p_service_id: activeServiceId });
    if (error) { showToast(`Nepodařilo se: ${error.message}`, "error"); return; }
    setTajemstvi(String(data));
  }, [activeServiceId]);

  const smaz = useCallback(async () => {
    if (!activeServiceId || !supabase) return;
    if (!window.confirm("Smazat webhook? Web se přestane dozvídat o zakázkách z objednávek; nedoručené události se zahodí.")) return;
    const { error } = await (supabase as any).rpc("api_webhook_smazat", { p_service_id: activeServiceId });
    if (error) { showToast(`Nepodařilo se: ${error.message}`, "error"); return; }
    setWebhook(null);
    setUrl("");
    setUdalosti([...UDALOSTI]);
    setAktivni(true);
    setTajemstvi(null);
    showToast("Webhook smazán", "success");
    void nacti();
  }, [activeServiceId, nacti]);

  const zkusebni = useCallback(async () => {
    if (!activeServiceId || !supabase || !supabaseAnonKey) return;
    setZkousim(true);
    setVysledekZkousky(null);
    try {
      const { data: obnovena } = await supabase.auth.refreshSession();
      const jwt = obnovena?.session?.access_token ?? (await supabase.auth.getSession()).data?.session?.access_token;
      const r = await supabaseFetch(`${supabaseUrl}/functions/v1/api-webhooks`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${jwt}`, apikey: supabaseAnonKey },
        body: JSON.stringify({ action: "test", serviceId: activeServiceId }),
      });
      const d = await r.json().catch(() => ({}));
      setVysledekZkousky(
        d.ok ? { ok: true, text: `Server odpověděl ${d.status} – v pořádku.` }
        : { ok: false, text: d.error ? `Nepovedlo se: ${d.error}` : `Server odpověděl ${d.status ?? r.status}.` },
      );
    } catch (e) {
      setVysledekZkousky({ ok: false, text: `Nepovedlo se: ${e instanceof Error ? e.message : String(e)}` });
    } finally {
      setZkousim(false);
      void nacti();
    }
  }, [activeServiceId, nacti]);

  const zkopiruj = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      showToast("Zkopírováno", "success");
    } catch {
      showToast("Kopírování se nepodařilo", "error");
    }
  };

  const tokenyObjednavek = tokeny.filter((t) => !t.revoked_at && t.scopes.includes("orders"));
  const zmeneno = !webhook || webhook.url !== url.trim() || webhook.aktivni !== aktivni
    || [...webhook.udalosti].sort().join() !== [...udalosti].sort().join();

  return (
    <div data-tour="api-objednavky">
      <div style={nadpis}>Objednávky z webu</div>
      <p style={popis}>
        Formulář „Pošlete nám zařízení“ nebo e-shop na vašem webu pošle objednávku opravy do Jobi.
        Objeví se v <strong style={{ color: "var(--text)" }}>Zakázkách nahoře v Příchozích objednávkách</strong> a na stránce Dnes;
        když zásilka dorazí, jedním kliknutím z ní založíte zakázku. Web se pak přes webhook dozví
        číslo zakázky a každou změnu jejího stavu.
      </p>
      <p style={popis}>
        Web potřebuje token se zaškrtnutým <strong style={{ color: "var(--text)" }}>Přijímat objednávky</strong>{" "}
        (<code>orders</code>) – vytvoříte ho výše v části Zápis – tokeny.
        {tokenyObjednavek.length > 0
          ? ` Platné tokeny pro objednávky: ${tokenyObjednavek.map((t) => `${t.name} (naposled ${kdy(t.last_used_at)})`).join(", ")}.`
          : " Zatím žádný takový token nemáte."}
      </p>
      <pre style={kod}>{`curl -X POST ${VEREJNE_API}/orders \\
  -H "Authorization: Bearer jobi_…" \\
  -H "Content-Type: application/json" \\
  -d '{"orders":[{"external_id":"SRV-2026-0123",
    "customer":{"name":"Jan Novák","phone":"+420777123456","email":"jan@example.cz"},
    "device":{"name":"iPhone 13","serial":"356789…","passcode":"1234"},
    "issue":"Prasklý displej",
    "shipping":{"inbound":"DPD","outbound":"Zásilkovna",
      "tracking":[{"carrier":"dpd","number":"13912345678901","direction":"inbound"}]}}]}'`}</pre>
      <p style={{ ...popis, marginTop: 8 }}>
        Stejné <code>external_id</code> poslané znovu objednávku jen aktualizuje (třeba
        <code> "status": "in_transit"</code> po předání dopravci). Stav zjistíte přes
        <code> GET {VEREJNE_API}/orders?external_id=…</code>. Přesný tvar, ověření podpisu
        webhooku a příklady jsou v <a href={`${VEREJNE_API}/docs`} target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent)" }}>dokumentaci API</a>.
      </p>

      <div style={nadpis}>Webhook – oznámení zpět na web</div>
      <p style={popis}>
        Na tuhle adresu pošleme <code>POST</code> s JSONem, když z objednávky vznikne zakázka
        a když zakázka změní stav. Požadavek je podepsaný (<code>X-Jobi-Signature: sha256=…</code>)
        tajemstvím, které se ukáže jen jednou. Nedoručené zkusíme znovu 3× (po 1, 5 a 30 minutách).
      </p>
      <div data-tour="api-objednavky-webhook" style={{ display: "grid", gap: 8, marginBottom: 8 }}>
        <input
          placeholder="https://vas-web.cz/jobi-webhook"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          maxLength={500}
          style={vstup}
        />
        <div style={{ display: "grid", gap: 6 }}>
          {UDALOSTI.map((u) => (
            <label key={u} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={udalosti.includes(u)}
                onChange={(e) => setUdalosti((p) => (e.target.checked ? [...p, u] : p.filter((x) => x !== u)))}
              />
              <span style={{ color: "var(--text)" }}>{POPIS_UDALOSTI[u]}</span>
              <code style={{ fontSize: 11, color: "var(--muted)" }}>{u}</code>
            </label>
          ))}
          <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, cursor: "pointer", marginTop: 4 }}>
            <input type="checkbox" checked={aktivni} onChange={(e) => setAktivni(e.target.checked)} />
            <span style={{ color: "var(--text)" }}>Posílat (vypnutím webhook pozastavíte bez smazání)</span>
          </label>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Tlacitko onClick={() => void uloz()} disabled={ukladam || !url.trim() || udalosti.length === 0 || !zmeneno}>
            {ukladam ? "Ukládám…" : webhook ? "Uložit změny" : "Uložit webhook"}
          </Tlacitko>
          <span data-tour="api-objednavky-zkusebni">
            <Tlacitko onClick={() => void zkusebni()} disabled={zkousim || !webhook}>
              {zkousim ? "Posílám…" : "Poslat zkušební webhook"}
            </Tlacitko>
          </span>
          {webhook && <Tlacitko onClick={() => void noveTajemstvi()}>Vyměnit tajemství</Tlacitko>}
          {webhook && <Tlacitko onClick={() => void smaz()}>Smazat</Tlacitko>}
        </div>
      </div>
      {vysledekZkousky && (
        <p style={{ ...popis, color: vysledekZkousky.ok ? "var(--accent)" : "rgba(239,68,68,0.95)" }}>{vysledekZkousky.text}</p>
      )}
      {webhook && (
        <p style={popis}>
          Naposled doručeno: {kdy(webhook.posledni_uspech_at)}
          {webhook.posledni_chyba && webhook.posledni_chyba_at && (!webhook.posledni_uspech_at || webhook.posledni_chyba_at > webhook.posledni_uspech_at)
            ? ` · poslední chyba ${kdy(webhook.posledni_chyba_at)}: ${webhook.posledni_chyba}`
            : ""}
        </p>
      )}

      {tajemstvi && (
        <div style={{ border: "1px solid var(--accent)", background: "var(--accent-soft)", borderRadius: 8, padding: 12, marginBottom: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 6, color: "var(--text)" }}>Tajemství pro ověření podpisu. Uložte si ho teď.</div>
          <pre style={{ ...kod, background: "var(--panel)" }}>{tajemstvi}</pre>
          <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
            <Tlacitko onClick={() => void zkopiruj(tajemstvi)}>Kopírovat tajemství</Tlacitko>
            <Tlacitko onClick={() => setTajemstvi(null)}>Mám ho uložené</Tlacitko>
          </div>
          <p style={{ ...popis, margin: "8px 0 0" }}>
            Podruhé se nezobrazí. Kdyby se ztratilo, klikněte na Vyměnit tajemství a nové dejte webu.
          </p>
        </div>
      )}

      <div data-tour="api-objednavky-formular">
        <div style={nadpis}>Formulář Jobi pro váš web</div>
        <p style={popis}>
          Nemáte na webu vlastní formulář? Vložte tenhle. Zákazník vyplní kontakt, zařízení
          (s výběrem z vašeho ceníku), závadu a jestli zařízení přinese osobně, nebo pošle.
          Zaškrtnutý souhlas s podmínkami se uloží jako elektronické odsouhlasení a vytiskne
          se na zakázkovém listu. Objednávka přijde do Příchozích objednávek jako „formulář Jobi“.
        </p>
        {formular ? (
          <div style={{ display: "grid", gap: 8 }}>
            <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, cursor: "pointer" }}>
              <input type="checkbox" checked={formular.zapnuto} onChange={(e) => void ulozFormular({ ...formular, zapnuto: e.target.checked })} />
              <span style={{ color: "var(--text)" }}>Formulář je zapnutý</span>
            </label>
            <textarea
              placeholder="Úvodní text nad formulářem (nepovinné)"
              defaultValue={formular.uvod}
              maxLength={400}
              onBlur={(e) => { if (e.target.value.trim() !== formular.uvod) void ulozFormular({ ...formular, uvod: e.target.value.trim() }); }}
              style={{ ...vstup, minHeight: 60, fontFamily: "inherit" }}
            />
            <input
              placeholder="Odkaz na obchodní podmínky (https://…, nepovinné)"
              defaultValue={formular.podminkyUrl ?? ""}
              maxLength={500}
              onBlur={(e) => { const v = e.target.value.trim() || null; if (v !== formular.podminkyUrl) void ulozFormular({ ...formular, podminkyUrl: v }); }}
              style={vstup}
            />
            {formular.zapnuto && slug && (
              <>
                <pre style={kod}>{`<div id="jobi-objednavka"></div>
<script src="${supabaseUrl}/functions/v1/public-order-form/embed.js?service=${slug}"></script>`}</pre>
                <div>
                  <Tlacitko onClick={() => void zkopiruj(`<div id="jobi-objednavka"></div>\n<script src="${supabaseUrl}/functions/v1/public-order-form/embed.js?service=${slug}"></script>`)}>Kopírovat kód</Tlacitko>
                </div>
              </>
            )}
            {formular.zapnuto && !slug && (
              <p style={{ ...popis, color: "rgba(239,68,68,0.95)" }}>Formulář potřebuje adresu servisu – vyplňte ji v Základních údajích.</p>
            )}
          </div>
        ) : (
          <p style={popis}>Nastavení formuláře se nepodařilo načíst.</p>
        )}
      </div>

      <div data-tour="api-objednavky-log">
        <div style={nadpis}>Poslední doručení</div>
        {log.length === 0 ? (
          <p style={popis}>Zatím nic neodešlo.</p>
        ) : (
          <div style={{ display: "grid", gap: 4, marginBottom: 12 }}>
            {log.map((d) => (
              <div
                key={d.id}
                style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "baseline", fontSize: 12, padding: "6px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--panel)" }}
              >
                <span style={{ color: "var(--muted)", minWidth: 96 }}>{kdy(d.created_at)}</span>
                <code style={{ fontSize: 11 }}>{d.udalost}</code>
                <span style={{ color: "var(--text)" }}>
                  {d.payload?.external_id ?? ""}{d.payload?.ticket_code ? ` → ${d.payload.ticket_code}` : ""}
                  {d.payload?.status?.label && d.udalost !== "ping" ? ` · ${d.payload.status.label}` : ""}
                </span>
                <span style={{ marginLeft: "auto", fontWeight: 700, color: d.stav === "odeslano" ? "var(--accent)" : d.stav === "chyba" ? "rgba(239,68,68,0.95)" : "var(--muted)" }}>
                  {POPIS_STAVU_DORUCENI[d.stav]}
                  {d.http_status ? ` (${d.http_status})` : ""}
                  {d.pokusy > 1 ? ` · ${d.pokusy}. pokus` : ""}
                  {d.stav === "ceka" && d.pokusy > 0 ? ` · znovu ${kdy(d.dalsi_pokus_at)}` : ""}
                </span>
                {d.chyba && d.stav !== "odeslano" && <span style={{ flexBasis: "100%", color: "var(--muted)" }}>{d.chyba}</span>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

const kod: React.CSSProperties = {
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  fontSize: 12, background: "var(--panel-2)", padding: "10px 12px",
  borderRadius: 8, border: "1px solid var(--border)",
  overflowX: "auto", whiteSpace: "pre-wrap", wordBreak: "break-all", margin: 0,
};
const nadpis: React.CSSProperties = { fontWeight: 950, fontSize: 14, margin: "20px 0 8px", color: "var(--text)" };
const popis: React.CSSProperties = { fontSize: 13, color: "var(--muted)", lineHeight: 1.6, margin: "0 0 10px" };
const vstup: React.CSSProperties = {
  padding: "10px 12px", borderRadius: 8, border: "1px solid var(--border)",
  background: "var(--panel)", color: "var(--text)", fontSize: 13, minWidth: 0,
};

function Tlacitko({ children, onClick, disabled }: { children: React.ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: "8px 14px", borderRadius: 10, border: "1px solid var(--border)",
        background: "var(--panel)", color: "var(--text)", fontWeight: 600,
        fontFamily: "inherit", fontSize: 13,
        cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.6 : 1,
      }}
    >
      {children}
    </button>
  );
}
