/**
 * Modál „Vyfotit z telefonu“ – QR odkazy na focení k zakázce nebo k rozepsanému
 * příjmu (koncept). Vyneseno z Orders.tsx beze změny obsahu.
 */
import type React from "react";
import { createPortal } from "react-dom";
import { Button } from "../../components/ui";
import { SectionHeading } from "../../components/SectionHeading";
import { DeviceIcon } from "../../components/icons";
import { showToast } from "../../components/Toast";
import { qrDataUrl } from "../../../jobidocs/src/qr";

type Props = {
  items: Array<{ deviceLabel: string; url: string }>;
  onClose: () => void;
  /** Token focení ke konceptu – když je, jde o přijímací fotky před vytvořením zakázky. Čte se při každém vykreslení. */
  draftCaptureTokenRef: React.MutableRefObject<string | null>;
  draftCaptureLiveCount: number;
};

export function CaptureQrModal({ items, onClose, draftCaptureTokenRef, draftCaptureLiveCount }: Props) {
  return createPortal(
    <div
      role="dialog"
      aria-label="Vyfotit z telefonu"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 10000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(0,0,0,0.5)",
        padding: 24,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: "var(--panel)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-lg)",
          boxShadow: "var(--shadow-soft)",
          maxWidth: items.length > 1 ? 480 : 360,
          width: "100%",
          maxHeight: "90vh",
          overflow: "auto",
          padding: 24,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 16,
          color: "var(--text)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <SectionHeading icon={<DeviceIcon size={18} />}>Vyfotit z telefonu</SectionHeading>
        <p style={{ margin: 0, fontSize: 14, color: "var(--text-secondary)", textAlign: "center" }}>
          {/* Token se čte při vykreslení schválně (stejně jako dřív v Orders.tsx): zapisuje ho obsluha kliknutí těsně před otevřením okna. */}
          {/* eslint-disable-next-line react-hooks/refs */}
          {draftCaptureTokenRef.current
            ? "Naskenujte QR kód mobilem. Vyfocené fotky se po zavření tohoto okna načtou do rozpracované zakázky."
            : items.length > 1
            ? "Naskenujte QR kód podle zařízení. Fotka se uloží k příslušné zakázce."
            : "Naskenujte QR kód mobilem. Otevře se stránka pro vyfocení diagnostiky – fotka se uloží přímo k zakázce."}
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 20, justifyContent: "center" }}>
          {items.map((item, i) => (
            <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
              {items.length > 1 && (
                <div style={{ fontWeight: 700, fontSize: 14, color: "var(--text)", textAlign: "center" }}>{item.deviceLabel || `Zakázka ${i + 1}`}</div>
              )}
              <div style={{ background: "white", padding: 12, borderRadius: 12 }}>
                {/* QR se kreslí lokálně. Dřív se tahal z api.qrserver.com,
                    takže do cizí služby odcházel odkaz i s tokenem, kterým
                    se dá k zakázce nahrát fotka – a bez internetu se QR
                    nevykreslil vůbec. Stejná funkce kreslí QR platbu na
                    fakturách. */}
                <img
                  src={qrDataUrl(item.url, 220, "L")}
                  alt={`QR pro ${item.deviceLabel || "zakázku"}`}
                  style={{ display: "block", width: 220, height: 220 }}
                />
              </div>
              <Button variant="soft"
                onClick={() => {
                  navigator.clipboard?.writeText(item.url).then(() => showToast("Odkaz zkopírován", "success"));
                }} style={{ fontSize: 12 }}
              >
                Kopírovat odkaz
              </Button>
            </div>
          ))}
        </div>
        {/* eslint-disable-next-line react-hooks/refs */}
        {draftCaptureTokenRef.current && (
          <div style={{ fontSize: 12, color: "var(--muted)", textAlign: "center" }}>
            Aktuálně nafoceno: <b style={{ color: "var(--text)" }}>{draftCaptureLiveCount}</b>. Zavřete až po nafocení všech fotek.
          </div>
        )}
        <Button variant="soft" onClick={onClose} style={{ marginTop: 8 }}>
          {/* eslint-disable-next-line react-hooks/refs */}
          {draftCaptureTokenRef.current
            ? `Zavřít (${draftCaptureLiveCount} ${draftCaptureLiveCount === 1 ? "fotka" : draftCaptureLiveCount >= 2 && draftCaptureLiveCount <= 4 ? "fotky" : "fotek"})`
            : "Zavřít"}
        </Button>
      </div>
    </div>,
    document.body
  );
}
