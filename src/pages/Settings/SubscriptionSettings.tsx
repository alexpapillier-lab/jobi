import { useEffect, useMemo, useState } from "react";
import { Button, Pill } from "../../components/ui";
import { Card } from "../../lib/settingsUi";
import { SectionHeading } from "../../components/SectionHeading";
import { showToast } from "../../components/Toast";
import { CheckIcon, XIcon } from "../../components/icons";
import { useEntitlements } from "../../hooks/useEntitlements";
import {
  castka,
  loadBilling,
  loadCenik,
  openPortal,
  startCheckout,
  MODUL_POPIS,
  PODPORA_EMAIL,
  SLEVA_ROCNE,
  STATUS_LABELS,
  TARIFY,
  type BillingRow,
  type Plan,
  type TarifInfo,
} from "../../lib/billing";

/**
 * Nastavení → Firma → Předplatné.
 *
 * Obrazovka odpovídá na dvě otázky, každou ve své kartě: co mám teď zapnuté
 * a do kdy, a co bych dostal, kdybych si vybral jiný tarif. Dřív to byl jeden
 * odstavec s výčtem oddělovaným tečkami a tři tlačítka bez popisu, takže z ní
 * nešlo poznat, co si člověk kupuje.
 *
 * Ceny se v aplikaci neopisují – načítají se ze Stripe funkcí `billing-prices`.
 * Dokud platby neběží, ukáže se odkaz na ceník a nabídka zapnout plán ručně.
 */
const VSECHNY_MODULY = ["access", "invoices", "accounting", "sms", "branches", "api_catalog", "api_inventory", "consolidated"] as const;

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

  /** Cena tarifu ze Stripe, pokud už ceník existuje. */
  const cena = (t: TarifInfo["tier"]): string | null => {
    const p = plany.find((x) => x.tier === t && x.interval === obdobi);
    return p?.amount != null ? castka(p.amount, p.currency) : null;
  };

  const vybrany = plany.find((p) => p.tier === tarif && p.interval === obdobi);
  const vybranyInfo = TARIFY.find((t) => t.tier === tarif)!;
  const klicTarifu = vybrany?.lookup_key ?? `jobi_${tarif}_${obdobi === "year" ? "yearly" : "monthly"}`;
  const maSmsVCene = (vybrany?.modules ?? vybranyInfo.modules).includes("sms");

  const koupit = async () => {
    setBusy("checkout");
    const res = await startCheckout(activeServiceId, { plan: klicTarifu, branches: pobockyNavic, sms: smsNavic && !maSmsVCene });
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
  const smsStrop = quota("sms");
  const dnyDoKonce = trialDaysLeft ?? 0;

  /** Řádky přehledu „co mám zapnuté". Vypnuté se ukazují taky – jinak není vidět, co si lze dokoupit. */
  const stavModulu = useMemo(
    () => VSECHNY_MODULY.map((m) => ({ modul: m, popis: MODUL_POPIS[m] ?? m, zapnuty: has(m) })),
    [has]
  );

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <Card>
        <SectionHeading size="sm">Co máte zapnuté</SectionHeading>

        {loading ? (
          <div style={{ color: "var(--muted)", fontSize: "var(--text-sm)", marginTop: 14 }}>Načítání…</div>
        ) : (
          <div style={{ marginTop: 14, display: "grid", gap: 16 }}>
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              {maPredplatne ? (
                <Pill color={row?.status === "past_due" ? "var(--danger-text)" : "var(--success-text, #16a34a)"}>
                  {row?.plan ? `${STATUS_LABELS[row.status ?? ""] ?? stav} · ${popisTarifu(row.plan)}` : stav}
                </Pill>
              ) : trialEndsAt ? (
                <Pill color={dnyDoKonce > 0 ? "var(--warning-text)" : "var(--danger-text)"}>
                  {dnyDoKonce > 0 ? `Zkušební období, ${dnyText(dnyDoKonce)}` : "Zkušební období skončilo"}
                </Pill>
              ) : (
                <Pill color="var(--success-text, #16a34a)">Aktivní bez omezení</Pill>
              )}
              {maPredplatne && (
                <Button size="sm" variant="soft" onClick={() => void spravovat()} disabled={busy !== null}>
                  {busy === "portal" ? "Otevírám…" : "Karta, faktury a zrušení"}
                </Button>
              )}
            </div>

            <dl style={{ display: "grid", gap: 8, margin: 0, fontSize: "var(--text-sm)" }}>
              {row?.current_period_end && (
                <Radek
                  popisek={row.cancel_at_period_end ? "Předplatné končí" : "Další platba"}
                  hodnota={new Date(row.current_period_end).toLocaleDateString("cs-CZ")}
                />
              )}
              {trialEndsAt && !maPredplatne && (
                <Radek popisek="Zkušební období do" hodnota={new Date(trialEndsAt).toLocaleDateString("cs-CZ")} />
              )}
              <Radek
                popisek="Pobočky"
                hodnota={
                  pobocek === null
                    ? "bez omezení"
                    : `${pobocek}${row && row.branches_quantity > 0 ? ` (z toho ${row.branches_quantity} navíc)` : ""}`
                }
              />
              {has("sms") && (
                <Radek popisek="SMS za měsíc" hodnota={smsStrop === null ? "bez omezení" : `${smsStrop} zpráv`} />
              )}
            </dl>

            <div role="list" style={{ display: "grid", gap: 6 }}>
              {stavModulu.map(({ modul, popis, zapnuty }) => (
                <div
                  key={modul}
                  role="listitem"
                  aria-label={`${popis}: ${zapnuty ? "zapnuto" : "vypnuto"}`}
                  style={{ display: "flex", alignItems: "center", gap: 8, fontSize: "var(--text-sm)" }}
                >
                  <span
                    aria-hidden
                    style={{
                      width: 18,
                      height: 18,
                      borderRadius: 999,
                      display: "grid",
                      placeItems: "center",
                      flexShrink: 0,
                      background: zapnuty ? "var(--success-soft, rgba(34,197,94,0.15))" : "var(--panel-2)",
                      color: zapnuty ? "var(--success-text, #16a34a)" : "var(--muted)",
                    }}
                  >
                    {zapnuty ? <CheckIcon size={11} /> : <XIcon size={11} />}
                  </span>
                  <span style={{ color: zapnuty ? "var(--text)" : "var(--muted)" }}>{popis}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </Card>

      {!loading && !maPredplatne && (
        <Card>
          <SectionHeading size="sm">Vyberte tarif</SectionHeading>
          <div style={{ color: "var(--muted)", fontSize: "var(--text-sm)", marginTop: "calc(-1 * var(--space-2))" }}>
            Platí se kartou. Fakturu a správu karty řeší platební brána, tarif se dá kdykoli změnit.
          </div>

          {platbyVypnute ? (
            <div style={{ marginTop: 16, padding: "12px 14px", borderRadius: 10, background: "var(--panel-2)", border: "1px solid var(--border)", fontSize: "var(--text-sm)", color: "var(--text)" }}>
              Platby zatím nejsou spuštěné. Napište nám na{" "}
              <a href={`mailto:${PODPORA_EMAIL}?subject=Jobi%20%E2%80%93%20p%C5%99edplatn%C3%A9`} style={{ color: "var(--accent)", fontWeight: 700 }}>{PODPORA_EMAIL}</a>{" "}
              a plán vám zapneme ručně.
            </div>
          ) : (
            <div style={{ marginTop: 16, display: "grid", gap: 16 }}>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                {([["month", "Platit měsíčně"], ["year", "Platit ročně"]] as const).map(([hodnota, popis]) => (
                  <button
                    key={hodnota}
                    type="button"
                    onClick={() => setObdobi(hodnota)}
                    aria-pressed={obdobi === hodnota}
                    style={{
                      padding: "6px 14px",
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
                <span style={{ fontSize: "var(--text-xs)", color: "var(--success-text, #16a34a)", fontWeight: 700 }}>
                  Ročně ušetříte {SLEVA_ROCNE} %
                </span>
              </div>

              <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 220px), 1fr))" }}>
                {TARIFY.map((t) => {
                  const vybrano = tarif === t.tier;
                  const c = cena(t.tier);
                  return (
                    <button
                      key={t.tier}
                      type="button"
                      onClick={() => setTarif(t.tier)}
                      aria-pressed={vybrano}
                      style={{
                        textAlign: "left",
                        padding: 14,
                        borderRadius: 12,
                        border: `1px solid ${vybrano ? "var(--accent)" : "var(--border)"}`,
                        background: vybrano ? "var(--accent-soft)" : "var(--panel)",
                        cursor: "pointer",
                        display: "grid",
                        gap: 10,
                        alignContent: "start",
                      }}
                    >
                      <div>
                        <div style={{ fontWeight: 800, fontSize: "var(--text-md, 15px)", color: vybrano ? "var(--accent)" : "var(--text)" }}>
                          {t.label}
                        </div>
                        <div style={{ fontWeight: 800, fontSize: 20, color: "var(--text)", marginTop: 2 }}>
                          {c ?? "—"}
                          <span style={{ fontWeight: 600, fontSize: "var(--text-xs)", color: "var(--muted)" }}>
                            {c ? ` / ${obdobi === "year" ? "rok" : "měsíc"}` : ""}
                          </span>
                        </div>
                      </div>
                      <div style={{ fontSize: "var(--text-xs)", color: "var(--muted)", lineHeight: 1.5 }}>{t.popis}</div>
                      <div style={{ display: "grid", gap: 4 }}>
                        {t.modules.map((m) => (
                          <div key={m} style={{ display: "flex", gap: 6, alignItems: "center", fontSize: "var(--text-xs)", color: "var(--text)" }}>
                            <CheckIcon size={11} />
                            <span>{MODUL_POPIS[m] ?? m}</span>
                          </div>
                        ))}
                        <div style={{ display: "flex", gap: 6, alignItems: "center", fontSize: "var(--text-xs)", color: "var(--muted)" }}>
                          <CheckIcon size={11} />
                          <span>
                            {t.branchesIncluded === 1 ? "1 pobočka" : `${t.branchesIncluded} pobočky`} v ceně
                            {t.smsIncluded > 0 ? `, ${t.smsIncluded} SMS měsíčně` : ""}
                          </span>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>

              <div style={{ display: "grid", gap: 10, padding: "12px 14px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--panel-2)" }}>
                <div style={{ fontSize: "var(--text-sm)", fontWeight: 700, color: "var(--text)" }}>Připlatit si</div>
                <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: "var(--text-sm)", color: "var(--text)", flexWrap: "wrap" }}>
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
                    nad {vybranyInfo.branchesIncluded === 1 ? "jednu pobočku" : `${vybranyInfo.branchesIncluded} pobočky`}, které tarif {vybranyInfo.label} zahrnuje
                  </span>
                </label>
                {!maSmsVCene && (
                  <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: "var(--text-sm)", color: "var(--text)", cursor: "pointer", flexWrap: "wrap" }}>
                    <input type="checkbox" checked={smsNavic} onChange={(e) => setSmsNavic(e.target.checked)} />
                    SMS zákazníkům
                    <span style={{ color: "var(--muted)", fontSize: "var(--text-xs)" }}>balíček 100 zpráv měsíčně</span>
                  </label>
                )}
              </div>

              {plany.length === 0 && (
                <div style={{ fontSize: "var(--text-xs)", color: "var(--muted)" }}>
                  Ceny se načtou z platební brány, až bude spuštěná. Aktuální ceník je na appjobi.com.
                </div>
              )}

              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
                <Button variant="soft" onClick={() => window.open("https://appjobi.com/cenik", "_blank", "noopener")}>
                  Ceník na webu
                </Button>
                <Button variant="primary" onClick={() => void koupit()} disabled={busy !== null}>
                  {busy === "checkout" ? "Otevírám…" : `Pokračovat s tarifem ${vybranyInfo.label}`}
                </Button>
              </div>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

function Radek({ popisek, hodnota }: { popisek: string; hodnota: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
      <dt style={{ color: "var(--muted)" }}>{popisek}</dt>
      <dd style={{ margin: 0, color: "var(--text)", fontWeight: 600, textAlign: "right" }}>{hodnota}</dd>
    </div>
  );
}

/** Z lookup key („jobi_business_yearly") udělá „Business, ročně". */
function popisTarifu(plan: string): string {
  const info = TARIFY.find((t) => plan.includes(t.tier));
  const rocne = plan.includes("yearly");
  return `${info?.label ?? plan}, ${rocne ? "ročně" : "měsíčně"}`;
}

/** 1 den zbývá / 2 dny zbývají / 5 dní zbývá */
function dnyText(n: number): string {
  if (n === 1) return "zbývá 1 den";
  if (n >= 2 && n <= 4) return `zbývají ${n} dny`;
  return `zbývá ${n} dní`;
}
