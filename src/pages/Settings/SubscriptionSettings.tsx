import { useEffect, useState } from "react";
import { Button, Pill } from "../../components/ui";
import { Card } from "../../lib/settingsUi";
import { SectionHeading } from "../../components/SectionHeading";
import { showToast } from "../../components/Toast";
import { useEntitlements } from "../../hooks/useEntitlements";
import { castka, loadBilling, loadCenik, openPortal, startCheckout, MODUL_POPIS, PODPORA_EMAIL, STATUS_LABELS, type BillingRow, type Plan } from "../../lib/billing";

/**
 * Nastavení → Firma → Předplatné.
 *
 * Ukazuje, co servis má a do kdy, a posílá do Stripe. Dokud platby nejsou
 * spuštěné, nabídne napsat nám – aby stránka dávala smysl i teď, kdy se plán
 * zapíná ručně v Owner panelu.
 */
/** Názvy tarifů i bez načteného ceníku (než se spustí platby). */
const TARIF_LABELS: Record<string, string> = { starter: "Starter", business: "Business", enterprise: "Enterprise" };

export function SubscriptionSettings({ activeServiceId }: { activeServiceId: string }) {
  const { trialEndsAt, trialDaysLeft, has, quota } = useEntitlements(activeServiceId);
  const [row, setRow] = useState<BillingRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [platbyVypnute, setPlatbyVypnute] = useState(false);
  const [obdobi, setObdobi] = useState<"month" | "year">("month");
  const [tarif, setTarif] = useState<"starter" | "business" | "enterprise">("business");
  const [pobockyNavic, setPobockyNavic] = useState(0);
  const [smsNavic, setSmsNavic] = useState(false);
  const [plany, setPlany] = useState<Plan[]>([]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void loadBilling(activeServiceId).then((r) => { if (!cancelled) { setRow(r); setLoading(false); } });
    void loadCenik().then((c) => { if (!cancelled && c) setPlany(c.plans); });
    return () => { cancelled = true; };
  }, [activeServiceId]);

  /** Vybraný tarif ve zvoleném období – klíč posílá checkout do Stripe. */
  const vybrany = plany.find((p) => p.tier === tarif && p.interval === obdobi);
  const klicTarifu = vybrany?.lookup_key ?? `jobi_${tarif}_${obdobi === "year" ? "yearly" : "monthly"}`;
  const maSmsVCene = (vybrany?.modules ?? []).includes("sms");

  const koupit = async () => {
    setBusy("checkout");
    const res = await startCheckout(activeServiceId, {
      plan: klicTarifu,
      branches: pobockyNavic,
      sms: smsNavic && !maSmsVCene,
    });
    setBusy(null);
    if (res.url) { window.location.href = res.url; return; }
    if (res.notConfigured) { setPlatbyVypnute(true); return; }
    showToast(res.error ?? "Nepodařilo se otevřít platbu.", "error");
  };

  const spravovat = async () => {
    setBusy("portal");
    const res = await openPortal(activeServiceId);
    setBusy(null);
    if (res.url) { window.location.href = res.url; return; }
    if (res.notConfigured) { setPlatbyVypnute(true); return; }
    showToast(res.error ?? "Nepodařilo se otevřít správu předplatného.", "error");
  };

  const maPredplatne = !!row?.stripe_subscription_id && row.status !== "canceled";
  const stav = row?.status ? STATUS_LABELS[row.status] ?? row.status : null;
  const pobocek = quota("branches");

  return (
    <Card>
      <SectionHeading size="sm">Předplatné</SectionHeading>
      <div style={{ color: "var(--muted)", fontSize: "var(--text-sm)", marginTop: "calc(-1 * var(--space-2))" }}>
        Tarify Starter, Business a Enterprise; pobočky navíc za příplatek. Platba kartou, fakturu a správu karty řeší platební brána.
      </div>

      {loading ? (
        <div style={{ color: "var(--muted)", fontSize: "var(--text-sm)", marginTop: 14 }}>Načítání…</div>
      ) : (
        <div style={{ marginTop: 16, display: "grid", gap: 14 }}>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ fontWeight: 700, color: "var(--text)" }}>Stav</span>
            {maPredplatne ? (
              <Pill color={row?.status === "past_due" ? "var(--danger-text)" : "var(--success-text, #16a34a)"}>{stav}</Pill>
            ) : trialEndsAt ? (
              <Pill color={(trialDaysLeft ?? 0) > 0 ? "var(--warning-text)" : "var(--danger-text)"}>
                {(trialDaysLeft ?? 0) > 0 ? `Zkušební období, zbývá ${trialDaysLeft} dní` : "Zkušební období skončilo"}
              </Pill>
            ) : (
              <Pill color="var(--success-text, #16a34a)">Aktivní bez omezení</Pill>
            )}
          </div>

          <div style={{ fontSize: "var(--text-sm)", color: "var(--muted)", display: "grid", gap: 4 }}>
            {row?.current_period_end && (
              <span>
                {row.cancel_at_period_end ? "Předplatné končí " : "Další platba "}
                {new Date(row.current_period_end).toLocaleDateString("cs-CZ")}
              </span>
            )}
            {trialEndsAt && !maPredplatne && (
              <span>Zkušební období do {new Date(trialEndsAt).toLocaleDateString("cs-CZ")}</span>
            )}
            <span>
              Pobočky: {pobocek === null ? "bez omezení" : pobocek}
              {row && row.branches_quantity > 0 ? ` (z toho ${row.branches_quantity} navíc)` : ""}
            </span>
            <span>Faktury: {has("invoices") ? "zapnuté" : "vypnuté"} · Napojení na účetnictví: {has("accounting") ? "zapnuté" : "vypnuté"} · SMS: {has("sms") ? "zapnuté" : "vypnuté"}</span>
          </div>

          {platbyVypnute ? (
            <div style={{ padding: "12px 14px", borderRadius: 10, background: "var(--panel-2)", border: "1px solid var(--border)", fontSize: "var(--text-sm)", color: "var(--text)" }}>
              Platby zatím nejsou spuštěné. Napište nám na{" "}
              <a href={`mailto:${PODPORA_EMAIL}?subject=Jobi%20%E2%80%93%20p%C5%99edplatn%C3%A9`} style={{ color: "var(--accent)", fontWeight: 700 }}>{PODPORA_EMAIL}</a>{" "}
              a plán vám zapneme ručně.
            </div>
          ) : (
            <>
            {!maPredplatne && (
              <div style={{ display: "grid", gap: 10, padding: "12px 14px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--panel-2)" }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <span style={{ fontSize: "var(--text-sm)", fontWeight: 700, color: "var(--text)" }}>Tarif</span>
                  {(["starter", "business", "enterprise"] as const).map((t) => {
                    const p = plany.find((x) => x.tier === t && x.interval === obdobi);
                    const vybrano = tarif === t;
                    return (
                      <button
                        key={t}
                        type="button"
                        onClick={() => setTarif(t)}
                        title={p ? (p.modules ?? []).map((m) => MODUL_POPIS[m] ?? m).join(" · ") : undefined}
                        style={{
                          padding: "6px 14px",
                          borderRadius: 10,
                          border: `1px solid ${vybrano ? "var(--accent)" : "var(--border)"}`,
                          background: vybrano ? "var(--accent-soft)" : "var(--panel)",
                          color: vybrano ? "var(--accent)" : "var(--text)",
                          fontSize: "var(--text-sm)",
                          fontWeight: 700,
                          cursor: "pointer",
                          display: "flex",
                          flexDirection: "column",
                          alignItems: "flex-start",
                          gap: 2,
                        }}
                      >
                        <span>{p?.label ?? TARIF_LABELS[t] ?? t}</span>
                        {p?.amount != null && (
                          <span style={{ fontWeight: 600, fontSize: "var(--text-xs)", color: "var(--muted)" }}>
                            {castka(p.amount, p.currency)} / {obdobi === "year" ? "rok" : "měsíc"}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>

                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <span style={{ fontSize: "var(--text-sm)", fontWeight: 700, color: "var(--text)" }}>Platit</span>
                  {([["month", "měsíčně"], ["year", "ročně"]] as const).map(([hodnota, popis]) => (
                    <button
                      key={hodnota}
                      type="button"
                      onClick={() => setObdobi(hodnota)}
                      style={{
                        padding: "5px 14px",
                        borderRadius: 999,
                        border: `1px solid ${obdobi === hodnota ? "var(--accent)" : "var(--border)"}`,
                        background: obdobi === hodnota ? "var(--accent-soft)" : "var(--panel)",
                        color: obdobi === hodnota ? "var(--accent)" : "var(--text)",
                        fontSize: "var(--text-sm)",
                        fontWeight: 700,
                        cursor: "pointer",
                      }}
                    >
                      {popis}
                    </button>
                  ))}
                </div>
                <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: "var(--text-sm)", color: "var(--text)" }}>
                  Pobočky navíc
                  <input
                    type="number"
                    min={0}
                    max={50}
                    value={pobockyNavic}
                    onChange={(e) => setPobockyNavic(Math.max(0, Math.min(50, Number(e.target.value) || 0)))}
                    className="ui-input"
                    style={{ width: 70, padding: "4px 8px", textAlign: "center" }}
                  />
                  <span style={{ color: "var(--muted)", fontSize: "var(--text-xs)" }}>
                    tarif zahrnuje {vybrany?.branchesIncluded ?? 1}
                  </span>
                </label>
                {!maSmsVCene && (
                  <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: "var(--text-sm)", color: "var(--text)", cursor: "pointer" }}>
                    <input type="checkbox" checked={smsNavic} onChange={(e) => setSmsNavic(e.target.checked)} />
                    SMS zákazníkům (příplatek)
                  </label>
                )}
                {plany.length === 0 && (
                  <div style={{ fontSize: "var(--text-xs)", color: "var(--muted)" }}>
                    Ceny se načtou z platební brány, až bude spuštěná. Aktuální ceník je na appjobi.com.
                  </div>
                )}
              </div>
            )}

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {maPredplatne ? (
                <Button variant="primary" onClick={() => void spravovat()} disabled={busy !== null}>
                  {busy === "portal" ? "Otevírám…" : "Spravovat předplatné"}
                </Button>
              ) : (
                <Button variant="primary" onClick={() => void koupit()} disabled={busy !== null}>
                  {busy === "checkout" ? "Otevírám…" : "Vybrat plán"}
                </Button>
              )}
              <Button variant="soft" onClick={() => window.open("https://appjobi.com/cenik", "_blank", "noopener")}>
                Ceník
              </Button>
            </div>
            </>
          )}
        </div>
      )}
    </Card>
  );
}
