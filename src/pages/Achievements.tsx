import { useMemo, useState, useEffect } from "react";
import { useAuth } from "../auth/AuthProvider";
import { ACHIEVEMENT_DEFS, getAchievementDef, getEarnedForUser } from "../lib/achievements";
import { TrophyIcon } from "../components/TrophyIcon";
import { useAchievementProgress } from "../hooks/useAchievementProgress";
import type { NavKey } from "../layout/Sidebar";

type AchievementsProps = {
  activeServiceId: string | null;
  servicesCount?: number;
};

type Tab = "personal" | "service";

const CTA_LABELS: Record<string, string> = {
  orders: "Jít do Zakázek",
  customers: "Jít do Zákazníků",
  inventory: "Jít do Skladu",
  calendar: "Otevřít Kalendář",
  statistics: "Otevřít Statistiky",
};

export default function Achievements({ activeServiceId, servicesCount = 0 }: AchievementsProps) {
  const { session } = useAuth();
  const userId = session?.user?.id ?? "";
  const [refreshKey, setRefreshKey] = useState(0);
  const progress = useAchievementProgress(userId, activeServiceId, servicesCount);

  const handleCta = (feature: string) => {
    const pageMap: Record<string, NavKey> = {
      orders: "orders",
      customers: "customers",
      inventory: "inventory",
      calendar: "calendar",
      statistics: "statistics",
    };
    const page = pageMap[feature];
    if (page) {
      window.dispatchEvent(new CustomEvent("jobsheet:navigate", { detail: { page } }));
    }
  };

  useEffect(() => {
    const onUpdate = () => setRefreshKey((k) => k + 1);
    window.addEventListener("jobsheet:achievements-updated", onUpdate);
    return () => window.removeEventListener("jobsheet:achievements-updated", onUpdate);
  }, []);

  const earned = useMemo(() => getEarnedForUser(userId, activeServiceId), [userId, activeServiceId, refreshKey]);
  const earnedIds = useMemo(() => new Set(earned.map((e) => e.achievementId)), [earned]);

  const personalDefs = ACHIEVEMENT_DEFS.filter((a) => a.scope === "user");
  const serviceDefs = ACHIEVEMENT_DEFS.filter((a) => a.scope === "service");

  const [tab, setTab] = useState<Tab>("personal");

  const border = "1px solid var(--border)";

  const renderList = (defs: typeof ACHIEVEMENT_DEFS) => (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {defs.map((def) => {
        const isEarned = earnedIds.has(def.id);
        const earnedRecord = earned.find((e) => e.achievementId === def.id);
        const prog = progress[def.id];
        const showProgress = !isEarned && def.progressTarget && prog;
        const remaining = showProgress ? Math.max(0, prog.target - prog.current) : 0;
        const ctaLabel = def.ctaFeature ? CTA_LABELS[def.ctaFeature] : null;

        if (!isEarned) {
          return (
            <div
              key={def.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 16,
                padding: 14,
                borderRadius: 12,
                background: "var(--panel)",
                border,
                opacity: 0.7,
              }}
            >
              <div
                style={{
                  flexShrink: 0,
                  width: 36,
                  height: 36,
                  borderRadius: 10,
                  background: "var(--panel-2)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <LockIcon size={20} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 14, color: "var(--muted)", marginBottom: 2 }}>
                  ???
                </div>
                <div style={{ fontSize: 12, color: "var(--muted)" }}>Zamčeno – splňte úkol pro odemčení</div>
              </div>
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: "var(--muted)",
                  padding: "4px 8px",
                  borderRadius: 6,
                  background: "var(--panel-2)",
                }}
              >
                Zamčeno
              </span>
            </div>
          );
        }

        return (
          <div
            key={def.id}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 16,
              padding: 14,
              borderRadius: 12,
              background: "var(--panel)",
              border,
              opacity: 1,
            }}
          >
            <div style={{ flexShrink: 0 }}>
              <TrophyIcon tier={def.trophy} size={36} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 800, fontSize: 14, color: "var(--text)", marginBottom: 2 }}>
                {def.title}
              </div>
              <div style={{ fontSize: 12, color: "var(--muted)" }}>{def.description}</div>
              {earnedRecord && (
                <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>
                  Získáno {new Date(earnedRecord.earnedAt).toLocaleDateString("cs-CZ", {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </div>
              )}
              {showProgress && (
                <div style={{ fontSize: 11, color: "var(--accent)", fontWeight: 700, marginTop: 4 }}>
                  Zbývá {remaining}/{def.progressTarget}
                </div>
              )}
            </div>
            {ctaLabel && def.ctaFeature && (
              <button
                type="button"
                onClick={() => handleCta(def.ctaFeature!)}
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  padding: "4px 10px",
                  borderRadius: 6,
                  border: "1px solid var(--accent)",
                  background: "var(--accent-soft)",
                  color: "var(--accent)",
                  cursor: "pointer",
                }}
              >
                {ctaLabel}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );

  return (
    <div style={{ padding: "var(--pad-24)", maxWidth: 700, margin: "0 auto" }}>
      <h1 style={{ fontWeight: 800, fontSize: 24, color: "var(--text)", marginBottom: 8 }}>Achievementy</h1>
      <p style={{ fontSize: 14, color: "var(--muted)", marginBottom: 20 }}>
        Osobní achievementy jsou vázané na vaše činy, servisní na výkony celého servisu.
      </p>

      <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
        <button
          type="button"
          onClick={() => setTab("personal")}
          style={{
            padding: "10px 18px",
            borderRadius: 10,
            border: tab === "personal" ? "2px solid var(--accent)" : "1px solid var(--border)",
            background: tab === "personal" ? "var(--accent-soft)" : "var(--panel)",
            color: tab === "personal" ? "var(--accent)" : "var(--text)",
            fontWeight: 700,
            fontSize: 13,
            cursor: "pointer",
          }}
        >
          Osobní ({earned.filter((e) => getAchievementDef(e.achievementId)?.scope === "user").length}/{personalDefs.length})
        </button>
        <button
          type="button"
          onClick={() => setTab("service")}
          style={{
            padding: "10px 18px",
            borderRadius: 10,
            border: tab === "service" ? "2px solid var(--accent)" : "1px solid var(--border)",
            background: tab === "service" ? "var(--accent-soft)" : "var(--panel)",
            color: tab === "service" ? "var(--accent)" : "var(--text)",
            fontWeight: 700,
            fontSize: 13,
            cursor: "pointer",
          }}
        >
          Servisní ({earned.filter((e) => getAchievementDef(e.achievementId)?.scope === "service").length}/{serviceDefs.length})
        </button>
      </div>

      {tab === "personal" ? renderList(personalDefs) : renderList(serviceDefs)}
    </div>
  );
}

function LockIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0110 0v4" />
    </svg>
  );
}
