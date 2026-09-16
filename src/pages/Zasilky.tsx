import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Card, Input, PageHeader, Pill, Segmented } from "../components/ui";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { showToast } from "../components/Toast";
import { reportError } from "../lib/reportError";
import { supabase } from "../lib/supabaseClient";
import { printHtmlInBrowser } from "../lib/webPrint";
import { safeLoadCompanyData } from "../lib/companyData";
import { useBranches } from "../context/BranchContext";
import { useStatuses } from "../state/StatusesStore";
import { useIsNarrow } from "../hooks/useIsNarrow";
import { StatusBadge } from "../components/tickets/StatusBadge";
import {
  cisloZasilky,
  druhaPobocka,
  htmlProtokolu,
  nactiZasilky,
  nepreveztePolozky,
  odeberZeZasilky,
  odesliZasilku,
  prevezmiZasilku,
  pridejDoZasilky,
  smazKoncept,
  stavZasilkyText,
  subscribeZasilky,
  ulozHlavickuZasilky,
  umisteniZakazky,
  vytvorZasilku,
  type StavZasilky,
  type Zasilka,
} from "../lib/zasilky";

/**
 * Stránka Zásilky – modul „Přesuny mezi pobočkami“.
 *
 * Vlevo seznam zásilek (koncepty, na cestě, převzaté), vpravo otevřená
 * zásilka: hlavička (odkud, kam, dopravce, sledovací číslo), položky
 * a akce podle stavu. Koncept se plní výběrem zakázek ze seznamu (žádné
 * skenování), odeslání a převzetí dělá databáze přes RPC.
 */

type ZakazkaRadek = {
  id: string;
  code: string;
  title: string;
  customerName: string;
  serial: string;
  status: string | null;
  branchId: string | null;
  locationBranchId: string | null;
  transitShipmentId: string | null;
};

const SLOUPCE = "id, code, title, customer_name, device_serial, status, branch_id, location_branch_id, transit_shipment_id";

function mapRadek(r: Record<string, unknown>): ZakazkaRadek {
  const s = (v: unknown) => (typeof v === "string" ? v : "");
  return {
    id: s(r.id),
    code: s(r.code),
    title: s(r.title),
    customerName: s(r.customer_name),
    serial: s(r.device_serial),
    status: typeof r.status === "string" ? r.status : null,
    branchId: typeof r.branch_id === "string" ? r.branch_id : null,
    locationBranchId: typeof r.location_branch_id === "string" ? r.location_branch_id : null,
    transitShipmentId: typeof r.transit_shipment_id === "string" ? r.transit_shipment_id : null,
  };
}

function datum(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("cs-CZ", { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" });
}

type Zalozka = StavZasilky;

export default function Zasilky({ activeServiceId, onOpenTicket }: { activeServiceId: string | null; onOpenTicket: (ticketId: string) => void }) {
  const { branches, branchById, activeBranchId, branchForNew } = useBranches();
  const { getByKey, isFinal } = useStatuses();
  const isNarrow = useIsNarrow();
  const nazevPobocky = useCallback((id: string) => branchById(id)?.name ?? "jiná pobočka", [branchById]);

  const [zasilky, setZasilky] = useState<Zasilka[]>([]);
  const [zakazky, setZakazky] = useState<Map<string, ZakazkaRadek>>(new Map());
  const [nacitam, setNacitam] = useState(true);
  const [zalozka, setZalozka] = useState<Zalozka>("draft");
  const [otevrenaId, setOtevrenaId] = useState<string | null>(null);
  const [hledat, setHledat] = useState("");
  const [iHotove, setIHotove] = useState(false);
  const [zauzlovano, setZauzlovano] = useState(false);
  const [potvrditSmazani, setPotvrditSmazani] = useState(false);
  const [vybraneKPrevzeti, setVybraneKPrevzeti] = useState<Set<string>>(new Set());

  /* Nová zásilka: odkud = aktivní pobočka (jinak pobočka pro novou zakázku),
     kam = druhá pobočka, když jsou jen dvě. */
  const [novaOdkud, setNovaOdkud] = useState<string>("");
  const [novaKam, setNovaKam] = useState<string>("");
  useEffect(() => {
    const odkud = activeBranchId ?? branchForNew?.id ?? branches[0]?.id ?? "";
    setNovaOdkud(odkud);
    setNovaKam(druhaPobocka(branches, odkud) ?? branches.find((b) => b.id !== odkud)?.id ?? "");
  }, [activeBranchId, branchForNew?.id, branches]);

  const nacti = useCallback(async () => {
    if (!activeServiceId || !supabase) return;
    try {
      const [z, { data, error }] = await Promise.all([
        nactiZasilky(activeServiceId),
        (supabase.from("tickets") as any).select(SLOUPCE).eq("service_id", activeServiceId).is("deleted_at", null).order("created_at", { ascending: false }).limit(3000),
      ]);
      if (error) throw new Error(error.message);
      setZasilky(z);
      setZakazky(new Map(((data ?? []) as Record<string, unknown>[]).map(mapRadek).map((r) => [r.id, r])));
    } catch (error) {
      reportError({ code: "zasilky.load_failed", error, userMessage: "Zásilky se nepodařilo načíst.", source: "Zasilky", serviceId: activeServiceId });
    } finally {
      setNacitam(false);
    }
  }, [activeServiceId]);

  useEffect(() => {
    setNacitam(true);
    void nacti();
    if (!activeServiceId || !supabase) return;
    const odhlasit = subscribeZasilky(activeServiceId, () => void nacti());
    // Zakázky se mění i mimo zásilky (stav, přesun pobočky); stačí znovu načíst.
    const kanal = supabase
      .channel(`zasilky-tickets:${activeServiceId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "tickets", filter: `service_id=eq.${activeServiceId}` }, () => void nacti())
      .subscribe();
    return () => { odhlasit(); void supabase?.removeChannel(kanal); };
  }, [activeServiceId, nacti]);

  const otevrena = useMemo(() => zasilky.find((z) => z.id === otevrenaId) ?? null, [zasilky, otevrenaId]);
  useEffect(() => { setVybraneKPrevzeti(new Set()); }, [otevrenaId]);

  const vZalozce = useMemo(() => zasilky.filter((z) => z.status === zalozka), [zasilky, zalozka]);
  const pocty = useMemo(() => ({
    draft: zasilky.filter((z) => z.status === "draft").length,
    sent: zasilky.filter((z) => z.status === "sent").length,
    received: zasilky.filter((z) => z.status === "received").length,
  }), [zasilky]);

  /* Zakázky, které jdou do konceptu: fyzicky na pobočce odeslání, necestují,
     nejsou už v téhle zásilce. Hotové zakázky jen na přání – zpátky se
     posílají opravené, takže u zpáteční cesty se hodí i ty. */
  const nabidka = useMemo(() => {
    if (!otevrena || otevrena.status !== "draft") return [];
    const uz = new Set(otevrena.polozky.map((p) => p.ticketId));
    const q = hledat.trim().toLowerCase();
    const out: ZakazkaRadek[] = [];
    for (const t of zakazky.values()) {
      if (uz.has(t.id) || t.transitShipmentId) continue;
      const u = umisteniZakazky(t);
      const mistoId = u.druh === "jinde" ? u.branchId : t.branchId;
      if (mistoId !== otevrena.fromBranchId) continue;
      if (!iHotove && t.status && isFinal(t.status)) continue;
      if (q && !`${t.code} ${t.title} ${t.customerName} ${t.serial}`.toLowerCase().includes(q)) continue;
      out.push(t);
      if (out.length >= 60) break;
    }
    return out;
  }, [otevrena, zakazky, hledat, iHotove, isFinal]);

  const akce = async (co: () => Promise<void>, hotovo?: string) => {
    if (zauzlovano) return;
    setZauzlovano(true);
    try {
      await co();
      if (hotovo) showToast(hotovo, "success");
      await nacti();
    } catch (error) {
      reportError({ code: "zasilky.action_failed", error, userMessage: error instanceof Error ? error.message : "Akce se nepodařila.", source: "Zasilky", serviceId: activeServiceId });
    } finally {
      setZauzlovano(false);
    }
  };

  const zalozit = () =>
    akce(async () => {
      if (!activeServiceId || !novaOdkud || !novaKam) throw new Error("Vyberte pobočku odeslání i cílovou pobočku.");
      const z = await vytvorZasilku({ serviceId: activeServiceId, fromBranchId: novaOdkud, toBranchId: novaKam });
      setZalozka("draft");
      setOtevrenaId(z.id);
    });

  const tiskProtokolu = async (z: Zasilka) => {
    const firma = safeLoadCompanyData();
    const html = htmlProtokolu(z, {
      nazevPobocky,
      servis: firma?.name || undefined,
      zakazky: z.polozky.map((p) => {
        const t = zakazky.get(p.ticketId);
        return { ticketId: p.ticketId, code: t?.code ?? "?", device: t?.title ?? "", customer: t?.customerName ?? "", serial: t?.serial || undefined };
      }),
    });
    try {
      await printHtmlInBrowser(html);
    } catch (error) {
      reportError({ code: "zasilky.print_failed", error, userMessage: "Protokol se nepodařilo vytisknout.", source: "Zasilky", serviceId: activeServiceId });
    }
  };

  const card: React.CSSProperties = { display: "grid", gap: 12 };
  const radekZakazky = (t: ZakazkaRadek | undefined, ticketId: string, vpravo?: React.ReactNode) => {
    const meta = t?.status ? getByKey(t.status) : undefined;
    return (
      <div key={ticketId} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 8px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--panel)", flexWrap: "wrap" }}>
        <button type="button" onClick={() => onOpenTicket(ticketId)} style={{ background: "none", border: "none", padding: 0, cursor: "pointer", color: "var(--accent)", fontWeight: 800, fontFamily: "inherit", fontSize: 13 }}>
          {t?.code ?? "zakázka"}
        </button>
        <span style={{ fontSize: 13, color: "var(--text)", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: "1 1 160px" }}>
          {t ? `${t.title}${t.serial ? ` · ${t.serial}` : ""} · ${t.customerName}` : "zakázka mimo váš přístup"}
        </span>
        {meta && <StatusBadge label={meta.label} bg={meta.bg ?? "var(--muted)"} isFinal={meta.isFinal} size="sm" />}
        {vpravo}
      </div>
    );
  };

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <PageHeader
        title="Zásilky"
        subtitle="Přesuny zakázek mezi pobočkami: koncept naplníte zakázkami, odešlete, druhá pobočka převezme."
        actions={
          branches.length >= 2 ? (
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <select className="ui-input" aria-label="Z pobočky" value={novaOdkud} onChange={(e) => { setNovaOdkud(e.target.value); if (e.target.value === novaKam) setNovaKam(druhaPobocka(branches, e.target.value) ?? ""); }} style={{ width: "auto" }}>
                {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
              <span style={{ color: "var(--muted)" }}>→</span>
              <select className="ui-input" aria-label="Na pobočku" value={novaKam} onChange={(e) => setNovaKam(e.target.value)} style={{ width: "auto" }}>
                <option value="">– cílová pobočka –</option>
                {branches.filter((b) => b.id !== novaOdkud).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
              <Button variant="primary" onClick={() => void zalozit()} disabled={zauzlovano || !novaOdkud || !novaKam}>+ Nová zásilka</Button>
            </div>
          ) : undefined
        }
      />

      {branches.length < 2 && (
        <Card><div style={{ color: "var(--muted)", fontSize: 13 }}>Zásilky mají smysl u servisu s více pobočkami. Pobočky přidáte v Nastavení → Firma → Pobočky.</div></Card>
      )}

      <div style={{ display: "grid", gridTemplateColumns: isNarrow ? "1fr" : "minmax(260px, 1fr) 2fr", gap: 16, alignItems: "start" }}>
        <Card>
          <div style={card}>
            <Segmented<Zalozka>
              size="sm"
              ariaLabel="Stav zásilek"
              value={zalozka}
              onChange={(v) => { setZalozka(v); setOtevrenaId(null); }}
              options={[
                { value: "draft", label: `Koncepty (${pocty.draft})` },
                { value: "sent", label: `Na cestě (${pocty.sent})` },
                { value: "received", label: `Převzaté (${pocty.received})` },
              ]}
            />
            {nacitam ? (
              <div style={{ color: "var(--muted)", fontSize: 13 }}>Načítám…</div>
            ) : vZalozce.length === 0 ? (
              <div style={{ color: "var(--muted)", fontSize: 13 }}>
                {zalozka === "draft" ? "Žádný koncept. Založte novou zásilku tlačítkem nahoře." : zalozka === "sent" ? "Nic není na cestě." : "Zatím žádná převzatá zásilka."}
              </div>
            ) : (
              <div style={{ display: "grid", gap: 6 }}>
                {vZalozce.map((z) => {
                  const chybi = nepreveztePolozky(z).length;
                  const aktivni = z.id === otevrenaId;
                  return (
                    <button
                      key={z.id}
                      type="button"
                      onClick={() => setOtevrenaId(z.id)}
                      aria-pressed={aktivni}
                      style={{ textAlign: "left", padding: "8px 10px", borderRadius: 10, border: `1px solid ${aktivni ? "var(--accent)" : "var(--border)"}`, background: aktivni ? "var(--accent-soft)" : "var(--panel)", color: "var(--text)", cursor: "pointer", fontFamily: "inherit", display: "grid", gap: 2 }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" }}>
                        <span style={{ fontWeight: 800 }}>{cisloZasilky(z)} · {nazevPobocky(z.fromBranchId)} → {nazevPobocky(z.toBranchId)}</span>
                        <span style={{ fontSize: 12, color: "var(--muted)", whiteSpace: "nowrap" }}>{z.polozky.length} {z.polozky.length === 1 ? "zakázka" : z.polozky.length < 5 ? "zakázky" : "zakázek"}</span>
                      </div>
                      <div style={{ fontSize: 12, color: "var(--muted)" }}>
                        {z.status === "draft" ? `založeno ${datum(z.createdAt)}` : z.status === "sent" ? `odesláno ${datum(z.sentAt)}` : `převzato ${datum(z.receivedAt)}`}
                        {z.trackingNumber ? ` · ${z.trackingNumber}` : ""}
                        {chybi > 0 ? ` · chybí ${chybi}` : ""}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </Card>

        <Card>
          {!otevrena ? (
            <div style={{ color: "var(--muted)", fontSize: 13 }}>Vyberte zásilku vlevo, nebo založte novou.</div>
          ) : (
            <div style={card}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start", flexWrap: "wrap" }}>
                <div>
                  <div style={{ fontWeight: 950, fontSize: "var(--text-lg)" }}>
                    {cisloZasilky(otevrena)} · {nazevPobocky(otevrena.fromBranchId)} → {nazevPobocky(otevrena.toBranchId)}
                  </div>
                  <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
                    <Pill>{stavZasilkyText(otevrena.status)}</Pill>
                    {otevrena.sentAt ? ` odesláno ${datum(otevrena.sentAt)}` : ""}
                    {otevrena.receivedAt ? ` · převzato ${datum(otevrena.receivedAt)}` : ""}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  <Button size="sm" variant="soft" onClick={() => void tiskProtokolu(otevrena)} disabled={otevrena.polozky.length === 0}>Předávací protokol</Button>
                  {otevrena.status === "draft" && (
                    <>
                      <Button size="sm" variant="ghost" onClick={() => setPotvrditSmazani(true)} disabled={zauzlovano}>Smazat koncept</Button>
                      <Button size="sm" variant="primary" disabled={zauzlovano || otevrena.polozky.length === 0} onClick={() => void akce(() => odesliZasilku(otevrena.id), "Zásilka odeslána.")}>
                        Odeslat ({otevrena.polozky.length})
                      </Button>
                    </>
                  )}
                </div>
              </div>

              {/* Hlavička: dopravce, sledovací číslo, poznámka – jde doplnit i po odeslání. */}
              <div style={{ display: "grid", gridTemplateColumns: isNarrow ? "1fr" : "1fr 1fr", gap: 8 }}>
                <label style={{ display: "grid", gap: 4, fontSize: 12, color: "var(--muted)" }}>
                  Dopravce
                  <Input key={`${otevrena.id}-c`} defaultValue={otevrena.carrier} placeholder="např. PPL, Zásilkovna, vlastní svoz" onBlur={(e) => { if (e.target.value.trim() !== otevrena.carrier) void akce(() => ulozHlavickuZasilky(otevrena.id, { carrier: e.target.value })); }} />
                </label>
                <label style={{ display: "grid", gap: 4, fontSize: 12, color: "var(--muted)" }}>
                  Sledovací číslo
                  <Input key={`${otevrena.id}-t`} defaultValue={otevrena.trackingNumber} placeholder="číslo balíku" onBlur={(e) => { if (e.target.value.trim() !== otevrena.trackingNumber) void akce(() => ulozHlavickuZasilky(otevrena.id, { trackingNumber: e.target.value })); }} />
                </label>
                <label style={{ display: "grid", gap: 4, fontSize: 12, color: "var(--muted)", gridColumn: "1 / -1" }}>
                  Poznámka
                  <Input key={`${otevrena.id}-n`} defaultValue={otevrena.note} placeholder="např. křehké, 2 krabice" onBlur={(e) => { if (e.target.value.trim() !== otevrena.note) void akce(() => ulozHlavickuZasilky(otevrena.id, { note: e.target.value })); }} />
                </label>
              </div>

              {/* Položky */}
              <div style={{ display: "grid", gap: 6 }}>
                <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", color: "var(--muted)" }}>
                  Zakázky v zásilce ({otevrena.polozky.length})
                </div>
                {otevrena.polozky.length === 0 && <div style={{ color: "var(--muted)", fontSize: 13 }}>Zatím prázdná. Přidejte zakázky níže.</div>}
                {otevrena.polozky.map((p) =>
                  radekZakazky(
                    zakazky.get(p.ticketId),
                    p.ticketId,
                    otevrena.status === "draft" ? (
                      <Button size="sm" variant="ghost" disabled={zauzlovano} onClick={() => void akce(() => odeberZeZasilky(otevrena.id, p.ticketId))}>Odebrat</Button>
                    ) : p.receivedAt ? (
                      <span style={{ fontSize: 12, color: "var(--success-text)", whiteSpace: "nowrap" }}>převzato {datum(p.receivedAt)}</span>
                    ) : (
                      <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, whiteSpace: "nowrap", cursor: "pointer" }}>
                        <input
                          type="checkbox"
                          checked={vybraneKPrevzeti.has(p.ticketId)}
                          onChange={(e) => setVybraneKPrevzeti((prev) => { const n = new Set(prev); if (e.target.checked) n.add(p.ticketId); else n.delete(p.ticketId); return n; })}
                        />
                        převzít
                      </label>
                    ),
                  ),
                )}
              </div>

              {otevrena.status === "sent" && nepreveztePolozky(otevrena).length > 0 && (
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", paddingTop: 8, borderTop: "1px solid var(--border)" }}>
                  <span style={{ fontSize: 13, color: "var(--muted)", flex: 1 }}>
                    Převzetí na pobočce {nazevPobocky(otevrena.toBranchId)}: zaškrtněte, co v krabici je. Co chybí, zůstane „na cestě“ a jde převzít později.
                  </span>
                  <Button size="sm" variant="ghost" onClick={() => setVybraneKPrevzeti(new Set(nepreveztePolozky(otevrena).map((p) => p.ticketId)))}>Vybrat vše</Button>
                  <Button
                    size="sm"
                    variant="primary"
                    disabled={zauzlovano || vybraneKPrevzeti.size === 0}
                    onClick={() => void akce(() => prevezmiZasilku(otevrena.id, [...vybraneKPrevzeti]), "Zakázky převzaty.")}
                  >
                    Převzít vybrané ({vybraneKPrevzeti.size})
                  </Button>
                </div>
              )}

              {otevrena.status === "draft" && (
                <div style={{ display: "grid", gap: 8, paddingTop: 8, borderTop: "1px solid var(--border)" }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", color: "var(--muted)", flex: 1 }}>
                      Přidat zakázky z pobočky {nazevPobocky(otevrena.fromBranchId)}
                    </div>
                    <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--muted)", cursor: "pointer" }}>
                      <input type="checkbox" checked={iHotove} onChange={(e) => setIHotove(e.target.checked)} /> i hotové
                    </label>
                  </div>
                  <Input value={hledat} onChange={(e) => setHledat(e.target.value)} placeholder="Hledat podle čísla, zařízení, zákazníka nebo IMEI…" aria-label="Hledat zakázku" />
                  {nabidka.length === 0 ? (
                    <div style={{ color: "var(--muted)", fontSize: 13 }}>Žádná další zakázka na této pobočce k odeslání.</div>
                  ) : (
                    <div style={{ display: "grid", gap: 6, maxHeight: 420, overflowY: "auto" }}>
                      {nabidka.map((t) =>
                        radekZakazky(t, t.id, (
                          <Button size="sm" variant="soft" disabled={zauzlovano} onClick={() => void akce(() => pridejDoZasilky(otevrena.id, t.id))}>Přidat</Button>
                        )),
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </Card>
      </div>

      <ConfirmDialog
        open={potvrditSmazani}
        title="Smazat koncept zásilky?"
        message="Zakázky v něm zůstanou, kde jsou – koncept se jich nedotýká."
        confirmLabel="Smazat"
        onCancel={() => setPotvrditSmazani(false)}
        onConfirm={async () => {
          setPotvrditSmazani(false);
          if (!otevrena) return;
          await akce(() => smazKoncept(otevrena.id), "Koncept smazán.");
          setOtevrenaId(null);
        }}
      />
    </div>
  );
}
