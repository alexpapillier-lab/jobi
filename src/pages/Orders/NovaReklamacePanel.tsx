/**
 * Okno „Nová reklamace“ – příjem reklamace ve stejném stylu a šířce jako
 * „Nová zakázka“ (NovaZakazkaPanel): lepivá hlavička s pobočkou, karty
 * Zdrojová zakázka (napovídání, záruka na opravu, reklamované opravy),
 * Zákazník, Zařízení, Reklamovaná závada (popis, termín vyřízení, poznámka
 * pro technika), Přijímací fotky a lepivá patička.
 *
 * Stav konceptu, ověření a založení drží useNovaReklamaceKoncept; okno se
 * vykresluje jen otevřené (koncept žije v localStorage, ne v DOM) – jinak
 * by jeho pole se stejnými popisky kolidovala se schovaným příjmem zakázky.
 */
import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "../../components/ui";
import { SectionHeading } from "../../components/SectionHeading";
import { DateTimePicker } from "../../components/DateTimePicker";
import { CameraIcon, DeviceIcon, InboxIcon, NoteIcon, UserIcon, XIcon } from "../../components/icons";
import { CustomerAutocomplete, HandoffMethodSelect, type CustomerMatch } from "../../components/orders";
import { FotkaZakazky } from "../../components/FotkaZakazky";
import { VyberFotek } from "../../components/orders/VyberFotek";
import { formatCZ } from "../../components/tickets";
import { getHandoffOptions } from "../../lib/handoffOptions";
import { BARVA_SEKCE, stylSekce } from "../../lib/sekceDetailu";
import { stavZarukyOpravy } from "../../lib/zarukaOpravy";
import { LHUTA_VYRIZENI_DNI, vychoziTerminVyrizeni, type KonceptReklamace } from "../../lib/reklamacePrijem";
import type { Branch } from "../../lib/branches";
import type { TicketEx } from "./typy";
import { formatIco, formatPhoneNumber, formatZipCode } from "./formatovani";
import { border, borderError, card, fieldLabel, fieldHint, fieldMuted, subHeading, baseFieldInput, baseFieldTextArea } from "./styly";
import { CaptureQrModal } from "./CaptureQrModal";
import type { useNovaReklamaceKoncept } from "./hooks/useNovaReklamaceKoncept";

type Props = {
  r: ReturnType<typeof useNovaReklamaceKoncept>;
  isNarrow: boolean;
  naTelefonu: boolean;
  hasBranches: boolean;
  branches: Branch[];
  branchForNew: Branch | null;
  cloudTickets: TicketEx[];
  searchCustomers: (q: string) => Promise<CustomerMatch[]>;
  /** Telefon je povinný (Nastavení → Zakázky → Povinná pole). */
  customerPhoneRequired: boolean;
  /** Zakázka je po záruce – místo reklamace příjem placené opravy. */
  onPlacenaOprava?: (ticketId: string) => void;
};

/** Napovídání zdrojové zakázky: kód, zákazník, SN/IMEI, telefon. */
function najdiZakazky(tickets: TicketEx[], dotaz: string): TicketEx[] {
  const q = dotaz.trim().toLowerCase();
  if (!q) return tickets.slice(0, 8);
  const cisla = q.replace(/\s/g, "");
  return tickets
    .filter(
      (t) =>
        t.code?.toLowerCase().includes(q) ||
        t.customerName?.toLowerCase().includes(q) ||
        t.serialOrImei?.toLowerCase().includes(q) ||
        t.deviceLabel?.toLowerCase().includes(q) ||
        (cisla.length >= 3 && t.customerPhone?.replace(/\s/g, "").includes(cisla))
    )
    .slice(0, 12);
}

export function NovaReklamacePanel({ r, isNarrow, naTelefonu, hasBranches, branches, branchForNew, cloudTickets, searchCustomers, customerPhoneRequired, onPlacenaOprava }: Props) {
  const [dotaz, setDotaz] = useState("");
  const k = r.koncept;
  const set = <K extends keyof KonceptReklamace>(pole: K, hodnota: KonceptReklamace[K]) => r.setKoncept((p) => ({ ...p, [pole]: hodnota }));
  const nalezene = useMemo(() => najdiZakazky(cloudTickets, dotaz), [cloudTickets, dotaz]);
  const handoff = getHandoffOptions();
  const err = (pole: string) => (r.ukazChybu(pole) ? <div style={fieldHint}>{r.chyby[pole]}</div> : null);
  const ramecek = (pole: string) => (r.ukazChybu(pole) ? borderError : border);

  if (!r.otevreno) return null;

  const zaruka = k.zdroj ? stavZarukyOpravy(k.zdroj.zarukaDo) : null;
  const lhuta = vychoziTerminVyrizeni(new Date());

  return createPortal(
    <>
      <div
        onClick={r.zavri}
        style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.35)", zIndex: 1240 }}
      />
      <div
        // Rozdělaná práce: tichá obnova webu (lib/aktualizaceWebu) čeká, dokud je panel otevřený.
        data-jobi-rozdelano=""
        data-tour="nova-reklamace"
        role="dialog"
        aria-label="Nová reklamace"
        style={{
          position: "fixed",
          inset: 0,
          margin: "auto",
          height: "fit-content",
          width: 920,
          maxWidth: "calc(100vw - 24px)",
          maxHeight: "calc(100dvh / var(--ui-scale, 1) - 24px)",
          overflow: "auto",
          background: "var(--panel)",
          backdropFilter: "var(--blur)",
          WebkitBackdropFilter: "var(--blur)",
          border,
          borderRadius: "var(--radius-lg)",
          boxShadow: "var(--shadow)",
          padding: "0 18px",
          // Nad detailem zakázky (1210) – reklamace se zakládá i z jeho nabídky „…“.
          zIndex: 1250,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", position: "sticky", top: 0, zIndex: 3, background: "var(--panel)", margin: "0 -18px 0", padding: "18px 18px 12px", borderBottom: "1px solid var(--border)" }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 950, fontSize: 16, color: "var(--text)" }}>Nová reklamace</div>
            {!isNarrow && (
              <div style={{ color: "var(--muted)", fontSize: 12, marginTop: 4 }}>
                Stav se automaticky nastaví na <b>Přijato</b>. Reklamaci vyřiďte do {LHUTA_VYRIZENI_DNI} dnů od přijetí.
              </div>
            )}
          </div>
          {hasBranches && (
            <select
              className="ui-input"
              aria-label="Pobočka reklamace"
              title="Pobočka – u reklamace k zakázce se převezme pobočka zakázky"
              value={k.branchId ?? branchForNew?.id ?? ""}
              onChange={(e) => set("branchId", e.target.value || null)}
              style={{ width: "auto", maxWidth: 200, padding: "6px 10px", fontSize: 12, fontWeight: 600 }}
            >
              {branches.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          )}
          <Button variant="soft" iconOnly icon={<XIcon size={16} />} aria-label="Zavřít" title="Zavřít (rozpracované údaje zůstanou uložené)" onClick={r.zavri} />
        </div>

        <div style={{ marginTop: 14, display: "grid", gap: 14 }}>
          {/* ===== ZDROJOVÁ ZAKÁZKA ===== */}
          <div data-tour="nova-reklamace-zdroj" style={{ ...card, ...stylSekce("opravy") }}>
            <SectionHeading icon={<InboxIcon size={16} />} size="sm" barva={BARVA_SEKCE.opravy}>Zdrojová zakázka</SectionHeading>
            {k.zdroj ? (
              <div style={{ display: "grid", gap: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 13, color: "var(--muted)" }}>
                    Zakázka: <strong style={{ color: "var(--text)" }}>{k.zdroj.kod ?? "—"}</strong>
                    {r.nacitamZdroj && " · načítám…"}
                  </span>
                  <button type="button" onClick={r.zpetNaVyber} style={{ fontSize: 12, color: "var(--accent)", background: "none", border: "none", cursor: "pointer", padding: 4, fontWeight: 700 }}>
                    Zpět na výběr
                  </button>
                </div>

                {/* Záruka na opravu původní zakázky. Jen upozornění – reklamaci
                    po záruce servis založit může (vstřícnost, spor o datum). */}
                {!r.nacitamZdroj && (zaruka === null ? (
                  <div style={{ fontSize: 12, color: "var(--muted)" }}>
                    Záruka na opravu u zakázky není uvedená (zakázka nebyla vydaná nebo je z doby před evidencí záruky).
                  </div>
                ) : zaruka.platna ? (
                  <div role="status" data-tour="nova-reklamace-zaruka" style={{ fontSize: 13, fontWeight: 600, color: "var(--success-text)", padding: "8px 10px", background: "color-mix(in srgb, var(--success) 12%, transparent)", borderRadius: 8, border: "1px solid color-mix(in srgb, var(--success) 40%, transparent)" }}>
                    V záruce do {zaruka.datum}
                  </div>
                ) : (
                  <div role="status" data-tour="nova-reklamace-zaruka" style={{ fontSize: 13, color: "var(--warning-text)", padding: "8px 10px", background: "color-mix(in srgb, var(--warning) 14%, transparent)", borderRadius: 8, border: "1px solid color-mix(in srgb, var(--warning) 45%, transparent)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                    <span><strong>Po záruce</strong> (skončila {zaruka.datum}). Reklamaci můžete založit i tak, nebo přijmout zařízení jako placenou opravu.</span>
                    {onPlacenaOprava && (
                      <Button variant="soft" size="sm" onClick={() => onPlacenaOprava(k.zdroj!.ticketId)}>
                        Založit placenou opravu
                      </Button>
                    )}
                  </div>
                ))}

                <div data-tour="nova-reklamace-opravy">
                  <div style={subHeading}>Co zákazník reklamuje</div>
                  {k.zdroj.opravy.length === 0 ? (
                    <div style={{ ...fieldMuted, marginTop: 0 }}>Zakázka nemá zapsané provedené opravy – popište závadu níž.</div>
                  ) : (
                    <div style={{ display: "grid", gap: 6 }}>
                      {k.zdroj.opravy.map((o) => {
                        const zaskrtnuto = k.reklamovaneOpravy.includes(o.id);
                        return (
                          <label key={o.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", border: `1px solid ${zaskrtnuto ? "var(--accent)" : "var(--border)"}`, borderRadius: 10, background: zaskrtnuto ? "var(--accent-soft)" : "var(--panel-2)", cursor: "pointer", fontSize: 13 }}>
                            <input
                              type="checkbox"
                              checked={zaskrtnuto}
                              onChange={(e) =>
                                set("reklamovaneOpravy", e.target.checked ? [...k.reklamovaneOpravy, o.id] : k.reklamovaneOpravy.filter((x) => x !== o.id))
                              }
                            />
                            <span style={{ flex: 1, minWidth: 0, fontWeight: 600 }}>{o.name}</span>
                            {typeof o.price === "number" && <span style={{ color: "var(--muted)" }}>{o.price.toLocaleString("cs-CZ")} Kč</span>}
                          </label>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            ) : k.bezZakazky ? (
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span style={{ fontSize: 13, color: "var(--muted)" }}>Bez propojení na zakázku – zákazníka a zařízení vyplňte ručně.</span>
                <button type="button" onClick={r.zpetNaVyber} style={{ fontSize: 12, color: "var(--accent)", background: "none", border: "none", cursor: "pointer", padding: 4, fontWeight: 700 }}>
                  Zpět na výběr
                </button>
              </div>
            ) : (
              <>
                <input
                  type="text"
                  autoFocus
                  placeholder="Vyhledat zakázku (kód, zákazník, SN, telefon…)"
                  value={dotaz}
                  onChange={(e) => setDotaz(e.target.value)}
                  style={{ ...baseFieldInput, marginBottom: 10 }}
                />
                <div style={{ maxHeight: 240, overflowY: "auto", display: "grid", gap: 6, marginBottom: 10 }}>
                  {nalezene.length === 0 ? (
                    <div style={{ padding: 12, color: "var(--muted)", fontSize: 13 }}>
                      {dotaz.trim() ? "Žádná zakázka nevyhovuje. Zadejte jiný výraz nebo založte reklamaci bez zakázky." : "Zadejte hledaný výraz nebo založte reklamaci bez zakázky."}
                    </div>
                  ) : (
                    nalezene.map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => void r.vyberZdroj(t)}
                        disabled={r.nacitamZdroj}
                        style={{ display: "block", width: "100%", padding: "10px 12px", textAlign: "left", border: "1px solid var(--border)", borderRadius: 10, background: "var(--panel-2)", color: "var(--text)", fontSize: 13, cursor: "pointer" }}
                      >
                        <span style={{ fontWeight: 700 }}>{t.code ?? "—"}</span>
                        {" · "}
                        {t.customerName ?? "—"}
                        {t.deviceLabel ? ` · ${t.deviceLabel}` : ""}
                        {t.serialOrImei ? <span style={{ color: "var(--muted)" }}> · SN {t.serialOrImei}</span> : null}
                        {t.createdAt ? <span style={{ color: "var(--muted)" }}> · {formatCZ(t.createdAt)}</span> : null}
                      </button>
                    ))
                  )}
                </div>
                <Button variant="soft" size="sm" onClick={r.bezZakazky}>
                  Reklamace bez propojení na zakázku
                </Button>
                <div style={fieldMuted}>Bez zakázky – zákazník přinesl opravu odjinud. Diagnostika a komentáře se pak píší jen do reklamace.</div>
              </>
            )}
          </div>

          {/* ===== ZÁKAZNÍK ===== */}
          <div data-tour="nova-reklamace-zakaznik" style={{ ...card, ...stylSekce("zakaznik") }}>
            <SectionHeading icon={<UserIcon size={16} />} size="sm" barva={BARVA_SEKCE.zakaznik}>Zákazník</SectionHeading>
            <div style={{ display: "grid", gridTemplateColumns: isNarrow ? "1fr" : "1fr 1fr", gap: 10 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ ...fieldLabel, marginTop: 0 }}>Jméno</div>
                {k.customerId ? (
                  <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", border: "1px solid var(--accent)", borderRadius: 12, background: "var(--accent-soft)", minHeight: 40 }}>
                    <span style={{ color: "var(--accent)", display: "inline-flex" }}><UserIcon size={15} /></span>
                    <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{k.customerName.trim() || "Bez jména"}</span>
                    <button type="button" onClick={() => set("customerId", null)} title="Odpojit kartu zákazníka a upravit údaje ručně" style={{ background: "none", border: "none", padding: 0, color: "var(--accent)", fontWeight: 700, fontSize: 12, cursor: "pointer" }}>
                      Změnit
                    </button>
                  </div>
                ) : (
                  <CustomerAutocomplete
                    id="nova-reklamace-jmeno"
                    value={k.customerName}
                    placeholder="Jméno zákazníka"
                    inputStyle={baseFieldInput}
                    search={searchCustomers}
                    onSelect={(m) => {
                      const c = m as CustomerMatch & { ico?: string | null; address_street?: string | null; address_zip?: string | null; note?: string | null };
                      r.setKoncept((p) => ({
                        ...p,
                        customerId: c.id,
                        customerName: c.name || "",
                        customerPhone: c.phone || "",
                        customerEmail: c.email || "",
                        addressStreet: c.address_street || "",
                        addressCity: c.city || "",
                        addressZip: (c.address_zip || "").replace(/\D/g, ""),
                        company: c.company || "",
                        ico: (c.ico || "").replace(/\D/g, ""),
                        customerInfo: c.note || "",
                      }));
                    }}
                    onChange={(text) => set("customerName", text)}
                  />
                )}
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ ...fieldLabel, marginTop: 0 }}>Telefon{customerPhoneRequired ? " *" : ""}</div>
                <input
                  id="nova-reklamace-telefon"
                  value={formatPhoneNumber(k.customerPhone)}
                  inputMode="tel"
                  onChange={(e) => set("customerPhone", e.target.value.replace(/[^\d+]/g, ""))}
                  style={{ ...baseFieldInput, border: ramecek("customerPhone") }}
                  placeholder="+420 600 000 000"
                />
                {err("customerPhone")}
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: isNarrow ? "1fr" : "1fr 1fr 160px", gap: 10 }}>
              <div>
                <div style={fieldLabel}>E-mail</div>
                <input type="email" value={k.customerEmail} onChange={(e) => set("customerEmail", e.target.value)} style={{ ...baseFieldInput, border: ramecek("customerEmail") }} placeholder="e-mail zákazníka" />
                {err("customerEmail")}
              </div>
              <div>
                <div style={fieldLabel}>Firma</div>
                <input value={k.company} onChange={(e) => set("company", e.target.value)} style={baseFieldInput} placeholder="Název firmy" />
              </div>
              <div>
                <div style={fieldLabel}>IČO</div>
                <input inputMode="numeric" value={formatIco(k.ico)} onChange={(e) => set("ico", e.target.value.replace(/[^\d]/g, ""))} style={{ ...baseFieldInput, border: ramecek("ico") }} maxLength={9} placeholder="IČO" />
                {err("ico")}
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: isNarrow ? "1fr 1fr" : "2fr 1fr 160px", gap: 10 }}>
              <div style={{ gridColumn: isNarrow ? "1 / -1" : "auto" }}>
                <div style={fieldLabel}>Ulice</div>
                <input value={k.addressStreet} onChange={(e) => set("addressStreet", e.target.value)} style={baseFieldInput} placeholder="Ulice, č.p." />
              </div>
              <div>
                <div style={fieldLabel}>Město</div>
                <input value={k.addressCity} onChange={(e) => set("addressCity", e.target.value)} style={baseFieldInput} placeholder="Město" />
              </div>
              <div>
                <div style={fieldLabel}>PSČ</div>
                <input inputMode="numeric" value={formatZipCode(k.addressZip)} onChange={(e) => set("addressZip", e.target.value.replace(/[^\d]/g, ""))} style={{ ...baseFieldInput, border: ramecek("addressZip") }} maxLength={6} placeholder="PSČ" />
                {err("addressZip")}
              </div>
            </div>
            <div style={fieldLabel}>Poznámka k zákazníkovi</div>
            <input value={k.customerInfo} onChange={(e) => set("customerInfo", e.target.value)} style={baseFieldInput} placeholder="Volá jen odpoledne, preferuje SMS" />
          </div>

          {/* ===== ZAŘÍZENÍ ===== */}
          <div data-tour="nova-reklamace-zarizeni" style={{ ...card, ...stylSekce("zarizeni") }}>
            <SectionHeading icon={<DeviceIcon size={16} />} size="sm" barva={BARVA_SEKCE.zarizeni}>Zařízení</SectionHeading>
            <div style={{ ...fieldLabel, marginTop: 0 }}>Zařízení *</div>
            <input value={k.deviceLabel} onChange={(e) => set("deviceLabel", e.target.value)} style={{ ...baseFieldInput, border: ramecek("deviceLabel") }} placeholder="např. iPhone 13, notebook" />
            {err("deviceLabel")}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 220px), 1fr))", gap: 10 }}>
              <div>
                <div style={fieldLabel}>IMEI / SN</div>
                <input value={k.serialOrImei} onChange={(e) => set("serialOrImei", e.target.value)} style={baseFieldInput} placeholder="Sériové číslo nebo IMEI" />
              </div>
              <div>
                <div style={fieldLabel}>Heslo / kód</div>
                <input value={k.devicePasscode} onChange={(e) => set("devicePasscode", e.target.value)} style={baseFieldInput} placeholder="Kód k odemčení" />
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 220px), 1fr))", gap: 10 }}>
              <div>
                <div style={fieldLabel}>Popis stavu</div>
                <input value={k.deviceCondition} onChange={(e) => set("deviceCondition", e.target.value)} style={baseFieldInput} placeholder="Stav při převzetí reklamace – oděrky, prasklina…" />
              </div>
              <div>
                <div style={fieldLabel}>Příslušenství</div>
                <input value={k.deviceAccessories} onChange={(e) => set("deviceAccessories", e.target.value)} style={baseFieldInput} placeholder="Nabíječka, pouzdro" />
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 220px), 1fr))", gap: 10 }}>
              <div>
                <div style={fieldLabel}>Způsob převzetí</div>
                <HandoffMethodSelect options={handoff.receiveMethods} value={k.handoffMethod} onChange={(v) => set("handoffMethod", v)} triggerStyle={baseFieldInput} />
              </div>
            </div>
          </div>

          {/* ===== REKLAMOVANÁ ZÁVADA ===== */}
          <div data-tour="nova-reklamace-zavada" style={{ ...card, ...stylSekce("diagnostika") }}>
            <SectionHeading icon={<NoteIcon size={16} />} size="sm" barva={BARVA_SEKCE.diagnostika}>Reklamovaná závada</SectionHeading>
            <div style={{ ...fieldLabel, marginTop: 0 }}>Popis reklamované závady *</div>
            <textarea
              id="nova-reklamace-popis"
              value={k.popisZavady}
              onChange={(e) => set("popisZavady", e.target.value)}
              rows={3}
              style={{ ...baseFieldTextArea, minHeight: 72, border: ramecek("popisZavady") }}
              placeholder="Co zákazník reklamuje – projevy závady, od kdy se objevuje"
            />
            {err("popisZavady")}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 260px), 1fr))", gap: 10 }}>
              <div>
                <div style={fieldLabel}>Předpokládaný termín vyřízení</div>
                <DateTimePicker value={k.terminVyrizeni} onChange={(v) => set("terminVyrizeni", v)} inputStyle={baseFieldInput} />
                <div style={fieldMuted}>
                  {k.terminVyrizeni ? "" : "Nevyplněno = zákonná lhůta. "}
                  Ze zákona do {LHUTA_VYRIZENI_DNI} dnů od přijetí, tj. {formatCZ(lhuta)}.
                  {k.terminVyrizeni && (
                    <> {" "}<button type="button" onClick={() => set("terminVyrizeni", null)} style={{ background: "none", border: "none", padding: 0, color: "var(--accent)", fontWeight: 700, fontSize: 12, cursor: "pointer" }}>Použít zákonnou lhůtu</button></>
                  )}
                </div>
              </div>
            </div>
            <div style={fieldLabel}>Poznámka pro technika</div>
            <textarea value={k.poznamkaTechnik} onChange={(e) => set("poznamkaTechnik", e.target.value)} style={{ ...baseFieldTextArea, minHeight: 56 }} placeholder="Zákazník si přeje zachovat data" />
          </div>

          {/* ===== PŘIJÍMACÍ FOTKY ===== */}
          <div data-tour="nova-reklamace-fotky" style={{ ...card }}>
            <div style={subHeading}>Přijímací fotky</div>
            <div style={{ ...fieldMuted, marginTop: 0, marginBottom: 10 }}>Fotky se po vytvoření reklamace nahrají a připojí k ní (stav zařízení při převzetí).</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
              {k.fotky.map((dataUrl, idx) => (
                <div key={idx} style={{ position: "relative" }}>
                  <img src={dataUrl} alt={`Fotka ${idx + 1}`} style={{ width: 80, height: 80, objectFit: "cover", borderRadius: 8, border: "1px solid var(--border)" }} />
                  <button
                    type="button"
                    aria-label="Odebrat fotku"
                    onClick={() => r.odeberFotku(idx)}
                    style={{ position: "absolute", top: 4, right: 4, width: 22, height: 22, borderRadius: "50%", background: "rgba(239, 68, 68, 0.9)", color: "white", border: "none", cursor: "pointer", display: "grid", placeItems: "center", padding: 0 }}
                  >
                    <XIcon size={12} />
                  </button>
                </div>
              ))}
              {r.qrFotky.map((url, idx) => (
                <div key={`qr-${idx}`} style={{ position: "relative" }}>
                  <FotkaZakazky url={url} alt={`QR fotka ${idx + 1}`} style={{ width: 80, height: 80, objectFit: "cover", borderRadius: 8, border: "1px solid var(--border)" }} />
                  <div style={{ position: "absolute", left: 4, right: 4, bottom: 4, fontSize: "var(--text-xs)", fontWeight: 700, borderRadius: 6, background: "rgba(0,0,0,0.55)", color: "white", textAlign: "center", padding: "2px 4px" }}>
                    z mobilu
                  </div>
                </div>
              ))}
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8, alignItems: "center" }}>
              <VyberFotek popisek={<><CameraIcon size={14} /> Nahrát fotky</>} style={{ ...baseFieldInput, width: "auto", padding: "6px 12px", display: "inline-flex", alignItems: "center", gap: 6, fontSize: "var(--text-sm)", fontWeight: 600 }}>
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  style={{ display: "none" }}
                  onChange={(e) => {
                    const files = Array.from(e.target.files || []);
                    e.target.value = "";
                    void r.pridejSoubory(files);
                  }}
                />
              </VyberFotek>
              {!naTelefonu && (
                <Button variant="soft" size="sm" onClick={() => void r.vyfotitZTelefonu()} disabled={r.qrNacitam} title="QR kód pro nafocení z telefonu. Fotky se připojí po kliknutí na „Vytvořit reklamaci“.">
                  {r.qrNacitam ? "Vytvářím…" : "Vyfotit z telefonu (QR)"}
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* ===== Patička – lepivá ===== */}
        <div style={{ display: "flex", flexDirection: isNarrow ? "column" : "row", alignItems: isNarrow ? "stretch" : "center", gap: 10, justifyContent: "space-between", position: "sticky", bottom: 0, zIndex: 3, background: "var(--panel)", margin: "14px -18px 0", padding: 18, paddingTop: 12, borderTop: "1px solid var(--border)" }}>
          {!isNarrow && <span style={{ fontSize: 12, color: "var(--muted)" }}>Rozpracované údaje se ukládají automaticky</span>}
          <div style={{ display: "flex", alignItems: "center", gap: 10, justifyContent: "flex-end", flexWrap: "wrap" }}>
            {r.submitAttempted && r.duvod && (
              <span role="status" style={{ fontSize: 12, color: "var(--muted)" }}>{r.duvod}</span>
            )}
            <Button variant="soft" onClick={r.zahod} title="Zahodit rozpracovanou reklamaci">
              Zrušit
            </Button>
            <Button
              variant="primary"
              onClick={() => void r.vytvorit()}
              aria-disabled={!r.lzeVytvorit || r.vytvarim}
              title={r.duvod ? `Nejde vytvořit: ${r.duvod}` : "Vytvořit reklamaci (⌘/Ctrl+Enter)"}
              data-tour="nova-reklamace-vytvorit"
            >
              {r.vytvarim ? "Vytvářím…" : "Vytvořit reklamaci"}
            </Button>
          </div>
        </div>
      </div>

      {r.qrPolozky && r.qrPolozky.length > 0 && (
        <CaptureQrModal
          items={r.qrPolozky}
          onClose={r.zavriQr}
          draftCaptureTokenRef={r.qrTokenRef}
          draftCaptureLiveCount={r.qrPocet}
          nazevKonceptu="rozpracované reklamace"
        />
      )}
    </>,
    document.body
  );
}
