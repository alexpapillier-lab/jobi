import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Seznam oprávnění členů žije na třech místech: v rozhraní (TeamSettings),
 * v edge funkci team-set-capabilities a v databázové funkci
 * povolene_capability(). Když se rozejdou, majitel servisu nemůže uložit
 * vůbec nic – rozhraní posílá všechny klíče najednou a databáze celý zápis
 * odmítne kvůli jedinému neznámému. Přesně to se stalo s klíčem
 * `branch_only` a projevilo se to hláškou „[object Object]".
 *
 * Test čte zdrojáky, protože edge funkce ani migrace se do aplikace
 * neimportují. Je to ošklivé, ale levnější než další takový výpadek.
 */
const koren = join(__dirname, "..", "..");

function klice(soubor: string, zacatek: RegExp, konec: string): string[] {
  const text = readFileSync(join(koren, soubor), "utf8");
  const od = text.search(zacatek);
  expect(od, `V ${soubor} chybí seznam oprávnění.`).toBeGreaterThan(-1);
  const usek = text.slice(od, od + text.slice(od).indexOf(konec));
  return [...usek.matchAll(/['"]([a-z_]+)['"]/g)].map((m) => m[1]).filter((k) => k !== "use strict");
}

describe("seznam oprávnění je všude stejný", () => {
  const vRozhrani = klice("src/pages/Settings/TeamSettings.tsx", /const CAPABILITY_KEYS = \[/, "] as const");
  const vEdgeFunkci = klice("supabase/functions/team-set-capabilities/index.ts", /ALLOWED_KEYS = \[/, "];");
  const vDatabazi = klice("supabase/migrations/20260909100000_capability_branch_only.sql", /select array\[/, "]::text[]");

  it("rozhraní zná aspoň deset oprávnění", () => {
    expect(vRozhrani.length).toBeGreaterThanOrEqual(10);
  });

  it("edge funkce má stejné klíče jako rozhraní", () => {
    expect([...vEdgeFunkci].sort()).toEqual([...vRozhrani].sort());
  });

  it("databáze má stejné klíče jako rozhraní", () => {
    expect([...vDatabazi].sort()).toEqual([...vRozhrani].sort());
  });
});
