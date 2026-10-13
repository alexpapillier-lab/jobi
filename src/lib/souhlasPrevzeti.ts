import { supabase } from "./supabaseClient";
import type { DocumentData } from "../../jobidocs/core/types";
import { formatDateTime, consentText } from "../../jobidocs/core/variables";
import { POPIS_METODY, type MetodaSouhlasu, type Souhlas } from "../../supabase/functions/_shared/objednavky";

/**
 * Podpis zákazníka při převzetí a elektronické odsouhlasení z webu.
 *
 *   - tickets.intake_signature_url – ruční podpis (portál, dílna); obrázek
 *     v soukromém bucketu, zobrazuje se přes podepsaný odkaz,
 *   - tickets.intake_consent – souhlas se zakázkovým listem odsouhlasený
 *     zákazníkem online na webu servisu (objednávka přes API, migrace
 *     20261013100000). Zapisuje ho jen převod objednávky na zakázku;
 *     ruční podpis ho nepřepisuje, oba záznamy zůstávají.
 *
 * Sloupce se čtou samostatně, ne v hlavním selectu zakázky: kdyby migrace
 * ještě nebyla nasazená, rozbil by chybějící sloupec načtení celé zakázky.
 */
export type SouhlasZakazky = Souhlas & {
  order_id?: string;
  external_id?: string;
  source?: string;
  transferred_at?: string;
};

export type PodpisPrevzeti = {
  intakeSignatureUrl?: string;
  intakeConsent?: SouhlasZakazky;
};

export async function nactiPodpisPrevzeti(ticketId: string): Promise<PodpisPrevzeti> {
  if (!supabase) return {};
  const tabulka = () => supabase!.from("tickets") as any;
  const { data, error } = await tabulka().select("intake_signature_url, intake_consent").eq("id", ticketId).maybeSingle();
  if (!error && data) return mapujPodpisPrevzeti(data as Record<string, unknown>);
  // Starší databáze bez intake_consent: aspoň ruční podpis.
  const z = await tabulka().select("intake_signature_url").eq("id", ticketId).maybeSingle();
  return z.error || !z.data ? {} : mapujPodpisPrevzeti(z.data as Record<string, unknown>);
}

export function mapujPodpisPrevzeti(row: Record<string, unknown>): PodpisPrevzeti {
  const out: PodpisPrevzeti = {};
  if (typeof row.intake_signature_url === "string" && row.intake_signature_url) out.intakeSignatureUrl = row.intake_signature_url;
  const c = row.intake_consent;
  if (c && typeof c === "object" && !Array.isArray(c) && typeof (c as SouhlasZakazky).id === "string") out.intakeConsent = c as SouhlasZakazky;
  return out;
}

/** Souhlas pro tisk (DocumentData.consent v JobiDocs). */
export function souhlasDoDokumentu(c: SouhlasZakazky | undefined | null): DocumentData["consent"] {
  if (!c) return undefined;
  return {
    id: c.id,
    signedAt: c.signed_at,
    method: c.method,
    source: c.source,
    signerName: c.signer_name,
    ip: c.ip,
    userAgent: c.user_agent,
    termsVersion: c.terms_version ?? c.document_version,
    orderNumber: c.external_id,
  };
}

/**
 * Obrázek do kolonky podpisu převzetí: ruční podpis má přednost (je novější
 * a vznikl na místě), jinak obrázek z odsouhlasení na webu.
 */
export function obrazekPodpisuPrevzeti(p: PodpisPrevzeti): string | undefined {
  return p.intakeSignatureUrl || p.intakeConsent?.signature_url || undefined;
}

/** „Elektronicky odsouhlaseno 13. 10. 2026 14:32 · ID ABC123 · formulář servis.iswap.cz“ – stejný text jako v tisku. */
export function textSouhlasu(c: SouhlasZakazky): string {
  return consentText({ service: {}, consent: souhlasDoDokumentu(c) });
}

/** Řádky detailu souhlasu (štítek, hodnota) – jen vyplněné. */
export function detailSouhlasu(c: SouhlasZakazky): Array<[string, string]> {
  const radky: Array<[string, string | undefined]> = [
    ["ID odsouhlasení", c.id],
    ["Odsouhlaseno", formatDateTime(c.signed_at)],
    ["Způsob", POPIS_METODY[c.method as MetodaSouhlasu] ?? c.method],
    ["Kdo", c.signer_name],
    ["Objednávka", c.external_id ? `${c.external_id}${c.source ? ` (${c.source})` : ""}` : c.source],
    ["IP adresa", c.ip],
    ["Prohlížeč", c.user_agent],
    ["Verze podmínek", c.terms_version],
    ["Verze dokumentu", c.document_version],
    ["Otisk textu", c.text_hash],
    ["Podmínky", c.terms_url],
    ["Přijato do Jobi", formatDateTime(c.received_at)],
    ["Přeneseno na zakázku", formatDateTime(c.transferred_at)],
  ];
  return radky.filter((r): r is [string, string] => typeof r[1] === "string" && r[1].trim() !== "");
}
