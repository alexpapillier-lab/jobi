import { typedSupabase } from "./typedSupabase";

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
  const ts = Date.now().toString(36).toUpperCase().slice(-4);
  return `${prefix}${y}-${ts}`;
}

export function invoiceNumberToVS(invoiceNumber: string): string {
  return invoiceNumber.replace(/[^0-9]/g, "").slice(0, 10);
}
