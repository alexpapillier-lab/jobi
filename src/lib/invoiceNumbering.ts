import { typedSupabase } from "./typedSupabase";
import { KIND_VS_PREFIX, type InvoiceKind } from "../pages/Invoices/types";

/**
 * Atomically generates the next invoice number via a DB function.
 * Falls back to a client-side generated number if the RPC is unavailable.
 */
export async function generateInvoiceNumber(
  serviceId: string,
  prefix = "FV",
  year?: number,
): Promise<string> {
  const y = year ?? new Date().getFullYear();
  try {
    const { data, error } = await (typedSupabase as any).rpc("next_invoice_number", {
      p_service_id: serviceId,
      p_prefix: prefix,
      p_year: y,
    });
    if (error) throw error;
    if (typeof data === "string" && data.length > 0) return data;
  } catch {
    // fallback
  }
  /* Náhradní číslo jen z číslic. Dřív bylo v base36 („FV2026-1A2B"), takže
     z něj vyšel nesmyslný variabilní symbol – ten se odvozuje jen z číslic
     a písmena tiše vypadla. */
  const sekundy = (Math.floor(Date.now() / 1000) % 10000).toString().padStart(4, "0");
  const nahoda = Math.floor(Math.random() * 100).toString().padStart(2, "0");
  return `${prefix}${y}-${sekundy}${nahoda}`;
}

/**
 * Variabilní symbol z čísla dokladu.
 *
 * Bere jen číslice a vpředu přidá číslici druhu dokladu, protože číselné řady
 * běží zvlášť: bez ní by „FV2026-0001" i „ZF2026-0001" daly „20260001" a banka
 * by dvě platby nerozeznala. Symbol smí mít nejvýš deset číslic, proto se
 * číslo v krajním případě zkracuje zprava – rozlišení druhu je důležitější
 * než poslední číslice pořadí.
 */
export function invoiceNumberToVS(invoiceNumber: string, kind: InvoiceKind = "invoice"): string {
  const cislice = invoiceNumber.replace(/[^0-9]/g, "");
  return `${KIND_VS_PREFIX[kind]}${cislice}`.slice(0, 10);
}
