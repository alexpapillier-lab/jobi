/**
 * Velikosti funkcí a komponent na úrovni modulu.
 *
 * Používá parser TypeScriptu, ne regulární výrazy. Ruční měření se v tomhle
 * projektu dvakrát spletlo: jednou přiřadilo velikost sousednímu jménu
 * (`SidebarNav` místo `App`), podruhé počítáním složených závorek skončilo
 * uprostřed JSX. Parser dává přesné hranice uzlů, takže tyhle chyby nehrozí.
 *
 * Použití:
 *   node scripts/velikosti.mjs src/pages/Orders.tsx [další soubory…]
 *   npm run velikosti
 */
import ts from "typescript";
import fs from "fs";

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error("Použití: node scripts/velikosti.mjs <soubor.tsx> […]");
  process.exit(1);
}

for (const file of files) {
  const text = fs.readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const out = [];

  const visit = (node, depth) => {
    let name = null;
    if (ts.isFunctionDeclaration(node) && node.name) {
      name = node.name.text;
    } else if (ts.isVariableStatement(node)) {
      const d = node.declarationList.declarations[0];
      if (d?.initializer && (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer))) {
        name = d.name.getText(sf);
      }
    }
    if (name && depth === 0) {
      const start = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
      const end = sf.getLineAndCharacterOfPosition(node.getEnd()).line + 1;
      out.push({ name, lines: end - start + 1, start });
    }
    node.forEachChild((c) => visit(c, depth + (ts.isSourceFile(node) ? 0 : 1)));
  };
  sf.forEachChild((n) => visit(n, 0));

  out.sort((a, b) => b.lines - a.lines);
  const total = text.split("\n").length;
  const soucet = out.reduce((a, b) => a + b.lines, 0);
  const podil = total ? Math.round((out[0]?.lines ?? 0) / total * 100) : 0;

  console.log(`\n${file}  —  ${total} řádků`);
  for (const o of out.slice(0, 8)) {
    console.log(`   ${o.name.padEnd(28)} ${String(o.lines).padStart(5)} ř.  (ř.${o.start})`);
  }
  console.log(`   [funkcí na úrovni modulu: ${out.length}, jejich součet: ${soucet} ř., největší = ${podil} % souboru]`);
}
