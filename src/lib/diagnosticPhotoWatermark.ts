/**
 * Watermark pro diagnostické fotky: datum, čas, "jobi" – vpravo dole.
 * Aplikuje se v prohlížeči před odesláním do DB/Storage.
 */

const WATERMARK_TEXT = "jobi";

/**
 * Přidá watermark na obrázek a vrátí Blob (JPEG).
 * Čas se bere v okamžiku volání (aktuální čas zařízení).
 */
export async function addWatermarkToImageBlob(source: File | Blob | string): Promise<Blob> {
  const img = await loadImage(source);
  const canvas = document.createElement("canvas");
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2d context není k dispozici");

  ctx.drawImage(img, 0, 0);
  if (img.src?.startsWith("blob:")) URL.revokeObjectURL(img.src);

  const now = new Date();
  const dateStr = now.toLocaleDateString("cs-CZ", { day: "2-digit", month: "2-digit", year: "numeric" });
  const timeStr = now.toLocaleTimeString("cs-CZ", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const label = `${dateStr} ${timeStr} · ${WATERMARK_TEXT}`;

  const fontSize = Math.max(12, Math.round(Math.min(img.width, img.height) * 0.03));
  ctx.font = `${fontSize}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
  ctx.textAlign = "right";
  ctx.textBaseline = "bottom";

  const padding = Math.round(fontSize * 0.8);
  const x = img.width - padding;
  const y = img.height - padding;

  // Stín pro čitelnost
  ctx.shadowColor = "rgba(0,0,0,0.8)";
  ctx.shadowBlur = 4;
  ctx.shadowOffsetX = 1;
  ctx.shadowOffsetY = 1;
  ctx.fillStyle = "rgba(255,255,255,0.95)";
  ctx.fillText(label, x, y);
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("Nepodařilo se vytvořit obrázek"));
      },
      "image/jpeg",
      0.92
    );
  });
}

function loadImage(source: File | Blob | string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Nepodařilo se načíst obrázek"));
    if (typeof source === "string") {
      img.src = source;
    } else {
      img.src = URL.createObjectURL(source);
    }
  });
}
