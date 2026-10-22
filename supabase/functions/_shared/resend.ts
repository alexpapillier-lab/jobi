/**
 * Odeslání e-mailu přes Resend – náhrada za `fetch("https://api.resend.com/emails", init)`.
 *
 * Navíc jen jedno: na testovací adresy se nic neposílá. Doména `.test`,
 * `.example`, `.invalid`, `.localhost` (RFC 2606) a example.com/net/org
 * nikdy nedoručí, takže každý takový e-mail (noční E2E testy, zkoušky)
 * ukrojil z denního stropu Resendu (Free 100/den) a jako nedoručený
 * zhoršoval pověst odesílatele – skutečné e-maily pak častěji padají do spamu.
 *
 * Testovací příjemci se z `to`/`cc`/`bcc` vyřadí; když nezbude nikdo,
 * Resend se nevolá a vrátí se 200 s `{ id: null, skipped: "test" }`
 * (volající to bere jako odeslané – pro testy je to správně).
 */

const RESEND_URL = "https://api.resend.com/emails";

const TESTOVACI_KONCOVKY = [".test", ".example", ".invalid", ".localhost"];
const TESTOVACI_DOMENY = new Set(["example.com", "example.net", "example.org"]);

/** Adresa, na kterou se nikdy nedoručí (testy, ukázky). Vstup může být i „Jméno <adresa>“. */
export function jeTestovaciEmail(adresa: string | null | undefined): boolean {
  const s = String(adresa ?? "").trim().toLowerCase();
  const v = s.match(/<([^>]+)>/)?.[1] ?? s;
  const at = v.lastIndexOf("@");
  if (at < 0) return false;
  const domena = v.slice(at + 1).replace(/\.$/, "");
  return TESTOVACI_DOMENY.has(domena) || TESTOVACI_KONCOVKY.some((k) => domena === k.slice(1) || domena.endsWith(k));
}

function bezTestovacich(v: unknown): unknown {
  if (typeof v === "string") return jeTestovaciEmail(v) ? [] : [v];
  if (Array.isArray(v)) return v.filter((x) => typeof x !== "string" || !jeTestovaciEmail(x));
  return v;
}

const pocet = (v: unknown) => (Array.isArray(v) ? v.length : v ? 1 : 0);

export async function resendFetch(init: RequestInit): Promise<Response> {
  let telo: Record<string, unknown> | null = null;
  try {
    telo = typeof init.body === "string" ? JSON.parse(init.body) : null;
  } catch {
    telo = null;
  }
  if (!telo) return fetch(RESEND_URL, init);

  const to = bezTestovacich(telo.to);
  const cc = telo.cc === undefined ? undefined : bezTestovacich(telo.cc);
  const bcc = telo.bcc === undefined ? undefined : bezTestovacich(telo.bcc);
  if (pocet(to) + pocet(cc) + pocet(bcc) === 0) {
    console.log("[resend] testovací adresa – e-mail se neposílá:", JSON.stringify(telo.to));
    return new Response(JSON.stringify({ id: null, skipped: "test" }), { status: 200, headers: { "Content-Type": "application/json" } });
  }
  const upravene: Record<string, unknown> = { ...telo, to };
  if (cc !== undefined) upravene.cc = cc;
  if (bcc !== undefined) upravene.bcc = bcc;
  // Resend chce v `to` aspoň jednoho – zbyl-li příjemce jen v cc/bcc, posune se.
  if (pocet(to) === 0) {
    const nahradni = (Array.isArray(cc) && cc.length ? cc : bcc) as string[];
    upravene.to = [nahradni[0]];
  }
  return fetch(RESEND_URL, { ...init, body: JSON.stringify(upravene) });
}
