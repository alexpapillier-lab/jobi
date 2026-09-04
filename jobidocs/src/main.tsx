import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

/** Pád v UI nesmí nechat prázdné okno – ukáže se hláška a tlačítko pro obnovení. */
class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 32, fontFamily: "system-ui, sans-serif", maxWidth: 640 }}>
          <h2 style={{ marginTop: 0 }}>JobiDocs narazil na chybu</h2>
          <p style={{ color: "#6b7280" }}>Rozpracované změny jsou zálohované a po obnovení se nabídnou k načtení.</p>
          <pre style={{ background: "#f3f4f6", padding: 12, borderRadius: 8, fontSize: 12, overflow: "auto" }}>{String(this.state.error?.message ?? this.state.error)}</pre>
          <button type="button" onClick={() => window.location.reload()} style={{ padding: "10px 16px", borderRadius: 8, border: "1px solid #d1d5db", background: "#fff", cursor: "pointer" }}>
            Obnovit aplikaci
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
