import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabaseClient";
import { useServiceVat, VYCHOZI_DPH } from "../../hooks/useServiceVat";
import { Card, FieldLabel } from "../../lib/settingsUi";
import { Input, SettingRow, SettingRows, UnsavedBar } from "../../components/ui";
import { showToast } from "../../components/Toast";
import { useRegisterUnsaved } from "./hooks/useUnsavedGuard";

/**
 * Nastavení DPH pro servis (sekce Fakturace a DPH).
 *
 * Ukládá se do tabulky services, ne do companyData v localStorage –
 * potřebuje to znát i dokument a veřejné API, ne jen tenhle prohlížeč.
 * Zápis je omezený sloupcovým GRANTem (migrace 20260902240000), takže
 * odsud nejde přepsat nic jiného než tyhle hodnoty.
 *
 * Ukládání: jedna lišta „Neuložené změny“ místo tlačítka pod formulářem
 * (stejné pravidlo jako u ostatních vícepolních formulářů v Nastavení).
 */
type Draft = { platce: boolean; sazba: string; cenySDph: boolean; slug: string };

const stejne = (a: Draft, b: Draft) =>
  a.platce === b.platce && a.sazba.trim() === b.sazba.trim() && a.cenySDph === b.cenySDph && a.slug.trim() === b.slug.trim();

export function DphNastaveni({ activeServiceId }: { activeServiceId: string | null }) {
  const ulozene = useServiceVat(activeServiceId);
  const [slugUlozeny, setSlugUlozeny] = useState("");
  const [draft, setDraft] = useState<Draft>({
    platce: VYCHOZI_DPH.vatPayer, sazba: String(VYCHOZI_DPH.defaultVatRate), cenySDph: VYCHOZI_DPH.pricesIncludeVat, slug: "",
  });
  const [snapshot, setSnapshot] = useState<Draft>(draft);
  const [uklada, setUklada] = useState(false);

  useEffect(() => {
    if (!activeServiceId || !supabase) return;
    let zruseno = false;
    (async () => {
      const { data } = await supabase.from("services").select("public_slug").eq("id", activeServiceId).maybeSingle();
      if (!zruseno) setSlugUlozeny(((data as { public_slug?: string } | null)?.public_slug) ?? "");
    })();
    return () => { zruseno = true; };
  }, [activeServiceId]);

  // Načtené hodnoty = nový výchozí stav i snímek pro porovnání.
  useEffect(() => {
    if (ulozene.loading) return;
    const nacteno: Draft = {
      platce: ulozene.vatPayer,
      sazba: String(ulozene.defaultVatRate),
      cenySDph: ulozene.pricesIncludeVat,
      slug: slugUlozeny,
    };
    setDraft(nacteno);
    setSnapshot(nacteno);
  }, [ulozene.loading, ulozene.vatPayer, ulozene.defaultVatRate, ulozene.pricesIncludeVat, slugUlozeny]);

  const dirty = useMemo(() => !stejne(draft, snapshot), [draft, snapshot]);

  const uloz = async () => {
    if (!activeServiceId || !supabase) return;
    const cislo = Number(String(draft.sazba).replace(",", "."));
    if (!Number.isFinite(cislo) || cislo < 0 || cislo > 100) {
      showToast("Sazba DPH musí být mezi 0 a 100.", "error");
      throw new Error("Sazba DPH musí být mezi 0 a 100.");
    }
    const adresa = draft.slug.trim().toLowerCase();
    // Stejné omezení má i CHECK constraint – ať se chyba ukáže tady,
    // ne až jako hláška z databáze.
    if (adresa && !/^[a-z0-9]([a-z0-9-]{1,48}[a-z0-9])?$/.test(adresa)) {
      showToast("Adresa smí obsahovat jen malá písmena, číslice a pomlčky (2–50 znaků).", "error");
      throw new Error("Neplatná adresa.");
    }
    setUklada(true);
    const { error } = await supabase
      .from("services")
      .update({
        vat_payer: draft.platce,
        default_vat_rate: cislo,
        prices_include_vat: draft.cenySDph,
        public_slug: adresa || null,
      } as never)
      .eq("id", activeServiceId);
    setUklada(false);
    if (error) {
      showToast(`Uložení selhalo: ${error.message}`, "error");
      throw error;
    }
    const ulozeno: Draft = { ...draft, sazba: String(cislo), slug: adresa };
    setDraft(ulozeno);
    setSnapshot(ulozeno);
    showToast("Nastavení DPH uloženo", "success");
  };

  const zahod = () => setDraft(snapshot);

  useRegisterUnsaved({ dirty, save: uloz, discard: zahod });

  return (
    <>
      <Card>
        <div style={{ fontWeight: 900, fontSize: "var(--text-base)", marginBottom: "var(--space-1)", color: "var(--text)" }}>Fakturace a DPH</div>
        <div style={{ fontSize: "var(--text-sm)", color: "var(--muted)", marginBottom: "var(--space-3)" }}>
          Určuje sazbu u nových položek faktur a co se tiskne na dokumentu.
        </div>

        <SettingRows>
          <SettingRow
            clickable
            label="Jsme plátci DPH"
            description="Když vypnuto, nové položky faktur mají sazbu 0 a na dokumentu se netiskne rekapitulace DPH, jen poznámka „Nejsme plátci DPH“."
            control={
              <input
                type="checkbox"
                checked={draft.platce}
                onChange={(e) => setDraft((d) => ({ ...d, platce: e.target.checked }))}
              />
            }
          />
          {draft.platce && (
            <SettingRow
              label="Výchozí sazba"
              description="V procentech, pro nové položky faktur."
              control={
                <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
                  <Input
                    type="text"
                    inputMode="decimal"
                    value={draft.sazba}
                    onChange={(e) => setDraft((d) => ({ ...d, sazba: e.target.value }))}
                    placeholder="21"
                    style={{ width: 88, textAlign: "right" }}
                  />
                  <span style={{ color: "var(--muted)", fontSize: "var(--text-base)" }}>%</span>
                </div>
              }
            />
          )}
          <SettingRow
            clickable
            label="Ceny v ceníku a skladu zadávám včetně DPH"
            description="Podle toho se dopočítá druhá varianta ceny ve veřejném API."
            control={
              <input
                type="checkbox"
                checked={draft.cenySDph}
                onChange={(e) => setDraft((d) => ({ ...d, cenySDph: e.target.checked }))}
              />
            }
          />
        </SettingRows>

        <div style={{ marginTop: "var(--space-3)", paddingTop: "var(--space-3)", borderTop: "1px solid var(--border)" }}>
          <div style={{ fontWeight: 800, fontSize: "var(--text-base)", color: "var(--text)" }}>Veřejné API</div>
          <FieldLabel>Adresa ve veřejném API</FieldLabel>
          <Input
            type="text"
            value={draft.slug}
            onChange={(e) => setDraft((d) => ({ ...d, slug: e.target.value }))}
            placeholder="nazev-servisu"
            spellCheck={false}
            style={{ maxWidth: 320 }}
          />
          <div style={{ fontSize: "var(--text-sm)", color: "var(--muted)", marginTop: "var(--space-1)" }}>
            Bez vyplnění se ceník ani sklad ven nedostanou, i kdyby byl modul zapnutý.
            Malá písmena, číslice a pomlčky.
          </div>
        </div>
      </Card>
      <UnsavedBar dirty={dirty} saving={uklada} onSave={() => { uloz().catch(() => {}); }} onDiscard={zahod} />
    </>
  );
}
