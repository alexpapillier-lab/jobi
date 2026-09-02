import { app, BrowserWindow, ipcMain, dialog, Tray, Menu, nativeImage } from "electron";
import { autoUpdater } from "electron-updater";
import path from "path";
import fs from "fs/promises";
import os from "os";
import { startApiServer } from "../api/server";

const API_PORT = 3847;
// V zabalené aplikaci vždy načítat zabudovaný dist; jinak by se načítal localhost → prázdné okno
const isDev = !app.isPackaged;

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
/** Na macOS: při true necháme okno zavřít (quit), jinak close → hide (zůstane v trayi). */
let isQuitting = false;

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
    return printers.map((pr) => ({
      name: pr.name,
      status: pr.status === 0 ? "idle" : String(pr.status),
      available: pr.status === 0,
    }));
  } catch {
    return [];
  } finally {
    if (!win.isDestroyed()) win.close();
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

    await win.loadFile(tmpPath);
    // loadFile už čeká na načtení – čekání na did-finish-load by viselo (událost už proběhla)

    const pdfBuffer = await win.webContents.printToPDF({
      printBackground: true,
      margins: { marginType: "none" },
      pageSize: "A4",
      preferCSSPageSize: true,
    });

    win.close();
    return Buffer.from(pdfBuffer);
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

  if (isDev) {
    mainWindow.loadURL("http://localhost:5173");
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, "../../dist/index.html"));
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  // macOS: červené tlačítko zavřít → skrýt okno (ne quit), skrýt Dock; zůstane jen tray. Při Ukončit → skutečně quit.
  if (process.platform === "darwin") {
    const win = mainWindow;
    win.on("close", (e) => {
      if (!win.isDestroyed() && !isQuitting) {
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
    if (!icon) return;
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
            isQuitting = true;
            app.quit();
          },
        },
      ])
    );
    tray.on("click", () => {
      tray?.popUpContextMenu();
    });
  } catch {
    // ikona nenalezena – tray přeskočíme
  }
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

  // Explicit feed: GitHub Releases (electron-updater expects latest-mac.yml + zip on the release)
  autoUpdater.setFeedURL({
    provider: "github",
    owner: "alexpapillier-lab",
    repo: "jobi",
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
ipcMain.handle("jobidocs:get-update-error", () => updateError);

app.whenReady().then(async () => {
  const userDataPath = app.getPath("userData");
  const isWindows = process.platform === "win32";
  await startApiServer(API_PORT, userDataPath, {
    htmlToPdf: htmlToPdfElectron,
    // Na macOS zůstávají undefined -> api/server.ts použije původní lp/lpstat cestu.
    printPdfNative: isWindows ? printPdfElectronWindows : undefined,
    listPrintersNative: isWindows ? listPrintersElectronWindows : undefined,
  });
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
