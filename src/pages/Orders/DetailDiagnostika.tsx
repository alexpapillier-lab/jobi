/**
 * Sbalitelná karta „Diagnostika“ v detailu zakázky: protokol, fotky před a
 * diagnostické fotky (nahrání, focení z telefonu přes QR, mazání, lightbox).
 * Změny se sbírají do dirtyFlags a ukládají při zavření detailu.
 * Vyneseno z Orders.tsx beze změny obsahu.
 */
import type React from "react";
import { Button } from "../../components/ui";
import { SearchIcon } from "../../components/icons";
import { SbalitelnaHlavicka } from "../../components/orders/SbalitelnaSekce";
import { FotkaZakazky } from "../../components/FotkaZakazky";
import { VyberFotek } from "../../components/orders/VyberFotek";
import { showToast } from "../../components/Toast";
import { supabase, supabaseUrl, supabaseAnonKey, supabaseFetch, resetTauriFetchState } from "../../lib/supabaseClient";
import { uploadDiagnosticPhotoWithWatermark, deleteDiagnosticPhotoFromStorage, isDiagnosticPhotoStorageUrl } from "../../lib/diagnosticPhotosStorage";
import { reportSilent } from "../../lib/reportError";
import { normalizeError } from "../../utils/errorNormalizer";
import { popisDoOdkazu } from "../../lib/diagnosticPhotoWatermark";
import { BARVA_SEKCE, stylSekce } from "../../lib/sekceDetailu";
import type { DirtyFlags, FotoLightboxStav, PolozkaQrFoceni, TicketEx } from "./typy";
import { card, fieldLabel, baseFieldInput, baseFieldTextArea } from "./styly";

type Props = {
  detailedTicket: TicketEx;
  detailDiagnostikaOpen: boolean;
  prepnoutDetailDiagnostiku: () => void;
  setDirtyFlags: React.Dispatch<React.SetStateAction<DirtyFlags>>;
  setCloudTickets: React.Dispatch<React.SetStateAction<TicketEx[]>>;
  setPhotoLightbox: React.Dispatch<React.SetStateAction<FotoLightboxStav | null>>;
  naTelefonu: boolean;
  activeServiceId: string | null;
  serviceName: string | null;
  captureQRLoading: boolean;
  setCaptureQRLoading: React.Dispatch<React.SetStateAction<boolean>>;
  diagnosticPhotosUploading: boolean;
  setDiagnosticPhotosUploading: React.Dispatch<React.SetStateAction<boolean>>;
  setCaptureQRItems: React.Dispatch<React.SetStateAction<PolozkaQrFoceni[] | null>>;
};

export function DetailDiagnostika({
  detailedTicket,
  detailDiagnostikaOpen,
  prepnoutDetailDiagnostiku,
  setDirtyFlags,
  setCloudTickets,
  setPhotoLightbox,
  naTelefonu,
  activeServiceId,
  serviceName,
  captureQRLoading,
  setCaptureQRLoading,
  diagnosticPhotosUploading,
  setDiagnosticPhotosUploading,
  setCaptureQRItems,
}: Props) {
  return (
    <div id="detail-diagnostika" data-tour="detail-diagnostika" style={{ ...card, ...stylSekce("diagnostika"), marginTop: 16 }}>
      <SbalitelnaHlavicka
        icon={<SearchIcon size={16} />}
        barva={BARVA_SEKCE.diagnostika}
        title="Diagnostika"
        otevreno={detailDiagnostikaOpen}
        onToggle={prepnoutDetailDiagnostiku}
        ovlada="detail-diagnostika-obsah"
        souhrn="protokol, fotky"
      />
      {detailDiagnostikaOpen && (
      <div id="detail-diagnostika-obsah" style={{ display: "grid", gap: 12 }}>
        <div>
          <div style={fieldLabel}>Diagnostický protokol</div>
          <textarea
            value={detailedTicket.diagnosticText || ""}
            onChange={(e) => {
              setDirtyFlags((prev) => ({ ...prev, diagnosticText: true }));
              setCloudTickets((prev) =>
                prev.map((t) =>
                  t.id === detailedTicket.id
                    ? { ...t, diagnosticText: e.target.value }
                    : t
                )
              );
            }}
            style={baseFieldTextArea}
            placeholder="Zadejte výsledky diagnostiky zařízení..."
            rows={6}
          />
        </div>
        
        <div>
          <div style={fieldLabel}>Fotky před</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 8 }}>
            {(detailedTicket.diagnosticPhotosBefore || []).map((photoUrl, idx) => (
                <div key={idx} style={{ position: "relative" }}>
                  <FotkaZakazky
                    url={photoUrl}
                    alt={`Fotka před ${idx + 1}`}
                    role="button"
                    tabIndex={0}
                    onClick={() =>
                      setPhotoLightbox({
                        urls: detailedTicket.diagnosticPhotosBefore || [],
                        index: idx,
                        ticketCode: detailedTicket.code,
                      })
                    }
                    onKeyDown={(e) =>
                      e.key === "Enter" &&
                      setPhotoLightbox({
                        urls: detailedTicket.diagnosticPhotosBefore || [],
                        index: idx,
                        ticketCode: detailedTicket.code,
                      })
                    }
                    style={{
                      width: 120,
                      height: 120,
                      objectFit: "cover",
                      borderRadius: 8,
                      border: "1px solid var(--border)",
                      cursor: "pointer",
                    }}
                  />
                  <button
                    onClick={async (e) => {
                      e.stopPropagation();
                      const url = (detailedTicket.diagnosticPhotosBefore || [])[idx];
                      if (url && isDiagnosticPhotoStorageUrl(url)) {
                        try {
                          await deleteDiagnosticPhotoFromStorage(supabase, url);
                        } catch (e) {
                          reportSilent({ code: "orders.photo_delete_failed", error: e, source: "Orders.deleteDiagnosticPhoto" });
                        }
                      }
                      setDirtyFlags((prev) => ({ ...prev, diagnosticPhotos: true }));
                      setCloudTickets((prev) =>
                        prev.map((t) =>
                          t.id === detailedTicket.id
                            ? {
                                ...t,
                                diagnosticPhotosBefore: (t.diagnosticPhotosBefore || []).filter((_, i) => i !== idx),
                              }
                            : t
                        )
                      );
                    }}
                    style={{
                      position: "absolute",
                      top: 4,
                      right: 4,
                      width: 24,
                      height: 24,
                      borderRadius: "50%",
                      background: "rgba(239, 68, 68, 0.9)",
                      color: "white",
                      border: "none",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 14,
                      fontWeight: 700,
                    }}
                  >
                    ×
                  </button>
                </div>
              ))}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8, alignItems: "center" }}>
            {!naTelefonu && (
            <Button variant="soft"
              onClick={async () => {
                if (!supabase || !supabaseUrl || !supabaseAnonKey || !activeServiceId || !detailedTicket?.id) return;
                setCaptureQRLoading(true);
                try {
                  let lastErr: unknown = null;
                  for (let attempt = 0; attempt < 2; attempt++) {
                    try {
                      const { data: refreshData, error: refreshErr } = await supabase.auth.refreshSession();
                      if (refreshErr && attempt === 0) throw new Error("Session vypršela.");
                      const token = refreshData?.session?.access_token ?? (await supabase.auth.getSession()).data?.session?.access_token;
                      if (!token) throw new Error("Nejste přihlášeni.");
                      const res = await supabaseFetch(`${supabaseUrl}/functions/v1/capture-create-token`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, apikey: supabaseAnonKey },
                        body: JSON.stringify({ ticketId: detailedTicket.id, isBefore: true }),
                      });
                      const raw = await res.text();
                      const data: { url?: string; error?: string } = raw ? JSON.parse(raw) : {};
                      if (!res.ok) throw new Error(data.error || res.statusText);
                      if (data.url) setCaptureQRItems([{ deviceLabel: detailedTicket.deviceLabel || "Zakázka", url: popisDoOdkazu(data.url, { cislo: detailedTicket.code, servis: serviceName }) }]);
                      return;
                    } catch (err) {
                      lastErr = err;
                      const msg = err instanceof Error ? err.message : String(err);
                      if (attempt === 0 && (msg.includes("síťový modul") || msg.includes("Nelze načíst"))) {
                        resetTauriFetchState();
                        continue;
                      }
                      break;
                    }
                  }
                  showToast(normalizeError(lastErr) || "Nepodařilo vytvořit QR odkaz.", "error");
                } finally {
                  setCaptureQRLoading(false);
                }
              }}
              disabled={!supabase || !activeServiceId || !detailedTicket?.id || diagnosticPhotosUploading || captureQRLoading} style={{ fontSize: 13 }}
            >
              {captureQRLoading ? "Vytvářím…" : "Vyfotit z telefonu"}
            </Button>
            )}
            <VyberFotek popisek="Nahrát soubory" disabled={diagnosticPhotosUploading} style={{ ...baseFieldInput, padding: "8px 12px", margin: 0 }}>
              <input
                type="file"
                accept="image/*"
                multiple
                disabled={diagnosticPhotosUploading}
                style={{ display: "none" }}
                onChange={async (e) => {
                  const files = Array.from(e.target.files || []);
                  e.target.value = "";
                  if (!files.length || !supabase || !activeServiceId || !detailedTicket?.id) return;
                  setDiagnosticPhotosUploading(true);
                  try {
                    const urls: string[] = [];
                    for (const file of files) {
                      const url = await uploadDiagnosticPhotoWithWatermark(supabase, activeServiceId, detailedTicket.id, file, { cislo: detailedTicket.code, servis: serviceName });
                      urls.push(url);
                    }
                    setDirtyFlags((prev) => ({ ...prev, diagnosticPhotos: true }));
                    setCloudTickets((prev) =>
                      prev.map((t) =>
                        t.id === detailedTicket.id
                          ? { ...t, diagnosticPhotosBefore: [...(t.diagnosticPhotosBefore || []), ...urls] }
                          : t
                      )
                    );
                  } catch (err) {
                    showToast(`Nahrání fotky se nezdařilo: ${normalizeError(err) || "neznámá chyba"}`, "error");
                  } finally {
                    setDiagnosticPhotosUploading(false);
                  }
                }}
              />
            </VyberFotek>
          </div>
        </div>
        <div>
          <div style={fieldLabel}>Diagnostické fotografie</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 8 }}>
            {(detailedTicket.diagnosticPhotos || []).map((photoUrl, idx) => (
              <div key={idx} style={{ position: "relative" }}>
                <FotkaZakazky
                  url={photoUrl}
                  alt={`Diagnostika ${idx + 1}`}
                  role="button"
                  tabIndex={0}
                  onClick={() => setPhotoLightbox({ urls: detailedTicket.diagnosticPhotos || [], index: idx, ticketCode: detailedTicket.code })}
                  onKeyDown={(e) => e.key === "Enter" && setPhotoLightbox({ urls: detailedTicket.diagnosticPhotos || [], index: idx, ticketCode: detailedTicket.code })}
                  style={{
                    width: 120, 
                    height: 120, 
                    objectFit: "cover", 
                    borderRadius: 8,
                    border: "1px solid var(--border)",
                    cursor: "pointer",
                  }}
                />
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    (async () => {
                    const photoUrl = (detailedTicket.diagnosticPhotos || [])[idx];
                    if (photoUrl && isDiagnosticPhotoStorageUrl(photoUrl)) {
                      try {
                        await deleteDiagnosticPhotoFromStorage(supabase, photoUrl);
                      } catch (_) {
                        // Orphan v Storage; odstraníme jen z UI
                      }
                    }
                    setDirtyFlags((prev) => ({ ...prev, diagnosticPhotos: true }));
                    setCloudTickets((prev) =>
                      prev.map((t) =>
                        t.id === detailedTicket.id
                          ? { ...t, diagnosticPhotos: (t.diagnosticPhotos || []).filter((_, i) => i !== idx) }
                          : t
                      )
                    );
                  })();
                  }}
                  style={{
                    position: "absolute",
                    top: 4,
                    right: 4,
                    width: 24,
                    height: 24,
                    borderRadius: "50%",
                    background: "rgba(239, 68, 68, 0.9)",
                    color: "white",
                    border: "none",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 14,
                    fontWeight: 700,
                  }}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8, alignItems: "center" }}>
            {!naTelefonu && (
            <Button variant="soft"
              onClick={async () => {
                if (!supabase || !supabaseUrl || !supabaseAnonKey || !activeServiceId || !detailedTicket?.id) return;
                const client = supabase!;
                setCaptureQRLoading(true);
                try {
                let lastErr: unknown = null;
                for (let attempt = 0; attempt < 2; attempt++) {
                  try {
                    const doRequest = async (retry = false): Promise<Response> => {
                      const { data: refreshData, error: refreshErr } = await client.auth.refreshSession();
                      if (refreshErr && !retry) {
                        throw new Error("Session vypršela. Odhlaste se a přihlaste znovu.");
                      }
                      const token = refreshData?.session?.access_token ?? (await client.auth.getSession()).data?.session?.access_token;
                      if (!token) {
                        throw new Error("Nejste přihlášeni.");
                      }
                      return supabaseFetch(`${supabaseUrl}/functions/v1/capture-create-token`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, apikey: supabaseAnonKey },
                        body: JSON.stringify({ ticketId: detailedTicket.id }),
                      });
                    };
                    let res = await doRequest();
                    if (res.status === 401) {
                      res = await doRequest(true);
                    }
                    const raw = await res.text();
                    let data: { url?: string; error?: string; detail?: string } = {};
                    try { if (raw) data = JSON.parse(raw); } catch {}
                    if (!res.ok) {
                      if (res.status === 401) throw new Error("Přihlášení vypršelo. Odhlaste se a přihlaste znovu.");
                      throw new Error(data?.error || data?.detail || res.statusText || "Chyba serveru");
                    }
                    if (data?.error) throw new Error(data.error);
                    if (!data?.url) throw new Error("Chybí URL v odpovědi");
                    setCaptureQRItems([{ deviceLabel: (detailedTicket?.deviceLabel) || "Zakázka", url: popisDoOdkazu(data.url, { cislo: detailedTicket.code, servis: serviceName }) }]);
                    return;
                  } catch (err) {
                    lastErr = err;
                    const msg = err instanceof Error ? err.message : String(err);
                    if (attempt === 0 && (msg.includes("síťový modul") || msg.includes("Nelze načíst"))) {
                      resetTauriFetchState();
                      continue;
                    }
                    break;
                  }
                }
                showToast(normalizeError(lastErr) || "Nepodařilo vytvořit QR odkaz.", "error");
              } finally {
                setCaptureQRLoading(false);
              }
            }}
            disabled={!supabase || !activeServiceId || !detailedTicket?.id || diagnosticPhotosUploading || captureQRLoading} style={{ fontSize: 13 }}
            >
              {captureQRLoading ? "Vytvářím…" : "Vyfotit z telefonu"}
            </Button>
            )}
            <VyberFotek popisek="Nahrát soubory" disabled={diagnosticPhotosUploading} style={{ ...baseFieldInput, padding: "8px 12px", margin: 0 }}>
              <input
                type="file"
                accept="image/*"
                multiple
                disabled={diagnosticPhotosUploading}
                style={{ display: "none" }}
                onChange={async (e) => {
                  const files = Array.from(e.target.files || []);
                  e.target.value = "";
                  if (!files.length) return;
                  const hasId = !!(activeServiceId && detailedTicket.id);
                  if (hasId && supabase) {
                    setDiagnosticPhotosUploading(true);
                    try {
                    const urls: string[] = [];
                    for (const file of files) {
                      const url = await uploadDiagnosticPhotoWithWatermark(
                        supabase,
                        activeServiceId!,
                        detailedTicket.id!,
                        file,
                        { cislo: detailedTicket.code, servis: serviceName }
                      );
                        urls.push(url);
                      }
                      setDirtyFlags((prev) => ({ ...prev, diagnosticPhotos: true }));
                      setCloudTickets((prev) =>
                        prev.map((t) =>
                          t.id === detailedTicket.id
                            ? { ...t, diagnosticPhotos: [...(t.diagnosticPhotos || []), ...urls] }
                            : t
                        )
                      );
                    } catch (err) {
                      showToast(
                        `Nahrání fotky se nezdařilo: ${normalizeError(err) || "neznámá chyba"}`,
                        "error"
                      );
                    } finally {
                      setDiagnosticPhotosUploading(false);
                    }
                  } else {
                    const reader = (file: File) =>
                      new Promise<string>((resolve, reject) => {
                        const r = new FileReader();
                        r.onload = () => resolve(r.result as string);
                        r.onerror = () => reject(new Error("Načtení souboru selhalo"));
                        r.readAsDataURL(file);
                      });
                    try {
                      const results = await Promise.all(files.map(reader));
                      setDirtyFlags((prev) => ({ ...prev, diagnosticPhotos: true }));
                      setCloudTickets((prev) =>
                        prev.map((t) =>
                          t.id === detailedTicket.id
                            ? { ...t, diagnosticPhotos: [...(t.diagnosticPhotos || []), ...results] }
                            : t
                        )
                      );
                    } catch (_) {
                      showToast("Nepodařilo se načíst vybrané soubory.", "error");
                    }
                  }
                }}
              />
            </VyberFotek>
            {diagnosticPhotosUploading && (
              <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>Nahrávám…</span>
            )}
          </div>
        </div>
      </div>
      )}
    </div>
  );
}
