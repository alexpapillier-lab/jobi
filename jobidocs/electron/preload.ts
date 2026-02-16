import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("electron", {
  openPrintDialog: (html: string) => ipcRenderer.invoke("open-print-dialog", html),
  showSaveDialog: (defaultName: string) => ipcRenderer.invoke("show-save-dialog", defaultName),
});
