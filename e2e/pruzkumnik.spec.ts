import { test, expect, type Page, type ConsoleMessage } from "@playwright/test";
import { prihlasSe, SERVIS } from "./pomocnici";

/**
 * Průzkumník: robot, který si aplikaci prochází sám.
 *
 * Ostatní testy zkoušejí to, co někdo napsal, tedy cesty, které nás
 * napadly. Tenhle chodí po aplikaci jako netrpělivý člověk u pultu: kliká
 * na tlačítka, cpe do polí nesmysly, mačká Escape a dívá se, jestli něco
 * nespadne. Nehledá správný výsledek – hledá pád: neodchycenou výjimku,
 * odpověď serveru 500 a hlášku o chybě, která se nemá objevit.
 *
 * Běží jen v testovacím servisu a záměrně nesahá na věci, které odejdou
 * ven (SMS, e-mail) nebo na správu servisu. Náhoda má pevné semínko, takže
 * když se něco najde, jde to zopakovat: E2E_SEMINKO=12345.
 */

/** Stránky, po kterých se chodí. */
const STRANKY = ["orders", "calendar", "customers", "invoices", "inventory", "devices", "statistics", "settings"] as const;

/**
 * Čeho se nedotýkat. Odesílání SMS a e-mailů má dopad mimo aplikaci,
 * odhlášení by průzkum ukončilo a mazání servisu nebo účtu je nevratné.
 */
const ZAKAZANO = [
  /sms/i, /e-?mail/i, /odeslat/i, /poslat/i, /pozvat/i, /pozvánk/i,
  /odhlásit/i, /smazat servis/i, /zrušit předplatné/i, /owner/i,
  /exportovat data/i, /gdpr/i, /obnovit z zálohy/i, /import/i,
  /stáhnout/i, /aktualizovat aplikaci/i, /nahlásit chybu/i,
];

/** Nesmysly, které se cpou do polí. */
const NESMYSLY = [
  "",
  "   ",
  "0",
  "-1",
  "999999999999",
  "'; drop table tickets; --",
  "<script>window.__xss=1</script>",
  "ěščřžýáíé ĚŠČŘŽÝÁÍÉ",
  "🙂🙂🙂",
  "x".repeat(500),
];

function nahoda(semínko: number) {
  let s = semínko >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

type Nalez = { kde: string; co: string; detail: string };

test("průzkumník projde aplikaci a nic nespadne", async ({ page }) => {
  test.setTimeout(15 * 60_000);
  const semínko = Number(process.env.E2E_SEMINKO ?? 20260906);
  const dalsi = nahoda(semínko);
  const nalezy: Nalez[] = [];
  let kde = "start";

  page.on("pageerror", (err) => {
    // Neodchycená výjimka znamená, že se kus obrazovky přestal vykreslovat.
    nalezy.push({ kde, co: "neodchycená výjimka", detail: err.message.slice(0, 300) });
  });
  page.on("console", (m: ConsoleMessage) => {
    if (m.type() !== "error") return;
    const t = m.text();
    // Chyby, které nejsou o aplikaci: zablokované zdroje, chybějící favicon.
    if (/favicon|net::ERR_|Failed to load resource/i.test(t)) return;
    nalezy.push({ kde, co: "chyba v konzoli", detail: t.slice(0, 300) });
  });
  page.on("response", (r) => {
    if (r.status() < 500) return;
    nalezy.push({ kde, co: `odpověď ${r.status()}`, detail: r.url().split("?")[0].slice(-120) });
  });

  await prihlasSe(page);
  // Pojistka, aby robot nechodil po cizím servisu.
  const servis = await page.evaluate((k) => localStorage.getItem(k), "jobsheet_active_service_id_v1");
  expect(servis, "Průzkumník smí běžet jen v testovacím servisu.").toBe(SERVIS.id);

  const zakazane = (text: string) => ZAKAZANO.some((r) => r.test(text));

  for (const stranka of STRANKY) {
    kde = stranka;
    await page.evaluate((s) => window.dispatchEvent(new CustomEvent("jobsheet:navigate", { detail: { page: s } })), stranka);
    await page.waitForTimeout(1500);

    for (let kolo = 0; kolo < 12; kolo++) {
      // 1) Do náhodného textového pole vložit nesmysl.
      const pole = page.locator("input:visible:not([type=file]):not([type=checkbox]):not([type=radio]), textarea:visible");
      const poleN = Math.min(await pole.count(), 40);
      if (poleN > 0) {
        const i = Math.floor(dalsi() * poleN);
        const nesmysl = NESMYSLY[Math.floor(dalsi() * NESMYSLY.length)];
        await pole.nth(i).fill(nesmysl, { timeout: 3000 }).catch(() => {});
      }

      // 2) Kliknout na náhodné povolené tlačítko.
      const tlacitka = page.locator("button:visible:not([disabled])");
      const tlacitekN = Math.min(await tlacitka.count(), 60);
      if (tlacitekN > 0) {
        const i = Math.floor(dalsi() * tlacitekN);
        const t = tlacitka.nth(i);
        const popis = ((await t.getAttribute("aria-label")) ?? (await t.innerText().catch(() => "")) ?? "").trim();
        if (!zakazane(popis)) {
          await t.click({ timeout: 3000, trial: false }).catch(() => {});
          await page.waitForTimeout(400);
        }
      }

      // 3) Občas Escape – zavírání oken je časté místo, kde se něco rozbije.
      if (dalsi() < 0.3) {
        await page.keyboard.press("Escape").catch(() => {});
        await page.waitForTimeout(200);
      }
    }

    // Po každé stránce se vrátit na zakázky, ať se robot nezasekne v okně.
    await page.keyboard.press("Escape").catch(() => {});
    await page.waitForTimeout(300);
  }

  // Aplikace musí po celém průzkumu pořád fungovat.
  kde = "závěr";
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("jobsheet:navigate", { detail: { page: "orders" } })));
  await expect(page.getByRole("button", { name: "+ Nová zakázka" })).toBeVisible({ timeout: 30_000 });

  const souhrn = nalezy.map((n) => `• [${n.kde}] ${n.co}: ${n.detail}`).join("\n");
  expect(nalezy, `Průzkumník (semínko ${semínko}) našel:\n${souhrn}`).toEqual([]);
});
