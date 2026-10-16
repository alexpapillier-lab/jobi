/**
 * Změnil člověk ve formuláři Upravit něco?
 *
 * Formulář se při kliknutí na Upravit celý předvyplní, takže „má nějaké
 * klíče“ neznamená „má změny“ – zavření detailu pak hlásilo neuložené
 * změny, i když nikdo nic nepřepsal. Porovnává se s tím, čím se formulář
 * naplnil. Prázdné hodnoty (undefined, null, "") se berou jako stejné:
 * pole, do kterého se kliklo a zase se smazalo, není změna.
 */

function normalizuj(v: unknown): string {
  if (v === undefined || v === null || v === "") return "";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

export function formularZmenen(puvodni: Record<string, unknown> | null | undefined, aktualni: Record<string, unknown>): boolean {
  const zaklad = puvodni ?? {};
  const klice = new Set([...Object.keys(zaklad), ...Object.keys(aktualni)]);
  for (const k of klice) {
    if (normalizuj(zaklad[k]) !== normalizuj(aktualni[k])) return true;
  }
  return false;
}
