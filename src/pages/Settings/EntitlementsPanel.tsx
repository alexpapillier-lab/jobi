import { useCallback, useEffect, useState } from "react";
import { supabase, supabaseUrl, supabaseAnonKey, supabaseFetch } from "../../lib/supabaseClient";
import { Card } from "../../lib/settingsUi";
import { showToast } from "../../components/Toast";

/**
 * Správa nároků servisů na placené moduly. Jen pro root ownera.
 *
 * Data jdou přes Edge Function entitlements-manage – tabulka
 * service_entitlements má RLS, která zápis nikomu nepovoluje.
 */

type Row = {
  id: string;
  service_id: string;
  service_name: string | null;
  module: string;
  active: boolean;
  valid_until: string | null;
  note: string | null;
  /** Kolik kusů modulu má servis zaplaceno (dnes počet poboček). NULL = bez omezení. */
  quota: number | null;
};

type Service = { service_id: string; service_name: string };

/** Stav předplatného servisu (ze Stripe přes billing-webhook). */
type BillingRow = {
  service_id: string;
  status: string | null;
  plan: string | null;
  branches_quantity: number;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  stripe_customer_id: string | null;
};

const STATUS_LABELS: Record<string, string> = {
  trialing: "zkušební období",
  active: "aktivní",
  past_due: "po splatnosti",
  canceled: "zrušeno",
  unpaid: "nezaplaceno",
  incomplete: "nedokončeno",
};

const PLAN_LABELS: Record<string, string> = {
  jobi_plan_monthly: "měsíční tarif",
  jobi_plan_yearly: "roční tarif",
};

const PROVIDER_LABELS: Record<string, string> = { idoklad: "iDoklad", fakturoid: "Fakturoid" };

function datum(v: string | null | undefined): string {
  return v ? new Date(v).toLocaleDateString("cs-CZ") : "";
}

const MODULE_LABELS: Record<string, string> = {
  access: "Přístup do aplikace",
  sms: "SMS",
  invoices: "Faktury",
  api_catalog: "Veřejné API – ceník",
  api_inventory: "Veřejné API – sklad",
  branches: "Pobočky",
  accounting: "Napojení na účetnictví",
  consolidated: "Konsolidované statistiky",
};

/** Popisek jednotky u modulů prodávaných po kusech. */
const QUOTA_UNIT: Record<string, string> = { branches: "poboček", sms: "SMS měsíčně" };

async function callManage(body: Record<string, unknown>): Promise<{ ok?: boolean; error?: string; entitlements?: Row[]; modules?: string[]; quotaModules?: string[]; branchCounts?: Record<string, number>; billing?: Record<string, BillingRow>; integrations?: Record<string, string[]> }> {
  const client = supabase;
  if (!client || !supabaseUrl || !supabaseAnonKey) throw new Error("Chybí konfigurace Supabase.");
  // refreshSession: v desktopu getSession() často vrací prošlý token -> 401
  const { data: refreshed } = await client.auth.refreshSession();
  const token =
    refreshed?.session?.access_token ?? (await client.auth.getSession()).data?.session?.access_token;
  if (!token) throw new Error("Nejste přihlášeni.");

  const res = await supabaseFetch(`${supabaseUrl}/functions/v1/entitlements-manage`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      apikey: supabaseAnonKey,
    },
    body: JSON.stringify(body),
  });
  const raw = await res.text();
  const data = raw ? JSON.parse(raw) : {};
  if (!res.ok) throw new Error(data?.error || `Chyba ${res.status}`);
  return data;
}

export function EntitlementsPanel({ services }: { services: Service[] }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [modules, setModules] = useState<string[]>([]);
  const [quotaModules, setQuotaModules] = useState<string[]>(["branches"]);
  const [branchCounts, setBranchCounts] = useState<Record<string, number>>({});
  const [billing, setBilling] = useState<Record<string, BillingRow>>({});
  const [integrations, setIntegrations] = useState<Record<string, string[]>>({});
  /** Rozepsaný limit, než ho uživatel potvrdí (Enter / opuštění pole). */
  const [quotaDraft, setQuotaDraft] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await callManage({ action: "list" });
      setRows(data.entitlements ?? []);
      setModules(data.modules ?? ["access", "sms", "invoices", "api_catalog", "api_inventory", "branches", "accounting", "consolidated"]);
      setQuotaModules(data.quotaModules ?? ["branches"]);
      setBranchCounts(data.branchCounts ?? {});
      setBilling(data.billing ?? {});
      setIntegrations(data.integrations ?? {});
      setQuotaDraft({});
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const toggle = async (serviceId: string, module: string, grant: boolean) => {
    const key = `${serviceId}:${module}`;
    setBusy(key);
    try {
      await callManage({ action: grant ? "grant" : "revoke", serviceId, module });
      showToast(
        `${MODULE_LABELS[module] ?? module} ${grant ? "zapnuto" : "vypnuto"}`,
        "success"
      );
      await load();
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setBusy(null);
    }
  };

  /** Zruší časové omezení nároku – ze zkušebního období udělá trvalý modul. */
  const zrusitPlatnost = async (serviceId: string, module: string) => {
    const key = `${serviceId}:${module}`;
    setBusy(key);
    try {
      await callManage({ action: "grant", serviceId, module, validUntil: null });
      showToast("Modul zapnutý natrvalo", "success");
      await load();
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setBusy(null);
    }
  };

  /** Uloží limit počtu kusů (prázdné = bez omezení). */
  const saveQuota = async (serviceId: string, module: string, raw: string) => {
    const key = `${serviceId}:${module}`;
    const trimmed = raw.trim();
    const current = rows.find((x) => x.service_id === serviceId && x.module === module)?.quota ?? null;
    const next = trimmed === "" ? null : Number(trimmed);
    if (next !== null && (!Number.isInteger(next) || next < 1)) {
      showToast("Počet musí být celé číslo aspoň 1, nebo prázdné pole pro bez omezení.", "error");
      return;
    }
    if (next === current) {
      setQuotaDraft((d) => { const c = { ...d }; delete c[key]; return c; });
      return;
    }
    setBusy(key);
    try {
      await callManage({ action: "grant", serviceId, module, quota: next });
      showToast(next === null ? "Limit zrušen (bez omezení)" : `Limit nastaven na ${next}`, "success");
      await load();
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setBusy(null);
    }
  };

  /** Má servis daný modul právě teď platný? */
  const isActive = (serviceId: string, module: string) => {
    const r = rows.find((x) => x.service_id === serviceId && x.module === module);
    if (!r || !r.active) return false;
    return !r.valid_until || r.valid_until > new Date().toISOString();
  };

  return (
    <Card>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "var(--space-3)", marginBottom: "var(--space-4)" }}>
        <div>
          <div style={{ fontWeight: 950, fontSize: "var(--text-lg)", marginBottom: 4, color: "var(--text)" }}>
            Placené moduly
          </div>
          <div style={{ fontSize: "var(--text-base)", color: "var(--muted)" }}>
            Co má který servis zaplacené. Vypnutí modul jen zneplatní, záznam zůstane.
          </div>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          style={{
            padding: "8px 16px", borderRadius: "var(--radius-2xs)", border: "1px solid var(--border)",
            background: "var(--panel)", color: "var(--text)", fontWeight: 600,
            fontSize: "var(--text-base)", cursor: loading ? "default" : "pointer", opacity: loading ? 0.6 : 1,
          }}
        >
          {loading ? "Načítám…" : "Obnovit"}
        </button>
      </div>

      {error && (
        <div style={{ padding: "var(--space-3)", borderRadius: "var(--radius-xs)", background: "var(--danger-soft)", color: "var(--danger-text)", fontSize: "var(--text-base)", marginBottom: "var(--space-3)" }}>
          {error}
        </div>
      )}

      {services.length === 0 && !loading && (
        <div style={{ fontSize: "var(--text-base)", color: "var(--muted)" }}>Žádné servisy k zobrazení.</div>
      )}

      <div style={{ display: "grid", gap: "var(--space-2)" }}>
        {services.map((s) => (
          <div
            key={s.service_id}
            style={{
              display: "flex", justifyContent: "space-between", alignItems: "center",
              flexWrap: "wrap", gap: "var(--space-3)",
              padding: "var(--space-3)", borderRadius: "var(--radius-xs)",
              border: "1px solid var(--border)", background: "var(--panel)",
            }}
          >
            <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 200, flex: "1 1 220px" }}>
              <span style={{ fontWeight: 700, fontSize: "var(--text-base)", color: "var(--text)" }}>
                {s.service_name}
              </span>
              {/* Souhrn: na čem servis jede, aniž by se chodilo do Stripe. */}
              <span style={{ fontSize: "var(--text-xs)", color: "var(--muted)" }}>
                {(() => {
                  const b = billing[s.service_id];
                  const casti: string[] = [];
                  if (b?.status) {
                    const stav = STATUS_LABELS[b.status] ?? b.status;
                    const plan = b.plan ? PLAN_LABELS[b.plan] ?? b.plan : null;
                    casti.push(plan ? `${plan}, ${stav}` : stav);
                    if (b.current_period_end) {
                      casti.push(`${b.cancel_at_period_end ? "končí" : "platí do"} ${datum(b.current_period_end)}`);
                    }
                  } else {
                    // Bez předplatného: rozhoduje platnost nároku na přístup.
                    const pristup = rows.find((x) => x.service_id === s.service_id && x.module === "access");
                    if (!pristup || !pristup.active) casti.push("bez přístupu do aplikace");
                    else if (pristup.valid_until) casti.push(`zkušební období do ${datum(pristup.valid_until)}`);
                    else casti.push("trvalý přístup, bez předplatného");
                  }
                  const limit = rows.find((x) => x.service_id === s.service_id && x.module === "branches")?.quota;
                  const ma = branchCounts[s.service_id] ?? 0;
                  if (ma > 1 || (limit ?? 0) > 1) casti.push(`pobočky ${ma}${limit ? ` z ${limit}` : ""}`);
                  const fakturace = integrations[s.service_id] ?? [];
                  if (fakturace.length > 0) casti.push(fakturace.map((p) => PROVIDER_LABELS[p] ?? p).join(", "));
                  return casti.join(" · ");
                })()}
              </span>
            </span>
            <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap", alignItems: "center" }}>
              {modules.map((m) => {
                const on = isActive(s.service_id, m);
                const key = `${s.service_id}:${m}`;
                const row = rows.find((x) => x.service_id === s.service_id && x.module === m);
                const hasQuota = quotaModules.includes(m);
                const used = m === "branches" ? branchCounts[s.service_id] ?? 0 : 0;
                const draft = quotaDraft[key] ?? (row?.quota == null ? "" : String(row.quota));
                return (
                  <span key={m} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                    <button
                      type="button"
                      disabled={busy === key}
                      onClick={() => void toggle(s.service_id, m, !on)}
                      title={on ? "Kliknutím vypnout" : "Kliknutím zapnout"}
                      style={{
                        padding: "6px 14px", borderRadius: "var(--radius-pill)",
                        border: `1px solid ${on ? "var(--success)" : "var(--border)"}`,
                        background: on ? "var(--success-soft)" : "transparent",
                        color: on ? "var(--success-text)" : "var(--muted)",
                        fontWeight: 700, fontSize: "var(--text-sm)",
                        cursor: busy === key ? "default" : "pointer",
                        opacity: busy === key ? 0.5 : 1,
                      }}
                    >
                      {MODULE_LABELS[m] ?? m} {on ? "✓" : "—"}
                    </button>
                    {/* Zkušební období: nárok platí jen do data. */}
                    {on && row?.valid_until && (
                      <button
                        type="button"
                        disabled={busy === key}
                        onClick={() => void zrusitPlatnost(s.service_id, m)}
                        title={`Platí do ${new Date(row.valid_until).toLocaleString("cs-CZ")}. Kliknutím zapnout natrvalo.`}
                        style={{ border: "none", background: "transparent", fontSize: "var(--text-xs)", color: "var(--warning-text)", fontWeight: 700, cursor: "pointer", padding: 0 }}
                      >
                        do {new Date(row.valid_until).toLocaleDateString("cs-CZ")}
                      </button>
                    )}
                    {/* Moduly po kusech (pobočky): kolik jich má servis zaplaceno. Prázdné = bez omezení. */}
                    {hasQuota && on && (
                      <label
                        title={`Kolik ${QUOTA_UNIT[m] ?? "kusů"} smí servis mít. Prázdné = bez omezení. Právě používá ${used}.`}
                        style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: "var(--text-xs)", color: "var(--muted)" }}
                      >
                        max
                        <input
                          type="number"
                          min={1}
                          step={1}
                          inputMode="numeric"
                          value={draft}
                          placeholder="∞"
                          disabled={busy === key}
                          onChange={(e) => setQuotaDraft((d) => ({ ...d, [key]: e.target.value }))}
                          onBlur={(e) => void saveQuota(s.service_id, m, e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                            if (e.key === "Escape") setQuotaDraft((d) => { const c = { ...d }; delete c[key]; return c; });
                          }}
                          style={{
                            width: 52, padding: "4px 6px", borderRadius: "var(--radius-2xs)",
                            border: "1px solid var(--border)", background: "var(--panel-2)",
                            color: "var(--text)", fontSize: "var(--text-xs)", fontWeight: 700, textAlign: "center",
                          }}
                        />
                        {m === "branches" && <span style={{ fontVariantNumeric: "tabular-nums" }}>· má {used}</span>}
                      </label>
                    )}
                  </span>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}
