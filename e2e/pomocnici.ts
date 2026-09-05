import { expect, type Page } from "@playwright/test";

/**
 * Sdílené kroky pro E2E testy.
 *
 * Testy jezdí proti ostrému Supabase ve vlastním servisu, takže se chovají
 * jako skutečný uživatel – žádné obcházení přihlášení injektováním tokenu.
 * Když se rozbije přihlašovací obrazovka, testy to mají poznat.
 */
export const SERVIS = {
  email: "e2e@jobi.test",
  nazev: "E2E testovaci servis",
  /** Zkratka servisu – čísla zakázek začínají tímhle. */
  zkratka: "E2E",
};

/** Heslo chodí z prostředí; bez něj se testy přeskočí (viz global setup). */
export function heslo(): string {
  const h = process.env.E2E_PASSWORD;
  if (!h) throw new Error("Chybí E2E_PASSWORD.");
  return h;
}

export async function prihlasSe(page: Page): Promise<void> {
  await page.goto("/");
  const email = page.locator('input[type="email"]').first();
  await expect(email).toBeVisible();
  await email.fill(SERVIS.email);
  await page.locator('input[type="password"]').first().fill(heslo());
  await page.getByRole("button", { name: "Přihlásit se" }).click();
  // Tlačítko „+ Nová zakázka" je první věc, která existuje jen po přihlášení
  // a jen na seznamu zakázek; nadpis Zakázky je i v postranní navigaci.
  await expect(page.getByRole("button", { name: "+ Nová zakázka" })).toBeVisible({ timeout: 45_000 });
  // Zakázku nejde založit dřív, než se načtou statusy servisu – aplikace to
  // uživateli řekne hláškou, ale test by na ni zbytečně narážel.
  await page.waitForLoadState("networkidle").catch(() => {});
}

/** Unikátní jméno, ať se dá zakázka po testu poznat a najít. */
export function testovaciJmeno(predpona: string): string {
  return `${predpona} ${Date.now().toString(36)}`;
}
