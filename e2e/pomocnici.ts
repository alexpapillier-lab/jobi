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
  /** Id servisu v databázi – účet je i v ukázkovém servisu pro snímky na web, aktivní musí být tenhle. */
  id: "882beee7-4564-4d10-8ac6-16dc19240b57",
  /** Zkratka servisu – čísla zakázek začínají tímhle. */
  zkratka: "E2E",
};

/**
 * Druhý účet ve stejném servisu: technik s omezenými právy. Slouží k testům
 * souběžné práce – aby bylo vidět, že se změny mezi lidmi propisují a že
 * práva platí i v rozhraní, ne jen v databázi.
 */
export const TECHNIK = {
  email: "e2e-technik@jobi.test",
  prezdivka: "E2E technik",
};

/** Heslo chodí z prostředí; bez něj se testy přeskočí (viz global setup). */
export function heslo(kdo: "owner" | "technik" = "owner"): string {
  const h = kdo === "technik" ? process.env.E2E_PASSWORD_TECHNIK : process.env.E2E_PASSWORD;
  if (!h) throw new Error(kdo === "technik" ? "Chybí E2E_PASSWORD_TECHNIK." : "Chybí E2E_PASSWORD.");
  return h;
}

export async function prihlasSe(page: Page, kdo: "owner" | "technik" = "owner"): Promise<void> {
  // Účet e2e@jobi.test je i v ukázkovém servisu „Servis Novák“; bez téhle
  // volby aplikace vezme první servis ze seznamu a test skončí v cizích datech.
  await page.addInitScript(
    ([klic, id]) => { if (!localStorage.getItem(klic)) localStorage.setItem(klic, id); },
    ["jobsheet_active_service_id_v1", SERVIS.id],
  );
  await page.goto("/");
  const email = page.locator('input[type="email"]').first();
  await expect(email).toBeVisible();
  await email.fill(kdo === "technik" ? TECHNIK.email : SERVIS.email);
  await page.locator('input[type="password"]').first().fill(heslo(kdo));
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

/**
 * Řádek zakázky v seznamu.
 *
 * Hledá se podle čísla zakázky a jde se na nejbližšího předka, který má
 * tlačítka – tedy na celý řádek i se stavem. Filtrovat `div` podle textu
 * nestačí: podle toho, co se do řádku vejde, vrátí buď celý řádek, nebo
 * jen odstavec se jménem, a test pak hledá tlačítko tam, kde není.
 */
/**
 * Viditelný výskyt čísla zakázky.
 *
 * Číslo se v seznamu vykresluje ve dvou rozvrženích (široké a úzké) a další
 * kopie drží schované stránky, které zůstávají připojené. `getByText` proto
 * pravidelně padá na „resolved to 2 elements“. Tenhle pomocník bere jen to,
 * co je opravdu vidět.
 */
export function vidZakazku(page: Page, kod: string) {
  return page.locator(`:text-is("${kod}"):visible`);
}

export function radekZakazky(page: Page, kod: string) {
  return vidZakazku(page, kod).first().locator("xpath=ancestor::*[.//button][1]");
}

/** Náhodné české mobilní číslo, ať se zákazníci mezi testy nepotkávají. */
export function nahodnyTelefon(): string {
  const zbytek = String(Math.floor(Math.random() * 1_000_000)).padStart(6, "0");
  return `+420777${zbytek}`;
}

/**
 * Založí zakázku a vrátí její číslo.
 *
 * Aplikace po vytvoření sama otevře detail nové zakázky. Číslo se proto čte
 * z hlavičky detailu a ten se pak zavře, ať test pokračuje nad seznamem.
 * S `nechatOtevrene` detail zůstane – to se hodí testům, které rovnou pracují
 * s nabídkou nebo fakturou.
 */
export async function zalozZakazku(
  page: Page,
  udaje: {
    zakaznik: string;
    zarizeni: string;
    popis?: string;
    telefon?: string;
    seriove?: string;
    nechatOtevrene?: boolean;
    /** Zkratka servisu, kterou má číslo začínat. Bez ní se čeká zkratka testovacího servisu. */
    zkratka?: string;
  },
): Promise<string> {
  await page.getByRole("button", { name: "+ Nová zakázka" }).click();
  await page.getByPlaceholder("Jan Novák").fill(udaje.zakaznik);
  // Pokaždé jiné číslo. Se stejným telefonem aplikace správně nabídne, že
  // zákazník už existuje, a formulář se chová jinak, než test čeká.
  await page.getByPlaceholder("+420 777 123 456").fill(udaje.telefon ?? nahodnyTelefon());
  await page.getByPlaceholder("Název nebo typ zařízení…").first().fill(udaje.zarizeni);
  if (udaje.seriove) await page.getByPlaceholder("35-123456-789012-3").first().fill(udaje.seriove);
  // Vyplnění dalšího pole zavře napovídač zařízení, který jinak leží přes
  // tlačítko Vytvořit zakázku. Escape by zavřel celé okno.
  await page
    .getByPlaceholder("Výměna displeje, výměna baterie, diagnostika")
    .first()
    .fill(udaje.popis ?? "Zakázka z automatického testu");

  // Aplikace se po zadání telefonu zeptá, jestli zákazníka založit do adresáře.
  const bezPrirazeni = page.getByRole("button", { name: /Ne, pokračovat bez přiřazení/ });
  if (await bezPrirazeni.isVisible().catch(() => false)) {
    await bezPrirazeni.click();
  }

  await page.getByRole("button", { name: "Vytvořit zakázku" }).click();

  // Číslo se čte z hlavičky otevřeného detailu, ne ze seznamu za ním: v
  // seznamu je čísel spousta a první z nich patří jiné zakázce.
  const podnadpis = page.getByText(new RegExp(`^${udaje.zakaznik} · `)).first();
  await expect(podnadpis).toBeVisible({ timeout: 30_000 });
  const hlavicka = podnadpis.locator("xpath=..");
  // Číslo se v hlavičce objeví o chvíli později než jméno (zakázka se
  // nejdřív ukáže, pak dojede z databáze) – počkat, ne číst hned.
  const zkratka = udaje.zkratka ?? SERVIS.zkratka;
  await expect(hlavicka).toContainText(new RegExp(`${zkratka}\\d{6,}`), { timeout: 15_000 });
  const kod = ((await hlavicka.innerText()).match(new RegExp(`${zkratka}\\d{6,}`)) ?? [])[0];
  if (!kod) throw new Error("Zakázka se založila, ale v hlavičce detailu není číslo.");

  if (!udaje.nechatOtevrene) await zavriDetail(page);
  return kod;
}

/**
 * Zavře detail zakázky a počká, až zmizí ztmavení přes celou obrazovku.
 * Bez toho další klik dopadne na kulisu a test se zasekne na minutu.
 */
export async function zavriDetail(page: Page): Promise<void> {
  // Křížků „Zavřít" je na stránce víc; ten z okna Nová zakázka zůstává v DOM
  // schovaný za detailem a klik na něj by se zasekl.
  const zavrit = page.locator('button[aria-label="Zavřít"]:not([title*="rozpracované"])').last();
  if (await zavrit.isVisible().catch(() => false)) await zavrit.click();
  else await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "+ Nová zakázka" })).toBeVisible({ timeout: 20_000 });
  await expect
    .poll(
      () =>
        page.evaluate(() =>
          [...document.querySelectorAll("div")].some((e) => {
            const cs = getComputedStyle(e);
            return (
              cs.position === "fixed" &&
              cs.inset === "0px" &&
              cs.pointerEvents !== "none" &&
              Number(cs.opacity) > 0.05 &&
              cs.backgroundColor.startsWith("rgba(0, 0, 0")
            );
          }),
        ),
      { timeout: 15_000, message: "Ztmavení přes obrazovku nezmizelo." },
    )
    .toBe(false);
}

/**
 * Počká, až z localStorage zmizí rozdělaný stav dané oblasti – tedy až ho
 * potvrdí databáze.
 *
 * Sklad i ceník se ukládají s odkladem a klíč je na servis
 * (`jobi_sklad_neulozeno_v1:<id servisu>`), takže se hledá podle předpony.
 * Bez téhle kontroly by test prošel i nad hodnotou, která je jen na
 * obrazovce – a hledáním přesného klíče by prošel dokonce vždycky.
 */
export async function pockejNaZapisSnimku(page: Page, predpona: string): Promise<void> {
  await expect
    .poll(
      () => page.evaluate((p) => Object.keys(localStorage).filter((k) => k.startsWith(p)).length, predpona),
      { timeout: 60_000, message: `Rozdělaný stav (${predpona}) nezmizel – změna se nedostala do databáze.` },
    )
    .toBe(0);
}
