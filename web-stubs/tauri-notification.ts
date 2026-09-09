/**
 * Stub @tauri-apps/plugin-notification pro web – systémová upozornění jdou
 * přes Notification API prohlížeče. Chat týmu si plugin načítá jen na
 * desktopu (isDesktop), takže se tenhle kód ve webu nespustí; stub je tu
 * proto, aby se balíček pluginu vůbec nedostal do webového buildu (jeho
 * `addPluginListener` v tauri-core stubu není a build padal).
 */
import type * as Skutecny from "@tauri-apps/plugin-notification";

export const isPermissionGranted: typeof Skutecny.isPermissionGranted = async () =>
  typeof Notification !== "undefined" && Notification.permission === "granted";

export const requestPermission: typeof Skutecny.requestPermission = async () => {
  if (typeof Notification === "undefined") return "denied";
  return (await Notification.requestPermission()) as Awaited<ReturnType<typeof Skutecny.requestPermission>>;
};

export const sendNotification: typeof Skutecny.sendNotification = (options) => {
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
  const o = typeof options === "string" ? { title: options } : options;
  new Notification(o.title, { body: o.body });
};
