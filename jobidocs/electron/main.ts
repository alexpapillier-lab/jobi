import dns from "node:dns";
import { randomUUID } from "node:crypto";
import { app, BrowserWindow, ipcMain, dialog, Tray, Menu, nativeImage, autoUpdater as electronAutoUpdater } from "electron";
import { autoUpdater } from "electron-updater";
import path from "path";
import fs from "fs/promises";
import os from "os";
import { startApiServer } from "../api/server";

// Některé sítě neroutují IPv6; Node by pak u Supabase a fontů skončil na „fetch failed“.
dns.setDefaultResultOrder("ipv4first");

/**
 * Port lze přenastavit, aby šla aplikace spustit vedle už běžící kopie (testy).
 *
 * V zabalené aplikaci se ale přepínač ignoruje: Jobi chodí na natvrdo
 * `http://127.0.0.1:3847` (src-tauri/src/lib.rs a src/lib/jobidocs.ts), takže
 * jiný port by obě aplikace tiše rozpojil – JobiDocs by běžel a Jobi by hlásil
 * „spusťte JobiDocs“. Proměnná v prostředí uživatele (třeba zděděná ze
 * spouštěče) tak nemůže rozbít tisk.
 */
const VYCHOZI_PORT = 3847;
/**
 * Klíč, kterým se okno JobiDocs hlásí svému API.
 *
 * Okno se načítá z `file://` a posílá `Origin: null` – jenže to samé posílá
 * i libovolná stránka ze sandboxovaného iframu, takže by se cizí web dostal
 * k seznamu servisů, posledním fakturám i k přepsání přihlášení. Klíč vzniká
 * při startu, žije jen v paměti procesu a předává se oknu v adrese.
 */
const KLIC_OKNA = randomUUID();
const API_PORT = app.isPackaged ? VYCHOZI_PORT : Number(process.env.JOBIDOCS_API_PORT) || VYCHOZI_PORT;
// V zabalené aplikaci vždy načítat zabudovaný dist; jinak by se načítal localhost → prázdné okno
const isDev = !app.isPackaged;
/**
 * Načíst zabudovaný dist i v nezabalené aplikaci.
 *
 * Automatický test spouští `electron .` z buildu, ale bez vývojového serveru
 * na 5173 – bez tohohle přepínače by se otevřelo prázdné okno. Aktualizace
 * se tím neovlivní: ty se dál řídí `isDev`, takže test nesahá na GitHub.
 */
const loadFromDist = process.env.JOBIDOCS_LOAD_DIST === "1";

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
/**
 * Na macOS: při true necháme okno zavřít (quit), jinak close → hide (zůstane v trayi).
 *
 * Zvedá se v setupQuitHandling() u každé cesty k ukončení. Nesmí se spoléhat
 * na to, že ho nastaví jen položka v trayi – viz komentář tam.
 */
let isQuitting = false;
/**
 * Proč lokální API neběží (nejčastěji obsazený port = druhá kopie JobiDocs).
 *
 * Dřív se `startApiServer` čekalo bez ošetření chyby: když port obsadila jiná
 * kopie, `app.whenReady()` skončilo zamítnutým příslibem, okno se vůbec
 * nevytvořilo a v horní liště zůstala jen ikona. Uživatel viděl aplikaci,
 * která „nejde otevřít“. Teď se chyba uloží sem, okno se otevře a UI ji ukáže.
 */
let apiStartError: string | null = null;

/**
 * Tisk PDF na Windows přes Chromium v Electronu.
 *
 * POZOR: Používá se VÝHRADNĚ na Windows. macOS tiskne dál přes /usr/bin/lp
 * (api/print.ts) – ta cesta je odladěná a nesmí se měnit.
 *
 * Windows nemá CUPS, takže `lp` tam neexistuje. PDF načteme do skrytého okna
 * (Chromium PDF viewer) a vytiskneme přes webContents.print().
 */
async function printPdfElectronWindows(
  pdfBuffer: Buffer,
  printerName?: string
): Promise<string> {
  if (pdfBuffer.length === 0) throw new Error("PDF je prázdný");

  const tmpPath = path.join(os.tmpdir(), `jobidocs-print-${Date.now()}.pdf`);
  await fs.writeFile(tmpPath, pdfBuffer);

  const win = new BrowserWindow({
    show: false,
    webPreferences: { plugins: true, nodeIntegration: false, contextIsolation: true },
  });

  try {
    await win.loadURL(`file://${tmpPath.replace(/\\/g, "/")}`);
    // PDF viewer se vykresluje až po načtení; bez krátké prodlevy vyjede prázdná stránka.
    await new Promise((r) => setTimeout(r, 700));

    await new Promise<void>((resolve, reject) => {
      win.webContents.print(
        {
          silent: true,
          printBackground: true,
          ...(printerName ? { deviceName: printerName } : {}),
        },
        (success, failureReason) => {
          if (success) resolve();
          else reject(new Error(failureReason || "Tisk se nezdařil"));
        }
      );
    });

    // Windows nevrací job ID jako lp; vracíme prázdný řetězec (volající to snese).
    return "";
  } finally {
    if (!win.isDestroyed()) win.close();
    setTimeout(() => { void fs.unlink(tmpPath).catch(() => {}); }, 5000);
  }
}

/**
 * Seznam tiskáren na Windows (lpstat tam není). Na macOS se nepoužívá.
 */
async function listPrintersElectronWindows(): Promise<
  Array<{ name: string; status: string; available: boolean }>
> {
  const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
  try {
    const printers = await win.webContents.getPrintersAsync();
    return printers.map((pr) => {
      // Electron 44 odstranil PrinterInfo.status (dřív Windows DWORD, 0 = připravena).
      // Stav teď dodává OS v options, pokud vůbec – klíč printer-state podle IPP:
      // 3 = idle, 4 = tiskne, 5 = zastavena.
      const raw = (pr.options as Record<string, unknown> | undefined)?.["printer-state"];
      const state = raw === undefined || raw === null ? null : String(raw);
      const status =
        state === null ? "unknown"
        : state === "3" ? "idle"
        : state === "4" ? "printing"
        : state === "5" ? "stopped"
        : state;
      return {
        name: pr.name,
        status,
        // Když stav OS nedodá, tiskárnu radši nabídneme, než abychom ji schovali.
        available: state === null ? true : state === "3" || state === "4",
      };
    });
  } catch {
    return [];
  } finally {
    if (!win.isDestroyed()) win.close();
  }
}

/**
 * Dokumenty z jádra si po načtení samy změří stránku a případně zmenší písmo,
 * aby se vešly na jednu stranu (skript v HTML nastaví data-fit="done").
 * Tady na to počkáme, jinak by PDF vzniklo před doměřením. Surové HTML bez
 * skriptu prostě po krátké prodlevě projde dál.
 */
async function waitForFit(win: BrowserWindow, maxMs = 8000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    try {
      const state = (await win.webContents.executeJavaScript(
        "(function(){var r=document.documentElement;return r.dataset.fit==='done'?'done':(document.body&&document.body.querySelector('.page[data-main]')?'wait':'none')})()"
      )) as string;
      if (state === "done") return;
      if (state === "none") {
        await new Promise((r) => setTimeout(r, 250));
        return;
      }
    } catch {
      return;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
}

/**
 * Render HTML to PDF using Electron's bundled Chromium (no Puppeteer/Chrome needed).
 * Uses temp file instead of data URL to avoid size limits for large documents.
 */
async function htmlToPdfElectron(html: string): Promise<Buffer> {
  const tmpPath = path.join(os.tmpdir(), `jobidocs-render-${Date.now()}.html`);
  try {
    await fs.writeFile(tmpPath, html, "utf-8");

    const win = new BrowserWindow({
      show: false,
      webPreferences: {
        offscreen: true,
        nodeIntegration: false,
        contextIsolation: true,
      },
    });

    try {
      await win.loadFile(tmpPath);
      // loadFile už čeká na načtení – čekání na did-finish-load by viselo (událost už proběhla)
      await waitForFit(win);

      const pdfBuffer = await win.webContents.printToPDF({
        printBackground: true,
        // Electron 44 zrušil marginType; nulové okraje se zadávají čísly (v palcích).
        margins: { top: 0, bottom: 0, left: 0, right: 0 },
        pageSize: "A4",
        preferCSSPageSize: true,
      });

      return Buffer.from(pdfBuffer);
    } finally {
      // Bez tohohle zůstávalo po každém neúspěšném renderu viset skryté okno.
      if (!win.isDestroyed()) win.close();
    }
  } finally {
    await fs.unlink(tmpPath).catch(() => {});
  }
}

ipcMain.handle("show-save-dialog", async (_, defaultName: string) => {
  const win = BrowserWindow.getAllWindows()[0] ?? null;
  const { filePath } = await dialog.showSaveDialog(win ?? undefined, {
    defaultPath: defaultName,
    filters: [{ name: "PDF", extensions: ["pdf"] }, { name: "All Files", extensions: ["*"] }],
  });
  return filePath ?? null;
});

ipcMain.handle("open-print-dialog", async (_, html: string) => {
  const tmpPath = path.join(os.tmpdir(), `jobidocs-print-${Date.now()}.html`);
  try {
    await fs.writeFile(tmpPath, html, "utf-8");
    const win = new BrowserWindow({
      show: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
      },
    });
    await win.loadFile(tmpPath);
    return new Promise<void>((resolve, reject) => {
      win.webContents.print(
        { silent: false, printBackground: true },
        (success, err) => {
          win.close();
          if (success) resolve();
          else reject(err ?? new Error("Print failed"));
        }
      );
    });
  } finally {
    await fs.unlink(tmpPath).catch(() => {});
  }
});

/**
 * Aby šlo aplikaci na macOS vůbec ukončit.
 *
 * Okno se na červené tlačítko jen schová (viz `close` v createWindow), aby
 * JobiDocs běžel dál v menu baru. Ten strážce ale ruší ZAVŘENÍ OKNA, a to i
 * tehdy, když se zavírá kvůli ukončení aplikace. Dokud se `isQuitting`
 * nastavovalo jen v položce trayi „Ukončit JobiDocs“, každá jiná cesta
 * k ukončení tiše selhala:
 *
 *   - „Restartovat a nainstalovat“ u aktualizace. autoUpdater.quitAndInstall()
 *     nejdřív zavírá okna a app.quit() volá až potom, co se zavřou. `close` to
 *     zavření zrušil, takže okno se jen schovalo, app.quit() nikdy nepřišel a
 *     aktualizace se nenainstalovala. Navenek to vypadalo, že se okno zavřelo,
 *     ale ikona zůstala v horní liště.
 *   - ⌘Q i Ukončit v nabídce aplikace – totéž, jen se okno schovalo.
 *
 * Proč dvě události místo jedné: při quitAndInstall() se `before-quit` PŘED
 * zavřením oken vůbec nepošle. Electron na to má zvlášť „before-quit-for-update“
 * a sám v dokumentaci píše, že je potřeba poslouchat obojí. Ta událost visí na
 * nativním autoUpdateru z Electronu, ne na tom z electron-updateru – ten na
 * macOS nakonec volá právě jeho (MacUpdater.handleUpdateDownloaded).
 */
function setupQuitHandling() {
  app.on("before-quit", () => {
    isQuitting = true;
  });

  if (process.platform === "darwin") {
    electronAutoUpdater.on("before-quit-for-update", () => {
      isQuitting = true;
    });
  }
}

async function createWindow() {
  const preloadPath = path.join(__dirname, "preload.js");
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: preloadPath,
    },
  });

  // Okno musí mluvit s API TOHOTO procesu, ne s pevnou 3847.
  //
  // Renderer měl adresu API natvrdo, takže druhá spuštěná kopie (a stejně
  // tak test na vlastním portu) obsluhovala okno cizí instance: ukazovala
  // její servisy a ukládala do nich. Adresu proto předává hlavní proces
  // v parametru `?api=`, který src/api.ts už uměl číst.
  const apiUrl = `http://127.0.0.1:${API_PORT}`;
  if (isDev && !loadFromDist) {
    mainWindow.loadURL(`http://localhost:5173/?api=${encodeURIComponent(apiUrl)}&klic=${encodeURIComponent(KLIC_OKNA)}`);
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, "../../dist/index.html"), { query: { api: apiUrl, klic: KLIC_OKNA } });
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  // macOS: červené tlačítko zavřít → skrýt okno (ne quit), skrýt Dock; zůstane jen tray. Při Ukončit → skutečně quit.
  //
  // Podmínka `tray` je zásadní: schovat okno i Dock a nemít ikonu v horní
  // liště znamená běžící aplikaci, kterou uživatel nemá jak vyvolat zpět.
  // Když se tray nepodaří vytvořit (chybí ikona v buildu), necháme okno
  // zavřít normálně, ať se aplikace chová jako každá jiná.
  if (process.platform === "darwin") {
    const win = mainWindow;
    win.on("close", (e) => {
      if (!win.isDestroyed() && !isQuitting && tray) {
        e.preventDefault();
        win.hide();
        app.dock?.hide();
      }
    });
  }
}

const TRAY_ICON_SIZE = 22; // macOS menu bar: 22x22 (16x16 také ok)
const TRAY_ICON_TEMPLATE = "tray-icon-template.png"; // monochrome (black + alpha); macOS přebarví podle menu baru

function loadTrayIcon(): ReturnType<typeof nativeImage.createFromPath> | null {
  const iconPath = path.join(__dirname, TRAY_ICON_TEMPLATE);
  let icon = nativeImage.createFromPath(iconPath);
  if (icon.isEmpty()) return null;
  const size = icon.getSize();
  if (size.width > TRAY_ICON_SIZE || size.height > TRAY_ICON_SIZE) {
    icon = icon.resize({ width: TRAY_ICON_SIZE, height: TRAY_ICON_SIZE });
  }
  // macOS: template image = maska; OS sám přebarví podle kontrastu k menu baru
  if (process.platform === "darwin") icon.setTemplateImage(true);
  return icon;
}

function setupTray() {
  if (process.platform !== "darwin") return;
  try {
    const icon = loadTrayIcon();
    if (!icon) {
      console.warn(`[JobiDocs] Ikona pro horní lištu nenalezena (${TRAY_ICON_TEMPLATE}); aplikace poběží bez trayi.`);
      return;
    }
    tray = new Tray(icon);
    tray.setToolTip("JobiDocs – běží");
    tray.setContextMenu(
      Menu.buildFromTemplate([
        {
          label: "Otevřít JobiDocs",
          click: () => {
            if (process.platform === "darwin") app.dock?.show();
            if (mainWindow) {
              mainWindow.show();
              mainWindow.focus();
            } else {
              createWindow().then(() => mainWindow?.show());
            }
          },
        },
        { type: "separator" },
        {
          label: "Ukončit JobiDocs",
          click: () => {
            // isQuitting zvedne i before-quit; necháváme to tu, ať je ukončení
            // z trayi čitelné na jednom místě a nezáviselo na pořadí událostí.
            isQuitting = true;
            app.quit();
          },
        },
      ])
    );
    tray.on("click", () => {
      tray?.popUpContextMenu();
    });
  } catch (err) {
    // Tray přeskočíme, ale mlčky ne: bez něj se mění i chování zavírání okna.
    console.warn("[JobiDocs] Tray se nepodařilo vytvořit:", err);
    tray = null;
  }
}

type UpdateChannel = "stable" | "beta";
function channelPath(): string {
  return path.join(app.getPath("userData"), "update-channel.json");
}
function readUpdateChannel(): UpdateChannel {
  try {
    const raw = JSON.parse(require("fs").readFileSync(channelPath(), "utf-8")) as { channel?: string };
    return raw.channel === "beta" ? "beta" : "stable";
  } catch {
    return "stable";
  }
}
async function writeUpdateChannel(channel: UpdateChannel): Promise<void> {
  await fs.writeFile(channelPath(), JSON.stringify({ channel }), "utf-8");
  autoUpdater.setFeedURL({ provider: "generic", url: `https://github.com/alexpapillier-lab/jobi/releases/download/jobidocs-${channel}` });
}

let updateState: { version: string; downloaded: boolean; progress: number } | null = null;
let updateError: string | null = null;
const CHECK_INTERVAL_MS = 10 * 60 * 1000; // 10 min

function sendUpdateState() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("jobidocs:update-state", updateState);
  }
}

function sendUpdateError(err: string | null) {
  updateError = err;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("jobidocs:update-error", err);
  }
}

function setupAutoUpdate() {
  if (isDev) return;
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;

  // Kanál aktualizací: pevná adresa release `jobidocs-stable` / `jobidocs-beta`
  // v repu (release app do něj nahrává latest-mac.yml + zip). Nezávisí na tom,
  // co GitHub označí jako „Latest“, takže Jobi a JobiDocs mohou mít každý
  // svou verzi a svůj kanál.
  autoUpdater.setFeedURL({
    provider: "generic",
    url: `https://github.com/alexpapillier-lab/jobi/releases/download/jobidocs-${readUpdateChannel()}`,
  });

  autoUpdater.on("update-available", (info) => {
    updateError = null;
    updateState = { version: info.version, downloaded: false, progress: 0 };
    sendUpdateError(null);
    sendUpdateState();
  });

  autoUpdater.on("update-not-available", () => {
    updateError = null;
    updateState = null;
    sendUpdateError(null);
    sendUpdateState();
  });

  autoUpdater.on("download-progress", (progress) => {
    if (updateState) {
      updateState = { ...updateState, progress: progress.percent };
      sendUpdateState();
    }
  });

  autoUpdater.on("update-downloaded", () => {
    if (updateState) {
      updateState = { ...updateState, downloaded: true, progress: 100 };
      sendUpdateState();
    }
  });

  autoUpdater.on("error", (err) => {
    console.warn("[JobiDocs] Update error:", err);
    updateState = null;
    const msg = err instanceof Error ? err.message : String(err);
    sendUpdateError(msg);
    sendUpdateState();
  });

  const doCheck = () => {
    sendUpdateError(null);
    autoUpdater.checkForUpdates().catch((err) => {
      console.warn("[JobiDocs] Update check failed:", err);
      sendUpdateError(err instanceof Error ? err.message : String(err));
    });
  };
  doCheck();
  setInterval(doCheck, CHECK_INTERVAL_MS);
}

ipcMain.handle("jobidocs:check-update", async () => {
  if (isDev) return null;
  sendUpdateError(null);
  try {
    const result = await autoUpdater.checkForUpdates();
    return result?.updateInfo?.version ?? null;
  } catch (err) {
    console.warn("[JobiDocs] Update check failed:", err);
    sendUpdateError(err instanceof Error ? err.message : String(err));
    return null;
  }
});

ipcMain.handle("jobidocs:download-update", async () => {
  if (isDev || !updateState) return false;
  try {
    await autoUpdater.downloadUpdate();
    return true;
  } catch (err) {
    console.warn("[JobiDocs] Download failed:", err);
    return false;
  }
});

ipcMain.handle("jobidocs:quit-and-install", () => {
  if (isDev) return;
  autoUpdater.quitAndInstall(false, true);
});

ipcMain.handle("jobidocs:get-update-state", () => updateState);
ipcMain.handle("jobidocs:get-update-channel", () => readUpdateChannel());
ipcMain.handle("jobidocs:set-update-channel", async (_e, channel: string) => {
  await writeUpdateChannel(channel === "beta" ? "beta" : "stable");
  updateState = null;
  sendUpdateState();
  return readUpdateChannel();
});
ipcMain.handle("jobidocs:get-update-error", () => updateError);

ipcMain.handle("jobidocs:get-api-error", () => apiStartError);

app.whenReady().then(async () => {
  const userDataPath = app.getPath("userData");
  const isWindows = process.platform === "win32";
  try {
    await startApiServer(API_PORT, userDataPath, {
      htmlToPdf: htmlToPdfElectron,
      // Na macOS zůstávají undefined -> api/server.ts použije původní lp/lpstat cestu.
      printPdfNative: isWindows ? printPdfElectronWindows : undefined,
      listPrintersNative: isWindows ? listPrintersElectronWindows : undefined,
      appVersion: app.getVersion(),
      klicOkna: KLIC_OKNA,
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    apiStartError =
      (err as { code?: string })?.code === "EADDRINUSE"
        ? `Port ${API_PORT} už používá jiný program – nejspíš druhá kopie JobiDocs. Ukončete ji a spusťte JobiDocs znovu.`
        : `Lokální službu JobiDocs se nepodařilo spustit: ${detail}`;
    console.error("[JobiDocs] Start API selhal:", err);
  }
  setupQuitHandling();
  await createWindow();
  setupTray();
  setupAutoUpdate();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  // macOS: okna jen skrýváme (close → hide), aplikace běží v trayi; nevolat quit
  if (process.platform !== "darwin") {
    app.quit();
  }
});
