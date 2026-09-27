/**
 * Která faktura kryje zakázku – pro „Přejít na fakturu“ a štítek v seznamu.
 *
 * Zdrojem je vazební tabulka `invoice_tickets` (migrace 20260927130000):
 * obsahuje jednotlivé faktury (trigger zrcadlí `invoices.ticket_id`)
 * i souhrnné faktury za víc zakázek. Dřív se četlo jen `invoices.ticket_id`,
 * takže zakázka vyfakturovaná souhrnně vypadala jako nevyfakturovaná
 * a nabízela „Vystavit fakturu“ – druhou fakturu by pak zastavila až
 * databáze chybou.
 *
 * Zálohová faktura se do vazeb nepromítá (zakázku nevyfakturuje), bere se
 * dál z `invoices.ticket_id` a ukáže se, jen dokud zakázka nemá fakturu.
 */

export type FakturaZakazky = {
  /** invoices.id */
  id: string;
  /** Číslo dokladu; koncept ho ještě nemá. */
  cislo: string | null;
  /** faktura = zakázka je vyfakturovaná (i souhrnně); zaloha = jen zálohová faktura. */
  druh: "faktura" | "zaloha";
};

/** Řádek `invoice_tickets` s vloženým číslem faktury (select „ticket_id, invoice_id, invoices(number)“). */
export type VazbaFakturyRadek = {
  ticket_id: string | null;
  invoice_id: string | null;
  invoices?: { number?: string | null } | Array<{ number?: string | null }> | null;
};

export type ZalohaRadek = { id: string; ticket_id: string | null; number?: string | null };

function cisloZVazby(r: VazbaFakturyRadek): string | null {
  const f = Array.isArray(r.invoices) ? r.invoices[0] : r.invoices;
  const c = (f?.number ?? "").trim();
  return c || null;
}

/**
 * Mapa zakázka → faktura. Aktivní vazba (nestornovaná, nesmazaná faktura)
 * má přednost před zálohou; volající posílá jen aktivní vazby.
 */
export function mapaFakturZakazek(vazby: VazbaFakturyRadek[], zalohy: ZalohaRadek[]): Record<string, FakturaZakazky> {
  const mapa: Record<string, FakturaZakazky> = {};
  for (const z of zalohy) {
    if (!z.ticket_id || !z.id || mapa[z.ticket_id]) continue;
    mapa[z.ticket_id] = { id: z.id, cislo: (z.number ?? "").trim() || null, druh: "zaloha" };
  }
  for (const v of vazby) {
    if (!v.ticket_id || !v.invoice_id) continue;
    mapa[v.ticket_id] = { id: v.invoice_id, cislo: cisloZVazby(v), druh: "faktura" };
  }
  return mapa;
}

/** Text štítku v seznamu zakázek; záloha štítek nemá (zakázka vyfakturovaná není). */
export function stitekFaktury(f: FakturaZakazky | undefined): string | null {
  if (!f || f.druh !== "faktura") return null;
  return f.cislo ?? "koncept faktury";
}
