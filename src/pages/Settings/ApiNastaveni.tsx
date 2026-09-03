import { useCallback, useEffect, useState } from "react";
import { supabase, supabaseUrl } from "../../lib/supabaseClient";
import { useEntitlements } from "../../hooks/useEntitlements";
import { showToast } from "../../components/Toast";

type Rezim = "hidden" | "boolean" | "exact";

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
        .select("public_slug, inventory_availability_mode")
        .eq("id", activeServiceId)
        .maybeSingle();
      if (zruseno) return;
      const d = data as { public_slug?: string | null; inventory_availability_mode?: Rezim } | null;
      setSlug(d?.public_slug ?? null);
      setRezim(d?.inventory_availability_mode ?? "boolean");
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

      <div style={nadpis}>Zápis</div>
      <p style={popis}>
        Čtení je veřejné, zápis bude vyžadovat token. Ten se zatím nedá vytvořit –
        připravuje se.
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
