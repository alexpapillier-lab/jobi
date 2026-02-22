import { useEffect, useState, useRef } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  generateTicketHTML,
  generateDiagnosticProtocolHTML,
  generateWarrantyHTML,
  mapSupabaseTicketToTicketEx,
  safeLoadCompanyData,
  safeLoadDocumentsConfig,
  type TicketEx,
} from "./Orders";
import { supabase } from "../lib/supabaseClient";

export default function Preview() {
  // Get params from URL
  const getUrlParam = (name: string): string | null => {
    if (typeof window === "undefined") return null;
    const params = new URLSearchParams(window.location.search);
    return params.get(name);
  };

  const ticketId = getUrlParam("ticketId");
  const docType = getUrlParam("docType") as "ticket" | "diagnostic" | "warranty" | null;
  const autoPrint = getUrlParam("autoPrint") === "1";
  
  const [ticket, setTicket] = useState<TicketEx | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [htmlContent, setHtmlContent] = useState<string>("");
  const [iframeLoaded, setIframeLoaded] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Load ticket from DB
  useEffect(() => {
    if (!ticketId || !supabase) {
      setError("Chybí ticketId nebo Supabase klient");
      setLoading(false);
      return;
    }

    let cancelled = false;
    const loadTicket = async () => {
      if (!supabase) {
        setError("Supabase není inicializován");
        setLoading(false);
        return;
      }

      try {
        if (cancelled) return;
        const { data, error: fetchError } = await (supabase
          .from("tickets") as any)
          .select("*")
          .eq("id", ticketId)
          .is("deleted_at", null)
          .single();

        if (cancelled) return;
        if (fetchError) throw fetchError;
        if (!data) throw new Error("Zakázka nenalezena");

        const mappedTicket = mapSupabaseTicketToTicketEx(data);
        setTicket(mappedTicket);
      } catch (err) {
        if (cancelled) return;
        console.error("[Preview] Error loading ticket:", err);
        setError(err instanceof Error ? err.message : "Neznámá chyba při načítání zakázky");
        setLoading(false);
      }
    };

    loadTicket();
    return () => { cancelled = true; };
  }, [ticketId]);

  // Generate HTML when ticket and docType are available
  useEffect(() => {
    if (!ticket || !docType) {
      return;
    }

    try {
      const companyData = safeLoadCompanyData();
      const documentsConfig = safeLoadDocumentsConfig();
      
      let html = "";
      switch (docType) {
        case "ticket":
          html = generateTicketHTML(ticket, true, documentsConfig, false);
          break;
        case "diagnostic":
          html = generateDiagnosticProtocolHTML(ticket, companyData, true, documentsConfig, false);
          break;
        case "warranty":
          html = generateWarrantyHTML(ticket, companyData, true, documentsConfig, false);
          break;
        default:
          setError(`Neznámý typ dokumentu: ${docType}`);
          setLoading(false);
          return;
      }

      // Note: We don't inject print script into HTML anymore
      // Instead, we trigger print from the parent window after iframe loads
      // This works better in Tauri WebviewWindow

      setHtmlContent(html);
      setLoading(false);
    } catch (err) {
      console.error("[Preview] Error generating HTML:", err);
      setError(err instanceof Error ? err.message : "Chyba při generování dokumentu");
      setLoading(false);
    }
  }, [ticket, docType]);

  // Auto-print: Trigger print from parent window after iframe loads
  useEffect(() => {
    if (autoPrint && htmlContent && iframeLoaded && iframeRef.current) {
      // Wait for iframe content to fully render
      const timer = setTimeout(async () => {
        try {
          const iframe = iframeRef.current;
          if (!iframe) {
            console.warn("[Preview] iframe ref not available for auto-print");
            return;
          }

          // Ensure window has focus first
          try {
            const appWindow = getCurrentWindow();
            await appWindow.setFocus();
            await appWindow.show();
            console.log("[Preview] Auto-print: Window focused");
          } catch (focusErr) {
            console.warn("[Preview] Failed to focus window:", focusErr);
          }

          console.log("[Preview] Auto-print: Attempting print via main window");
          // In Tauri WebviewWindow, print from iframe doesn't work reliably
          // Use main window print - toolbar will be hidden via CSS @media print
          window.focus();
          window.print();
          console.log("[Preview] Auto-print: Print triggered via main window");
        } catch (err) {
          console.error("[Preview] Auto-print error:", err);
        }
      }, 600); // Wait for iframe content to render

      return () => clearTimeout(timer);
    }
  }, [autoPrint, htmlContent, iframeLoaded]);

  // Handle print button
  const handlePrint = async () => {
    try {
      // In Tauri WebviewWindow, print from iframe doesn't work reliably
      // Use main window print - toolbar will be hidden via CSS @media print
      console.log("[Preview] Attempting print via main window");
      
      // Ensure window has focus
      try {
        const appWindow = getCurrentWindow();
        await appWindow.setFocus();
        await appWindow.show();
      } catch (focusErr) {
        console.warn("[Preview] Failed to focus window:", focusErr);
      }
      
      window.focus();
      window.print();
      console.log("[Preview] Print triggered via main window");
    } catch (err) {
      console.error("[Preview] Error printing:", err);
    }
  };

  // Handle close button
  const handleClose = async () => {
    try {
      const appWindow = getCurrentWindow();
      await appWindow.close();
      console.log("[Preview] Window closed via Tauri API");
    } catch (err) {
      console.error("[Preview] Error closing window:", err);
      // Fallback to window.close() if Tauri API fails
      if (typeof window !== "undefined") {
        window.close();
      }
    }
  };

  if (loading) {
    return (
      <div style={{ 
        display: "flex", 
        alignItems: "center", 
        justifyContent: "center", 
        height: "100vh",
        fontSize: 14,
        color: "var(--text, #333)"
      }}>
        Načítání dokumentu...
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ 
        display: "flex", 
        flexDirection: "column",
        alignItems: "center", 
        justifyContent: "center", 
        height: "100vh",
        padding: 20,
        fontSize: 14,
        color: "var(--text, #333)"
      }}>
        <div style={{ color: "rgba(239,68,68,0.9)", marginBottom: 12 }}>{error}</div>
        <button
          onClick={handleClose}
          style={{
            padding: "10px 20px",
            borderRadius: 8,
            border: "1px solid var(--border, #ccc)",
            background: "var(--accent, #2563eb)",
            color: "white",
            cursor: "pointer",
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          Zavřít
        </button>
      </div>
    );
  }

  return (
    <>
      {/* Print styles - hide toolbar when printing */}
      <style>{`
        @media print {
          .preview-toolbar {
            display: none !important;
          }
          body {
            margin: 0 !important;
            padding: 0 !important;
            overflow: visible !important;
            background: white !important;
          }
          .preview-iframe {
            position: fixed !important;
            top: 0 !important;
            left: 0 !important;
            width: 100vw !important;
            height: 100vh !important;
            border: none !important;
            margin: 0 !important;
            padding: 0 !important;
            transform: none !important;
            zoom: 1 !important;
          }
        }
      `}</style>
      <div style={{ 
        display: "flex", 
        flexDirection: "column", 
        height: "100vh",
        background: "#f5f5f5"
      }}>
        {/* Toolbar */}
        <div className="preview-toolbar" style={{
          display: "flex",
          justifyContent: "flex-end",
          gap: 12,
          padding: "12px 16px",
          background: "white",
          borderBottom: "1px solid #e5e5e5",
          boxShadow: "0 2px 4px rgba(0,0,0,0.1)",
        }}>
        <button
          onClick={handlePrint}
          style={{
            padding: "8px 16px",
            borderRadius: 6,
            border: "1px solid #2563eb",
            background: "#2563eb",
            color: "white",
            cursor: "pointer",
            fontSize: 13,
            fontWeight: 600,
            transition: "opacity 0.2s",
          }}
          onMouseEnter={(e) => e.currentTarget.style.opacity = "0.9"}
          onMouseLeave={(e) => e.currentTarget.style.opacity = "1"}
        >
          🖨️ Tisknout
        </button>
        <button
          onClick={handleClose}
          style={{
            padding: "8px 16px",
            borderRadius: 6,
            border: "1px solid #ccc",
            background: "white",
            color: "#333",
            cursor: "pointer",
            fontSize: 13,
            fontWeight: 600,
            transition: "background 0.2s",
          }}
          onMouseEnter={(e) => e.currentTarget.style.background = "#f5f5f5"}
          onMouseLeave={(e) => e.currentTarget.style.background = "white"}
        >
          ✕ Zavřít
        </button>
      </div>

        {/* Iframe with document */}
        <iframe
          ref={iframeRef}
          srcDoc={htmlContent}
          className="preview-iframe"
          onLoad={() => {
            console.log("[Preview] Iframe loaded");
            setIframeLoaded(true);
          }}
          style={{
            flex: 1,
            border: "none",
            width: "100%",
            background: "white",
          }}
          title="Náhled dokumentu"
        />
      </div>
    </>
  );
}
