/**
 * Upozornění na novou zprávu v chatu týmu: krátké cinknutí a systémové
 * oznámení.
 *
 * Zvuk je vlastní (WebAudio, žádný soubor) a má vlastní vypínač
 * `jobi_chat_zvuk` nezávislý na obecných zvucích aplikace – kdo si vypne
 * cinkání při ukládání, nemusí chtít přijít o zprávy od kolegů, a naopak.
 *
 * Systémové oznámení jde na desktopu přes Tauri plugin (načítá se dynamicky,
 * jen když aplikace v Tauri běží – ve webu by import spadl), v prohlížeči
 * přes `Notification`. O povolení se žádá až při prvním otevření panelu,
 * ne při načtení aplikace: dotaz na oznámení hned po startu lidé odklikávají
 * jako obtěžování a druhou šanci prohlížeč nedá.
 */

import { isDesktop } from "./platform";
import { otevriChat } from "./chat";

export const KLIC_ZVUKU = "jobi_chat_zvuk";
const KLIC_POVOLENI_ZADANO = "jobi_chat_oznameni_zadano";

export function jeZvukZapnuty(): boolean {
  try {
    if (typeof localStorage === "undefined") return true;
    const v = localStorage.getItem(KLIC_ZVUKU);
    return v !== "0" && v !== "false";
  } catch {
    return true;
  }
}

export function nastavZvuk(zapnuto: boolean): void {
  try {
    localStorage.setItem(KLIC_ZVUKU, zapnuto ? "1" : "0");
  } catch {
    /* soukromý režim – nastavení vydrží jen do zavření */
  }
}

let kontext: AudioContext | null = null;

function audio(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!kontext) {
    try {
      const C = window.AudioContext ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (C) kontext = new C();
    } catch {
      return null;
    }
  }
  return kontext;
}

/** Dvojité „cink“ – jiné než zvuk uložení, ať se pozná bez koukání. */
export function zacinkej(): void {
  if (!jeZvukZapnuty()) return;
  const ctx = audio();
  if (!ctx) return;
  const zahraj = () => {
    try {
      const t0 = ctx.currentTime;
      for (const [f, od, delka] of [
        [880, 0, 0.12],
        [1320, 0.11, 0.18],
      ] as const) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.value = f;
        osc.connect(gain);
        gain.connect(ctx.destination);
        gain.gain.setValueAtTime(0.0001, t0 + od);
        gain.gain.exponentialRampToValueAtTime(0.12, t0 + od + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + od + delka);
        osc.start(t0 + od);
        osc.stop(t0 + od + delka + 0.02);
      }
    } catch {
      /* zvuk je bonus, ne nutnost */
    }
  };
  if (ctx.state === "suspended") void ctx.resume().then(zahraj, () => {});
  else zahraj();
}

/**
 * Má se na zprávu upozornit? Ne na vlastní, ne na tu, kterou uživatel
 * právě čte (panel otevřený na tom kanálu a okno má fokus).
 */
export function maUpozornit(v: { jeCizi: boolean; kanal: string; aktivniKanal: string | null; panelOtevren: boolean; oknoMaFokus: boolean }): boolean {
  if (!v.jeCizi) return false;
  if (v.panelOtevren && v.oknoMaFokus && v.aktivniKanal === v.kanal) return false;
  return true;
}

export function oknoMaFokus(): boolean {
  if (typeof document === "undefined") return false;
  if (document.visibilityState === "hidden") return false;
  return typeof document.hasFocus === "function" ? document.hasFocus() : true;
}

type TauriOznameni = {
  isPermissionGranted: () => Promise<boolean>;
  requestPermission: () => Promise<string>;
  sendNotification: (o: { title: string; body?: string }) => void;
};

let tauriModul: Promise<TauriOznameni | null> | null = null;

function nactiTauri(): Promise<TauriOznameni | null> {
  if (!isDesktop()) return Promise.resolve(null);
  if (!tauriModul) {
    tauriModul = import("@tauri-apps/plugin-notification")
      .then((m) => m as unknown as TauriOznameni)
      .catch(() => null);
  }
  return tauriModul;
}

/**
 * Požádá o povolení systémových oznámení. Volá se při prvním otevření
 * panelu; pamatuje si, že už se ptalo, aby se po odmítnutí neptalo pořád
 * (v prohlížeči by to stejně nic nevyvolalo, jen zbytečný slib).
 */
export async function pozadejOPovoleni(): Promise<boolean> {
  try {
    if (typeof localStorage !== "undefined" && localStorage.getItem(KLIC_POVOLENI_ZADANO) === "1") return await jePovoleno();
    localStorage?.setItem(KLIC_POVOLENI_ZADANO, "1");
  } catch {
    /* bez localStorage se zeptá pokaždé – to je snesitelné */
  }
  const tauri = await nactiTauri();
  if (tauri) {
    try {
      if (await tauri.isPermissionGranted()) return true;
      return (await tauri.requestPermission()) === "granted";
    } catch {
      return false;
    }
  }
  if (typeof Notification === "undefined") return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;
  try {
    return (await Notification.requestPermission()) === "granted";
  } catch {
    return false;
  }
}

export async function jePovoleno(): Promise<boolean> {
  const tauri = await nactiTauri();
  if (tauri) {
    try {
      return await tauri.isPermissionGranted();
    } catch {
      return false;
    }
  }
  return typeof Notification !== "undefined" && Notification.permission === "granted";
}

/**
 * Ukáže systémové oznámení. Klik na něj (ve webu) přenese okno dopředu
 * a otevře panel na daném kanálu. Na desktopu kliknutí jen zvedne aplikaci –
 * Tauri plugin událost kliknutí do JavaScriptu na desktopu nedoručuje.
 */
export async function upozorniNaZpravu(v: { titulek: string; text: string; kanal: string }): Promise<void> {
  const tauri = await nactiTauri();
  if (tauri) {
    try {
      if (await tauri.isPermissionGranted()) tauri.sendNotification({ title: v.titulek, body: v.text });
    } catch {
      /* oznámení se nepovedlo – zvuk a bublina stačí */
    }
    return;
  }
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
  try {
    const n = new Notification(v.titulek, { body: v.text, tag: `jobi-chat-${v.kanal}`, silent: true });
    n.onclick = () => {
      try {
        window.focus();
      } catch {
        /* některé prohlížeče focus z oznámení nepustí */
      }
      otevriChat({ kanal: v.kanal });
      n.close();
    };
  } catch {
    /* Notification konstruktor umí hodit (např. Android Chrome) */
  }
}
