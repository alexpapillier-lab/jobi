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
}

function setupTray() {
  if (process.platform !== "darwin") return;
  const iconPath = path.join(__dirname, "tray-icon.png");
  try {
    const icon = nativeImage.createFromPath(iconPath);
    if (icon.isEmpty()) return;
    tray = new Tray(icon);
    tray.setToolTip("JobiDocs – běží");
    tray.setContextMenu(
      Menu.buildFromTemplate([
        {
          label: "Otevřít JobiDocs",
          click: () => {
            if (mainWindow) {
              mainWindow.show();
              mainWindow.focus();
            } else {
              createWindow().then(() => mainWindow?.show());
            }
          },
        },
        { type: "separator" },
        { label: "Ukončit JobiDocs", role: "quit" },
      ])
    );
    tray.on("click", () => {
      if (mainWindow) {
        mainWindow.show();
        mainWindow.focus();
      } else {
        createWindow().then(() => mainWindow?.show());
      }
    });
  } catch {
    // ikona nenalezena – tray přeskočíme
  }
}

function setupAutoUpdate() {
  if (isDev) return;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("update-available", (info) => {
    dialog.showMessageBox(mainWindow ?? undefined, {
      type: "info",
      title: "Aktualizace JobiDocs",
      message: `Je k dispozici nová verze ${info.version}.`,
      detail: "Stahování proběhne na pozadí. Po dokončení můžete aplikaci restartovat.",
      buttons: ["OK"],
    }).catch(() => {});
  });

  autoUpdater.on("update-downloaded", () => {
    dialog.showMessageBox(mainWindow ?? undefined, {
      type: "info",
      title: "Aktualizace stažena",
      message: "Nová verze je připravena. Restartovat nyní?",
      buttons: ["Restartovat", "Později"],
      defaultId: 0,
    }).then(({ response }) => {
      if (response === 0) autoUpdater.quitAndInstall(false, true);
    }).catch(() => {});
  });

  autoUpdater.checkForUpdates().catch((err) => {
    console.warn("[JobiDocs] Update check failed:", err);
  });
}

app.whenReady().then(async () => {
  const userDataPath = app.getPath("userData");
  await startApiServer(API_PORT, userDataPath, { htmlToPdf: htmlToPdfElectron });
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
  if (process.platform !== "darwin") {
    app.quit();
  }
});
