import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("electron", {
  openPrintDialog: (html: string) => ipcRenderer.invoke("open-print-dialog", html),
  showSaveDialog: (defaultName: string) => ipcRenderer.invoke("show-save-dialog", defaultName),
  update: {
    check: () => ipcRenderer.invoke("jobidocs:check-update"),
    getState: () => ipcRenderer.invoke("jobidocs:get-update-state"),
    getError: () => ipcRenderer.invoke("jobidocs:get-update-error"),
    download: () => ipcRenderer.invoke("jobidocs:download-update"),
    quitAndInstall: () => ipcRenderer.invoke("jobidocs:quit-and-install"),
    onState: (cb: (state: { version: string; downloaded: boolean; progress: number } | null) => void) => {
      const handler = (_: unknown, state: { version: string; downloaded: boolean; progress: number } | null) => cb(state);
      ipcRenderer.on("jobidocs:update-state", handler);
      return () => ipcRenderer.removeListener("jobidocs:update-state", handler);
    },
    onError: (cb: (err: string | null) => void) => {
      const handler = (_: unknown, err: string | null) => cb(err);
      ipcRenderer.on("jobidocs:update-error", handler);
      return () => ipcRenderer.removeListener("jobidocs:update-error", handler);
    },
  },
});
