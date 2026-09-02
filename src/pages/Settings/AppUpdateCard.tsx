import { useAppUpdate } from "../../context/AppUpdateContext";

export function AppUpdateCard() {
  const update = useAppUpdate();
  if (!update) return null;

  const { update: updateInfo, downloadProgress, downloaded, checking, downloading, error, checkForUpdate, downloadAndInstall, relaunch } = update;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {!updateInfo && !checking && (
        <div style={{ fontSize: 13, color: "var(--muted)" }}>
          Aktuálně nemáte k dispozici žádnou novou verzi. Kontrola probíhá automaticky.
        </div>
      )}
      {checking && <div style={{ fontSize: 13, color: "var(--muted)" }}>Kontroluji aktualizace…</div>}
      {error && <div style={{ fontSize: 13, color: "var(--danger-text)" }}>Chyba: {error}</div>}
      {updateInfo && !downloaded && (
        <>
          <div style={{ fontSize: 13, color: "var(--text)" }}>
            K dispozici je nová verze <strong>{updateInfo.version}</strong>
            {updateInfo.body && <div style={{ marginTop: 8, color: "var(--muted)", whiteSpace: "pre-wrap" }}>{updateInfo.body}</div>}
          </div>
          {!downloading ? (
            <button
              type="button"
              onClick={downloadAndInstall}
              disabled={downloading}
              style={{
                padding: "10px 20px",
                background: "var(--accent)",
                color: "white",
                border: "none",
                borderRadius: "var(--radius-md)",
                cursor: "pointer",
                fontWeight: 600,
                fontSize: 14,
                alignSelf: "flex-start",
              }}
            >
              Nainstalovat
            </button>
          ) : (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <div
                  style={{
                    flex: 1,
                    height: 8,
                    background: "var(--panel-2)",
                    borderRadius: 4,
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      width: `${downloadProgress}%`,
                      height: "100%",
                      background: "var(--accent)",
                      borderRadius: 4,
                      transition: "width 0.2s ease",
                    }}
                  />
                </div>
                <span style={{ fontSize: 12, color: "var(--muted)", minWidth: 36 }}>{downloadProgress}%</span>
              </div>
              <div style={{ fontSize: 13, color: "var(--muted)" }}>Stahuji…</div>
            </>
          )}
        </>
      )}
      {downloaded && (
        <button
          type="button"
          onClick={relaunch}
          style={{
            padding: "10px 20px",
            background: "var(--accent)",
            color: "white",
            border: "none",
            borderRadius: "var(--radius-md)",
            cursor: "pointer",
            fontWeight: 600,
            fontSize: 14,
            alignSelf: "flex-start",
          }}
        >
          Restartovat a nainstalovat
        </button>
      )}
      <button
        type="button"
        onClick={checkForUpdate}
        disabled={checking}
        style={{
          padding: "8px 14px",
          background: "var(--panel-2)",
          color: "var(--text)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-md)",
          cursor: checking ? "not-allowed" : "pointer",
          fontSize: 12,
          alignSelf: "flex-start",
        }}
      >
        {checking ? "Kontroluji…" : "Zkontrolovat aktualizace"}
      </button>
    </div>
  );
}
