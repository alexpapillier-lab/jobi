/**
 * Karta „Zařízení“ v okně Nová zakázka: sbalitelné karty zařízení, opravy
 * z ceníku i mimo ceník, sleva při příjmu, termín, záruka a Find My, další
 * údaje zařízení (IMEI, heslo, stav, převzetí, cena, poznámka).
 *
 * Vyneseno z Orders.tsx beze změny obsahu; stav konceptu drží kontejner.
 */
import type React from "react";
import { Button } from "../../components/ui";
import { SectionHeading } from "../../components/SectionHeading";
import { DateTimePicker } from "../../components/DateTimePicker";
import { CheckIcon, ChevronDownIcon, DeviceIcon, PlusIcon, XIcon } from "../../components/icons";
import { DeviceAutocomplete, HandoffMethodSelect, SlevaNovaZakazka } from "../../components/orders";
import { formatCZ } from "../../components/tickets";
import { getHandoffOptions } from "../../lib/handoffOptions";
import { otevriVProhlizeci } from "../../lib/platform";
import { formatCurrency } from "../../lib/invoiceMath";
import { castkaSlevy, konecnaCena } from "../../lib/slevaZakazky";
import { poRucniCene, poZmeneSlevy, soucetOprav, zakladCeny } from "../../lib/cenaPriPrijmu";
import { najdiPravidlo, type PravidloOdmeny } from "../../lib/odmeny";
import type { PrednastavenaSleva } from "../../lib/prednastaveneSlevy";
import { BARVA_SEKCE, stylSekce } from "../../lib/sekceDetailu";
import { chybiPodkladZaruky, jeAppleZarizeni, najdiStejneZarizeni, odkazKontrolaImei, stavSerioveho } from "../../lib/zarizeniHistorie";
import type { DeviceRepair } from "../../lib/catalogStorage";
import type { ModelWithHierarchy, NewOrderDraft, TicketEx } from "./typy";
import { defaultDeviceRow } from "./koncept";
import { border, card, fieldLabel, fieldHint, fieldMuted, subHeading, baseFieldInput, baseFieldTextArea } from "./styly";

type Props = {
  newDraft: NewOrderDraft;
  setNewDraft: React.Dispatch<React.SetStateAction<NewOrderDraft>>;
  /** Které zařízení je rozbalené (ostatní jsou sbalené karty). */
  expandedDeviceIdx: number;
  setExpandedDeviceIdx: React.Dispatch<React.SetStateAction<number>>;
  errors: Record<string, string>;
  showError: (field: string) => boolean;
  showDeviceError: (idx: number) => boolean;
  isNarrow: boolean;
  modelsWithHierarchy: ModelWithHierarchy[];
  repairsForDeviceLabel: (label: string | undefined | null) => DeviceRepair[];
  /** Rozepsaná oprava mimo ceník (index zařízení → název a cena). */
  dalsiOprava: Record<number, { name: string; price: string }>;
  setDalsiOprava: React.Dispatch<React.SetStateAction<Record<number, { name: string; price: string }>>>;
  addManualPlannedRepair: (idx: number, nazev: string, cenaText: string) => boolean;
  /** Rozbalený úplný seznam oprav z ceníku u zařízení (index → true). */
  catalogShowAll: Record<number, boolean>;
  setCatalogShowAll: React.Dispatch<React.SetStateAction<Record<number, boolean>>>;
  togglePlannedRepair: (idx: number, repair: DeviceRepair) => void;
  removePlannedRepair: (idx: number, id: string) => void;
  nastavPlannedNabidnuto: (idx: number, id: string, nabidnuto: boolean) => void;
  pravidlaOdmen: PravidloOdmeny[];
  prednastaveneSlevy: PrednastavenaSleva[];
  newOrderDeviceMoreOpen: boolean;
  setNewOrderDeviceMoreOpen: React.Dispatch<React.SetStateAction<boolean>>;
  /** Všechny zakázky servisu – pro upozornění „zařízení už u vás bylo“. */
  cloudTickets: TicketEx[];
};

export function NovaZakazkaZarizeni({
  newDraft,
  setNewDraft,
  expandedDeviceIdx,
  setExpandedDeviceIdx,
  errors,
  showError,
  showDeviceError,
  isNarrow,
  modelsWithHierarchy,
  repairsForDeviceLabel,
  dalsiOprava,
  setDalsiOprava,
  addManualPlannedRepair,
  catalogShowAll,
  setCatalogShowAll,
  togglePlannedRepair,
  removePlannedRepair,
  nastavPlannedNabidnuto,
  pravidlaOdmen,
  prednastaveneSlevy,
  newOrderDeviceMoreOpen,
  setNewOrderDeviceMoreOpen,
  cloudTickets,
}: Props) {
  return (
    <div data-tour="nova-zarizeni" style={{ ...card, ...stylSekce("zarizeni") }}>
      <SectionHeading icon={<DeviceIcon size={16} />} size="sm" barva={BARVA_SEKCE.zarizeni}>Zařízení</SectionHeading>
      <div style={{ display: "grid", gap: 8 }}>
        {newDraft.devices.map((dev, idx) => {
          const multi = newDraft.devices.length > 1;
          const expanded = !multi || idx === expandedDeviceIdx;
          const summary = [dev.deviceLabel.trim(), dev.requestedRepair.trim().split("\n")[0]].filter(Boolean).join(" · ") || `Zařízení ${idx + 1}`;
          return (
            <div
              key={idx}
              id={`new-order-device-${idx}`}
              style={multi ? { border, borderRadius: "var(--radius-md)", padding: 10, background: expanded ? "var(--panel)" : "var(--panel-2)" } : undefined}
            >
              {multi && (
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <button
                    type="button"
                    onClick={() => setExpandedDeviceIdx(expanded ? -1 : idx)}
                    aria-expanded={expanded}
                    style={{ flex: 1, minWidth: 0, textAlign: "left", background: "none", border: "none", padding: 0, cursor: "pointer", color: "var(--text)", fontWeight: 700, fontSize: 13, display: "flex", alignItems: "center", gap: 8 }}
                  >
                    <span style={{ display: "inline-flex", color: "var(--muted)", transform: expanded ? "rotate(180deg)" : "none", transition: "transform 120ms ease" }}><ChevronDownIcon size={14} /></span>
                    <span style={{ color: "var(--muted)", fontWeight: 600, fontSize: 12, flex: "0 0 auto" }}>{idx + 1}.</span>
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{summary}</span>
                    {!expanded && showDeviceError(idx) && <span style={{ color: "rgba(239,68,68,0.95)", fontSize: 12, fontWeight: 600, flex: "0 0 auto" }}>chybí zařízení</span>}
                  </button>
                  <Button
                    variant="ghost"
                    size="sm"
                    iconOnly
                    icon={<XIcon size={14} />}
                    aria-label="Odebrat zařízení"
                    title="Odebrat zařízení"
                    onClick={() => setNewDraft((p) => ({ ...p, devices: p.devices.filter((_, i) => i !== idx) }))}
                  />
                </div>
              )}
              {expanded && (
                <div style={{ marginTop: multi ? 8 : 0 }}>
                  <div style={{ ...fieldLabel, marginTop: 0 }}>Zařízení *</div>
                  <DeviceAutocomplete
                    value={dev.deviceLabel}
                    onChange={(value) =>
                      setNewDraft((p) => ({
                        ...p,
                        devices: p.devices.map((d, i) => (i === idx ? { ...d, deviceLabel: value } : d)),
                      }))
                    }
                    models={modelsWithHierarchy}
                    error={showDeviceError(idx)}
                  />
                  {showDeviceError(idx) && <div style={fieldHint}>{errors[`deviceLabel_${idx}`]}</div>}

                  <div style={{ display: "grid", gridTemplateColumns: isNarrow ? "1fr" : "1fr 260px", gap: 10 }}>
                    <div data-tour="nova-pozadovana-oprava">
                      <div style={fieldLabel}>Požadovaná oprava</div>
                      <textarea
                        value={dev.requestedRepair}
                        onChange={(e) =>
                          setNewDraft((p) => ({
                            ...p,
                            devices: p.devices.map((d, i) => (i === idx ? { ...d, requestedRepair: e.target.value } : d)),
                          }))
                        }
                        style={{ ...baseFieldTextArea, minHeight: 64 }}
                        placeholder="Výměna displeje, výměna baterie, diagnostika"
                      />
                      {(() => {
                        const catalog = repairsForDeviceLabel(dev.deviceLabel);
                        const planned = dev.plannedRepairs ?? [];
                        const mimoCenik = planned.filter((r) => r.type !== "selected");
                        const rozepsana = dalsiOprava[idx] ?? { name: "", price: "" };
                        const pridejDalsi = () => {
                          if (addManualPlannedRepair(idx, rozepsana.name, rozepsana.price || "0")) setDalsiOprava((p) => ({ ...p, [idx]: { name: "", price: "" } }));
                        };
                        const plannedIds = new Set(planned.map((r) => r.repairId));
                        const sorted = [...catalog].sort((a, b) => a.name.localeCompare(b.name, "cs"));
                        const showAll = !!catalogShowAll[idx];
                        const visible = showAll ? sorted : sorted.slice(0, 8);
                        const sum = planned.reduce((a, r) => a + (r.price || 0), 0);
                        return (
                          <div style={{ marginTop: 8, display: "grid", gap: 6 }}>
                            {catalog.length > 0 && (
                            <>
                            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", color: "var(--muted)" }}>
                              Z ceníku
                            </div>
                            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                              {visible.map((r) => {
                                const on = plannedIds.has(r.id);
                                return (
                                  <button
                                    key={r.id}
                                    type="button"
                                    aria-pressed={on}
                                    onClick={() => togglePlannedRepair(idx, r)}
                                    title={on ? "Odebrat z požadované opravy" : "Přidat do požadované opravy"}
                                    style={{
                                      display: "inline-flex",
                                      alignItems: "center",
                                      gap: 6,
                                      padding: "5px 10px",
                                      borderRadius: 999,
                                      border: `1px solid ${on ? "var(--accent)" : "var(--border)"}`,
                                      background: on ? "var(--accent-soft)" : "var(--panel)",
                                      color: on ? "var(--accent)" : "var(--text)",
                                      fontSize: 12,
                                      fontWeight: 600,
                                      cursor: "pointer",
                                    }}
                                  >
                                    {on && <CheckIcon size={12} />}
                                    <span>{r.name}</span>
                                    {r.price > 0 && (
                                      <span style={{ color: on ? "var(--accent)" : "var(--muted)", fontWeight: 500 }}>
                                        {r.price.toLocaleString("cs-CZ")} Kč
                                      </span>
                                    )}
                                  </button>
                                );
                              })}
                              {sorted.length > 8 && (
                                <button
                                  type="button"
                                  onClick={() => setCatalogShowAll((p) => ({ ...p, [idx]: !showAll }))}
                                  style={{ padding: "5px 10px", borderRadius: 999, border: "1px dashed var(--border)", background: "transparent", color: "var(--muted)", fontSize: 12, fontWeight: 600, cursor: "pointer" }}
                                >
                                  {showAll ? "Méně" : `Dalších ${sorted.length - 8}`}
                                </button>
                              )}
                            </div>
                            </>
                            )}
                            {/* Oprava, která v ceníku není: jde do stejného seznamu, takže
                                se počítá do součtu i do slevy. Dřív se psala jen do textu
                                a sleva se na ni musela dopočítat ručně. */}
                            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", color: "var(--muted)", marginTop: catalog.length > 0 ? 4 : 0 }}>
                              Další oprava mimo ceník
                            </div>
                            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                              <input
                                value={rozepsana.name}
                                onChange={(e) => setDalsiOprava((p) => ({ ...p, [idx]: { ...rozepsana, name: e.target.value } }))}
                                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); pridejDalsi(); } }}
                                placeholder="Název opravy"
                                aria-label="Název další opravy"
                                style={{ ...baseFieldInput, flex: "1 1 180px", minWidth: 0, width: "auto" }}
                              />
                              <input
                                value={rozepsana.price}
                                onChange={(e) => setDalsiOprava((p) => ({ ...p, [idx]: { ...rozepsana, price: e.target.value } }))}
                                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); pridejDalsi(); } }}
                                placeholder="Cena Kč"
                                aria-label="Cena další opravy"
                                inputMode="decimal"
                                style={{ ...baseFieldInput, flex: "0 0 110px", width: 110 }}
                              />
                              <Button onClick={pridejDalsi} disabled={!rozepsana.name.trim()} title="Přidat opravu k zakázce">
                                Přidat
                              </Button>
                            </div>
                            {mimoCenik.length > 0 && (
                              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                                {mimoCenik.map((r) => (
                                  <span
                                    key={r.id}
                                    style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "5px 6px 5px 10px", borderRadius: 999, border: "1px solid var(--accent)", background: "var(--accent-soft)", color: "var(--accent)", fontSize: 12, fontWeight: 600 }}
                                  >
                                    <CheckIcon size={12} />
                                    <span>{r.name}</span>
                                    <span style={{ fontWeight: 500 }}>{(r.price || 0).toLocaleString("cs-CZ")} Kč</span>
                                    <button
                                      type="button"
                                      onClick={() => removePlannedRepair(idx, r.id)}
                                      aria-label={`Odebrat opravu ${r.name}`}
                                      title="Odebrat"
                                      style={{ display: "inline-grid", placeItems: "center", width: 18, height: 18, padding: 0, border: "none", borderRadius: 999, background: "transparent", color: "inherit", cursor: "pointer" }}
                                    >
                                      <XIcon size={12} />
                                    </button>
                                  </span>
                                ))}
                              </div>
                            )}
                            {/* Odměny týmu: co se na příjmu nabídlo navíc (ne to, s čím zákazník přišel). */}
                            {planned.some((r) => najdiPravidlo(pravidlaOdmen, r.name)) && (
                              <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 14px", fontSize: 12, color: "var(--muted)" }}>
                                {planned.filter((r) => najdiPravidlo(pravidlaOdmen, r.name)).map((r) => (
                                  <label key={`nab-${r.id}`} style={{ display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer" }} title="Prémie za nabídnutou opravu vzniká jen tehdy, když ji zákazník neměl v požadavku a přijal ji.">
                                    <input type="checkbox" checked={!!r.nabidnuto} onChange={(e) => nastavPlannedNabidnuto(idx, r.id, e.target.checked)} />
                                    <span>Nabídnuto navíc: <b>{r.name}</b></span>
                                  </label>
                                ))}
                              </div>
                            )}
                            {planned.length > 0 && (
                              <div style={{ fontSize: 12, color: "var(--muted)" }}>
                                {planned.length === 1 ? "1 oprava" : planned.length < 5 ? `${planned.length} opravy` : `${planned.length} oprav`}
                                {sum > 0 ? ` · ${sum.toLocaleString("cs-CZ")} Kč` : ""} · přidají se do zakázky s touto cenou, v detailu je upravíte.
                              </div>
                            )}
                          </div>
                        );
                      })()}
                      {/* Sleva už při příjmu – přednastavená z Nastavení nebo vlastní.
                          Dřív se dávala až v detailu, i když ji zákazník dostal
                          domluvenou u pultu. */}
                      {(() => {
                        const typ = dev.discountType ?? null;
                        const hodnota = dev.discountValue ?? 0;
                        const zaklad = zakladCeny(dev, soucetOprav(dev.plannedRepairs));
                        const sleva = castkaSlevy(zaklad, typ, hodnota);
                        return (
                          <div style={{ marginTop: 8, display: "grid", gap: 6 }}>
                            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", color: "var(--muted)" }}>
                              Sleva
                            </div>
                            <SlevaNovaZakazka
                              slevy={prednastaveneSlevy}
                              discountType={typ}
                              discountValue={hodnota}
                              onChange={(type, value) =>
                                setNewDraft((p) => ({
                                  ...p,
                                  // Sleva se propíše i do předschválené ceny (lib/cenaPriPrijmu).
                                  devices: p.devices.map((d, i) => (i === idx ? { ...d, ...poZmeneSlevy(d, soucetOprav(d.plannedRepairs), type, value) } : d)),
                                }))
                              }
                            />
                            {typ && hodnota > 0 && (
                              <div style={{ fontSize: 12, color: "var(--muted)" }}>
                                {zaklad > 0
                                  ? `Sleva −${formatCurrency(sleva)} z ${formatCurrency(zaklad)} · předschválená cena ${formatCurrency(konecnaCena(zaklad, typ, hodnota))}`
                                  : "Sleva se odečte z ceny oprav v zakázce. Zadejte předschválenou cenu nebo vyberte opravy z ceníku a propíše se hned."}
                              </div>
                            )}
                          </div>
                        );
                      })()}
                    </div>
                    <div>
                      <div style={fieldLabel}>Předpokládaný termín dokončení</div>
                      <DateTimePicker
                        value={dev.expectedCompletionAt ?? null}
                        onChange={(v) => {
                          setNewDraft((p) => {
                            if (idx === 0) {
                              return { ...p, devices: p.devices.map((d) => ({ ...d, expectedCompletionAt: v })) };
                            }
                            return {
                              ...p,
                              devices: p.devices.map((d, i) => (i === idx ? { ...d, expectedCompletionAt: v } : d)),
                            };
                          });
                        }}
                        inputStyle={baseFieldInput}
                      />
                      {multi && idx === 0 && <div style={fieldMuted}>Termín prvního zařízení se přenese na ostatní.</div>}
                    </div>
                  </div>

                  {/* Záruka a Find My schválně mimo sbalené „Další údaje“: bez podkladu
                      záruky se oprava u dodavatele neuplatní a se zapnutým Find My se
                      Apple u autorizovaných dílů neopraví – obojí se musí vyřešit se
                      zákazníkem u pultu, ne až u stolu. Find My se ptá jen u Apple. */}
                  <div style={{ marginTop: 10, display: "grid", gap: 6 }}>
                    <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer" }}>
                      <input
                        type="checkbox"
                        checked={dev.warrantyClaim}
                        onChange={(e) =>
                          setNewDraft((p) => ({
                            ...p,
                            devices: p.devices.map((d, i) => (i === idx ? { ...d, warrantyClaim: e.target.checked } : d)),
                          }))
                        }
                      />
                      <span>Záruční oprava</span>
                      <span style={{ color: "var(--muted)", fontSize: 12 }}>(nezaškrtnuto = pozáruční)</span>
                    </label>
                    {dev.warrantyClaim && (
                      <div>
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 220px), 1fr))", gap: 10 }}>
                          <div>
                            <div style={{ ...fieldLabel, marginTop: 0 }}>Datum nákupu</div>
                            <input
                              type="date"
                              value={dev.purchaseDate}
                              max={new Date().toISOString().slice(0, 10)}
                              onChange={(e) =>
                                setNewDraft((p) => ({
                                  ...p,
                                  devices: p.devices.map((d, i) => (i === idx ? { ...d, purchaseDate: e.target.value } : d)),
                                }))
                              }
                              aria-invalid={showError(`zaruka_${idx}`) || undefined}
                              style={baseFieldInput}
                            />
                          </div>
                          <div>
                            <div style={{ ...fieldLabel, marginTop: 0 }}>Doklad o koupi</div>
                            <input
                              value={dev.purchaseProof}
                              onChange={(e) =>
                                setNewDraft((p) => ({
                                  ...p,
                                  devices: p.devices.map((d, i) => (i === idx ? { ...d, purchaseProof: e.target.value } : d)),
                                }))
                              }
                              style={baseFieldInput}
                              placeholder="Číslo účtenky, faktura, „má v e-mailu“"
                            />
                          </div>
                        </div>
                        {chybiPodkladZaruky(dev) && (
                          <div style={showError(`zaruka_${idx}`) ? fieldHint : fieldMuted}>U záruční opravy vyplňte datum nákupu nebo doklad o koupi.</div>
                        )}
                      </div>
                    )}
                    {jeAppleZarizeni(dev.deviceLabel) && (
                      <>
                        <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer" }}>
                          <input
                            type="checkbox"
                            checked={dev.findMyOff}
                            onChange={(e) =>
                              setNewDraft((p) => ({
                                ...p,
                                devices: p.devices.map((d, i) => (i === idx ? { ...d, findMyOff: e.target.checked } : d)),
                              }))
                            }
                          />
                          <span>Find My vypnuto</span>
                        </label>
                        {!dev.findMyOff && (
                          <div role="note" style={{ fontSize: 12, color: "#b45309", background: "rgba(245,158,11,0.12)", borderRadius: 8, padding: "6px 8px" }}>
                            Bez vypnutého Find My nelze zařízení servisovat u autorizovaných dílů; požádejte zákazníka o vypnutí.
                          </div>
                        )}
                      </>
                    )}
                  </div>

                  {/* Další údaje zařízení (IMEI, heslo, stav, příslušenství, převzetí,
                      cena, poznámka). Dřív bydlely až dole v samostatné sekci „Další
                      údaje“ – při příjmu se pak přeskakovalo mezi zařízením nahoře
                      a jeho údaji o obrazovku níž. Patří k zařízení, tak jsou u něj;
                      sbalení si aplikace pamatuje stejně jako u sekce Další údaje. */}
                  <div style={{ marginTop: 12, borderTop: "1px dashed var(--border)", paddingTop: 6 }}>
                    <button
                      type="button"
                      onClick={() => setNewOrderDeviceMoreOpen((v) => !v)}
                      aria-expanded={newOrderDeviceMoreOpen}
                      aria-controls={`new-order-device-more-${idx}`}
                      style={{ width: "100%", display: "flex", alignItems: "center", gap: 8, padding: "6px 0", background: "none", border: "none", cursor: "pointer", color: "var(--text)", textAlign: "left" }}
                    >
                      <span style={{ display: "inline-flex", color: "var(--muted)", transform: newOrderDeviceMoreOpen ? "rotate(180deg)" : "none", transition: "transform 120ms ease" }}><ChevronDownIcon size={14} /></span>
                      <span style={{ ...subHeading, marginBottom: 0 }}>Další údaje zařízení</span>
                      {!newOrderDeviceMoreOpen && (
                        <span style={{ color: "var(--muted)", fontSize: 12, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          IMEI, heslo, stav, příslušenství, převzetí, cena
                        </span>
                      )}
                    </button>
                    {newOrderDeviceMoreOpen && (
                      <div id={`new-order-device-more-${idx}`}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 220px), 1fr))", gap: 10 }}>
                <div>
                  <div style={{ ...fieldLabel, marginTop: 0 }}>IMEI / SN</div>
                  {/* Překlep v IMEI, tvar Apple sériového čísla a „tenhle telefon už tu byl“ –
                      všechno chce servis vědět hned při příjmu, ne až u stolu. */}
                  {(() => {
                    const sn = dev.serialOrImei;
                    const stav = stavSerioveho(sn);
                    const odkaz = odkazKontrolaImei(sn);
                    const barva = !stav.platne ? "#dc2626" : stav.hlaska ? "#16a34a" : undefined;
                    const drive = najdiStejneZarizeni(cloudTickets, sn);
                    return (
                      <>
                        <input
                          value={sn}
                          onChange={(e) =>
                            setNewDraft((p) => ({
                              ...p,
                              devices: p.devices.map((d, i) => (i === idx ? { ...d, serialOrImei: e.target.value } : d)),
                            }))
                          }
                          aria-invalid={!stav.platne || undefined}
                          style={barva ? { ...baseFieldInput, border: `1px solid ${barva}` } : baseFieldInput}
                          placeholder="35-123456-789012-3"
                        />
                        {(stav.hlaska || drive.length > 0) && (
                      <div style={{ marginTop: 6, display: "grid", gap: 4, fontSize: 12 }}>
                        {stav.hlaska && (
                          <div role={stav.platne ? undefined : "alert"} style={{ color: barva, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                            <span>{stav.hlaska}</span>
                            {odkaz && (
                              <Button variant="soft" size="sm" onClick={() => void otevriVProhlizeci(odkaz)} title="Otevře imei.info v prohlížeči (model, blacklist)">
                                Zkontrolovat IMEI
                              </Button>
                            )}
                          </div>
                        )}
                        {drive.length > 0 && (
                          <div role="note" style={{ color: "var(--accent)", background: "var(--accent-soft)", borderRadius: 8, padding: "6px 8px" }}>
                            Zařízení už u vás bylo ({drive.length}×):{" "}
                            {drive
                              .slice(0, 3)
                              .map((t) => `${t.code ?? "—"} · ${formatCZ(t.createdAt)}${t.issueShort || t.requestedRepair ? ` · ${t.issueShort || t.requestedRepair}` : ""}`)
                              .join(", ")}
                            {drive.length > 3 ? " …" : ""}
                          </div>
                        )}
                      </div>
                        )}
                      </>
                    );
                  })()}
                </div>
                <div>
                  <div style={{ ...fieldLabel, marginTop: 0 }}>Heslo / kód</div>
                  <input
                    value={dev.devicePasscode}
                    onChange={(e) =>
                      setNewDraft((p) => ({
                        ...p,
                        devices: p.devices.map((d, i) => (i === idx ? { ...d, devicePasscode: e.target.value } : d)),
                      }))
                    }
                    style={baseFieldInput}
                    placeholder="1234"
                  />
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 220px), 1fr))", gap: 10 }}>
                <div>
                  <div style={fieldLabel}>Popis stavu</div>
                  <input
                    list="new-order-device-condition-list"
                    value={dev.deviceCondition}
                    onChange={(e) =>
                      setNewDraft((p) => ({
                        ...p,
                        devices: p.devices.map((d, i) => (i === idx ? { ...d, deviceCondition: e.target.value } : d)),
                      }))
                    }
                    style={baseFieldInput}
                    placeholder="Rozbitý displej, oděrky"
                  />
                </div>
                <div>
                  <div style={fieldLabel}>Příslušenství</div>
                  <input
                    list="new-order-device-accessories-list"
                    value={dev.deviceAccessories}
                    onChange={(e) =>
                      setNewDraft((p) => ({
                        ...p,
                        devices: p.devices.map((d, i) => (i === idx ? { ...d, deviceAccessories: e.target.value } : d)),
                      }))
                    }
                    style={baseFieldInput}
                    placeholder="Nabíječka, pouzdro"
                  />
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 220px), 1fr))", gap: 10 }}>
                <div>
                  <div style={fieldLabel}>Způsob převzetí</div>
                  <HandoffMethodSelect
                    options={getHandoffOptions().receiveMethods}
                    value={dev.handoffMethod}
                    onChange={(v) =>
                      setNewDraft((p) => ({
                        ...p,
                        devices: p.devices.map((d, i) => (i === idx ? { ...d, handoffMethod: v } : d)),
                      }))
                    }
                    triggerStyle={baseFieldInput}
                  />
                </div>
                <div>
                  <div style={fieldLabel}>Způsob předání</div>
                  <HandoffMethodSelect
                    options={getHandoffOptions().returnMethods}
                    value={dev.handbackMethod}
                    onChange={(v) =>
                      setNewDraft((p) => ({
                        ...p,
                        devices: p.devices.map((d, i) => (i === idx ? { ...d, handbackMethod: v } : d)),
                      }))
                    }
                    triggerStyle={baseFieldInput}
                  />
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 220px), 1fr))", gap: 10 }}>
                <div>
                  <div style={fieldLabel}>Externí identifikace</div>
                  <input
                    value={dev.externalId}
                    onChange={(e) =>
                      setNewDraft((p) => ({
                        ...p,
                        devices: p.devices.map((d, i) => (i === idx ? { ...d, externalId: e.target.value } : d)),
                      }))
                    }
                    style={baseFieldInput}
                    placeholder="Číslo zakázky partnera"
                  />
                </div>
                <div>
                  <div style={fieldLabel}>Předschválená cena</div>
                  <input
                    type="number"
                    value={dev.estimatedPrice ?? ""}
                    onChange={(e) =>
                      setNewDraft((p) => ({
                        ...p,
                        // Ručně napsaná cena je od teď základ pro slevu (lib/cenaPriPrijmu).
                        devices: p.devices.map((d, i) => (i === idx ? { ...d, ...poRucniCene(d, e.target.value) } : d)),
                      }))
                    }
                    style={baseFieldInput}
                    placeholder="2 500"
                    min="0"
                    step="1"
                  />
                  <div style={fieldMuted}>
                    V Kč. Cena, se kterou zákazník předem souhlasí – už po slevě.
                    {dev.discountType && (dev.discountValue ?? 0) > 0 && (dev.cenaPredSlevou ?? soucetOprav(dev.plannedRepairs)) > 0
                      ? ` Bez slevy ${formatCurrency(dev.cenaPredSlevou ?? soucetOprav(dev.plannedRepairs))}.`
                      : ""}
                  </div>
                </div>
              </div>

              <div style={fieldLabel}>Poznámka pro technika</div>
              <textarea
                value={dev.deviceNote}
                onChange={(e) =>
                  setNewDraft((p) => ({
                    ...p,
                    devices: p.devices.map((d, i) => (i === idx ? { ...d, deviceNote: e.target.value } : d)),
                  }))
                }
                style={{ ...baseFieldTextArea, minHeight: 64 }}
                placeholder="Zákazník si přeje zachovat data"
              />
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
      <Button
        variant="soft"
        size="sm"
        icon={<PlusIcon size={14} />}
        style={{ marginTop: 10 }}
        disabled={!newDraft.devices[newDraft.devices.length - 1]?.deviceLabel?.trim()}
        onClick={() => {
          setNewDraft((p) => ({
            ...p,
            devices: [
              ...p.devices,
              { ...defaultDeviceRow(), expectedCompletionAt: p.devices[0]?.expectedCompletionAt ?? undefined },
            ],
          }));
          setExpandedDeviceIdx(newDraft.devices.length);
        }}
        title={!newDraft.devices[newDraft.devices.length - 1]?.deviceLabel?.trim() ? "Nejdřív vyplňte název posledního zařízení" : "Přidat další zařízení"}
      >
        Přidat další zařízení
      </Button>
    </div>
  );
}
