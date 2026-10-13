/**
 * Testovací účty (e-mail @jobi.test) a značky automatů v error_logs.
 *
 * E2E testy schválně odpojují síť a nechávají selhat zápisy – ověřují, že se
 * data neztratí. Jejich chyby se zapisují stejně jako skutečné, ale v přehledu
 * chyb (Owner) ani v hlídači provozu nemají co dělat. Nové záznamy nesou
 * `context.automat` (navigator.webdriver) nebo `context.dev` (vývojový server);
 * starší se poznají podle účtu.
 */
export const TESTOVACI_UCTY = [
  "3e2e0000-1111-4222-8333-444455556666", // e2e@jobi.test
  "3e2e0000-2222-4222-8333-444455556666", // e2e-technik@jobi.test
  "11111111-2222-4333-8444-555555555555", // technik.test@jobi.test
  "22222222-3333-4444-8555-666666666666", // spravce.test@jobi.test
  "33333333-4444-4555-8666-777777777777", // pobocka.test@jobi.test
  "4c0ce05b-74a1-458b-a455-bf82e3acaf65", // zatez@jobi.test
];

type Zaznam = { user_id?: string | null; context?: { dev?: unknown; automat?: unknown } | null };

/** Chyba z testu nebo vývoje – ne od skutečného uživatele. */
export function jeTestovaciZaznam(r: Zaznam): boolean {
  return r.context?.dev === true || r.context?.automat === true || (!!r.user_id && TESTOVACI_UCTY.includes(r.user_id));
}
