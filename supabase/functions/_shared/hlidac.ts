/**
 * Syntetický hlídač produkce – společná část.
 *
 * Vlastní kontroly jezdí v `scripts/hlidac/` (Node, GitHub Actions). Tenhle
 * soubor drží to, co musí být na SERVERU, protože o tom rozhoduje e-mail:
 * seznam kontrol, jejich závažnost a překlad „spadlo tohle“ na upozornění,
 * které si v `alerts-check` sáhne pro stejné tlumení přes `alert_events`
 * jako hlídač chyb. Druhá infrastruktura na posílání e-mailů tím nevzniká.
 *
 * Je to čistý kód bez sítě a databáze, takže ho testuje vitest
 * (`src/lib/hlidac.test.ts`) – edge funkce se naimportovat nedá, tahá si
 * `serve` z deno.land.
 */

/** Jedna kontrola. Pořadí v poli = závažnost, první je nejzávažnější. */
export type Kontrola = {
  /** Klíč. Stejný řetězec používá `scripts/hlidac/kontroly.mjs`. */
  id: string;
  /** Krátký název do e-mailu. */
  nazev: string;
  /** Co to znamená pro zákazníka, když tahle kontrola spadne. */
  dopad: string;
};

/**
 * Kontroly od nejzávažnější po nejméně závažnou.
 *
 * Na pořadí záleží: když spadne víc kontrol najednou (typicky celý výpadek),
 * pošle se JEDEN e-mail pojmenovaný podle té nejzávažnější a ostatní jsou
 * v něm vypsané. Kdyby měla každá kontrola vlastní e-mail, přišlo by při
 * výpadku šest zpráv místo jedné a tlumení by je neudrželo pohromadě.
 */
export const KONTROLY: Kontrola[] = [
  { id: "prihlaseni", nazev: "Přihlášení", dopad: "Nikdo se do aplikace nedostane." },
  { id: "databaze", nazev: "Odpověď databáze", dopad: "Databáze neodpovídá nebo odpovídá příliš pomalu." },
  { id: "seznam", nazev: "Seznam zakázek", dopad: "Servis po přihlášení uvidí prázdnou nebo rozbitou obrazovku." },
  { id: "zalozeni", nazev: "Založení zakázky", dopad: "U pultu nejde přijmout zařízení." },
  { id: "portal_akce", nazev: "Akce v zákaznickém portálu", dopad: "Zákazník nemůže schválit nabídku, podepsat převzetí ani potvrdit vyzvednutí." },
  { id: "portal_cteni", nazev: "Otevření zákaznického portálu", dopad: "Odkaz, který zákazník dostal, se neotevře." },
  { id: "smazani", nazev: "Smazání zakázky", dopad: "Zakázku nejde odstranit ze seznamu." },
  { id: "cenik", nazev: "Veřejný ceník", dopad: "Ceník vložený na webu servisu se nenačte." },
  { id: "rezervace", nazev: "Rezervační formulář", dopad: "Zákazník se z webu servisu neobjedná." },
  { id: "edge_funkce", nazev: "Nasazení edge funkcí", dopad: "Některá funkce není nasazená – brána na ni vrací 404." },
  { id: "web", nazev: "Web appjobi.com", dopad: "Webová verze aplikace nebo stránka portálu se nenačte." },
  { id: "uklid", nazev: "Úklid po hlídači", dopad: "V testovacím servisu zůstala zakázka z kontroly." },
];

/** Kontrola podle id; `null` u neznámého id (hlídač je novější než funkce). */
export function kontrola(id: string): Kontrola | null {
  return KONTROLY.find((k) => k.id === id) ?? null;
}

/** Co hlídač poslal o jedné neúspěšné kontrole. */
export type SelhaniKontroly = {
  id: string;
  /** Jedna věta, proč to spadlo (stav, chybová hláška, naměřený čas). */
  zprava: string;
};

/** Podnět ve tvaru, kterému rozumí odesílání v `alerts-check`. */
export type Podnet = { druh: string; nadpis: string; podrobnosti: string[] };

/** Kolikátý v pořadí závažnosti; neznámé id je až za všemi známými. */
function poradi(id: string): number {
  const i = KONTROLY.findIndex((k) => k.id === id);
  return i === -1 ? KONTROLY.length : i;
}

/**
 * Hlášení hlídače → nejvýš jeden podnět k odeslání.
 *
 * Druh (`kind`) je odvozený jen z NEJZÁVAŽNĚJŠÍ spadlé kontroly, ne ze všech.
 * Kdyby byl druh složený ze seznamu, stačilo by, aby při dalším běhu spadla
 * o jednu kontrolu víc, a vzniklo by nové `kind` – tlumení v `alert_events`
 * by na něj nedosáhlo a e-mail by přišel znovu. Takhle jde při probíhajícím
 * výpadku ven jedna zpráva za šest hodin.
 */
export function podnetyZHlidace(
  selhani: SelhaniKontroly[],
  meta?: { pokusy?: number; behUrl?: string | null },
): Podnet[] {
  const platna = (selhani ?? []).filter((s) => s && typeof s.id === "string" && s.id.length > 0);
  if (platna.length === 0) return [];

  const serazena = [...platna].sort((a, b) => poradi(a.id) - poradi(b.id));
  const hlavni = serazena[0];
  const k = kontrola(hlavni.id);
  const nazev = k?.nazev ?? hlavni.id;

  const nadpis = serazena.length === 1
    ? `Hlídač: ${nazev} nefunguje`
    : `Hlídač: ${nazev} nefunguje (a ${serazena.length - 1} další kontrola${serazena.length > 2 ? "y" : ""})`;

  const podrobnosti = serazena.map((s) => {
    const kk = kontrola(s.id);
    const popis = kk ? `${kk.nazev} – ${kk.dopad}` : s.id;
    return `${popis} (${orez(s.zprava, 300)})`;
  });

  // Kolikrát to spadlo po sobě, ať je z e-mailu poznat, že to není náhoda.
  if (meta?.pokusy && meta.pokusy > 1) {
    podrobnosti.push(`Spadlo ${meta.pokusy}× po sobě – jeden neúspěch se za poruchu nepovažuje.`);
  }
  if (meta?.behUrl) podrobnosti.push(`Záznam běhu: ${meta.behUrl}`);

  return [{ druh: `hlidac:${hlavni.id}`, nadpis, podrobnosti }];
}

function orez(s: unknown, n: number): string {
  const t = typeof s === "string" ? s : String(s ?? "");
  return t.length > n ? `${t.slice(0, n)}…` : t;
}
