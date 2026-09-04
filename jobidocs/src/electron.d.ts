import type { ElectronBridge } from "./api";

declare global {
  interface Window {
    electron?: ElectronBridge;
  }
}

export {};
