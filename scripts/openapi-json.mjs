/**
 * Převod docs/api/openapi.yaml na modul, který servíruje edge funkce.
 *
 * Zdrojem pravdy zůstává YAML – v Denu ale není parser, který bychom tam
 * chtěli tahat kvůli jednomu souboru, takže se převádí předem.
 *
 * Spouští se přes `npm run api:spec`.
 */
import { readFileSync, writeFileSync } from "node:fs";
import yaml from "js-yaml";

const ZDROJ = "docs/api/openapi.yaml";
const CIL = "supabase/functions/public-docs/openapi.ts";

const popis = yaml.load(readFileSync(ZDROJ, "utf8"));

if (!popis?.openapi || !popis?.paths) {
  console.error("✗ %s nevypadá jako platný OpenAPI popis", ZDROJ);
  process.exit(1);
}

writeFileSync(
  CIL,
  `// GENEROVÁNO – needituj. Zdroj: ${ZDROJ}\n` +
    `// Přegeneruj přes: npm run api:spec\n` +
    `export const POPIS = ${JSON.stringify(popis, null, 2)} as const;\n`,
);

const cest = Object.keys(popis.paths).length;
console.log(`✓ ${CIL} — ${cest} cest, verze ${popis.info.version}`);
