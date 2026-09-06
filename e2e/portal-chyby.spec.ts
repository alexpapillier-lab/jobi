import { test, expect, type Page, type Route } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Zákaznický portál – co se stane, když zápis neprojde.
 *
 * Portál je jediné místo, kde do databáze zapisuje někdo zvenčí, a zákazník
 * ho typicky otevírá na telefonu v mizerném signálu. Testy proto shazují
 * POSTy portálové funkce a hlídají, že se ukáže chyba a že se neztratí to,
 * co už zákazník napsal nebo nakreslil.
 *
 * Nic se nikam neuloží: VŠECHNY požadavky na portal-ticket jsou odchycené,
 * do ostré databáze se nesáhne. GET se odpovídá vymyšleným payloadem, takže
 * test nezávisí na tom, v jakém stavu zrovna je zakázka v testovacím servisu.
 *
 * Stránka se servíruje z `web/z/` na adrese, kterou dostane zákazník
 * (https://appjobi.com/z/?t=…), aby se testoval kód z repozitáře, a ne to,
 * co je zrovna nasazené.
 *
 * Odchytávání je přes REGULÁRNÍ VÝRAZY: glob v `page.route` se rozbije
 * o dotazovací část URL (`?t=…`) a POSTy by proklouzly na ostrý server.
 */

/** Token ukázkového servisu – v testu jde jen o tvar adresy, data jsou vymyšlená. */
const TOKEN = process.env.E2E_PORTAL_TOKEN ?? "Bg6PKHqi-Kb7QiSDnMp5lZiGQZRwriV3";
const ADRESA = `https://appjobi.com/z/?t=${TOKEN}`;

const WEB = path.resolve(fileURLToPath(new URL("../web", import.meta.url)));

const TYPY: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

/**
 * Vytáhne hlavičku z bloku `/z/*` v `web/_headers`.
 * Test tak jede proti tomu, co se opravdu nasadí, a ne proti kopii, která
 * se rozejde při první úpravě.
 */
function hlavickaPortalu(nazev: string): string {
  const text = fs.readFileSync(path.resolve(WEB, "_headers"), "utf-8");
  const radky = text.split("\n");
  let vBloku = false;
  for (const r of radky) {
    if (!r.startsWith(" ") && !r.startsWith("\t")) {
      const cesta = r.trim();
      if (cesta.startsWith("#") || cesta === "") continue;
      vBloku = cesta === "/z/*";
      continue;
    }
    if (!vBloku) continue;
    const i = r.indexOf(":");
    if (i > 0 && r.slice(0, i).trim().toLowerCase() === nazev.toLowerCase()) return r.slice(i + 1).trim();
  }
  throw new Error(`V web/_headers chybí u /z/* hlavička ${nazev}.`);
}

/** Statické soubory portálu servírujeme z repozitáře. */
async function servirujStatiku(page: Page, sHlavickami = false): Promise<void> {
  const csp = sHlavickami ? hlavickaPortalu("Content-Security-Policy") : null;
  await page.route(/^https:\/\/appjobi\.com\//, async (route) => {
    const url = new URL(route.request().url());
    let rel = url.pathname.replace(/^\/+/, "");
    if (rel === "" || rel.endsWith("/")) rel += "index.html";
    const soubor = path.resolve(WEB, rel);
    // Pojistka proti „../“ v cestě – test nemá číst nic mimo web/.
    if (!soubor.startsWith(WEB + path.sep) || !fs.existsSync(soubor)) {
      await route.fulfill({ status: 404, contentType: "text/plain", body: "nenalezeno" });
      return;
    }
    const hlavicky: Record<string, string> = {
      "content-type": TYPY[path.extname(soubor)] ?? "application/octet-stream",
    };
    if (csp && url.pathname.startsWith("/z/")) hlavicky["content-security-policy"] = csp;
    await route.fulfill({ status: 200, headers: hlavicky, body: fs.readFileSync(soubor) });
  });
}

type Zakazka = {
  quoteStatus?: "none" | "sent" | "approved" | "rejected";
  isFinal?: boolean;
  intakeSignedAt?: string | null;
  estimatedPrice?: number | null;
  /** Se `sPlatbou` má payload cenu i QR platbu – potřeba na test CSP. */
  sPlatbou?: boolean;
};

function payload(z: Zakazka = {}) {
  const quoteStatus = z.quoteStatus ?? "sent";
  return {
    ok: true,
    ticket: {
      code: "E2E-9001",
      createdAt: "2026-09-01T08:00:00.000Z",
      expectedCompletionAt: "2026-09-10T10:00:00.000Z",
      deviceLabel: "iPhone 13",
      requestedRepair: "Rozbitý displej",
      status: { isFinal: z.isFinal ?? false },
      photosBefore: [],
      photos: [],
      performedRepairs: z.sPlatbou ? [{ name: "Výměna displeje", price: 3500 }] : [],
      discount: null,
      totalPrice: z.sPlatbou ? 3500 : 0,
      estimatedPrice: z.estimatedPrice === undefined ? 1900 : z.estimatedPrice,
      quote: {
        amount: quoteStatus === "none" ? null : 3500,
        items: quoteStatus === "none" ? [] : [{ name: "Výměna displeje", price: 3500 }],
        note: null,
        status: quoteStatus,
        sentAt: quoteStatus === "none" ? null : "2026-09-02T09:00:00.000Z",
        decidedAt: null,
      },
      intakeSignedAt: z.intakeSignedAt ?? null,
      intakeSignatureUrl: null,
      handoffMethod: "personal",
      handbackMethod: "personal",
    },
    service: {
      name: "E2E testovaci servis",
      branch: null,
      openingHours: null,
      phone: null,
      email: null,
      website: null,
      addressStreet: null,
      addressCity: null,
      addressZip: null,
      bankAccount: z.sPlatbou ? "123456789/0800" : null,
      iban: z.sPlatbou ? "CZ6508000000000123456789" : null,
    },
    payment: z.sPlatbou
      ? { amount: 3500, vs: "9001", spayd: "SPD*1.0*ACC:CZ6508000000000123456789*AM:3500.00*CC:CZK*X-VS:9001" }
      : null,
  };
}

type Selhani = "sit" | "server" | "konflikt";

/**
 * Odchytí portálovou funkci: GET vrací vymyšlený stav, POST vždy selže.
 * Vrací pole odeslaných akcí, ať je vidět, co se pokusilo zapsat.
 */
async function odchytFunkci(page: Page, z: Zakazka, selhani: Selhani): Promise<string[]> {
  const pokusy: string[] = [];
  await page.route(/\/functions\/v1\/portal-ticket/, async (route: Route) => {
    if (route.request().method() !== "POST") {
      await route.fulfill({
        status: 200,
        contentType: "application/json; charset=utf-8",
        body: JSON.stringify(payload(z)),
      });
      return;
    }
    const telo = route.request().postDataJSON() as { action?: string } | null;
    pokusy.push(String(telo?.action ?? ""));
    if (selhani === "sit") {
      // Spadlé spojení – přesně to, co zákazníka potká ve výtahu nebo v metru.
      await route.abort("failed");
      return;
    }
    if (selhani === "konflikt") {
      await route.fulfill({
        status: 409,
        contentType: "application/json; charset=utf-8",
        body: JSON.stringify({ error: "Nabídka už není k rozhodnutí." }),
      });
      return;
    }
    await route.fulfill({
      status: 500,
      contentType: "application/json; charset=utf-8",
      body: JSON.stringify({ error: "Nepodařilo se uložit rozhodnutí." }),
    });
  });
  return pokusy;
}

/** Nakreslí do podpisového pole čáru myší. */
async function podepisSe(page: Page): Promise<void> {
  const pole = page.locator("canvas.sig-pad");
  await expect(pole).toBeVisible();
  // Souřadnice myši jsou vůči viewportu – bez odscrollování by tahy
  // u delší stránky dopadly mimo pole.
  await pole.scrollIntoViewIfNeeded();
  const box = await pole.boundingBox();
  if (!box) throw new Error("Podpisové pole nemá rozměry.");
  await page.mouse.move(box.x + 30, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 90, box.y + box.height / 2 - 20, { steps: 8 });
  await page.mouse.move(box.x + 150, box.y + box.height / 2 + 20, { steps: 8 });
  await page.mouse.up();
}

/** Je v podpisovém poli nakreslený tah? */
async function maInkoust(page: Page): Promise<boolean> {
  return page.locator("canvas.sig-pad").evaluate((c) => {
    const canvas = c as HTMLCanvasElement;
    const ctx = canvas.getContext("2d");
    if (!ctx) return false;
    const d = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 0) return true;
    return false;
  });
}

test.describe("zákaznický portál – chybové cesty", () => {
  test("rozepsaná poznámka k zamítnutí přežije spadlé spojení", async ({ page }) => {
    await servirujStatiku(page);
    const pokusy = await odchytFunkci(page, { quoteStatus: "sent" }, "sit");
    await page.goto(ADRESA);

    await expect(page.getByRole("heading", { name: "Cenová nabídka" })).toBeVisible();
    await page.getByRole("button", { name: "Nesouhlasím" }).click();

    const poznamka = "Oprava je pro mě příliš drahá, zařízení si vyzvednu.";
    const pole = page.locator("#rejectNote");
    await pole.fill(poznamka);
    await page.getByRole("button", { name: "Potvrdit zamítnutí" }).click();

    // Zákazník musí vidět, že se to neuložilo…
    await expect(page.locator("#cardQuote .inline-error")).toHaveText(/Nepodařilo se připojit/);
    // …a hlavně nesmí přijít o to, co napsal.
    await expect(pole).toHaveValue(poznamka);
    expect(pokusy).toEqual(["reject"]);

    // Druhý pokus posílá pořád tu samou poznámku, ne prázdný text.
    await page.getByRole("button", { name: "Potvrdit zamítnutí" }).click();
    await expect(page.locator("#cardQuote .inline-error")).toBeVisible();
    await expect(pole).toHaveValue(poznamka);
    expect(pokusy).toEqual(["reject", "reject"]);
  });

  test("poznámka přežije i chybu serveru a jde poslat znovu", async ({ page }) => {
    await servirujStatiku(page);
    await odchytFunkci(page, { quoteStatus: "sent" }, "server");
    await page.goto(ADRESA);

    await page.getByRole("button", { name: "Nesouhlasím" }).click();
    const pole = page.locator("#rejectNote");
    await pole.fill("Nechám to být.");
    await page.getByRole("button", { name: "Potvrdit zamítnutí" }).click();

    await expect(page.locator("#cardQuote .inline-error")).toHaveText(/Server je dočasně nedostupný/);
    await expect(pole).toHaveValue("Nechám to být.");
    // Tlačítko se musí odblokovat, jinak zákazník uvízne na „Odesílám…“.
    await expect(page.getByRole("button", { name: "Potvrdit zamítnutí" })).toBeEnabled();
  });

  test("nakreslený podpis se při chybě sítě nesmaže", async ({ page }) => {
    await servirujStatiku(page);
    const pokusy = await odchytFunkci(page, { quoteStatus: "none" }, "sit");
    await page.goto(ADRESA);

    await expect(page.getByRole("heading", { name: "Převzetí do opravy" })).toBeVisible();
    await podepisSe(page);
    expect(await maInkoust(page)).toBe(true);

    await page.getByRole("button", { name: "Podepsat" }).click();

    await expect(page.locator("#cardSign .inline-error")).toHaveText(/Nepodařilo se připojit/);
    expect(pokusy).toEqual(["sign"]);
    // Pole se nepřekresluje: podpis zůstává a jde poslat znovu.
    expect(await maInkoust(page)).toBe(true);
    await expect(page.getByRole("button", { name: "Podepsat" })).toBeEnabled();
    await expect(page.getByRole("button", { name: "Vymazat" })).toBeEnabled();
  });

  test("odmítnutí serverem u podpisu nechá podpis v poli", async ({ page }) => {
    await servirujStatiku(page);
    await odchytFunkci(page, { quoteStatus: "none" }, "server");
    await page.goto(ADRESA);

    await podepisSe(page);
    await page.getByRole("button", { name: "Podepsat" }).click();

    await expect(page.locator("#cardSign .inline-error")).toBeVisible();
    expect(await maInkoust(page)).toBe(true);
  });

  test("409 u nabídky ukáže, že rozhodnutí padlo jinde", async ({ page }) => {
    await servirujStatiku(page);
    await odchytFunkci(page, { quoteStatus: "sent" }, "konflikt");
    await page.goto(ADRESA);

    await page.getByRole("button", { name: "Schválit opravu" }).click();
    await page.getByRole("button", { name: "Potvrdit", exact: true }).click();

    await expect(page.getByText("Nabídka už není k rozhodnutí.")).toBeVisible();
  });

  test("odeslaná nabídka schová odhad ceny", async ({ page }) => {
    await servirujStatiku(page);
    await odchytFunkci(page, { quoteStatus: "sent", estimatedPrice: 1900 }, "sit");
    await page.goto(ADRESA);

    await expect(page.getByRole("heading", { name: "Cenová nabídka" })).toBeVisible();
    // Dvě různé částky vedle sebe zákazníka matou – platí ta z nabídky.
    await expect(page.getByText("Odhad ceny")).toHaveCount(0);
    await expect(page.locator("#cardQuote").getByText(/3\s*500/).first()).toBeVisible();
  });

  test("bez nabídky se odhad ceny pořád ukazuje", async ({ page }) => {
    await servirujStatiku(page);
    await odchytFunkci(page, { quoteStatus: "none", estimatedPrice: 1900 }, "sit");
    await page.goto(ADRESA);

    await expect(page.getByText("Odhad ceny").first()).toBeVisible();
    await expect(page.locator("#cardStatus").getByText(/1\s*900/).first()).toBeVisible();
  });

  test("uzavřená zakázka neukazuje nepodepsané převzetí", async ({ page }) => {
    await servirujStatiku(page);
    await odchytFunkci(page, { quoteStatus: "approved", isFinal: true, intakeSignedAt: null }, "sit");
    await page.goto(ADRESA);

    await expect(page.getByRole("heading", { name: "Cenová nabídka" })).toBeVisible();
    await expect(page.getByText("Převzetí do opravy")).toHaveCount(0);
    await expect(page.locator("canvas.sig-pad")).toHaveCount(0);
  });

  test("portál běží pod ostrým CSP z web/_headers", async ({ page }) => {
    // Kdyby se do portálu vrátil inline skript nebo knihovna z cizí CDN,
    // CSP je zablokuje a stránka se rozbije až zákazníkovi. Test proto
    // bere hlavičku přímo z web/_headers a čte, co prohlížeč zahlásí.
    const stiznosti: string[] = [];
    page.on("console", (m) => {
      if (/Content Security Policy|Refused to/i.test(m.text())) stiznosti.push(m.text());
    });
    page.on("pageerror", (e) => stiznosti.push(String(e)));

    await servirujStatiku(page, true);
    await odchytFunkci(page, { quoteStatus: "sent", sPlatbou: true }, "sit");
    await page.goto(ADRESA);

    await expect(page.getByRole("heading", { name: "Cenová nabídka" })).toBeVisible();
    // QR kód se kreslí lokální knihovnou do <img src="data:…"> – když by CSP
    // shodilo skript nebo data: obrázky, tady to praskne.
    await expect(page.locator("#cardPrice .qr-wrap img")).toBeVisible();
    // A stránka pořád umí to hlavní: nakreslit podpis.
    await podepisSe(page);
    expect(await maInkoust(page)).toBe(true);

    expect(stiznosti).toEqual([]);
  });

  test("web/_headers zakazuje vložení portálu do rámu", () => {
    expect(hlavickaPortalu("X-Frame-Options")).toBe("DENY");
    expect(hlavickaPortalu("Content-Security-Policy")).toContain("frame-ancestors 'none'");
  });

  test("portál se obejde bez cizí CDN", async ({ page }) => {
    // Cokoli mimo appjobi.com a portálovou funkci je chyba: na stránce
    // s podpisem a tokenem v adrese nemá cizí skript co dělat.
    // Pořadí je podstatné – Playwright zkouší naposled přidané pravidlo
    // první, takže tenhle „chytač zbytku“ musí být registrovaný nejdřív.
    const cizi: string[] = [];
    await page.route(/^https?:\/\//, async (route) => {
      cizi.push(route.request().url());
      await route.abort("failed");
    });
    await servirujStatiku(page);
    await odchytFunkci(page, { quoteStatus: "sent" }, "sit");
    await page.goto(ADRESA);

    await expect(page.getByRole("heading", { name: "Cenová nabídka" })).toBeVisible();
    expect(cizi).toEqual([]);
  });
});

/**
 * Čtení ze skutečné edge funkce – zapnout jen s `E2E_PORTAL_TOKEN`.
 * Zápisy zůstávají odchycené, takže se ani tady nic neuloží.
 */
test("skutečný token načte zakázku (jen pro čtení)", async ({ page }) => {
  test.skip(!process.env.E2E_PORTAL_TOKEN, "Bez E2E_PORTAL_TOKEN se proti ostré funkci nečte.");
  await servirujStatiku(page);
  await page.route(/\/functions\/v1\/portal-ticket/, async (route) => {
    if (route.request().method() === "POST") {
      // Pojistka: z testu nesmí odejít žádný zápis.
      await route.abort("failed");
      return;
    }
    await route.fallback();
  });
  await page.goto(ADRESA);
  await expect(page.getByText(/^Zakázka/).first()).toBeVisible({ timeout: 45_000 });
});
