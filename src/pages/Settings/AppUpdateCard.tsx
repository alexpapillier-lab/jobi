import { useAppUpdate } from "../../context/AppUpdateContext";
import { Button } from "../../components/ui/Button";
import { CheckIcon, DownloadIcon, WarningIcon } from "../../components/icons";

function relativeTime(ts: number | null): string {
  if (!ts) return "ještě neproběhla";
  const diff = Math.max(0, Date.now() - ts);
  const min = Math.round(diff / 60000);
  if (min < 1) return "právě teď";
  if (min < 60) return `před ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `před ${h} h`;
  return new Date(ts).toLocaleString("cs-CZ", { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** Poznámky k vydání: řádky začínající - nebo * jako odrážky, zbytek odstavce. */
function ReleaseNotes({ body }: { body: string }) {
  const lines = body.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return null;
  const bullets = lines.filter((l) => /^[-*•]\s+/.test(l));
  if (bullets.length >= Math.max(1, lines.length - 1)) {
    return (
      <ul style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 4, color: "var(--text)", fontSize: "var(--text-sm)" }}>
        {lines.map((l, i) => (
          <li key={i}>{l.replace(/^[-*•]\s+/, "")}</li>
        ))}
      </ul>
    );
  }
  return <div style={{ whiteSpace: "pre-wrap", color: "var(--text)", fontSize: "var(--text-sm)", lineHeight: 1.5 }}>{body.trim()}</div>;
}

export function AppUpdateCard() {
  const update = useAppUpdate();
  if (!update) return null;

  const { phase, update: info, downloadProgress, checking, error, lastCheckedAt, currentVersion, autoDownload, checkForUpdate, downloadAndInstall, relaunch, setAutoDownload } = update;

  const statusRow = (() => {
    switch (phase) {
      case "checking":
        return { tone: "var(--muted)", text: "Kontroluji, jestli je nová verze…" };
      case "available":
        return { tone: "var(--text)", text: `Nová verze ${info?.version} je k dispozici.` };
      case "downloading":
        return { tone: "var(--text)", text: `Stahuji verzi ${info?.version}…` };
      case "ready":
        return { tone: "var(--success-text)", text: `Verze ${info?.version} je připravená. Nainstaluje se při restartu aplikace.` };
      case "error":
        return { tone: "var(--danger-text)", text: error ?? "Aktualizace se nepodařila." };
      default:
        return { tone: "var(--muted)", text: "Máte nejnovější verzi." };
    }
  })();

  return (
    <div style={{ display: "grid", gap: "var(--space-4)" }}>
      {/* Stavový řádek */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: "var(--space-3)" }}>
        <div
          aria-hidden
          style={{
            width: 36,
            height: 36,
            borderRadius: 10,
            flexShrink: 0,
            display: "grid",
            placeItems: "center",
            background: phase === "error" ? "var(--danger-soft)" : phase === "ready" ? "var(--success-soft)" : "var(--accent-soft)",
            color: phase === "error" ? "var(--danger-text)" : phase === "ready" ? "var(--success-text)" : "var(--accent)",
          }}
        >
          {phase === "error" ? <WarningIcon size={18} /> : phase === "ready" || phase === "idle" ? <CheckIcon size={18} /> : <DownloadIcon size={18} />}
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontWeight: 700, color: statusRow.tone, fontSize: "var(--text-base)" }}>{statusRow.text}</div>
          <div style={{ color: "var(--muted)", fontSize: "var(--text-sm)", marginTop: 2 }}>
            Běží verze {currentVersion ?? "…"} · poslední kontrola {relativeTime(lastCheckedAt)}
          </div>
        </div>
      </div>

      {/* Průběh stahování */}
      {phase === "downloading" && (
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
          <div style={{ flex: 1, height: 6, background: "var(--panel-2)", borderRadius: 3, overflow: "hidden" }} role="progressbar" aria-valuenow={downloadProgress} aria-valuemin={0} aria-valuemax={100}>
            <div style={{ width: `${downloadProgress}%`, height: "100%", background: "var(--accent)", transition: "width 0.2s ease" }} />
          </div>
          <span style={{ fontSize: "var(--text-sm)", color: "var(--muted)", minWidth: 36, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{downloadProgress} %</span>
        </div>
      )}

      {/* Co je nového */}
      {info?.body && (phase === "available" || phase === "downloading" || phase === "ready") && (
        <div style={{ padding: "var(--space-3) var(--space-4)", borderRadius: "var(--radius-md)", background: "var(--panel-2)", display: "grid", gap: "var(--space-2)" }}>
          <div style={{ fontSize: "var(--text-xs)", fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", color: "var(--muted)" }}>
            Co je nového ve verzi {info.version}
            {info.date ? ` · ${new Date(info.date).toLocaleDateString("cs-CZ")}` : ""}
          </div>
          <ReleaseNotes body={info.body} />
        </div>
      )}

      {/* Akce */}
      <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap", alignItems: "center" }}>
        {phase === "ready" && (
          <Button variant="primary" onClick={relaunch}>
            Restartovat do nové verze
          </Button>
        )}
        {(phase === "available" || (phase === "error" && info)) && (
          <Button variant="primary" onClick={downloadAndInstall} icon={<DownloadIcon size={16} />}>
            {phase === "error" ? "Zkusit stáhnout znovu" : `Stáhnout verzi ${info?.version}`}
          </Button>
        )}
        {phase !== "downloading" && phase !== "ready" && (
          <Button variant="soft" onClick={checkForUpdate} disabled={checking}>
            {checking ? "Kontroluji…" : "Zkontrolovat teď"}
          </Button>
        )}
        {phase === "ready" && (
          <span style={{ color: "var(--muted)", fontSize: "var(--text-sm)" }}>Restart trvá pár sekund; rozpracovaná práce zůstane uložená v cloudu.</span>
        )}
      </div>

      {/* Volba */}
      <label style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", cursor: "pointer", fontSize: "var(--text-sm)", color: "var(--text)" }}>
        <input type="checkbox" checked={autoDownload} onChange={(e) => setAutoDownload(e.target.checked)} />
        <span>
          Stahovat nové verze automaticky
          <span style={{ color: "var(--muted)" }}> · ozveme se, až bude verze připravená k restartu</span>
        </span>
      </label>
    </div>
  );
}
