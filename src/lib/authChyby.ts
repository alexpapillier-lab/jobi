/**
 * České hlášky pro chyby přihlášení a registrace.
 *
 * Supabase odpovídá anglicky („Invalid login credentials“, „User already
 * registered“) a přihlašovací obrazovka je vypisovala tak, jak přišly. První
 * věc, kterou nový zákazník v Jobi uvidí po překlepu v hesle, tak byla
 * anglická věta – a u „User already registered“ navíc taková, ze které není
 * poznat, co má dělat dál (přihlásit se, ne zakládat účet znovu).
 *
 * Překládá se podle `error_code`, ne podle textu: kódy jsou součástí
 * rozhraní Supabase, kdežto text se mezi verzemi mění. Text slouží jen jako
 * záloha pro starší odpovědi, které kód ještě nemají.
 */

/** Co Supabase vrací v chybě – bere se, co je po ruce. */
type AuthChyba = { code?: unknown; error_code?: unknown; status?: unknown; message?: unknown } | null | undefined;

const PODLE_KODU: Record<string, string> = {
  invalid_credentials: "Špatný e-mail nebo heslo.",
  user_already_exists: "Účet s tímto e-mailem už existuje. Přihlaste se, nebo si nechte poslat nové heslo.",
  email_exists: "Účet s tímto e-mailem už existuje. Přihlaste se, nebo si nechte poslat nové heslo.",
  weak_password: "Heslo je příliš slabé – použijte alespoň 6 znaků.",
  email_address_invalid: "Zadejte platnou e-mailovou adresu.",
  validation_failed: "Zadejte platnou e-mailovou adresu a heslo.",
  email_not_confirmed: "E-mail ještě není potvrzený. Otevřete odkaz z e-mailu, který jsme vám poslali.",
  over_email_send_rate_limit: "Zkoušíte to moc často. Zkuste to prosím za chvíli znovu.",
  over_request_rate_limit: "Zkoušíte to moc často. Zkuste to prosím za chvíli znovu.",
  signup_disabled: "Registrace jsou dočasně vypnuté. Napište nám na podpora@appjobi.com.",
  same_password: "Nové heslo se musí lišit od toho dosavadního.",
};

/**
 * Záloha pro odpovědi bez `error_code`. Porovnává se malými písmeny a jen
 * na začátku věty – Supabase za text občas přidá podrobnosti.
 */
const PODLE_TEXTU: Array<[string, string]> = [
  ["invalid login credentials", PODLE_KODU.invalid_credentials],
  ["user already registered", PODLE_KODU.user_already_exists],
  ["a user with this email address has already been registered", PODLE_KODU.user_already_exists],
  ["password should be at least", PODLE_KODU.weak_password],
  ["unable to validate email address", PODLE_KODU.email_address_invalid],
  ["email not confirmed", PODLE_KODU.email_not_confirmed],
  ["signups not allowed", PODLE_KODU.signup_disabled],
  ["email rate limit exceeded", PODLE_KODU.over_email_send_rate_limit],
  ["for security purposes, you can only request this after", PODLE_KODU.over_request_rate_limit],
  ["failed to fetch", "Nepodařilo se spojit s Jobi. Zkontrolujte připojení k internetu."],
  ["network", "Nepodařilo se spojit s Jobi. Zkontrolujte připojení k internetu."],
];

/**
 * Vrátí českou hlášku k chybě z Supabase.
 *
 * Neznámou chybu nezahazuje: původní text je pro podporu jediná stopa, tak
 * se přilepí za obecnou větu. Prázdná/chybějící chyba dá `zaloha` – volající
 * tak nemusí řešit, jestli vůbec nějaká přišla.
 */
export function prelozAuthChybu(chyba: AuthChyba, zaloha = "Přihlášení se nepodařilo."): string {
  if (!chyba) return zaloha;
  const kod = typeof chyba.error_code === "string" ? chyba.error_code : typeof chyba.code === "string" ? chyba.code : "";
  const podleKodu = PODLE_KODU[kod];
  if (podleKodu) return podleKodu;

  const text = typeof chyba.message === "string" ? chyba.message.trim() : "";
  const male = text.toLowerCase();
  for (const [vzor, hlaska] of PODLE_TEXTU) {
    if (male.startsWith(vzor) || male.includes(vzor)) return hlaska;
  }

  if (!text) return zaloha;
  // Česká hláška ze serveru (edge funkce Jobi odpovídají česky) se nechává být.
  if (/[ěščřžýáíéúůňťď]/i.test(text)) return text;
  return `${zaloha} (${text})`;
}
