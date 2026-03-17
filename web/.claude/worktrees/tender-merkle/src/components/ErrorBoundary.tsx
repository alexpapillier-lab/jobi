import { Component, ErrorInfo, ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("[ErrorBoundary]", error, errorInfo);
    this.setState({
      error,
      errorInfo,
    });
  }

  handleReload = () => {
    window.location.reload();
  };

  handleCopyDetails = () => {
    const { error, errorInfo } = this.state;
    if (!error) return;

    const details = `Error: ${error.toString()}\n\nStack: ${error.stack || "N/A"}\n\nComponent Stack: ${errorInfo?.componentStack || "N/A"}`;
    
    navigator.clipboard.writeText(details).then(() => {
      alert("Detaily chyby byly zkopírovány do schránky");
    }).catch((err) => {
      console.error("[ErrorBoundary] Failed to copy to clipboard:", err);
      alert("Nepodařilo se zkopírovat detaily do schránky");
    });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            minHeight: "100vh",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            padding: 40,
            fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif",
            background: "var(--bg, #ffffff)",
            color: "var(--text, #000000)",
          }}
        >
          <div
            style={{
              maxWidth: 600,
              width: "100%",
              padding: 32,
              borderRadius: 16,
              border: "1px solid var(--border, #e0e0e0)",
              background: "var(--panel, #ffffff)",
              boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
            }}
          >
            <h1
              style={{
                fontSize: 24,
                fontWeight: 900,
                marginTop: 0,
                marginBottom: 16,
                color: "var(--text, #000000)",
              }}
            >
              Došlo k chybě aplikace
            </h1>
            <p
              style={{
                fontSize: 15,
                lineHeight: 1.6,
                marginBottom: 24,
                color: "var(--muted, #666666)",
              }}
            >
              Omlouváme se, aplikace narazila na neočekávanou chybu. Zkuste stránku obnovit. Pokud problém přetrvá, kontaktujte podporu.
            </p>
            <div
              style={{
                display: "flex",
                gap: 12,
                flexWrap: "wrap",
              }}
            >
              <button
                onClick={this.handleReload}
                style={{
                  padding: "10px 20px",
                  fontSize: 14,
                  fontWeight: 700,
                  borderRadius: 8,
                  border: "none",
                  background: "var(--accent, #007AFF)",
                  color: "#ffffff",
                  cursor: "pointer",
                  transition: "opacity 0.2s",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.opacity = "0.8";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.opacity = "1";
                }}
              >
                Obnovit
              </button>
              <button
                onClick={this.handleCopyDetails}
                style={{
                  padding: "10px 20px",
                  fontSize: 14,
                  fontWeight: 600,
                  borderRadius: 8,
                  border: "1px solid var(--border, #e0e0e0)",
                  background: "var(--panel, #ffffff)",
                  color: "var(--text, #000000)",
                  cursor: "pointer",
                  transition: "background 0.2s",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "var(--panel-2, #f5f5f5)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "var(--panel, #ffffff)";
                }}
              >
                Kopírovat detaily
              </button>
            </div>
            {process.env.NODE_ENV === "development" && this.state.error && (
              <details
                style={{
                  marginTop: 24,
                  padding: 16,
                  borderRadius: 8,
                  background: "var(--panel-2, #f5f5f5)",
                  fontSize: 12,
                  fontFamily: "monospace",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                  overflow: "auto",
                  maxHeight: 400,
                }}
              >
                <summary
                  style={{
                    cursor: "pointer",
                    fontWeight: 700,
                    marginBottom: 8,
                  }}
                >
                  Technické detaily (pouze v development módu)
                </summary>
                <div style={{ color: "var(--text, #000000)" }}>
                  {this.state.error.toString()}
                  {this.state.error.stack && (
                    <>
                      {"\n\nStack:\n"}
                      {this.state.error.stack}
                    </>
                  )}
                  {this.state.errorInfo?.componentStack && (
                    <>
                      {"\n\nComponent Stack:\n"}
                      {this.state.errorInfo.componentStack}
                    </>
                  )}
                </div>
              </details>
            )}
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

