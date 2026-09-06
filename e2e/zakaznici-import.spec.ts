import { test, expect } from "@playwright/test";
import { prihlasSe, nahodnyTelefon, testovaciJmeno } from "./pomocnici";

/**
 * Import zákazníků z CSV: přechod z jiného systému. Sloupce se poznají
 * podle hlavičky, zákazník s telefonem, který servis už má, se přeskočí.
 */
test("CSV se zákazníky se naimportuje a duplicitní telefon se přeskočí", async ({ page }) => {
  await prihlasSe(page);
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("jobsheet:navigate", { detail: { page: "customers" } })));
  await page.getByRole("button", { name: "Import z CSV" }).click();

  const jmeno = testovaciJmeno("Import");
  const telefon = nahodnyTelefon();
  const csv = [
    "Zákazník;Mobil;E-mail;Firma;IČO;Ulice;Město;PSČ;Poznámka",
    `${jmeno};${telefon};import@example.com;;;Dlouhá 1;Brno;602 00;z importu`,
    `${jmeno} dvojník;${telefon.replace("+420", "00420")};;;;;;;stejný telefon jinak zapsaný`,
    `Firma s.r.o. (${jmeno});;;Firma s.r.o.;12345678;;;;bez telefonu`,
    ";;;;;;;;",
  ].join("\r\n");
  await page.getByLabel("Soubor CSV").setInputFiles({ name: "zakaznici.csv", mimeType: "text/csv", buffer: Buffer.from("\uFEFF" + csv, "utf8") });

  const dialog = page.getByRole("dialog", { name: "Import zákazníků z CSV" });
  // Prázdný řádek parser zahodí už při čtení.
  await expect(dialog).toContainText("3 řádků");
  // Sloupce se poznaly podle hlavičky.
  await expect(dialog.getByLabel("Význam sloupce Zákazník")).toHaveValue("name");
  await expect(dialog.getByLabel("Význam sloupce Mobil")).toHaveValue("phone");
  await expect(dialog.getByLabel("Význam sloupce PSČ")).toHaveValue("address_zip");
  // 1 nový, 1 duplicitní telefon v souboru, 1 bez telefonu.
  await expect(dialog).toContainText("1 nových");
  await expect(dialog).toContainText("1 už máte");
  await expect(dialog).toContainText("1 bez telefonu");

  await dialog.getByRole("button", { name: /Importovat 2 zákazníků/ }).click();
  await expect(dialog).toContainText("Založeno 2 zákazníků", { timeout: 30_000 });
  // V dialogu jsou dvě „Zavřít“ (v hlavičce a u výsledku).
  await dialog.getByRole("button", { name: "Zavřít" }).last().click();

  await expect(page.getByText(jmeno, { exact: true }).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(`Firma s.r.o. (${jmeno})`).first()).toBeVisible();
});
