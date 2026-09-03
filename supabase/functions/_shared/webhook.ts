/**
 * Kontrola adresy webhooku.
 *
 * Adresu zadává servis a my na ni pošleme požadavek ze serveru – to je
 * učebnicový SSRF: kdyby se dala nasměrovat na 127.0.0.1 nebo na metadata
 * službu cloudu, ukázali bychom mu vnitřek vlastní infrastruktury.
 * Proto jen https a jen veřejné adresy.
 *
 * Bez Deno API, aby to šlo testovat z vitest – viz src/lib/webhook.test.ts.
 */

/** Rozsahy, které nesmí ven. Nejde o úplnost, jde o zjevné případy. */
const ZAKAZANE_NAZVY = [
  "localhost",
  "metadata.google.internal",
];

function jePrivatniIP(host: string): boolean {
  // IPv6 smyčka a odkaz na sebe sama
  if (host === "::1" || host === "[::1]" || host.startsWith("fe80:") || host.startsWith("[fe80:")) return true;
  // IPv4 v desítkovém zápisu
  const c = host.split(".");
  if (c.length !== 4 || c.some((x) => !/^\d{1,3}$/.test(x))) return false;
  const [a, b] = c.map(Number);
  if (c.map(Number).some((n) => n > 255)) return false;
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 169 && b === 254) return true;   // metadata služby cloudů
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
}

export type Kontrola = { ok: true; url: string } | { ok: false; duvod: string };

export function zkontrolujWebhook(vstup: unknown): Kontrola {
  if (typeof vstup !== "string" || !vstup.trim()) return { ok: false, duvod: "Adresa je prázdná" };
  const text = vstup.trim();
  if (text.length > 500) return { ok: false, duvod: "Adresa je moc dlouhá" };

  let u: URL;
  try {
    u = new URL(text);
  } catch {
    return { ok: false, duvod: "Tohle není platná adresa" };
  }

  // http by adresu i obsah poslalo v otevřené podobě
  if (u.protocol !== "https:") return { ok: false, duvod: "Adresa musí začínat https://" };

  const host = u.hostname.toLowerCase();
  if (ZAKAZANE_NAZVY.includes(host) || host.endsWith(".localhost")) {
    return { ok: false, duvod: "Na tuhle adresu posílat nejde" };
  }
  if (jePrivatniIP(host)) return { ok: false, duvod: "Na vnitřní síťovou adresu posílat nejde" };

  return { ok: true, url: u.toString() };
}
