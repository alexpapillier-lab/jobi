import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { Button, Label, Pill, Segmented } from "../../components/ui";
import { UserIcon } from "../../components/icons";
import { CustomerAutocomplete } from "../../components/orders/CustomerAutocomplete";
import { typedSupabase } from "../../lib/typedSupabase";
import { reportSilent } from "../../lib/reportError";
import { formatCurrency, type InvoiceLineItem } from "../../lib/invoiceMath";
import { stornoPodleStavu } from "../../lib/stornoStav";
import { useStatuses } from "../../state/StatusesStore";
import {
  SLOUPCE_ZAKAZKY,
  jeFiremniZakaznik,
  normalizujIco,
  obdobiOdDo,
  obdobiZMesice,
  popisObdobi,
  poznamkaSouhrnu,
  pocetZakazek,
  sestavPolozky,
  souhrnVyberu,
  vazbyZVyberu,
  vyberKandidaty,
  vychoziMesic,
  vychoziVyber,
  zakazkaZRadku,
  type Kandidat,
  type NastaveniDph,
  type VyberKandidatu,
  type ZakazkaProSouhrn,
} from "../../lib/souhrnnaFaktura";
import type { InvoiceCustomerMatch } from "./InvoiceEditor";
import { formatDate } from "./types";

/** Co dialog předá editoru faktury. */
export type SouhrnnaFakturaPrefill = {
  zakaznik: InvoiceCustomerMatch;
  polozky: InvoiceLineItem[];
  vazby: { ticket_id: string; castka: number }[];
  zakazky: { id: string; code: string | null }[];
  poznamka: string;
  /** Pobočka, když jsou všechny vybrané zakázky z jedné. */
  branchId: string | null;
};

/** Dotaz `in (…)` po dávkách – dlouhá URL s tisícem id by PostgREST odmítl. */
const DAVKA = 150;

function posunMesic(mesic: string, o: number): string {
  const [r, m] = mesic.split("-").map(Number);
  const d = new Date(r, m - 1 + o, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function nazevMesice(mesic: string): string {
  const [r, m] = mesic.split("-").map(Number);
  return new Date(r, m - 1, 1).toLocaleDateString("cs-CZ", { month: "long", year: "numeric" });
}

/**
 * Souhrnná faktura – výběr zákazníka, období a zakázek.
 *
 * Nabídne zákazníkovy zakázky vydané v období, které ještě nejsou na žádné
 * nestornované faktuře; vyfakturované ukáže zvlášť s číslem dokladu.
 * Potvrzení otevře obyčejný editor faktury s předvyplněnými položkami –
 * ukládání, číslování, tisk i export jsou tytéž jako u každé faktury.
 */
export function SouhrnnaFakturaDialog({
  open,
  activeServiceId,
  dph,
  searchCustomers,
  onClose,
  onVytvorit,
}: {
  open: boolean;
  activeServiceId: string;
  dph: NastaveniDph;
  searchCustomers: (q: string) => Promise<InvoiceCustomerMatch[]>;
  onClose: () => void;
  onVytvorit: (p: SouhrnnaFakturaPrefill) => void;
}) {
  const { statuses } = useStatuses();
  const [hledani, setHledani] = useState("");
  const [zakaznik, setZakaznik] = useState<InvoiceCustomerMatch | null>(null);
  const [rezim, setRezim] = useState<"mesic" | "rozsah">("mesic");
  const [mesic, setMesic] = useState(() => vychoziMesic(new Date()));
  const [od, setOd] = useState("");
  const [doDne, setDoDne] = useState("");
  const [rozpad, setRozpad] = useState(false);

  const [zakazky, setZakazky] = useState<ZakazkaProSouhrn[]>([]);
  const [vyfakturovano, setVyfakturovano] = useState<Map<string, string>>(new Map());
  const [nacitam, setNacitam] = useState(false);
  const [chyba, setChyba] = useState<string | null>(null);
  const [vybrane, setVybrane] = useState<Set<string>>(new Set());

  // Nové otevření začíná načisto; zákazník z minula by svedl k faktuře špatné firmě.
  useEffect(() => {
    if (!open) return;
    setHledani("");
    setZakaznik(null);
    setRezim("mesic");
    setMesic(vychoziMesic(new Date()));
    setOd("");
    setDoDne("");
    setRozpad(false);
    setZakazky([]);
    setVyfakturovano(new Map());
    setChyba(null);
    setVybrane(new Set());
  }, [open]);

  const obdobi = useMemo(() => (rezim === "mesic" ? obdobiZMesice(mesic) : obdobiOdDo(od, doDne)), [rezim, mesic, od, doDne]);

  const jeKoncovy = useMemo(() => {
    const konec = new Set(statuses.filter((s) => s.isFinal).map((s) => s.key));
    return (klic: string) => konec.has(klic);
  }, [statuses]);
  const jeStorno = useMemo(() => stornoPodleStavu(statuses), [statuses]);

  // Načtení zakázek zákazníka a jejich faktur.
  const dotazRef = useRef(0);
  useEffect(() => {
    if (!open || !zakaznik || !obdobi) {
      // Rozběhnutý dotaz pro předchozího zákazníka se tím zahodí.
      dotazRef.current++;
      setNacitam(false);
      setZakazky([]);
      setVyfakturovano(new Map());
      return;
    }
    const dotaz = ++dotazRef.current;
    setNacitam(true);
    setChyba(null);
    (async () => {
      try {
        // Karta zákazníka, nebo stejné IČO (jiná kontaktní osoba téže firmy).
        const ico = normalizujIco(zakaznik.ico)?.replace(/[^0-9A-Za-z]/g, "");
        const kdo = [`customer_id.eq.${zakaznik.id}`, ...(ico ? [`customer_ico.eq.${ico}`] : [])].join(",");
        // Vydání (completed_at) je nejpozději poslední změnou – od začátku období
        // se proto dá hledat podle updated_at a přesné období dopočítat tady.
        const { data, error } = await typedSupabase
          .from("tickets")
          .select(SLOUPCE_ZAKAZKY)
          .eq("service_id", activeServiceId)
          .is("deleted_at", null)
          .gte("updated_at", obdobi.start.toISOString())
          .or(kdo)
          .order("created_at", { ascending: true })
          .limit(2000);
        if (error) throw error;
        const radky = (data ?? []).map(zakazkaZRadku);

        const mapa = new Map<string, string>();
        const ids = radky.map((z) => z.id);
        for (let i = 0; i < ids.length; i += DAVKA) {
          const { data: vazby, error: vErr } = await typedSupabase
            .from("invoice_tickets")
            .select("ticket_id, invoice_id")
            .in("ticket_id", ids.slice(i, i + DAVKA))
            .eq("aktivni", true);
          if (vErr) {
            // Bez vazeb nejde poznat, co už je vyfakturované – radši nic nenabídnout.
            const kod = (vErr as { code?: string }).code;
            throw new Error(
              kod === "PGRST205" || kod === "42P01"
                ? "Souhrnná faktura potřebuje aktualizaci databáze (migrace 20260927130000). Zatím ji vystavit nejde."
                : vErr.message,
            );
          }
          const fakturaIds = [...new Set((vazby ?? []).map((v) => v.invoice_id))];
          const cisla = new Map<string, string>();
          if (fakturaIds.length > 0) {
            const { data: faktury } = await typedSupabase.from("invoices").select("id, number").in("id", fakturaIds);
            for (const f of faktury ?? []) cisla.set(f.id, f.number);
          }
          for (const v of vazby ?? []) mapa.set(v.ticket_id, cisla.get(v.invoice_id) || "jiném dokladu");
        }
        if (dotaz !== dotazRef.current) return;
        setZakazky(radky);
        setVyfakturovano(mapa);
      } catch (e) {
        if (dotaz !== dotazRef.current) return;
        reportSilent({ code: "invoices.souhrnna_load_failed", error: e, source: "SouhrnnaFakturaDialog" });
        setZakazky([]);
        setVyfakturovano(new Map());
        setChyba(e instanceof Error ? e.message : "Zakázky se nepodařilo načíst.");
      } finally {
        if (dotaz === dotazRef.current) setNacitam(false);
      }
    })();
  }, [open, zakaznik, obdobi, activeServiceId]);

  const vyber: VyberKandidatu = useMemo(() => {
    if (!zakaznik || !obdobi) return { kandidati: [], vyfakturovane: [] };
    return vyberKandidaty(zakazky, {
      zakaznik: { id: zakaznik.id, ico: zakaznik.ico ?? null },
      obdobi,
      jeKoncovy,
      jeStorno,
      vyfakturovano,
    });
  }, [zakazky, zakaznik, obdobi, jeKoncovy, jeStorno, vyfakturovano]);

  // Po načtení nového výběru se zaškrtne vše, co má cenu.
  useEffect(() => {
    setVybrane(vychoziVyber(vyber.kandidati));
  }, [vyber.kandidati]);

  const zaskrtnute = useMemo(() => vyber.kandidati.filter((k) => vybrane.has(k.zakazka.id)), [vyber.kandidati, vybrane]);
  const polozky = useMemo(() => sestavPolozky(zaskrtnute, dph, rozpad), [zaskrtnute, dph, rozpad]);
  const souhrn = useMemo(() => souhrnVyberu(zaskrtnute, polozky), [zaskrtnute, polozky]);

  /* Jeden objekt pro daný výběr: rodič podle něj pozná dvojklik na
     Vytvořit a editor neotevře podruhé (viz Invoices.otevritSouhrnnou). */
  const prefill = useMemo<SouhrnnaFakturaPrefill | null>(() => {
    if (!zakaznik || !obdobi || zaskrtnute.length === 0) return null;
    const pobocky = new Set(zaskrtnute.map((k) => k.zakazka.branchId));
    return {
      zakaznik,
      polozky,
      vazby: vazbyZVyberu(zaskrtnute),
      zakazky: zaskrtnute.map((k) => ({ id: k.zakazka.id, code: k.zakazka.code })),
      poznamka: poznamkaSouhrnu(obdobi, zaskrtnute.length),
      branchId: pobocky.size === 1 ? [...pobocky][0] : null,
    };
  }, [zakaznik, obdobi, zaskrtnute, polozky]);

  if (!open) return null;

  const prepni = (id: string) =>
    setVybrane((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const vseZaskrtnuto = vyber.kandidati.length > 0 && zaskrtnute.length === vyber.kandidati.length;

  const vytvorit = () => {
    if (prefill) onVytvorit(prefill);
  };

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="souhrnna-nadpis"
      data-escape-vlastni
      onMouseDown={(e) => {
        e.stopPropagation();
        if (e.target === e.currentTarget) onClose();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape" && !document.querySelector('[role="listbox"]')) onClose();
      }}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9995, padding: "var(--space-3)" }}
    >
      <div
        style={{
          background: "var(--panel)",
          color: "var(--text)",
          borderRadius: "var(--radius-md)",
          border: "1px solid var(--border)",
          width: "min(100%, 860px)",
          maxHeight: "90dvh",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          boxShadow: "0 20px 60px rgba(0,0,0,0.35)",
        }}
      >
        <div style={{ padding: "var(--space-5) var(--space-6) var(--space-3)", borderBottom: "1px solid var(--border)" }}>
          <h2 id="souhrnna-nadpis" style={{ margin: 0, fontSize: "var(--text-lg)", fontWeight: 800 }}>
            Souhrnná faktura
          </h2>
          <div style={{ color: "var(--muted)", fontSize: "var(--text-sm)", marginTop: 4 }}>
            Jedna faktura za všechny vydané zakázky zákazníka v období. Zakázky na jiné faktuře se nenabízejí.
          </div>
        </div>

        <div style={{ flex: 1, overflow: "auto", padding: "var(--space-4) var(--space-6)", display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
          {/* Zákazník */}
          <div>
            <Label>Zákazník</Label>
            <div style={{ marginTop: 4 }}>
              {zakaznik ? (
                <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", padding: "var(--space-2) var(--space-3)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", background: "var(--panel-2)" }}>
                  <UserIcon size={16} />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontWeight: 700, display: "flex", gap: "var(--space-2)", alignItems: "center", flexWrap: "wrap" }}>
                      {zakaznik.company || zakaznik.name}
                      {jeFiremniZakaznik(zakaznik) && <Pill>Firma</Pill>}
                    </div>
                    <div style={{ fontSize: "var(--text-sm)", color: "var(--muted)" }}>
                      {[zakaznik.company ? zakaznik.name : null, zakaznik.ico ? `IČO ${zakaznik.ico}` : null, zakaznik.email].filter(Boolean).join(" · ")}
                    </div>
                  </div>
                  <Button size="sm" variant="soft" onClick={() => { setZakaznik(null); setHledani(""); }}>
                    Změnit
                  </Button>
                </div>
              ) : (
                <CustomerAutocomplete
                  id="souhrnna-zakaznik"
                  value={hledani}
                  onChange={setHledani}
                  onSelect={(m) => setZakaznik(m as InvoiceCustomerMatch)}
                  search={searchCustomers}
                  placeholder="Firma, jméno, IČO nebo telefon"
                  inputStyle={inputStyle}
                  autoFocus
                />
              )}
            </div>
            {zakaznik && zakaznik.ico && (
              <div style={{ fontSize: "var(--text-xs)", color: "var(--muted)", marginTop: 4 }}>
                Nabízejí se i zakázky jiných kontaktních osob se stejným IČO.
              </div>
            )}
          </div>

          {/* Období */}
          <div style={{ display: "flex", gap: "var(--space-3)", alignItems: "flex-end", flexWrap: "wrap" }}>
            <div>
              <Label>Období vydání</Label>
              <div style={{ marginTop: 4 }}>
                <Segmented
                  size="sm"
                  ariaLabel="Druh období"
                  value={rezim}
                  options={[
                    { value: "mesic", label: "Měsíc" },
                    { value: "rozsah", label: "Od–do" },
                  ]}
                  onChange={setRezim}
                />
              </div>
            </div>
            {rezim === "mesic" ? (
              <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
                <Button size="sm" variant="ghost" aria-label="Předchozí měsíc" onClick={() => setMesic((m) => posunMesic(m, -1))}>
                  ‹
                </Button>
                <span style={{ minWidth: 130, textAlign: "center", fontWeight: 700 }}>{nazevMesice(mesic)}</span>
                <Button size="sm" variant="ghost" aria-label="Další měsíc" onClick={() => setMesic((m) => posunMesic(m, 1))}>
                  ›
                </Button>
              </div>
            ) : (
              <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
                <input type="date" aria-label="Od" value={od} onChange={(e) => setOd(e.target.value)} style={dateStyle} />
                <span style={{ color: "var(--muted)" }}>–</span>
                <input type="date" aria-label="Do" value={doDne} onChange={(e) => setDoDne(e.target.value)} style={dateStyle} />
              </div>
            )}
            <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: "var(--text-sm)", marginLeft: "auto", cursor: "pointer" }}>
              <input type="checkbox" checked={rozpad} onChange={(e) => setRozpad(e.target.checked)} />
              Rozepsat na jednotlivé opravy
            </label>
          </div>

          {/* Zakázky */}
          {!zakaznik ? (
            <Prazdne text="Vyberte zákazníka – nabídnou se jeho vydané zakázky." />
          ) : !obdobi ? (
            <Prazdne text="Vyplňte období od–do." />
          ) : chyba ? (
            <div role="alert" style={{ padding: "var(--space-3)", borderRadius: "var(--radius-sm)", background: "var(--danger-soft)", color: "var(--danger-text)", fontSize: "var(--text-sm)" }}>
              {chyba}
            </div>
          ) : nacitam ? (
            <Prazdne text="Načítám zakázky…" />
          ) : vyber.kandidati.length === 0 && vyber.vyfakturovane.length === 0 ? (
            <Prazdne text={`Za ${popisObdobi(obdobi)} nemá zákazník žádnou vydanou zakázku.`} />
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "var(--text-sm)", minWidth: 560 }}>
                <thead>
                  <tr style={{ borderBottom: "2px solid var(--border)" }}>
                    <th style={{ ...th, width: 32 }}>
                      <input
                        type="checkbox"
                        aria-label="Vybrat všechny zakázky"
                        checked={vseZaskrtnuto}
                        disabled={vyber.kandidati.length === 0}
                        onChange={() => setVybrane(vseZaskrtnuto ? new Set() : new Set(vyber.kandidati.map((k) => k.zakazka.id)))}
                      />
                    </th>
                    <th style={th}>Zakázka</th>
                    <th style={th}>Vydáno</th>
                    <th style={th}>Zařízení a opravy</th>
                    <th style={{ ...th, textAlign: "right" }}>Cena</th>
                  </tr>
                </thead>
                <tbody>
                  {vyber.kandidati.map((k) => (
                    <RadekZakazky key={k.zakazka.id} k={k} zaskrtnuto={vybrane.has(k.zakazka.id)} onPrepnout={() => prepni(k.zakazka.id)} />
                  ))}
                  {vyber.vyfakturovane.map((k) => (
                    <RadekZakazky key={k.zakazka.id} k={k} zaskrtnuto={false} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div
          style={{
            padding: "var(--space-3) var(--space-6)",
            borderTop: "1px solid var(--border)",
            display: "flex",
            alignItems: "center",
            gap: "var(--space-3)",
            flexWrap: "wrap",
            justifyContent: "space-between",
          }}
        >
          <div style={{ fontSize: "var(--text-sm)", color: "var(--muted)" }} aria-live="polite">
            {zaskrtnute.length > 0 ? (
              <>
                Vybráno: <strong style={{ color: "var(--text)" }}>{pocetZakazek(souhrn.pocet)}</strong> za{" "}
                <strong style={{ color: "var(--text)" }}>{formatCurrency(souhrn.soucetZakazek)}</strong>
                {Math.abs(souhrn.faktura.total_rounded - souhrn.soucetZakazek) >= 0.5 && (
                  <> · na faktuře {formatCurrency(souhrn.faktura.total_rounded)} s DPH</>
                )}
              </>
            ) : (
              "Nic není vybráno"
            )}
          </div>
          <div style={{ display: "flex", gap: "var(--space-2)" }}>
            <Button variant="ghost" onClick={onClose}>
              Zrušit
            </Button>
            <Button variant="primary" onClick={vytvorit} disabled={zaskrtnute.length === 0 || nacitam || !!chyba}>
              Vytvořit fakturu
            </Button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function RadekZakazky({ k, zaskrtnuto, onPrepnout }: { k: Kandidat; zaskrtnuto: boolean; onPrepnout?: () => void }) {
  const z = k.zakazka;
  const zamceno = !onPrepnout;
  return (
    <tr style={{ borderBottom: "1px solid var(--border)", opacity: zamceno ? 0.6 : 1, cursor: zamceno ? "default" : "pointer" }} onClick={onPrepnout}>
      <td style={td}>
        <input
          type="checkbox"
          aria-label={`Zakázka ${z.code ?? ""}`}
          checked={zaskrtnuto}
          disabled={zamceno}
          onClick={(e) => e.stopPropagation()}
          onChange={() => onPrepnout?.()}
        />
      </td>
      <td style={{ ...td, fontWeight: 700, whiteSpace: "nowrap" }}>{z.code || "bez čísla"}</td>
      <td style={{ ...td, whiteSpace: "nowrap", color: "var(--muted)" }}>{formatDate(k.vydano)}</td>
      <td style={td}>
        <div>{[z.deviceLabel, z.opravy.map((o) => o.name).join(", ")].filter(Boolean).join(" · ") || "—"}</div>
        {k.vyfakturovanoV && <div style={{ fontSize: "var(--text-xs)", color: "var(--muted)" }}>Vyfakturováno v {k.vyfakturovanoV}</div>}
      </td>
      <td style={{ ...td, textAlign: "right", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>
        {formatCurrency(k.cena)}
        {k.sleva > 0 && <div style={{ fontSize: "var(--text-xs)", color: "var(--muted)" }}>sleva {formatCurrency(k.sleva)}</div>}
      </td>
    </tr>
  );
}

function Prazdne({ text }: { text: string }) {
  return <div style={{ padding: "var(--space-6) var(--space-3)", textAlign: "center", color: "var(--muted)", fontSize: "var(--text-base)" }}>{text}</div>;
}

const inputStyle: CSSProperties = {
  width: "100%",
  padding: "10px var(--space-3)",
  borderRadius: "var(--radius-sm)",
  border: "1px solid var(--border)",
  background: "var(--panel)",
  color: "var(--text)",
  fontFamily: "inherit",
  fontSize: "var(--text-base)",
  outline: "none",
};

const dateStyle: CSSProperties = {
  padding: "7px 10px",
  borderRadius: "var(--radius-sm)",
  border: "1px solid var(--border)",
  background: "var(--panel-2)",
  color: "var(--text)",
  fontFamily: "inherit",
};

const th: CSSProperties = {
  textAlign: "left",
  padding: "6px",
  fontSize: "var(--text-xs)",
  fontWeight: 700,
  color: "var(--muted)",
  textTransform: "uppercase",
  letterSpacing: "0.03em",
  whiteSpace: "nowrap",
};

const td: CSSProperties = { padding: "8px 6px", verticalAlign: "top" };
