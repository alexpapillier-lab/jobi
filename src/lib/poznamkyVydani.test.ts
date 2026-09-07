import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
// Skript je .mjs, protože ho volá bash při vydání; vitest ho naimportovat umí,
// takže se testuje ta samá funkce, jaká poznámky opravdu skládá.
import { poznamkyZTitulku, sestavPoznamky, titulkyCommitu, VYCHOZI_MAX } from "../../scripts/poznamky-vydani.mjs";

const KOREN = join(dirname(fileURLToPath(import.meta.url)), "../..");

/**
 * Okno „Co je nového“ v aplikaci ukazovalo anglickou větu „See GitHub Releases
 * for details.“, protože `latest.json` mělo poznámky napevno. Tyhle testy
 * hlídají náhradu: poznámky se skládají z titulků commitů, které jsou v tomhle
 * repozitáři psané česky a pro člověka.
 */
describe("poznámky k vydání z commitů", () => {
  it("z titulků udělá odrážky v pořadí od nejnovějšího", () => {
    const text = sestavPoznamky(["Sklad hlásí zásobu správně", "Faktura tiskne QR"]);
    expect(text).toBe("- Sklad hlásí zásobu správně\n- Faktura tiskne QR");
  });

  it("zahodí commity, které uživateli nic neřeknou", () => {
    const out = poznamkyZTitulku([
      "Merge branch 'main'",
      "CI: rychlejší běh testů",
      "chore: bump závislostí",
      "Úklid po testech",
      "Testy na sklad",
      "Revert \"Něco\"",
      "Sklad hlásí zásobu správně",
    ]);
    expect(out).toEqual(["Sklad hlásí zásobu správně"]);
  });

  it("„test“ uvnitř věty není důvod odrážku zahodit", () => {
    // Past: filtr na začátek řádku, ne kdekoli – jinak by zmizelo vydání,
    // které přineslo právě testovací režim.
    expect(poznamkyZTitulku(["Testovací režim plateb jde zapnout v Nastavení"]))
      .toEqual(["Testovací režim plateb jde zapnout v Nastavení"]);
  });

  it("stejnou věc nevypíše dvakrát", () => {
    expect(poznamkyZTitulku(["Sklad počítá správně", "sklad počítá správně."])).toHaveLength(1);
  });

  it("uřízne odkazy na čísla úkolů a commitů", () => {
    expect(poznamkyZTitulku(["Portál drží podpis (#412)", "Tisk sedí [a1b2c3d]"]))
      .toEqual(["Portál drží podpis", "Tisk sedí"]);
  });

  it("víc než dvanáct odrážek nikdo nečte", () => {
    const hodne = Array.from({ length: 30 }, (_, i) => `Změna číslo ${i}`);
    expect(poznamkyZTitulku(hodne)).toHaveLength(VYCHOZI_MAX);
    expect(poznamkyZTitulku(hodne, 3)).toHaveLength(3);
  });

  it("prázdný rozsah nevrátí prázdné odrážky", () => {
    // Prázdný text by v aplikaci udělal prázdný rámeček „Co je nového“.
    expect(sestavPoznamky([])).toBe("");
    expect(sestavPoznamky(["chore: nic"])).toBe("");
  });

  it("rozsah bez commitů nespadne", () => {
    const spust = () => { throw new Error("fatal: bad revision"); };
    expect(titulkyCommitu("neexistujici-znacka", "HEAD", spust)).toEqual([]);
  });

  it("skutečná historie repozitáře dá čitelné odrážky", () => {
    const titulky = execSync("git log --no-merges --pretty=%s -25", { cwd: KOREN, encoding: "utf8" })
      .split("\n").filter(Boolean);
    const out = poznamkyZTitulku(titulky);
    expect(out.length).toBeGreaterThan(0);
    for (const r of out) {
      expect(r.length).toBeGreaterThan(10);
      expect(r).not.toMatch(/^[a-f0-9]{7,}$/);
    }
  });
});

describe("generátor latest.json", () => {
  it("nemá poznámky napevno", () => {
    const zdroj = readFileSync(join(KOREN, "scripts/generate-jobi-latest-json.sh"), "utf8");
    expect(zdroj, "poznámky se zase nastavují napevno").not.toMatch(/notes:\s*"See GitHub Releases/);
    expect(zdroj, "generátor nevolá skript na poznámky").toMatch(/poznamky-vydani\.mjs/);
  });
});
