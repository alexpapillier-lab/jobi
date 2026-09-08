/**
 * Vodoznak na diagnostických fotkách: číslo zakázky, název servisu, datum
 * a čas. Kreslí se v prohlížeči před odesláním do Storage; fotka bez něj
 * do zakázky nejde.
 *
 * Proč tmavý štítek a ne bílý text se stínem: stín měl pevné 4 px, což na
 * fotce z telefonu (4032 px) není vidět vůbec. Fotka bílého pultu nebo
 * displeje pak měla vpravo dole bílé písmo na bílé – datum, kvůli kterému
 * se vodoznak dělá, se nedalo přečíst. Štítek se škáluje s fotkou a je
 * čitelný na světlé i tmavé.
 *
 * Proč číslo zakázky a servis: fotka slouží jako důkaz při reklamaci
 * („takhle jsme to přebírali“). Datum bez čísla zakázky se k ničemu
 * nedá přiřadit; název servisu říká, kdo fotil. Když ještě nejsou známé
 * (fotky před založením zakázky), zůstane datum a „jobi“ jako dřív.
 *
 * Proč zmenšení: fotka z iPhonu má 3–5 MB a nahrávala se v plné velikosti.
 * Na telefonu v suterénu bez signálu je to rozdíl mezi „nahráno“ a chybou,
 * a škrábanec na krytu je vidět i na 2560 px. Menší fotky se nezvětšují.
 */

export type PopisVodoznaku = {
  /** Číslo zakázky (`tickets.code`), např. SN26000012. */
  cislo?: string | null;
  /** Název servisu. */
  servis?: string | null;
};

/** Delší strana fotky po zmenšení. */
export const MAX_STRANA_FOTKY = 2560;

/** Rozměr po zmenšení tak, aby delší strana nepřesáhla `MAX_STRANA_FOTKY`. */
export function rozmerPoZmenseni(sirka: number, vyska: number): { sirka: number; vyska: number } {
  const delsi = Math.max(sirka, vyska);
  if (delsi <= MAX_STRANA_FOTKY) return { sirka, vyska };
  const pomer = MAX_STRANA_FOTKY / delsi;
  return { sirka: Math.round(sirka * pomer), vyska: Math.round(vyska * pomer) };
}

/**
 * Řádky štítku. Datum je vždy v posledním; číslo a servis nad ním, když jsou.
 * Čas se bere v okamžiku volání (čas zařízení).
 */
export function radkyVodoznaku(popis: PopisVodoznaku | undefined, kdy: Date): string[] {
  const datum = kdy.toLocaleDateString("cs-CZ", { day: "2-digit", month: "2-digit", year: "numeric" });
  const cas = kdy.toLocaleTimeString("cs-CZ", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const hlavicka = [popis?.cislo?.trim(), popis?.servis?.trim()].filter((s): s is string => !!s).join(" · ");
  return hlavicka ? [hlavicka, `${datum} ${cas}`] : [`${datum} ${cas} · jobi`];
}

/**
 * Přidá číslo zakázky a servis do odkazu pro focení z telefonu (QR), aby
 * stránka `capture/` napsala na fotku totéž co aplikace. Odkaz vrací edge
 * funkce a zakázku zná jen podle id; doplnit text na klientovi je levnější
 * než ji učit číst `code` a název servisu. Jde jen o popisek – nahrání
 * dál hlídá token.
 */
export function popisDoOdkazu(url: string, popis?: PopisVodoznaku): string {
  const cislo = popis?.cislo?.trim();
  const servis = popis?.servis?.trim();
  if (!cislo && !servis) return url;
  const oddelovac = url.includes("?") ? "&" : "?";
  const casti: string[] = [];
  if (cislo) casti.push(`c=${encodeURIComponent(cislo)}`);
  if (servis) casti.push(`s=${encodeURIComponent(servis)}`);
  return `${url}${oddelovac}${casti.join("&")}`;
}

/** Nakreslí štítek vpravo dole. Velikosti se odvozují z kratší strany fotky. */
export function nakresliStitek(ctx: CanvasRenderingContext2D, sirka: number, vyska: number, radky: string[]): void {
  const pismo = Math.max(14, Math.round(Math.min(sirka, vyska) * 0.028));
  ctx.font = `600 ${pismo}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
  ctx.textAlign = "right";
  ctx.textBaseline = "alphabetic";

  const okrajX = Math.round(pismo * 0.7);
  const okrajY = Math.round(pismo * 0.45);
  const odkraje = Math.round(pismo * 0.8);
  const radek = Math.round(pismo * 1.25);
  const sirkaStitku = Math.max(...radky.map((r) => ctx.measureText(r).width)) + okrajX * 2;
  const vyskaStitku = radek * radky.length + okrajY * 2;
  const x1 = sirka - odkraje;
  const y1 = vyska - odkraje;
  const x0 = x1 - sirkaStitku;
  const y0 = y1 - vyskaStitku;
  const r = Math.round(pismo * 0.35);

  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.beginPath();
  ctx.moveTo(x0 + r, y0);
  ctx.arcTo(x1, y0, x1, y1, r);
  ctx.arcTo(x1, y1, x0, y1, r);
  ctx.arcTo(x0, y1, x0, y0, r);
  ctx.arcTo(x0, y0, x1, y0, r);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = "rgba(255,255,255,0.96)";
  radky.forEach((text, i) => {
    ctx.fillText(text, x1 - okrajX, y0 + okrajY + radek * (i + 1) - Math.round(pismo * 0.3));
  });
}

/**
 * Zmenší fotku, přidá vodoznak a vrátí Blob (JPEG).
 */
export async function addWatermarkToImageBlob(source: File | Blob | string, popis?: PopisVodoznaku): Promise<Blob> {
  const img = await loadImage(source);
  const { sirka, vyska } = rozmerPoZmenseni(img.width, img.height);
  const canvas = document.createElement("canvas");
  canvas.width = sirka;
  canvas.height = vyska;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2d context není k dispozici");

  ctx.drawImage(img, 0, 0, sirka, vyska);
  if (img.src?.startsWith("blob:")) URL.revokeObjectURL(img.src);

  nakresliStitek(ctx, sirka, vyska, radkyVodoznaku(popis, new Date()));

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("Nepodařilo se vytvořit obrázek"));
      },
      "image/jpeg",
      0.9
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
