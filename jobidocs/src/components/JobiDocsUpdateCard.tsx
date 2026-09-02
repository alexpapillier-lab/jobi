export function JobiDocsUpdateCard({
  updateState,
  updateError,
  updateChecking,
  updateDownloading,
  onCheck,
  onDownload,
  onRestart,
}: {
  updateState: { version: string; downloaded: boolean; progress: number } | null;
  updateError: string | null;
  updateChecking: boolean;
  updateDownloading: boolean;
  onCheck: () => Promise<void>;
  onDownload: () => Promise<void>;
  onRestart: () => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {updateError && (
        <div style={{ fontSize: 13, color: "var(--error)" }}>
          Kontrola aktualizací selhala: {updateError}
        </div>
      )}
      {!updateState && !updateChecking && !updateError && (
        <div style={{ fontSize: 13, color: "var(--muted)" }}>
          Aktuálně nemáte k dispozici žádnou novou verzi. Kontrola probíhá automaticky.
        </div>
      )}
      {updateChecking && <div style={{ fontSize: 13, color: "var(--muted)" }}>Kontroluji aktualizace…</div>}
      {updateState && !updateState.downloaded && (
        <>
          <div style={{ fontSize: 13, color: "var(--text)" }}>
            K dispozici je nová verze <strong>{updateState.version}</strong>
          </div>
          {!updateDownloading && updateState.progress === 0 ? (
            <button
              type="button"
              onClick={onDownload}
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
                      width: `${updateState.progress}%`,
                      height: "100%",
                      background: "var(--accent)",
                      borderRadius: 4,
                      transition: "width 0.2s ease",
                    }}
                  />
                </div>
                <span style={{ fontSize: 12, color: "var(--muted)", minWidth: 36 }}>{Math.round(updateState.progress)}%</span>
              </div>
              <div style={{ fontSize: 13, color: "var(--muted)" }}>Stahuji…</div>
            </>
          )}
        </>
      )}
      {updateState?.downloaded && (
        <button
          type="button"
          onClick={onRestart}
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
        onClick={onCheck}
        disabled={updateChecking}
        style={{
          padding: "8px 14px",
          background: "var(--panel-2)",
          color: "var(--text)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-md)",
          cursor: updateChecking ? "not-allowed" : "pointer",
          fontSize: 12,
          alignSelf: "flex-start",
        }}
      >
        {updateChecking ? "Kontroluji…" : "Zkontrolovat aktualizace"}
      </button>
    </div>
  );
}
