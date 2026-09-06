/**
 * Stub @tauri-apps/api/core pro web.
 *
 * Podpis je svázaný se skutečným pluginem (`typeof Skutecny.invoke`), aby
 * `tsc` nahlásil rozejití rozhraní. Bez toho se stuby nikdy nekontrolovaly a
 * volání s parametry navíc (`invoke("set_app_icon", { data })`) procházelo jen
 * proto, že JavaScript argumenty navíc mlčky zahodí.
 */
import type * as Skutecny from "@tauri-apps/api/core";

export const invoke: typeof Skutecny.invoke = async (cmd) => {
  throw new Error(`Tauri příkaz "${cmd}" není ve webové verzi dostupný.`);
};
