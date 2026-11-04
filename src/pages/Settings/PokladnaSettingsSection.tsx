import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Button, Card, Input, SettingRow, SettingRows, useSavedHint } from "../../components/ui";
import { nactiServiceConfig, mergeServiceConfig, subscribeServiceConfig } from "../../lib/serviceSettingsSync";
import { useConfigNacteno } from "./useConfigNacteno";
import { useBranches } from "../../context/BranchContext";
import { useStatuses } from "../../state/StatusesStore";
import { showToast } from "../../components/Toast";
import { ctiCastku, nactiPokladny, normalizujNastaveniPokladny, ulozPokladnu, vychoziStavVydani, type NastaveniPokladny, type Pokladna } from "../../lib/pokladna";
import { formatCurrency } from "../../lib/invoiceMath";

/** Stejná hlavička karty jako v Settings.tsx (tam je jen lokální). */
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

const dnesIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/**
 * Nastavení → Firma → Pokladna: zapnutí modulu, pokladny a volby.
 *
 * Při prvním zapnutí se založí pokladna na každou pobočku (nebo jedna, když
 * servis pobočky nemá) a uloží se datum spuštění – starší vydané zakázky se
 * pak na Dnes nehlásí jako nezaplacené.
 */
export function PokladnaSettingsSection({ activeServiceId }: { activeServiceId: string | null }) {
  const [volby, setVolby] = useState<NastaveniPokladny>(() => normalizujNastaveniPokladny(undefined));
  const [pokladny, setPokladny] = useState<Pokladna[]>([]);
  const [pracuji, setPracuji] = useState(false);
  const { nacteno, oznacNacteno } = useConfigNacteno(activeServiceId);
  const { branches, isMulti } = useBranches();
  const { statuses } = useStatuses();
  const hint = useSavedHint();

  const nactiSeznam = useCallback(async () => {
    if (!activeServiceId) return;
    try {
      setPokladny(await nactiPokladny(activeServiceId));
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Pokladny se nepodařilo načíst.", "error");
    }
  }, [activeServiceId]);

  useEffect(() => {
    if (!activeServiceId) return;
    let zruseno = false;
    nactiServiceConfig(activeServiceId).then((r) => {
      if (zruseno || r.stav === "chyba") return;
      setVolby(normalizujNastaveniPokladny(r.stav === "ok" ? r.config : undefined));
      oznacNacteno();
    });
    void nactiSeznam();
    const unsubscribe = subscribeServiceConfig(activeServiceId, (config) => setVolby(normalizujNastaveniPokladny(config)), "pokladna-nastaveni");
    return () => { zruseno = true; unsubscribe(); };
  }, [activeServiceId, oznacNacteno, nactiSeznam]);

  const ulozPatch = useCallback(async (patch: Record<string, unknown>) => {
    if (!nacteno || !activeServiceId) return false;
    try {
      const r = await mergeServiceConfig(activeServiceId, patch);
      if (r.error) throw new Error(r.error);
      window.dispatchEvent(new CustomEvent("jobsheet:ui-updated"));
      hint.show();
      return true;
    } catch (e) {
      console.error("[Pokladna] uložení selhalo", e);
      showToast("Nastavení se nepodařilo uložit", "error");
      return false;
    }
  }, [activeServiceId, nacteno, hint]);

  const zapnout = async (hodnota: boolean) => {
    if (!activeServiceId || pracuji) return;
    setPracuji(true);
    try {
      // Bez pokladny by zapnutý modul nebyl k ničemu – první zapnutí je založí.
      if (hodnota && pokladny.filter((p) => !p.archivovana).length === 0) {
        const kde = isMulti && branches.length > 0 ? branches.map((b) => ({ branchId: b.id as string | null, nazev: b.name })) : [{ branchId: null, nazev: "Pokladna" }];
        for (const k of kde) await ulozPokladnu({ id: null, serviceId: activeServiceId, nazev: k.nazev, branchId: k.branchId, pocatecniStav: 0 });
        await nactiSeznam();
      }
      const ok = await ulozPatch({ pokladna: hodnota, ...(hodnota && !volby.od ? { pokladna_od: dnesIso() } : {}) });
      if (ok) setVolby((v) => ({ ...v, zapnuto: hodnota }));
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Pokladnu se nepodařilo zapnout.", "error");
    } finally {
      setPracuji(false);
    }
  };

  const ulozRadek = async (p: Pokladna, zmena: Partial<Pokladna>) => {
    if (!activeServiceId) return;
    const nova = { ...p, ...zmena };
    try {
      await ulozPokladnu({ id: p.id, serviceId: activeServiceId, nazev: nova.nazev, branchId: nova.branchId, pocatecniStav: nova.pocatecniStav, poradi: nova.poradi, archivovat: nova.archivovana });
      hint.show();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Pokladnu se nepodařilo uložit.", "error");
    }
    await nactiSeznam();
  };

  const pridat = async () => {
    if (!activeServiceId) return;
    try {
      await ulozPokladnu({ id: null, serviceId: activeServiceId, nazev: `Pokladna ${pokladny.length + 1}`, branchId: isMulti ? (branches[0]?.id ?? null) : null, pocatecniStav: 0 });
      await nactiSeznam();
      hint.show();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Pokladnu se nepodařilo přidat.", "error");
    }
  };

  const koncove = statuses.filter((s) => s.isFinal);
  const auto = vychoziStavVydani(statuses);
  const autoText = auto ? `Automaticky (${statuses.find((s) => s.key === auto)?.label ?? auto})` : "Automaticky";

  return (
    <Card data-config-nacteno={nacteno ? "1" : "0"}>
      <CardHeader
        title="Pokladna"
        description="Hotovost a platby na jednom místě: zakázky připravené k vydání se zaplatí jedním klepnutím, ruční příjmy a výdaje, převody mezi pokladnami a uzávěrka s počítáním bankovek. Pohyby se nemažou – chyba se opraví stornem. Kdo z členů pokladnu vidí, nastavíte v Tým → oprávnění „Pokladna“."
        right={hint.node}
      />
      <SettingRows>
        <SettingRow
          clickable
          label="Pokladna"
          description={pracuji ? "Zakládám pokladny…" : "Přidá stránku Pokladna do navigace. Při prvním zapnutí se založí pokladna pro každou pobočku."}
          control={<input type="checkbox" checked={pracuji ? true : volby.zapnuto} disabled={!nacteno || pracuji} aria-label="Zapnout pokladnu" onChange={(e) => void zapnout(e.target.checked)} />}
        />
        {volby.zapnuto && (
          <>
            <SettingRow
              label="Po zaplacení zakázky"
              description="Na jaký stav se zakázka přepne, když ji v pokladně označíte jako zaplacenou. Proběhne všechno jako při běžném vydání (sklad, tisk, automatizace)."
              control={
                <select
                  className="ui-input"
                  aria-label="Stav po zaplacení"
                  value={volby.stavPoPlatbe ?? "__auto"}
                  disabled={!nacteno}
                  style={{ width: "auto", maxWidth: 260 }}
                  onChange={(e) => {
                    const v = e.target.value === "__auto" ? null : e.target.value;
                    setVolby({ ...volby, stavPoPlatbe: v });
                    void ulozPatch({ pokladna_stav_po_platbe: v });
                  }}
                >
                  <option value="__auto">{autoText}</option>
                  {koncove.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                  <option value="">Neměnit stav</option>
                </select>
              }
            />
            <SettingRow
              clickable
              label="Hotovost zaokrouhlovat na celé koruny"
              description="1 249,50 Kč se zaplatí jako 1 250 Kč, rozdíl se v pokladně zapíše jako zaokrouhlení. Kartou se platí přesně."
              control={<input type="checkbox" checked={volby.zaokrouhlovat} disabled={!nacteno} aria-label="Zaokrouhlovat hotovost" onChange={(e) => { setVolby({ ...volby, zaokrouhlovat: e.target.checked }); void ulozPatch({ pokladna_zaokrouhlovat: e.target.checked }); }} />}
            />
            <SettingRow
              clickable
              label="Upozornění na stránce Dnes"
              description={`Vydané zakázky bez zaznamenané platby${volby.od ? ` (od ${new Date(`${volby.od}T12:00:00`).toLocaleDateString("cs-CZ")})` : ""} a pokladna, ve které chybí uzávěrka z minulého dne.`}
              control={<input type="checkbox" checked={volby.upozorneni} disabled={!nacteno} aria-label="Upozornění na Dnes" onChange={(e) => { setVolby({ ...volby, upozorneni: e.target.checked }); void ulozPatch({ pokladna_upozorneni: e.target.checked }); }} />}
            />
          </>
        )}
      </SettingRows>

      {volby.zapnuto && (
        <div style={{ display: "grid", gap: 8, marginTop: "var(--space-4)" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", color: "var(--muted)" }}>Pokladny</div>
            <Button size="sm" variant="soft" onClick={() => void pridat()}>+ Přidat pokladnu</Button>
          </div>
          {pokladny.length === 0 && <div style={{ color: "var(--muted)", fontSize: 13 }}>Zatím žádná pokladna.</div>}
          {pokladny.map((p) => (
            <div key={p.id} style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", opacity: p.archivovana ? 0.55 : 1 }}>
              <span style={{ flex: "2 1 160px", minWidth: 0 }}><Input key={`${p.id}-n-${p.nazev}`} defaultValue={p.nazev} aria-label="Název pokladny" maxLength={60} onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== p.nazev) void ulozRadek(p, { nazev: v }); }} /></span>
              {isMulti && (
                <select className="ui-input" style={{ flex: "1 1 140px", minWidth: 0, width: "auto" }} aria-label="Pobočka pokladny" value={p.branchId ?? ""} onChange={(e) => void ulozRadek(p, { branchId: e.target.value || null })}>
                  <option value="">Celý servis</option>
                  {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              )}
              <span style={{ flex: "1 1 120px", minWidth: 0 }}><Input
                key={`${p.id}-s-${p.pocatecniStav}`}
                defaultValue={p.pocatecniStav ? String(p.pocatecniStav).replace(".", ",") : ""}
                placeholder="Počáteční stav"
                aria-label="Počáteční stav"
                title={`Kolik v pokladně bylo při spuštění (${formatCurrency(p.pocatecniStav)}). Po prvním pohybu už změnit nejde – použijte vklad nebo výběr.`}
                inputMode="decimal"
                onBlur={(e) => {
                  const v = e.target.value.trim() ? ctiCastku(e.target.value) : 0;
                  if (v === null) { e.target.value = String(p.pocatecniStav); return; }
                  if (v !== p.pocatecniStav) void ulozRadek(p, { pocatecniStav: v });
                }}
              /></span>
              <Button size="sm" variant="ghost" onClick={() => void ulozRadek(p, { archivovana: !p.archivovana })}>
                {p.archivovana ? "Obnovit" : "Archivovat"}
              </Button>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
