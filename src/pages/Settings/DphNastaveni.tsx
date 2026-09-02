import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabaseClient";
import { useServiceVat, VYCHOZI_DPH } from "../../hooks/useServiceVat";
import { FieldLabel } from "../../lib/settingsUi";
import { showToast } from "../../components/Toast";

/**
 * Nastavení DPH pro servis.
 *
 * Ukládá se do tabulky services, ne do companyData v localStorage –
 * potřebuje to znát i dokument a veřejné API, ne jen tenhle prohlížeč.
 * Zápis je omezený sloupcovým GRANTem (migrace 20260902240000), takže
 * odsud nejde přepsat nic jiného než tyhle tři hodnoty.
 */
export function DphNastaveni({ activeServiceId }: { activeServiceId: string | null }) {
  const ulozene = useServiceVat(activeServiceId);
  const [slug, setSlug] = useState("");
  const [platce, setPlatce] = useState(VYCHOZI_DPH.vatPayer);
  const [sazba, setSazba] = useState(String(VYCHOZI_DPH.defaultVatRate));
  const [cenySDph, setCenySDph] = useState(VYCHOZI_DPH.pricesIncludeVat);
  const [uklada, setUklada] = useState(false);

  useEffect(() => {
    if (!activeServiceId || !supabase) return;
    let zruseno = false;
    (async () => {
      const { data } = await supabase.from("services").select("public_slug").eq("id", activeServiceId).maybeSingle();
      if (!zruseno) setSlug(((data as { public_slug?: string } | null)?.public_slug) ?? "");
    })();
    return () => { zruseno = true; };
  }, [activeServiceId]);

  useEffect(() => {
    if (ulozene.loading) return;
    setPlatce(ulozene.vatPayer);
    setSazba(String(ulozene.defaultVatRate));
    setCenySDph(ulozene.pricesIncludeVat);
  }, [ulozene.loading, ulozene.vatPayer, ulozene.defaultVatRate, ulozene.pricesIncludeVat]);

  const uloz = async () => {
    if (!activeServiceId || !supabase) return;
    const cislo = Number(String(sazba).replace(",", "."));
    if (!Number.isFinite(cislo) || cislo < 0 || cislo > 100) {
      showToast("Sazba DPH musí být mezi 0 a 100.", "error");
      return;
    }
    const adresa = slug.trim().toLowerCase();
    // Stejné omezení má i CHECK constraint – ať se chyba ukáže tady,
    // ne až jako hláška z databáze.
    if (adresa && !/^[a-z0-9]([a-z0-9-]{1,48}[a-z0-9])?$/.test(adresa)) {
      showToast("Adresa smí obsahovat jen malá písmena, číslice a pomlčky (2–50 znaků).", "error");
      return;
    }
    setUklada(true);
    const { error } = await supabase
      .from("services")
      .update({
        vat_payer: platce,
        default_vat_rate: cislo,
        prices_include_vat: cenySDph,
        public_slug: adresa || null,
      } as never)
      .eq("id", activeServiceId);
    setUklada(false);
    showToast(error ? `Uložení selhalo: ${error.message}` : "Nastavení DPH uloženo", error ? "error" : "success");
  };

  const radek: React.CSSProperties = {
    display: "flex", gap: 12, alignItems: "flex-start",
    padding: "8px 0", cursor: "pointer",
  };

  return (
    <div style={{ marginTop: 20, paddingTop: 16, borderTop: "1px solid var(--border)" }}>
      <div style={{ fontWeight: 950, fontSize: 14, marginBottom: 4, color: "var(--text)" }}>DPH a veřejné API</div>
      <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 12 }}>
        Určuje sazbu u nových položek faktur a co se tiskne na dokumentu.
      </div>

      <label style={radek}>
        <input
          type="checkbox"
          checked={platce}
          onChange={(e) => setPlatce(e.target.checked)}
          style={{ marginTop: 3, width: 15, height: 15, accentColor: "var(--accent)" }}
        />
        <span>
          <span style={{ color: "var(--text)", fontWeight: 600 }}>Jsme plátci DPH</span>
          <span style={{ display: "block", fontSize: 12, color: "var(--muted)" }}>
            Když vypnuto, nové položky faktur mají sazbu 0 a na dokumentu se
            netiskne rekapitulace DPH, jen poznámka „Nejsme plátci DPH“.
          </span>
        </span>
      </label>

      {platce && (
        <div style={{ maxWidth: 200, marginTop: 8 }}>
          <FieldLabel>Výchozí sazba (%)</FieldLabel>
          <input
            type="text"
            inputMode="decimal"
            value={sazba}
            onChange={(e) => setSazba(e.target.value)}
            placeholder="21"
            style={{
              width: "100%", padding: "10px 12px", borderRadius: 10,
              border: "1px solid var(--border)", background: "var(--panel)",
              color: "var(--text)", fontFamily: "inherit", fontSize: 14,
            }}
          />
        </div>
      )}

      <label style={{ ...radek, marginTop: 8 }}>
        <input
          type="checkbox"
          checked={cenySDph}
          onChange={(e) => setCenySDph(e.target.checked)}
          style={{ marginTop: 3, width: 15, height: 15, accentColor: "var(--accent)" }}
        />
        <span>
          <span style={{ color: "var(--text)", fontWeight: 600 }}>Ceny v ceníku a skladu zadávám včetně DPH</span>
          <span style={{ display: "block", fontSize: 12, color: "var(--muted)" }}>
            Podle toho se dopočítá druhá varianta ceny ve veřejném API.
          </span>
        </span>
      </label>

      <div style={{ marginTop: 12 }}>
        <FieldLabel>Adresa ve veřejném API</FieldLabel>
        <input
          type="text"
          value={slug}
          onChange={(e) => setSlug(e.target.value)}
          placeholder="nazev-servisu"
          spellCheck={false}
          style={{
            width: "100%", maxWidth: 320, padding: "10px 12px", borderRadius: 10,
            border: "1px solid var(--border)", background: "var(--panel)",
            color: "var(--text)", fontFamily: "inherit", fontSize: 14,
          }}
        />
        <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>
          Bez vyplnění se ceník ani sklad ven nedostanou, i kdyby byl modul zapnutý.
          Malá písmena, číslice a pomlčky.
        </div>
      </div>

      <button
        type="button"
        onClick={uloz}
        disabled={uklada || !activeServiceId}
        style={{
          marginTop: 14, padding: "10px 18px", borderRadius: 10, border: "none",
          background: "var(--accent)", color: "#fff", fontWeight: 700,
          fontFamily: "inherit", fontSize: 14,
          cursor: uklada ? "not-allowed" : "pointer", opacity: uklada ? 0.6 : 1,
        }}
      >
        {uklada ? "Ukládám…" : "Uložit"}
      </button>
    </div>
  );
}
