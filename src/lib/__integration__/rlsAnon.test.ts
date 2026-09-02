import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Ověřuje, že s anon klíčem není zvenčí vidět nic, co vidět nemá.
 *
 * PROČ TENHLE TEST EXISTUJE:
 * 2. 9. 2026 se ukázalo, že tabulky capture_tokens a draft_capture_photos
 * nemají zapnuté RLS. S pouhým anon klíčem – který je vestavěný v každé
 * instalaci aplikace i ve veřejné capture stránce – vracely 22 platných
 * tokenů a veřejné URL fotek zákaznických zařízení. Nikdo si toho půl roku
 * nevšiml, protože to nic nekontrolovalo.
 *
 * Test se dívá na SKUTEČNOU databázi, ne na migrace. Migrace můžou být
 * v pořádku a produkce přesto ne – třeba když se nenasadily.
 *
 * Seznam tabulek se čte z migrací, takže nová tabulka je pokrytá
 * automaticky. Když u ní někdo zapomene RLS, test spadne.
 *
 * Bez SUPABASE údajů se přeskočí, aby nerozbil běžný `npm test`.
 */

const url = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL;
const anonKey = process.env.VITE_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY;

/**
 * Spouští se jen s RUN_INTEGRATION=1.
 *
 * Vitest si sám načítá .env, takže bez téhle podmínky by test běžel při
 * každém `npm test` – tedy by se každý běh testů dotazoval produkce
 * a bez internetu by selhal. Vývojáři má `npm test` fungovat i v letadle.
 */
const enabled = process.env.RUN_INTEGRATION === "1" && Boolean(url && anonKey);

/** Tabulky, kde je čitelnost anonymem ZÁMĚR. Přidávat jen s odůvodněním. */
const PUBLIC_BY_DESIGN = new Set<string>([
  // zatím žádné
]);

function tablesFromMigrations(): string[] {
  const dir = join(process.cwd(), "supabase", "migrations");
  const found = new Set<string>();
  for (const f of readdirSync(dir).filter((n) => n.endsWith(".sql"))) {
    const sql = readFileSync(join(dir, f), "utf-8").replace(/"/g, "");
    const re = /create table\s+(?:if not exists\s+)?(?:public\.)?([a-z_]+)/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(sql))) found.add(m[1].toLowerCase());
  }
  return [...found].filter((t) => !PUBLIC_BY_DESIGN.has(t)).sort();
}

async function selectAsAnon(table: string): Promise<{ status: number; rows: unknown[] | null }> {
  const res = await fetch(`${url}/rest/v1/${table}?select=*&limit=1`, {
    headers: { apikey: anonKey!, Authorization: `Bearer ${anonKey}` },
  });
  const text = await res.text();
  let rows: unknown[] | null = null;
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) rows = parsed;
  } catch {
    // Chybová odpověď není pole – to je v pořádku, znamená odepření.
  }
  return { status: res.status, rows };
}

describe.skipIf(!enabled)("RLS: anonymní přístup", () => {
  let tables: string[] = [];

  beforeAll(() => {
    tables = tablesFromMigrations();
  });

  it("v migracích je co kontrolovat", () => {
    expect(tables.length).toBeGreaterThan(20);
  });

  it("žádná tabulka nevrací anonymovi data", async () => {
    const leaking: string[] = [];
    let reachedApi = 0;

    for (const table of tablesFromMigrations()) {
      const { rows } = await selectAsAnon(table);
      // Pole (byť prázdné) znamená, že jsme se opravdu dovolali API.
      if (rows) reachedApi++;
      // Pole s alespoň jedním záznamem = únik. Prázdné pole i chyba jsou v pořádku.
      if (rows && rows.length > 0) leaking.push(table);
    }

    // Pojistka proti planému testu: kdyby byla špatná URL nebo klíč,
    // selhaly by všechny dotazy, rows by bylo null a test by prošel,
    // aniž by cokoli ověřil.
    expect(
      reachedApi,
      "Ani jeden dotaz se nedovolal API – zkontroluj VITE_SUPABASE_URL a klíč. " +
        "Test by jinak prošel, aniž by cokoli ověřil."
    ).toBeGreaterThan(tables.length / 2);

    expect(
      leaking,
      leaking.length
        ? `Tyhle tabulky vracejí data komukoli s anon klíčem: ${leaking.join(", ")}. ` +
          "Zapni na nich RLS (ALTER TABLE … ENABLE ROW LEVEL SECURITY), nebo je " +
          "přidej do PUBLIC_BY_DESIGN, pokud je to opravdu záměr."
        : ""
    ).toEqual([]);
  }, 120_000);
});
