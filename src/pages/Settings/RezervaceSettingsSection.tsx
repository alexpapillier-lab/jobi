import { useCallback, useEffect, useState } from "react";
import { Card, Button } from "../../components/ui";
import { showToast } from "../../components/Toast";
import { supabase, supabaseUrl } from "../../lib/supabaseClient";
import { useEntitlements } from "../../hooks/useEntitlements";
import { nactiServiceConfig, mergeServiceConfig } from "../../lib/serviceSettingsSync";
import { VYCHOZI_NASTAVENI_REZERVACI, nastaveniRezervaciZConfigu, type NastaveniRezervaci } from "../../lib/rezervace";

/**
 * Nastavení → Zakázky → Online rezervace.
 *
 * Formulář na web servisu je součástí každého tarifu – přivádí zákazníky
 * a nestojí nic. Výběr opravy z ceníku s předběžnou cenou potřebuje modul
 * veřejného API (ceník jde ven přes něj); bez něj formulář funguje s volným
 * textem. Adresa servisu (slug) je společná s veřejným API.
 */
const SKRIPT = `${supabaseUrl}/functions/v1/public-booking/embed.js`;
const DNY = ["Po", "Út", "St", "Čt", "Pá", "So", "Ne"];

export function RezervaceSettingsSection({ activeServiceId }: { activeServiceId: string | null }) {
  const { has } = useEntitlements(activeServiceId);
  const maCenik = has("api_catalog");
  const [nastaveni, setNastaveni] = useState<NastaveniRezervaci>(VYCHOZI_NASTAVENI_REZERVACI);
  const [slug, setSlug] = useState("");
  const [slugUlozeny, setSlugUlozeny] = useState("");
  const [nacitam, setNacitam] = useState(true);
  const [chybaNacteni, setChybaNacteni] = useState(false);

  useEffect(() => {
    if (!activeServiceId || !supabase) {
      setNacitam(false);
      return;
    }
    let zruseno = false;
    void (async () => {
      const [nactene, sluzba] = await Promise.all([
        nactiServiceConfig(activeServiceId),
        (supabase!.from("services") as never as { select: (c: string) => { eq: (a: string, b: string) => { maybeSingle: () => Promise<{ data: { public_slug?: string | null } | null }> } } })
          .select("public_slug").eq("id", activeServiceId).maybeSingle(),
      ]);
      if (zruseno) return;
      if (nactene.stav === "chyba") {
        // Bez načteného nastavení by se uložila výchozí otevírací doba
        // a smazal ručně psaný úvodní text.
        setChybaNacteni(true);
        setNacitam(false);
        return;
      }
      setChybaNacteni(false);
      setNastaveni(nastaveniRezervaciZConfigu(nactene.stav === "ok" ? (nactene.config as any)?.rezervace : undefined));
      const s = sluzba?.data?.public_slug ?? "";
      setSlug(s);
      setSlugUlozeny(s);
      setNacitam(false);
    })();
    return () => { zruseno = true; };
  }, [activeServiceId]);

  const uloz = useCallback(async (next: NastaveniRezervaci) => {
    setNastaveni(next);
    if (!activeServiceId) return;
    try {
      // Chyba se vrací, nevyhazuje – `catch` sám by ji minul.
      const r = await mergeServiceConfig(activeServiceId, { rezervace: next });
      if (r.error) throw new Error(r.error);
    } catch (e) {
      console.error("[Rezervace] uložení selhalo", e);
      showToast("Nastavení se nepodařilo uložit", "error");
    }
  }, [activeServiceId]);

  const ulozSlug = useCallback(async () => {
    if (!activeServiceId || !supabase) return;
    const adresa = slug.trim().toLowerCase();
    if (adresa && !/^[a-z0-9]([a-z0-9-]{1,48}[a-z0-9])?$/.test(adresa)) {
      showToast("Adresa smí obsahovat jen malá písmena, číslice a pomlčky (2–50 znaků).", "error");
      return;
    }
    const { error } = await (supabase.from("services") as never as { update: (v: unknown) => { eq: (a: string, b: string) => Promise<{ error: unknown }> } })
      .update({ public_slug: adresa || null }).eq("id", activeServiceId);
    if (error) {
      showToast("Adresu se nepodařilo uložit – nejspíš ji už používá jiný servis.", "error");
      return;
    }
    setSlug(adresa);
    setSlugUlozeny(adresa);
    showToast("Adresa uložena", "success");
  }, [activeServiceId, slug]);

  const zkopiruj = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      showToast("Zkopírováno", "success");
    } catch {
      showToast("Kopírování se nepodařilo, označte text ručně.", "error");
    }
  };

  if (nacitam) return <div style={{ color: "var(--muted)" }}>Načítám…</div>;
  if (chybaNacteni) {
    return (
      <div style={{ color: "var(--danger, #dc2626)" }}>
        Nastavení rezervací se nepodařilo načíst. Zkuste to za chvíli – měnit ho teď nejde, uložila by se výchozí otevírací doba.
      </div>
    );
  }

  const input: React.CSSProperties = { padding: "8px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--panel)", color: "var(--text)", fontSize: 13, fontFamily: "inherit" };
  const popis: React.CSSProperties = { fontSize: 13, color: "var(--muted)", lineHeight: 1.6, margin: "0 0 10px" };
  const kod = `<div id="jobi-rezervace"></div>\n<script src="${SKRIPT}?service=${slugUlozeny || "vase-adresa"}"></script>`;

  return (
    <Card>
      <div style={{ fontWeight: 800, fontSize: 15 }}>Online rezervace</div>
      <p style={{ ...popis, marginTop: 4 }}>
        Formulář na váš web: zákazník napíše, co má za zařízení, co je potřeba opravit a kdy chce přijít.
        Rezervace přistane v <strong style={{ color: "var(--text)" }}>Kalendáři</strong>, kde ji potvrdíte
        nebo z ní jedním kliknutím založíte zakázku. Na e-mail firmy přijde upozornění, zákazník dostane potvrzení.
      </p>

      <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, marginBottom: 12, cursor: "pointer" }}>
        <input type="checkbox" checked={nastaveni.zapnuto} onChange={(e) => void uloz({ ...nastaveni, zapnuto: e.target.checked })} />
        Přijímat rezervace z webu
      </label>

      {nastaveni.zapnuto && (
        <div style={{ display: "grid", gap: 12 }}>
          <label style={{ display: "grid", gap: 4, fontSize: 13 }}>
            <span style={{ color: "var(--muted)" }}>Adresa servisu ve formuláři (stejná jako u veřejného API)</span>
            <span style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <input type="text" value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="nazev-servisu" style={{ ...input, minWidth: 220 }} />
              <Button size="sm" variant="soft" onClick={() => void ulozSlug()} disabled={slug.trim().toLowerCase() === slugUlozeny}>Uložit adresu</Button>
            </span>
          </label>
          {!slugUlozeny && <div role="alert" style={{ fontSize: 13, color: "#dc2626" }}>Bez adresy formulář nebude fungovat – vyplňte ji a uložte.</div>}

          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", fontSize: 13 }}>
            <span style={{ color: "var(--muted)" }}>Otevřeno:</span>
            {DNY.map((d, i) => {
              const den = i + 1;
              const aktivni = nastaveni.dny.includes(den);
              return (
                <button
                  key={d}
                  type="button"
                  aria-pressed={aktivni}
                  onClick={() => void uloz({ ...nastaveni, dny: aktivni ? nastaveni.dny.filter((x) => x !== den) : [...nastaveni.dny, den].sort() })}
                  style={{ padding: "4px 10px", borderRadius: 999, border: `1px solid ${aktivni ? "var(--accent)" : "var(--border)"}`, background: aktivni ? "var(--accent-soft)" : "transparent", color: aktivni ? "var(--accent)" : "var(--muted)", fontWeight: 700, fontSize: 12, cursor: "pointer" }}
                >
                  {d}
                </button>
              );
            })}
          </div>

          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center", fontSize: 13 }}>
            <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
              {/* Ukládá se až po opuštění pole: při psaní času odchází několik
                  zápisů za sebou a vyhrát může starší mezistav (např. „0:30“). */}
              Od <input type="time" value={nastaveni.od} onChange={(e) => setNastaveni({ ...nastaveni, od: e.target.value || nastaveni.od })} onBlur={() => void uloz(nastaveni)} style={input} />
            </label>
            <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
              Do <input type="time" value={nastaveni.do} onChange={(e) => setNastaveni({ ...nastaveni, do: e.target.value || nastaveni.do })} onBlur={() => void uloz(nastaveni)} style={input} />
            </label>
            <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
              Krok
              <select value={nastaveni.krokMin} onChange={(e) => void uloz({ ...nastaveni, krokMin: Number(e.target.value) })} style={input}>
                {[15, 30, 60].map((k) => <option key={k} value={k}>{k} min</option>)}
              </select>
            </label>
          </div>

          <label style={{ display: "grid", gap: 4, fontSize: 13 }}>
            <span style={{ color: "var(--muted)" }}>Text nad formulářem (nepovinné)</span>
            <input
              type="text"
              defaultValue={nastaveni.uvod}
              onBlur={(e) => { if (e.target.value !== nastaveni.uvod) void uloz({ ...nastaveni, uvod: e.target.value.slice(0, 400) }); }}
              placeholder="např. Rezervace je nezávazná, ozveme se s potvrzením."
              style={input}
            />
          </label>

          <div>
            <div style={{ ...popis, marginBottom: 6 }}>Tohle vložte na svůj web tam, kde má formulář být:</div>
            <code style={{ display: "block", padding: 10, borderRadius: 8, background: "var(--panel-2)", fontSize: 12, whiteSpace: "pre-wrap", wordBreak: "break-all" }}>{kod}</code>
            <div style={{ marginTop: 8 }}>
              <Button size="sm" variant="soft" onClick={() => void zkopiruj(kod)}>Kopírovat kód</Button>
            </div>
          </div>

          <p style={popis}>
            {maCenik
              ? "Formulář nabídne model a opravu z vašeho ceníku i s předběžnou cenou a délkou opravy."
              : "Zákazník popíše závadu vlastními slovy. Výběr opravy z ceníku s cenou a délkou opravy přidá modul veřejného API (Nastavení → Firma → API)."}
            {" "}Ochrana proti robotům a limit 10 rezervací za hodinu z jedné adresy jsou součástí.
          </p>
        </div>
      )}
    </Card>
  );
}
