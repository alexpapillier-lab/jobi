import { useCallback, useEffect, useState } from "react";
import { supabase, supabaseUrl, supabaseAnonKey, supabaseFetch } from "../../lib/supabaseClient";
import { useEntitlements } from "../../hooks/useEntitlements";
import { showToast } from "../../components/Toast";

type Rezim = "hidden" | "boolean" | "exact";

type TokenRadek = {
  id: string;
  name: string;
  scopes: string[];
  last_used_at: string | null;
  revoked_at: string | null;
  created_at: string;
};

const POPIS_ROZSAHU: Record<string, string> = {
  "catalog:write": "Měnit ceny a časy oprav",
  "inventory:write": "Měnit počty kusů a ceny produktů",
};

async function volejSpravu(telo: Record<string, unknown>) {
  if (!supabase || !supabaseAnonKey) return { stav: 0, data: { error: "Chybí konfigurace Supabase" } };
  // refreshSession stejně jako v EntitlementsPanel – v desktopu getSession()
  // často vrátí prošlý token a funkce pak odpoví 401.
  const { data: obnovena } = await supabase.auth.refreshSession();
  const jwt = obnovena?.session?.access_token
    ?? (await supabase.auth.getSession()).data?.session?.access_token;
  if (!jwt) return { stav: 401, data: { error: "Nejste přihlášeni" } };

  const r = await supabaseFetch(`${supabaseUrl}/functions/v1/api-tokens-manage`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${jwt}`,
      apikey: supabaseAnonKey,
    },
    body: JSON.stringify(telo),
  });
  return { stav: r.status, data: await r.json().catch(() => ({})) };
}

function kdy(x: string | null) {
  if (!x) return "nikdy";
  return new Date(x).toLocaleString("cs-CZ", { dateStyle: "short", timeStyle: "short" });
}

/**
 * Přehled veřejného API pro servis.
 *
 * Ukazuje se jen servisům, které mají zapnutý aspoň jeden z modulů
 * api_catalog / api_inventory. Účel je praktický: kam se ptát, co odpověď
 * obsahuje, co se ven nikdy nedostane, a tlačítko, kterým si to jde
 * hned vyzkoušet – veřejný endpoint schválně nerozlišuje "servis
 * neexistuje" od "modul vypnutý", takže bez téhle stránky se špatně hádá,
 * proč nic nechodí.
 */
export function ApiNastaveni({ activeServiceId }: { activeServiceId: string | null }) {
  const { has, loading: modulyLoading } = useEntitlements(activeServiceId);
  const [slug, setSlug] = useState<string | null>(null);
  const [rezim, setRezim] = useState<Rezim>("boolean");
  const [nacitam, setNacitam] = useState(true);
  const [test, setTest] = useState<{ kde: "cenik" | "sklad"; stav: number; telo: string } | null>(null);
  const [testuji, setTestuji] = useState<"cenik" | "sklad" | null>(null);
  const [tokeny, setTokeny] = useState<TokenRadek[]>([]);
  const [novyNazev, setNovyNazev] = useState("");
  const [noveRozsahy, setNoveRozsahy] = useState<string[]>([]);
  const [vytvarim, setVytvarim] = useState(false);
  /* Token se ukáže jen tady a jen jednou – v databázi je od té chvíle
     už jen jeho otisk, takže znovu ho zobrazit nejde. */
  const [cerstvyToken, setCerstvyToken] = useState<string | null>(null);
  const [webhook, setWebhook] = useState("");
  const [webhookUlozeny, setWebhookUlozeny] = useState("");
  const [webhookVysledek, setWebhookVysledek] = useState<string | null>(null);
  const [pinguji, setPinguji] = useState(false);

  const maCenik = has("api_catalog");
  const maSklad = has("api_inventory");

  useEffect(() => {
    if (!activeServiceId || !supabase) {
      setNacitam(false);
      return;
    }
    let zruseno = false;
    (async () => {
      const { data } = await supabase
        .from("services")
        .select("public_slug, inventory_availability_mode, public_webhook_url")
        .eq("id", activeServiceId)
        .maybeSingle();
      if (zruseno) return;
      const d = data as { public_slug?: string | null; inventory_availability_mode?: Rezim; public_webhook_url?: string | null } | null;
      setSlug(d?.public_slug ?? null);
      setRezim(d?.inventory_availability_mode ?? "boolean");
      setWebhook(d?.public_webhook_url ?? "");
      setWebhookUlozeny(d?.public_webhook_url ?? "");
      setNacitam(false);
    })();
    return () => { zruseno = true; };
  }, [activeServiceId]);

  const adresaCenik = slug ? `${supabaseUrl}/functions/v1/public-catalog?service=${slug}` : null;
  const adresaSklad = slug ? `${supabaseUrl}/functions/v1/public-inventory?service=${slug}` : null;

  const vyzkousej = useCallback(async (adresa: string, kde: "cenik" | "sklad") => {
    setTestuji(kde);
    try {
      const r = await fetch(adresa);
      const t = await r.text();
      setTest({ kde, stav: r.status, telo: t.slice(0, 1200) });
    } catch (e) {
      setTest({ kde, stav: 0, telo: String(e) });
    } finally {
      setTestuji(null);
    }
  }, []);

  /* Režim dostupnosti si mění servis sám – sloupcový GRANT na
     inventory_availability_mode je v migraci 20260902250000. */
  const ulozRezim = useCallback(async (novy: Rezim) => {
    if (!activeServiceId || !supabase) return;
    const puvodni = rezim;
    setRezim(novy);
    // `as any` stejně jako jinde – vygenerované typy tabulku services nemají
    const { error } = await (supabase.from("services") as any)
      .update({ inventory_availability_mode: novy })
      .eq("id", activeServiceId);
    if (error) {
      setRezim(puvodni);
      showToast("Režim se nepodařilo uložit: " + error.message, "error");
    } else {
      showToast("Uloženo", "success");
    }
  }, [activeServiceId, rezim]);

  const nactiTokeny = useCallback(async () => {
    if (!activeServiceId) return;
    const { stav, data } = await volejSpravu({ action: "list", serviceId: activeServiceId });
    // 403 = přihlášený není owner ani admin; seznam prostě nebude
    if (stav === 200) setTokeny(data.tokens ?? []);
  }, [activeServiceId]);

  useEffect(() => { nactiTokeny(); }, [nactiTokeny]);

  const vytvorToken = useCallback(async () => {
    if (!activeServiceId) return;
    setVytvarim(true);
    const { stav, data } = await volejSpravu({
      action: "create", serviceId: activeServiceId,
      name: novyNazev.trim(), scopes: noveRozsahy,
    });
    setVytvarim(false);
    if (stav !== 200) { showToast(data.error ?? "Token se nepodařilo vytvořit", "error"); return; }
    setCerstvyToken(data.token);
    setNovyNazev("");
    setNoveRozsahy([]);
    nactiTokeny();
  }, [activeServiceId, novyNazev, noveRozsahy, nactiTokeny]);

  const odvolejToken = useCallback(async (tokenId: string) => {
    if (!activeServiceId) return;
    const { stav, data } = await volejSpravu({ action: "revoke", serviceId: activeServiceId, tokenId });
    if (stav !== 200) { showToast(data.error ?? "Odvolání se nepodařilo", "error"); return; }
    showToast("Token odvolán", "success");
    nactiTokeny();
  }, [activeServiceId, nactiTokeny]);

  const ulozWebhook = useCallback(async () => {
    if (!activeServiceId || !supabase) return;
    const hodnota = webhook.trim();
    const { error } = await (supabase.from("services") as any)
      .update({ public_webhook_url: hodnota || null })
      .eq("id", activeServiceId);
    if (error) { showToast("Uložení se nepodařilo: " + error.message, "error"); return; }
    setWebhookUlozeny(hodnota);
    showToast("Uloženo", "success");
  }, [activeServiceId, webhook]);

  const pingni = useCallback(async () => {
    if (!activeServiceId || !supabase || !supabaseAnonKey) return;
    setPinguji(true);
    setWebhookVysledek(null);
    try {
      const { data: obnovena } = await supabase.auth.refreshSession();
      const jwt = obnovena?.session?.access_token
        ?? (await supabase.auth.getSession()).data?.session?.access_token;
      const r = await supabaseFetch(`${supabaseUrl}/functions/v1/public-webhook-ping`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${jwt}`, apikey: supabaseAnonKey },
        body: JSON.stringify({ serviceId: activeServiceId }),
      });
      const d = await r.json().catch(() => ({}));
      setWebhookVysledek(
        d.skipped ? `Neodesláno: ${d.reason}`
        : d.ok ? `Server odpověděl ${d.status} – v pořádku.`
        : d.error ? `Nepovedlo se: ${d.error}`
        : `Server odpověděl ${d.status}.`,
      );
    } finally {
      setPinguji(false);
    }
  }, [activeServiceId]);

  const zkopiruj = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      showToast("Zkopírováno", "success");
    } catch {
      showToast("Kopírování se nepodařilo", "error");
    }
  };

  if (modulyLoading || nacitam) return <div style={{ color: "var(--muted)" }}>Načítám…</div>;

  if (!maCenik && !maSklad) {
    return (
      <div style={{ color: "var(--muted)", fontSize: 13, lineHeight: 1.6 }}>
        Veřejné API není pro tenhle servis zapnuté. Zapíná se v Nastavení → Servis → Owner.
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

  return (
    <div>
      <div style={{ fontWeight: 950, fontSize: 14, marginBottom: 4 }}>Stav</div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
        <Znacka aktivni={maCenik} popisek="Ceník" />
        <Znacka aktivni={maSklad} popisek="Sklad" />
        <Znacka aktivni={!!slug} popisek={slug ? `Adresa: ${slug}` : "Adresa nevyplněná"} />
      </div>

      {!slug && (
        <div style={{ fontSize: 13, color: "rgba(239,68,68,0.95)", marginBottom: 10 }}>
          Modul je zapnutý, ale servis nemá vyplněnou adresu – ven se nedostane nic.
          Doplň ji v Základních údajích.
        </div>
      )}

      {maCenik && adresaCenik && (
        <>
          <div style={nadpis}>Ceník – kam se ptát</div>
          <p style={popis}>Volá se GET, bez přihlášení a bez tokenu. Odpověď je JSON.</p>
          <pre style={kod}>{adresaCenik}</pre>
          <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
            <Tlacitko onClick={() => zkopiruj(adresaCenik)}>Kopírovat adresu</Tlacitko>
            <Tlacitko onClick={() => vyzkousej(adresaCenik, "cenik")} disabled={testuji !== null}>
              {testuji === "cenik" ? "Zkouším…" : "Vyzkoušet"}
            </Tlacitko>
          </div>

          {test?.kde === "cenik" && (
            <div style={{ marginTop: 10 }}>
              <div style={{ fontSize: 12, color: test.stav === 200 ? "var(--accent)" : "rgba(239,68,68,0.95)", marginBottom: 4 }}>
                Odpověď {test.stav}
                {test.stav === 404 && " – servis s touhle adresou nemá zapnutý modul, nebo adresa nesedí"}
              </div>
              <pre style={{ ...kod, maxHeight: 220, overflowY: "auto" }}>{test.telo}</pre>
            </div>
          )}

          <div style={nadpis}>Co odpověď obsahuje</div>
          <p style={popis}>
            Značky, kategorie, modely a opravy. U každé opravy název, popis, odhadovaný čas
            a cena ve třech variantách – <code>price</code> tak, jak ji zadáváš,
            a k tomu <code>price_incl_vat</code> a <code>price_excl_vat</code>. Neplátce DPH
            má ve všech třech stejnou hodnotu.
          </p>

          <div style={nadpis}>Co se ven nikdy nedostane</div>
          <p style={popis}>
            <strong style={{ color: "var(--text)" }}>Náklady na opravu</strong> (tvoje marže),
            interní identifikátory servisu a pořadí položek. Do dotazu se ta data vůbec
            nenačítají.
          </p>
          <p style={popis}>
            Skryté položky taky ne – u každé značky, kategorie, modelu i opravy jde zvlášť
            určit, jestli se posílá ven. Skrytá značka skryje i všechno pod sebou.
          </p>

          <div style={nadpis}>Použití na webu</div>
          <p style={popis}>Odpověď je běžný JSON, takže stačí fetch:</p>
          <pre style={kod}>{`fetch("${adresaCenik}")
  .then(r => r.json())
  .then(data => {
    data.repairs.forEach(o => {
      console.log(o.name, o.price_incl_vat, "Kč");
    });
  });`}</pre>
          <p style={{ ...popis, marginTop: 10 }}>
            Odpověď se cachuje na 5 minut a posílá ETag, takže opakované dotazy web
            nezdržují. Ceník se mění zřídka, tomu to odpovídá.
          </p>
        </>
      )}

      {maSklad && adresaSklad && (
        <>
          <div style={nadpis}>Sklad – kam se ptát</div>
          <p style={popis}>
            Samostatná adresa, schválně oddělená od ceníku. Kdo má zapnutý jen ceník,
            odsud nedostane nic – a naopak.
          </p>
          <pre style={kod}>{adresaSklad}</pre>
          <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
            <Tlacitko onClick={() => zkopiruj(adresaSklad)}>Kopírovat adresu</Tlacitko>
            <Tlacitko onClick={() => vyzkousej(adresaSklad, "sklad")} disabled={testuji !== null}>
              {testuji === "sklad" ? "Zkouším…" : "Vyzkoušet"}
            </Tlacitko>
          </div>

          {test?.kde === "sklad" && (
            <div style={{ marginTop: 10 }}>
              <div style={{ fontSize: 12, color: test.stav === 200 ? "var(--accent)" : "rgba(239,68,68,0.95)", marginBottom: 4 }}>
                Odpověď {test.stav}
                {test.stav === 404 && " – servis s touhle adresou nemá zapnutý modul skladu, nebo adresa nesedí"}
              </div>
              <pre style={{ ...kod, maxHeight: 220, overflowY: "auto" }}>{test.telo}</pre>
            </div>
          )}

          <div style={nadpis}>Kolik toho o skladu prozradíš</div>
          <p style={popis}>
            Tohle je jediné nastavení, které se týká celého skladu, ne jednotlivých položek.
          </p>
          <div style={{ display: "grid", gap: 8, marginBottom: 10 }}>
            {([
              ["boolean", "Skladem / není skladem", "Web se dozví jen to, jestli položku máte. Doporučeno."],
              ["exact", "Přesná čísla", "Pošle se počet kusů. Konkurence uvidí, co a kolik máte."],
              ["hidden", "Neposílat vůbec", "Dostupnost v odpovědi nebude. Ceny a popisy ano."],
            ] as [Rezim, string, string][]).map(([hodnota, nazev, vysvetleni]) => (
              <label
                key={hodnota}
                style={{
                  display: "flex", gap: 10, alignItems: "flex-start", cursor: "pointer",
                  padding: "10px 12px", borderRadius: 8,
                  border: `1px solid ${rezim === hodnota ? "var(--accent)" : "var(--border)"}`,
                  background: rezim === hodnota ? "var(--accent-soft)" : "transparent",
                }}
              >
                <input
                  type="radio"
                  name="rezim-dostupnosti"
                  checked={rezim === hodnota}
                  onChange={() => ulozRezim(hodnota)}
                  style={{ marginTop: 3 }}
                />
                <span>
                  <span style={{ display: "block", fontSize: 13, fontWeight: 700, color: "var(--text)" }}>{nazev}</span>
                  <span style={{ display: "block", fontSize: 12, color: "var(--muted)", lineHeight: 1.5 }}>{vysvetleni}</span>
                </span>
              </label>
            ))}
          </div>

          <div style={nadpis}>Co odpověď obsahuje</div>
          <p style={popis}>
            Kategorie produktů a produkty – název, popis, katalogové číslo, obrázek
            a cena ve stejných třech variantách jako u ceníku. Podle režimu výše
            k tomu <code>availability</code>.
          </p>

          <div style={nadpis}>Co se ven nikdy nedostane</div>
          <p style={popis}>
            <strong style={{ color: "var(--text)" }}>Počty kusů</strong>, pokud si nezvolíš
            režim s přesnými čísly. Dál interní identifikátory servisu, pořadí položek
            a vazba produktů na opravy.
          </p>
          <p style={popis}>
            Skryté položky taky ne – u kategorie i produktu jde zvlášť určit, jestli se
            posílá ven. Skrytá kategorie skryje i produkty pod sebou. Přepínáš to přímo
            ve Skladu, štítkem u položky.
          </p>
        </>
      )}

      <div style={nadpis}>Upozornění na změnu</div>
      <p style={popis}>
        Statický web se sám nedozví, že jsi zdražil. Zadej sem adresu, na kterou
        po úpravě ceníku nebo skladu pošleme POST – typicky „deploy hook“
        z Cloudflare Pages nebo Vercelu, který spustí přegenerování stránek.
        Nepovinné.
      </p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
        <input
          placeholder="https://…"
          value={webhook}
          onChange={(e) => setWebhook(e.target.value)}
          style={{
            flex: "1 1 320px", padding: "10px 12px", borderRadius: 8,
            border: "1px solid var(--border)", background: "var(--panel)",
            color: "var(--text)", fontSize: 13,
          }}
        />
        <Tlacitko onClick={ulozWebhook} disabled={webhook.trim() === webhookUlozeny}>Uložit</Tlacitko>
        <Tlacitko onClick={pingni} disabled={pinguji || !webhookUlozeny}>
          {pinguji ? "Zkouším…" : "Poslat zkušební"}
        </Tlacitko>
      </div>
      {webhookVysledek && (
        <p style={{ ...popis, color: /v pořádku/.test(webhookVysledek) ? "var(--accent)" : "rgba(239,68,68,0.95)" }}>
          {webhookVysledek}
        </p>
      )}
      <p style={popis}>
        Jen <code>https</code> a jen veřejné adresy – na vnitřní síť nebo na
        localhost se odsud posílat nedá.
      </p>

      <div style={nadpis}>Zápis – tokeny</div>
      <p style={popis}>
        Čtení je veřejné, zápis vyžaduje token. Hodí se, když ceny nebo počty kusů
        udržuje jiný systém – pokladna, e-shop. Token vydává jen majitel nebo admin
        servisu.
      </p>
      <p style={popis}>
        Měnit jde <strong style={{ color: "var(--text)" }}>počty kusů a ceny produktů</strong> a
        {" "}<strong style={{ color: "var(--text)" }}>ceny a časy oprav</strong>. Nic jiného –
        názvy, popisy ani vazby na modely se přes API přepsat nedají, to je úprava
        katalogu a patří do aplikace.
      </p>

      {cerstvyToken && (
        <div style={{
          border: "1px solid var(--accent)", background: "var(--accent-soft)",
          borderRadius: 8, padding: 12, marginBottom: 12,
        }}>
          <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 6, color: "var(--text)" }}>
            Token vytvořen. Ulož si ho teď.
          </div>
          <pre style={{ ...kod, background: "var(--panel)" }}>{cerstvyToken}</pre>
          <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
            <Tlacitko onClick={() => zkopiruj(cerstvyToken)}>Kopírovat token</Tlacitko>
            <Tlacitko onClick={() => setCerstvyToken(null)}>Mám ho uložený</Tlacitko>
          </div>
          <p style={{ ...popis, margin: "8px 0 0" }}>
            Podruhé se už nezobrazí – v databázi je od téhle chvíle jen jeho otisk.
            Kdyby se ztratil, vydej nový a starý odvolej.
          </p>
        </div>
      )}

      <div style={{ display: "grid", gap: 8, marginBottom: 12 }}>
        <input
          placeholder="K čemu token je (např. web, pokladna)…"
          value={novyNazev}
          onChange={(e) => setNovyNazev(e.target.value)}
          maxLength={60}
          style={{
            padding: "10px 12px", borderRadius: 8, border: "1px solid var(--border)",
            background: "var(--panel)", color: "var(--text)", fontSize: 13,
          }}
        />
        <div style={{ display: "grid", gap: 6 }}>
          {(maCenik ? ["catalog:write"] : []).concat(maSklad ? ["inventory:write"] : []).map((r) => (
            <label key={r} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={noveRozsahy.includes(r)}
                onChange={(e) => setNoveRozsahy((p) => e.target.checked ? [...p, r] : p.filter((x) => x !== r))}
              />
              <span style={{ color: "var(--text)" }}>{POPIS_ROZSAHU[r]}</span>
              <code style={{ fontSize: 11, color: "var(--muted)" }}>{r}</code>
            </label>
          ))}
        </div>
        <div>
          <Tlacitko
            onClick={vytvorToken}
            disabled={vytvarim || !novyNazev.trim() || noveRozsahy.length === 0}
          >
            {vytvarim ? "Vytvářím…" : "Vytvořit token"}
          </Tlacitko>
        </div>
      </div>

      {tokeny.length > 0 && (
        <div style={{ display: "grid", gap: 6, marginBottom: 12 }}>
          {tokeny.map((t) => (
            <div
              key={t.id}
              style={{
                display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
                padding: "8px 12px", borderRadius: 8, border: "1px solid var(--border)",
                background: "var(--panel)", opacity: t.revoked_at ? 0.55 : 1,
              }}
            >
              <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>{t.name}</span>
              <span style={{ fontSize: 11, color: "var(--muted)" }}>{t.scopes.join(", ")}</span>
              <span style={{ fontSize: 11, color: "var(--muted)", marginLeft: "auto" }}>
                {t.revoked_at ? `odvolán ${kdy(t.revoked_at)}` : `naposled použit: ${kdy(t.last_used_at)}`}
              </span>
              {!t.revoked_at && (
                <Tlacitko onClick={() => odvolejToken(t.id)}>Odvolat</Tlacitko>
              )}
            </div>
          ))}
        </div>
      )}

      <div style={nadpis}>Jak zapisovat</div>
      <pre style={kod}>{`curl -X POST ${supabaseUrl}/functions/v1/api-write \\
  -H "Authorization: Bearer jobi_…" \\
  -H "Content-Type: application/json" \\
  -H "Idempotency-Key: $(uuidgen)" \\
  -d '{"products":[{"sku":"BAT-6S","stock":4,"price":590}]}'`}</pre>
      <p style={{ ...popis, marginTop: 10 }}>
        Produkt se adresuje přes <code>id</code> nebo <code>sku</code>, oprava jen přes{" "}
        <code>id</code> – název opravy není jedinečný. Hlavička <code>Idempotency-Key</code> je
        volitelná, ale doporučená: když se požadavek při výpadku sítě odešle dvakrát,
        podruhé se jen vrátí uložená odpověď a nic se neprovede znovu.
      </p>
      <p style={popis}>
        Limit je 30 zápisů za minutu na token; při překročení přijde 429. Odvolání
        platí okamžitě a nedá se vzít zpět – odvolané tokeny zůstávají v seznamu,
        ať je dohledatelné, co se kdy dělo.
      </p>
    </div>
  );
}

function Znacka({ aktivni, popisek }: { aktivni: boolean; popisek: string }) {
  return (
    <span
      style={{
        display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12,
        padding: "4px 10px", borderRadius: 999,
        border: `1px solid ${aktivni ? "rgba(70,200,138,0.4)" : "var(--border)"}`,
        color: aktivni ? "var(--accent)" : "var(--muted)",
        background: "var(--panel-2)",
      }}
    >
      <span style={{ fontWeight: 700 }}>{aktivni ? "✓" : "○"}</span>
      {popisek}
    </span>
  );
}

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
