/**
 * Zvětšená diagnostická fotka se stažením. Podepsané odkazy dodává rodič
 * (usePodepsaneFotky), Escape zavírá rodičovský efekt.
 * Vyneseno z Orders.tsx beze změny obsahu.
 */
import { createPortal } from "react-dom";
import { showToast } from "../../components/Toast";
import { supabase } from "../../lib/supabaseClient";
import { podepsFotku } from "../../lib/podepsaneFotky";

type Props = {
  photoLightbox: { urls: string[]; index: number; ticketCode?: string };
  /** Podepsané URL ve stejném pořadí jako photoLightbox.urls. */
  fotkyLightboxu: string[];
  onClose: () => void;
};

export function FotoLightbox({ photoLightbox, fotkyLightboxu, onClose }: Props) {
  return createPortal(
    <div
      role="dialog"
      aria-label="Zvětšit fotku"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 10002,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(0,0,0,0.85)",
        padding: 24,
      }}
      onClick={onClose}
    >
      <button
        type="button"
        onClick={onClose}
        style={{
          position: "absolute",
          top: 16,
          right: 16,
          width: 40,
          height: 40,
          borderRadius: "50%",
          background: "rgba(255,255,255,0.2)",
          color: "white",
          border: "none",
          cursor: "pointer",
          fontSize: 20,
          fontWeight: 700,
          lineHeight: 1,
        }}
        aria-label="Zavřít"
      >
        ×
      </button>
      <button
        type="button"
        onClick={async (e) => {
          e.stopPropagation();
          // Bez podpisu vrátí úložiště 400 – holá URL fotku nevydá.
          const url = await podepsFotku(supabase, photoLightbox.urls[photoLightbox.index]);
          const code = photoLightbox.ticketCode || "zakazka";
          const safe = (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, "_");
          const name = `${safe(code)}_pic${photoLightbox.index + 1}.jpg`;
          try {
            const res = await fetch(url, { mode: "cors" });
            const blob = await res.blob();
            const a = document.createElement("a");
            a.href = URL.createObjectURL(blob);
            a.download = name;
            a.click();
            URL.revokeObjectURL(a.href);
            showToast("Fotka stažena", "success");
          } catch {
            window.open(url, "_blank");
          }
        }}
        style={{
          position: "absolute",
          top: 16,
          right: 64,
          padding: "8px 16px",
          borderRadius: 8,
          background: "rgba(255,255,255,0.2)",
          color: "white",
          border: "1px solid rgba(255,255,255,0.4)",
          cursor: "pointer",
          fontSize: 14,
          fontWeight: 600,
        }}
      >
        Stáhnout
      </button>
      <img
        src={fotkyLightboxu[photoLightbox.index] ?? photoLightbox.urls[photoLightbox.index]}
        alt={`Diagnostika ${photoLightbox.index + 1}`}
        style={{ maxWidth: "100%", maxHeight: "90vh", objectFit: "contain" }}
        onClick={(e) => e.stopPropagation()}
      />
    </div>,
    document.body
  );
}
