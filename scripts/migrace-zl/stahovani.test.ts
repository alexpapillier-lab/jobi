import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Browser } from "playwright";
import { jeDetail, urlStrany, vytahniDetail, vytahniSeznam, SEZNAM_ZAKAZEK } from "./stahovani";

/**
 * Extrakce ze stránek ZL v opravdovém prohlížeči nad umělými stránkami
 * (fixtures/*.html, postavené podle selektorů bota). Pouští Chromium, proto
 * jen na vyžádání:
 *   MIGRACE_ZL_PROHLIZEC=1 npx vitest run scripts/migrace-zl
 */
const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
const html = (f: string) => fs.readFileSync(path.join(DIR, f), "utf8");

it("adresa strany seznamu nese stránkování i 50 řádků na stranu", () => {
  expect(urlStrany(SEZNAM_ZAKAZEK, 3)).toBe("https://app.zakazkovylist.cz/orders/?ordersDatagrid-datagrid-page=3&ordersDatagrid-datagrid-perPage=50&complaintsDatagrid-datagrid-perPage=50");
});

describe.skipIf(!process.env.MIGRACE_ZL_PROHLIZEC)("migrace-zl – extrakce v prohlížeči", () => {
  let browser: Browser;
  beforeAll(async () => {
    const { chromium } = await import("playwright");
    browser = await chromium.launch();
  }, 60000);
  afterAll(async () => {
    await browser?.close();
  });

  it("detail zakázky: údaje bez PINu, položky, komentáře, historie, odkazy", async () => {
    const page = await browser.newPage();
    await page.setContent(html("detail-zakazky.html"));
    const d = await page.evaluate(vytahniDetail, "order");
    expect(jeDetail(d)).toBe(true);
    expect(d.kv).toMatchObject({
      "Zařízení": "iPhone 13",
      "Heslo zařízení / Kód obrazovky": "1234",
      "Požadovaná oprava": "Výměna displeje",
      "Předpokládaná cena": "3 500,00 Kč Cena zakázky je vyšší než předpokládaná cena.",
      "Jméno a příjmení": "Jana Testová",
      "Zákazník": "Jana Testová Skrýt jméno",
    });
    expect(d.kv.PIN).toBeUndefined();
    expect(d.repairTables).toEqual([
      { header: "Položka opravy Náklady Cena Akce", rows: [["Výměna displeje (originální)", "2 100,00 Kč", "3 990,00 Kč", "Smazat"], ["Celkem", "2 100,00 Kč", "3 990,00 Kč"]] },
    ]);
    expect(d.comments).toEqual([{ author: "Technik B", createdAt: "04.01.2024 11:00", content: "Objednán displej, zákazník souhlasí." }]);
    expect(d.statusHistory).toEqual([
      { status: "Přijato", user: "Technik A", at: "03.01.2024 09:16" },
      { status: "Vydáno - Zakázka dokončena", user: "Technik A", at: "06.01.2024 10:30" },
    ]);
    expect([d.customerCode, d.customerName, d.deviceCode, d.sourceOrderCode]).toEqual(["TSTC2400001", "Jana Testová", "TSTD2400001", null]);
    await page.close();
  });

  it("seznam: kódy z tabulky i mimo ni, stav z tlačítka / selectu / štítku, počet stran", async () => {
    const page = await browser.newPage();
    await page.setContent(html("seznam-zakazek.html"));
    const s = await page.evaluate(vytahniSeznam, "/order/detail/");
    expect(s.stran).toBe(72);
    expect(s.radky).toEqual([
      { kod: "TSTZ2400001", stav: "Vydáno" },
      { kod: "TSTZ2400002", stav: "Čeká na díl" },
      { kod: "TSTZ2400003", stav: "Připraveno k převzetí" },
      { kod: "TSTZ2400009", stav: "" },
    ]);
    await page.close();
  });
});
