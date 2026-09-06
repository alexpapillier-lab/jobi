import { test, expect, type Page } from "@playwright/test";
import { prihlasSe, testovaciJmeno, nahodnyTelefon, vidZakazku } from "./pomocnici";

/**
 * Termín dokončení: co se slíbí zákazníkovi na příjmu, musí být vidět
 * v kalendáři a hlavně to musí přežít zavření aplikace. Termín je slib,
 * který servis dává na papíře i v SMS.
 */
test.describe.configure({ mode: "serial" });

const zakaznik = testovaciJmeno("Termín");
/** Termín na pozítří – v dohledu agendy a nikdy nespadne na dnešek. */
const termin = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
let kod = "";

async function naKalendar(page: Page) {
  const agenda = page.locator("[data-agenda-group-toggle]").first();
  await expect
    .poll(async () => {
      await page.evaluate(() => window.dispatchEvent(new CustomEvent("jobsheet:navigate", { detail: { page: "calendar" } })));
      return agenda.isVisible().catch(() => false);
    }, { timeout: 45_000, message: "Kalendář se neotevřel." })
    .toBe(true);
}

test("zakázka založená s termínem je v kalendáři pod tím dnem", async ({ page }) => {
  test.setTimeout(150_000);
  await prihlasSe(page);

  await page.getByRole("button", { name: "+ Nová zakázka" }).click();
  await page.getByPlaceholder("Jan Novák").fill(zakaznik);
  await page.getByPlaceholder("+420 777 123 456").fill(nahodnyTelefon());
  await page.getByPlaceholder("Název nebo typ zařízení…").first().fill("Notebook (termín)");
  await page.getByPlaceholder("Výměna displeje, výměna baterie, diagnostika").first().fill("Slíbený termín");

  // Kalendář v příjmu: pokud termín padne do dalšího měsíce, přepnout dopředu.
  await page.getByRole("button", { name: "Vyberte datum" }).click();
  const kalendar = page.locator("[data-dt-cal]").first();
  await expect(kalendar).toBeVisible({ timeout: 10_000 });
  if (termin.getMonth() !== new Date().getMonth()) await kalendar.getByRole("button", { name: "›" }).click();
  await kalendar.getByRole("button", { name: String(termin.getDate()), exact: true }).click();

  await page.getByRole("button", { name: "Vytvořit zakázku" }).click();
  const podnadpis = page.getByText(new RegExp(`^${zakaznik} · `)).first();
  await expect(podnadpis).toBeVisible({ timeout: 30_000 });
  const hlavicka = podnadpis.locator("xpath=..");
  await expect(hlavicka).toContainText(/E2E\d{6,}/, { timeout: 15_000 });
  kod = ((await hlavicka.innerText()).match(/E2E\d{6,}/) ?? [])[0] ?? "";
  expect(kod).toMatch(/^E2E\d{6,}$/);
  await page.keyboard.press("Escape");

  await naKalendar(page);
  // Zakázka s termínem nepatří do skupiny „Bez termínu“, ale pod svůj den.
  const radek = vidZakazku(page, kod).first();
  await expect(radek).toBeVisible({ timeout: 30_000 });
  const skupina = radek.locator("xpath=ancestor::section[1]");
  await expect(skupina).not.toHaveAttribute("aria-label", /Bez termínu/);
});

test("termín drží i po přenačtení aplikace", async ({ page }) => {
  test.setTimeout(150_000);
  await prihlasSe(page);
  await naKalendar(page);
  const radek = vidZakazku(page, kod).first();
  await expect(radek).toBeVisible({ timeout: 30_000 });
  const skupina = radek.locator("xpath=ancestor::section[1]");
  const den = await skupina.getAttribute("aria-label");
  expect(den ?? "").not.toMatch(/Bez termínu/);

  await page.reload();
  await expect(page.getByRole("button", { name: "+ Nová zakázka" })).toBeVisible({ timeout: 45_000 });
  await naKalendar(page);
  const znovu = vidZakazku(page, kod).first();
  await expect(znovu).toBeVisible({ timeout: 30_000 });
  await expect(znovu.locator("xpath=ancestor::section[1]")).toHaveAttribute("aria-label", den ?? "");
});
