import { showToast } from "../components/Toast";
import { logError, type ErrorLogContext } from "./errorLog";
import { normalizeError } from "../utils/errorNormalizer";

/**
 * Ukáže chybu uživateli A ZÁROVEŇ ji nahlásí do centrálních logů.
 *
 * Proč to existuje: v aplikaci bylo ~25 míst, kde se uživateli zobrazil
 * chybový toast, ale nikam se nic nezapsalo. Uživatel pak napíše
 * „nešlo mi uložit zakázku" a v logu není nic, protože `logError` byl
 * napojený jen na pády vykreslení.
 *
 * Pravidlo: **když chybu vidí uživatel, musí ji vidět i majitel aplikace.**
 * Proto se to dělá jedním voláním – aby nešlo udělat jen půlku.
 *
 * Osobní údaje řeší scrubPII v errorLog.ts; do `context` patří jen
 * technické identifikátory.
 */
export function reportError(opts: {
  /** Strojový kód pro seskupování, např. "orders.save_failed". */
  code: string;
  /** Původní chyba. Do toastu se vezme čitelná hláška, do logu i stack. */
  error: unknown;
  /** Text pro uživatele. Když chybí, odvodí se z chyby. */
  userMessage?: string;
  /** Kde v aplikaci, např. "Orders.saveTicket". */
  source?: string;
  serviceId?: string | null;
  context?: ErrorLogContext;
}): void {
  const { code, error, userMessage, source, serviceId, context } = opts;

  showToast(userMessage ?? normalizeError(error), "error");

  // Nečeká se – logování nesmí zdržet odezvu rozhraní.
  void logError({ code, error, source, serviceId, context });
}

/**
 * Zaloguje chybu, kterou uživateli neukazujeme.
 *
 * Pro místa, kde selhání nevadí pro chod (načtení nepovinného údaje,
 * přehrání zvuku), ale je dobré o něm vědět. Nahrazuje prázdné `catch {}`,
 * po kterých nezůstane žádná stopa.
 */
export function reportSilent(opts: {
  code: string;
  error: unknown;
  source?: string;
  serviceId?: string | null;
  context?: ErrorLogContext;
}): void {
  void logError(opts);
}
