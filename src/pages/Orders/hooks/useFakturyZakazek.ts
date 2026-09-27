/**
 * Faktury zakázek servisu: aktivní vazby z `invoice_tickets` (jednotlivé
 * i souhrnné faktury) a zálohové faktury z `invoices.ticket_id`.
 * Logika sloučení je v src/lib/fakturyZakazek.ts.
 *
 * Načítá se při otevření stránky a znovu při každém návratu na Zakázky
 * (`naStrance`) – fakturu člověk vystavuje na stránce Faktury a po návratu
 * má zakázka ukazovat „Přejít na fakturu“, ne nabízet druhou.
 */
import { useEffect, useState } from "react";
import { supabase } from "../../../lib/supabaseClient";
import { fetchAllPages } from "../../../lib/fetchAllPages";
import { reportSilent } from "../../../lib/reportError";
import { mapaFakturZakazek, type FakturaZakazky, type VazbaFakturyRadek, type ZalohaRadek } from "../../../lib/fakturyZakazek";

type RadekFaktury = ZalohaRadek & { kind?: string | null };

/** Chybějící tabulka (server ještě bez migrace souhrnné faktury 20260927130000). */
function chybiTabulka(err: unknown): boolean {
  const e = err as { code?: string; message?: string } | null;
  if (!e) return false;
  if (e.code === "42P01" || e.code === "PGRST205" || e.code === "PGRST200") return true;
  const m = (e.message ?? "").toLowerCase();
  return m.includes("does not exist") || m.includes("could not find") || m.includes("schema cache");
}

export function useFakturyZakazek(activeServiceId: string | null, zapnuto: boolean, naStrance: boolean): Record<string, FakturaZakazky> {
  const [mapa, setMapa] = useState<Record<string, FakturaZakazky>>({});

  useEffect(() => {
    if (!activeServiceId || !zapnuto || !naStrance || !supabase) return;
    const klient = supabase;
    let zruseno = false;
    (async () => {
      try {
        const vazby = await fetchAllPages<VazbaFakturyRadek>((od, doo) =>
          (klient.from("invoice_tickets") as any)
            .select("ticket_id, invoice_id, invoices(number)")
            .eq("service_id", activeServiceId)
            .eq("aktivni", true)
            .order("ticket_id")
            .order("invoice_id")
            .range(od, doo),
        );
        /* Bez migrace souhrnné faktury se běžné faktury čtou postaru
           z invoices.ticket_id, zálohové vždycky odtud. */
        const bezVazeb = !!vazby.error && chybiTabulka(vazby.error);
        if (vazby.error && !bezVazeb) {
          reportSilent({ code: "orders.invoice_links_load_failed", error: vazby.error, source: "useFakturyZakazek", serviceId: activeServiceId });
          return;
        }
        const faktury = await fetchAllPages<RadekFaktury>((od, doo) => {
          let q = (klient.from("invoices") as any)
            .select("id, ticket_id, number, kind")
            .eq("service_id", activeServiceId)
            .not("ticket_id", "is", null)
            .is("deleted_at", null)
            // Stornovaná faktura zakázku neblokuje – jinak by po stornu šlo
            // jen „Přejít na fakturu“ a novou by ze zakázky nebylo jak vystavit.
            .neq("status", "cancelled");
          // Dobropis není faktura zakázky.
          q = bezVazeb ? q.neq("kind", "credit_note") : q.eq("kind", "proforma");
          return q.order("id").range(od, doo);
        });
        if (zruseno) return;
        if (faktury.error) {
          reportSilent({ code: "orders.invoice_links_load_failed", error: faktury.error, source: "useFakturyZakazek", serviceId: activeServiceId });
        }
        const radky = faktury.data ?? [];
        const vazbyData: VazbaFakturyRadek[] = bezVazeb
          ? radky
              .filter((r) => (r.kind ?? "invoice") === "invoice")
              .map((r) => ({ ticket_id: r.ticket_id, invoice_id: r.id, invoices: { number: r.number ?? null } }))
          : vazby.data;
        const zalohy = radky.filter((r) => r.kind === "proforma");
        setMapa(mapaFakturZakazek(vazbyData, zalohy));
      } catch (err) {
        reportSilent({ code: "orders.invoice_links_load_failed", error: err, source: "useFakturyZakazek", serviceId: activeServiceId });
      }
    })();
    return () => { zruseno = true; };
  }, [activeServiceId, zapnuto, naStrance]);

  return mapa;
}
