/**
 * Ověření a očištění těla zápisu přes veřejné API.
 *
 * Klíčové pravidlo: do databáze jde JEN to, co je tady vyjmenované.
 * Kdyby se přeposílal celý objekt od klienta, dal by se přes API přepsat
 * service_id nebo public_visible – tedy obejít viditelnost i vlastnictví.
 *
 * Bez Deno API, aby to šlo testovat z vitest – viz src/lib/zapis.test.ts.
 */

export type Zmena = {
  id?: string;
  sku?: string;
  hodnoty: Record<string, number>;
  /**
   * Do kterého skladu má jít `stock` – id nebo název. Když chybí, použije se
   * výchozí sklad servisu. Existující integrace o skladech nevědí, a proto
   * musí dál fungovat beze změny těla.
   */
  sklad?: string;
};

export type Vysledek = { zmeny: Zmena[]; chyby: string[] };

/** Kladné konečné číslo, zaokrouhlené. `null`, když hodnota nedává smysl. */
function cislo(x: unknown, celociselne: boolean): number | null {
  if (typeof x === "boolean" || x === null || x === undefined || x === "") return null;
  const n = Number(x);
  if (!Number.isFinite(n) || n < 0) return null;
  return celociselne ? Math.trunc(n) : Math.round(n * 100) / 100;
}

const JE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Nejvýš 200 položek na požadavek – ať jeden dotaz neběží minutu. */
const MAX_POLOZEK = 200;

export function zmenyProduktu(vstup: unknown[]): Vysledek {
  const zmeny: Zmena[] = [];
  const chyby: string[] = [];
  if (vstup.length > MAX_POLOZEK) {
    return { zmeny: [], chyby: [`Najednou jde poslat nejvýš ${MAX_POLOZEK} produktů`] };
  }

  vstup.forEach((r: any, i) => {
    const id = typeof r?.id === "string" && JE_UUID.test(r.id) ? r.id : undefined;
    const sku = typeof r?.sku === "string" && r.sku.trim() ? r.sku.trim() : undefined;
    if (!id && !sku) {
      chyby.push(`products[${i}]: chybí id nebo sku`);
      return;
    }

    const hodnoty: Record<string, number> = {};
    if ("stock" in r) {
      const v = cislo(r.stock, true);
      if (v === null) chyby.push(`products[${i}]: stock musí být nezáporné celé číslo`);
      else hodnoty.stock = v;
    }
    if ("price" in r) {
      const v = cislo(r.price, false);
      if (v === null) chyby.push(`products[${i}]: price musí být nezáporné číslo`);
      else hodnoty.price = v;
    }
    const sklad = typeof r?.warehouse === "string" && r.warehouse.trim() ? r.warehouse.trim() : undefined;
    if (sklad && !("stock" in r)) {
      chyby.push(`products[${i}]: warehouse dává smysl jen se stock`);
      return;
    }
    if (Object.keys(hodnoty).length === 0) {
      chyby.push(`products[${i}]: není co měnit (povolené: stock, price)`);
      return;
    }
    zmeny.push({ id, sku, hodnoty, sklad });
  });

  return { zmeny, chyby };
}

export function zmenyOprav(vstup: unknown[]): Vysledek {
  const zmeny: Zmena[] = [];
  const chyby: string[] = [];
  if (vstup.length > MAX_POLOZEK) {
    return { zmeny: [], chyby: [`Najednou jde poslat nejvýš ${MAX_POLOZEK} oprav`] };
  }

  vstup.forEach((r: any, i) => {
    // U oprav se schválně nedá adresovat názvem – ten není jedinečný,
    // „Výměna displeje“ má servis u každého modelu jinou.
    const id = typeof r?.id === "string" && JE_UUID.test(r.id) ? r.id : undefined;
    if (!id) {
      chyby.push(`repairs[${i}]: chybí platné id`);
      return;
    }

    const hodnoty: Record<string, number> = {};
    if ("price" in r) {
      const v = cislo(r.price, false);
      if (v === null) chyby.push(`repairs[${i}]: price musí být nezáporné číslo`);
      else hodnoty.price = v;
    }
    if ("estimated_time" in r) {
      const v = cislo(r.estimated_time, true);
      if (v === null) chyby.push(`repairs[${i}]: estimated_time musí být nezáporné celé číslo`);
      else hodnoty.estimated_time = v;
    }
    if (Object.keys(hodnoty).length === 0) {
      chyby.push(`repairs[${i}]: není co měnit (povolené: price, estimated_time)`);
      return;
    }
    zmeny.push({ id, hodnoty });
  });

  return { zmeny, chyby };
}

/** Otisk těla, aby stejný Idempotency-Key s jiným obsahem nešel zaměnit. */
export async function otiskTela(telo: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(telo));
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
