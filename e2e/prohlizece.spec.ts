import { test, expect, devices, type Page } from "@playwright/test";
import { prihlasSe, testovaciJmeno, zalozZakazku, zavriDetail, vidZakazku } from "./pomocnici";

/**
 * Hlavní cesty v Safari (WebKit) a Firefoxu.
 *
 * Zbytek testů jezdí jen v Chromiu, jenže servisy aplikaci otevírají i jinde
 * a zákazník portál nejčastěji v mobilním Safari, kde jinou možnost nemá.
 * Tahle sada je proto schválně krátká: jen to, bez čeho se nedá pracovat –
 * přihlásit se, najít a založit zakázku, vystavit fakturu, vytisknout doklad
 * a otevřít portál.
 *
 * Spouští se vlastním configem (`playwright.prohlizece.config.ts`), aby
 * hlavní sada v CI zůstala jednoprohlížečová.
 */
test.describe.configure({ mode: "serial" });

const PORTAL_URL = `http://127.0.0.1:${process.env.E2E_PORT_PORTAL ?? 5762}/z/`;

/**
 * Vyhodí chybu, když stránka spadne na neodchycené výjimce.
 *
 * V Chromiu projde spousta kódu, který Safari nebo Firefox odmítne (jiná
 * podpora API, přísnější parser). Bez tohohle by se to schovalo za obecné
 * „prvek se neobjevil" a hledalo by se to hodiny.
 */
function hlidejChyby(page: Page): string[] {
  const chyby: string[] = [];
  page.on("pageerror", (e) => chyby.push(String(e)));
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const t = m.text();
    // Chyby sítě a 4xx z API sem nepatří – ty testy poznají jinak.
    if (/Failed to load resource|net::ERR_|NS_ERROR_|status of 4\d\d|status of 5\d\d/.test(t)) return;
    // Firefox hlásí, že odmítl cookie `__cf_bm`, kterou Cloudflare posílá
    // s odpovědí Supabase na doméně supabase.co. Není to naše cookie ani
    // ji k ničemu nepotřebujeme a nemáme jak ji ovlivnit.
    if (/__cf_bm/.test(t)) return;
    chyby.push(t);
  });
  return chyby;
}

const zakaznik = testovaciJmeno("Prohlížeče");
/** Číslo zakázky se předává mezi testy – sada běží sériově. */
let kod = "";
/** Token zákaznického portálu z odkazu, který aplikace vygeneruje. */
let portalToken = "";

test("přihlášení a seznam zakázek", async ({ page }) => {
  const chyby = hlidejChyby(page);
  await prihlasSe(page);

  // Seznam se opravdu naplnil – prázdná obrazovka po přihlášení je ta
  // nejčastější podoba „aplikace v Safari nejde".
  await expect(page.getByRole("button", { name: "+ Nová zakázka" })).toBeVisible();
  await expect(vidZakazku(page, "E2E").first().or(page.getByText(/E2E\d{6,}/).first())).toBeVisible({ timeout: 30_000 });

  expect(chyby, `Neodchycené chyby ve stránce: ${chyby.join(" | ")}`).toEqual([]);
});

test("zakázka jde založit a znovu otevřít ze seznamu", async ({ page }) => {
  const chyby = hlidejChyby(page);
  await prihlasSe(page);

  kod = await zalozZakazku(page, { zakaznik, zarizeni: "iPhone (prohlížeče)", popis: "Rozbitý displej" });

  // Otevřít ji ze seznamu je jiná cesta než detail hned po založení: seznam
  // ji musí najít, vykreslit a detail načíst z databáze.
  await vidZakazku(page, kod).first().click();
  await expect(page.getByText(new RegExp(`^${zakaznik} · `)).first()).toBeVisible({ timeout: 30_000 });
  await zavriDetail(page);

  expect(chyby, `Neodchycené chyby ve stránce: ${chyby.join(" | ")}`).toEqual([]);
});

test("hledání najde zakázku podle čísla i podle jména", async ({ page }) => {
  const chyby = hlidejChyby(page);
  await prihlasSe(page);

  const hledani = page.getByPlaceholder("Vyhledávání…");
  await hledani.fill(kod);
  await expect(vidZakazku(page, kod).first()).toBeVisible({ timeout: 30_000 });

  await hledani.fill(zakaznik);
  await expect(vidZakazku(page, kod).first()).toBeVisible({ timeout: 30_000 });

  // Nesmysl nesmí vrátit nic – jinak filtr nefiltruje.
  await hledani.fill("nexistujicizakazka-zzz");
  await expect(vidZakazku(page, kod)).toHaveCount(0, { timeout: 30_000 });

  expect(chyby, `Neodchycené chyby ve stránce: ${chyby.join(" | ")}`).toEqual([]);
});

test("faktura se vystaví a částky se formátují česky", async ({ page }) => {
  const chyby = hlidejChyby(page);
  await prihlasSe(page);

  await vidZakazku(page, kod).first().click();
  await page.getByRole("button", { name: /Vystavit fakturu/ }).first().click();
  await expect(page.getByText("Nová faktura")).toBeVisible({ timeout: 40_000 });

  await page.getByPlaceholder("Název položky").first().fill("Oprava (prohlížeče)");
  await page.locator('input[type="number"]').nth(1).fill("1000");
  // Formát čísla jde přes Intl; nesedící mezera nebo desetinná čárka znamená,
  // že zákazník uvidí na faktuře jinou částku než servis.
  await expect(page.getByText("1 000,00 Kč").first()).toBeVisible({ timeout: 20_000 });

  await page.getByRole("button", { name: "Vystavit", exact: true }).click();
  await expect(page.getByText(/FV\d{4}-\d{4}/).first()).toBeVisible({ timeout: 40_000 });

  expect(chyby, `Neodchycené chyby ve stránce: ${chyby.join(" | ")}`).toEqual([]);
});

test("tisk faktury ve webové větvi sestaví doklad a otevře tiskový dialog", async ({ page }) => {
  const chyby = hlidejChyby(page);

  // `window.print()` by v testu otevřel dialog a běh by se zasekl. Podstrčíme
  // vlastní funkci – a to i do tiskového iframu, protože `printHtmlInBrowser`
  // tiskne z něj, ne z hlavní stránky.
  await page.addInitScript(() => {
    const cil = (() => {
      try {
        return (window.top as unknown as Record<string, unknown>) ?? (window as unknown as Record<string, unknown>);
      } catch {
        return window as unknown as Record<string, unknown>;
      }
    })();
    if (typeof cil.__tisk !== "number") cil.__tisk = 0;
    window.print = () => {
      cil.__tisk = (cil.__tisk as number) + 1;
    };
  });

  await prihlasSe(page);
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("jobsheet:navigate", { detail: { page: "invoices" } })));
  await expect(page.getByRole("button", { name: "Uzávěrka" })).toBeVisible({ timeout: 40_000 });

  const prvni = page.getByText(/^FV\d{4}-\d{4}$/).first();
  await expect(prvni).toBeVisible({ timeout: 30_000 });
  await prvni.click();

  await page.getByRole("button", { name: /^Tisk/ }).first().click();
  await page.getByRole("menuitem", { name: "Tisk" }).click();

  // Doklad se opravdu sestavil a doputoval do tiskového dialogu.
  await expect.poll(() => page.evaluate(() => (window as unknown as { __tisk?: number }).__tisk ?? 0), {
    timeout: 45_000,
    message: "Tiskový dialog se neotevřel – dokument se nesestavil.",
  }).toBeGreaterThan(0);

  // Doklad se sází sám: zmenšuje písmo, dokud se nevejde na stránku, a pak si
  // do `data-fit` napíše, že je hotovo. Kdyby měření v jiném prohlížeči
  // spadlo nebo doměřilo jinak, vyjede se doklad na dvě stránky – a to je
  // vidět až na papíře u zákazníka, ne na obrazovce.
  const sazba = await page.evaluate(() => {
    const ramecek = [...document.querySelectorAll("iframe")].find((i) => i.getAttribute("aria-hidden") === "true");
    const doc = ramecek?.contentDocument;
    if (!doc) return null;
    const d = doc.documentElement.dataset;
    return { fit: d.fit ?? null, stran: d.pages ?? null, preteka: d.overflow ?? null, delkaTextu: (doc.body.innerText ?? "").trim().length };
  });
  expect(sazba, "Tiskový iframe po tisku zmizel.").not.toBeNull();
  expect(sazba!.fit, "Sazba dokladu nedoběhla – tiskne se neproměřený doklad.").toBe("done");
  expect(sazba!.stran, "Faktura s jednou položkou se nevešla na jednu stránku.").toBe("1");
  expect(sazba!.preteka).toBe("0");
  expect(sazba!.delkaTextu, "Doklad je prázdný.").toBeGreaterThan(200);

  expect(chyby, `Neodchycené chyby ve stránce: ${chyby.join(" | ")}`).toEqual([]);
});

test("náhled dokladu se vykreslí (blob URL v iframu)", async ({ page }) => {
  const chyby = hlidejChyby(page);
  await prihlasSe(page);
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("jobsheet:navigate", { detail: { page: "invoices" } })));
  await expect(page.getByRole("button", { name: "Uzávěrka" })).toBeVisible({ timeout: 40_000 });

  const prvni = page.getByText(/^FV\d{4}-\d{4}$/).first();
  await expect(prvni).toBeVisible({ timeout: 30_000 });
  await prvni.click();
  await page.getByRole("button", { name: /^Tisk/ }).first().click();
  await page.getByRole("menuitem", { name: "Náhled" }).click();

  const nahled = page.frameLocator('iframe[title="Náhled PDF"]');
  // V náhledu musí být obsah dokladu, ne prázdná stránka: blob URL v iframu
  // je přesně to místo, kde se prohlížeče liší v tom, co pustí dovnitř.
  await expect(nahled.locator("body")).toContainText(/Faktura|FV\d{4}-\d{4}/, { timeout: 45_000 });

  expect(chyby, `Neodchycené chyby ve stránce: ${chyby.join(" | ")}`).toEqual([]);
});

test("servis pošle nabídku a získá odkaz na portál", async ({ page }) => {
  const chyby = hlidejChyby(page);
  await prihlasSe(page);

  const zakaznikPortal = testovaciJmeno("Portál prohlížeče");
  await zalozZakazku(page, {
    zakaznik: zakaznikPortal,
    zarizeni: "iPhone (portál prohlížeče)",
    popis: "Rozbitý displej",
    nechatOtevrene: true,
  });

  await expect(page.getByText("Cenová nabídka").first()).toBeVisible({ timeout: 30_000 });
  await page.getByPlaceholder("Vlastní položka").fill("Výměna displeje");
  await page.getByPlaceholder("Kč", { exact: true }).fill("3500");
  await page.getByRole("button", { name: "Přidat", exact: true }).click();
  await page.getByRole("button", { name: "Poslat ke schválení" }).click();
  await expect(page.getByText(/Čeká na schválení/).first()).toBeVisible({ timeout: 30_000 });

  const kotva = page.locator('a[href^="https://appjobi.com/z/"]').first();
  await expect(kotva).toBeVisible({ timeout: 40_000 });
  const odkaz = (await kotva.getAttribute("href")) ?? "";
  portalToken = new URL(odkaz).searchParams.get("t") ?? "";
  expect(portalToken, "Odkaz na portál nemá token.").not.toEqual("");

  // Odkaz se zákazníkovi nejčastěji posílá tak, že si ho servisák zkopíruje.
  // Zápis do schránky je přesně to místo, kde Safari a Firefox vyžadují, aby
  // se volal ještě v rámci kliknutí – po jakémkoli `await` ho odmítnou.
  await page.getByRole("button", { name: "Kopírovat", exact: true }).click();
  await expect(page.getByText("Odkaz zkopírován").first()).toBeVisible({ timeout: 15_000 });

  expect(chyby, `Neodchycené chyby ve stránce: ${chyby.join(" | ")}`).toEqual([]);
});

/**
 * Portál v mobilním Safari.
 *
 * Zákazník ho jinde na iPhonu otevřít nemůže – WKWebView i Chrome pro iOS
 * jedou na WebKitu. Testuje se místní kopie z `web/`, ne appjobi.com, aby se
 * opravy v portálu daly ověřit dřív, než se nasadí.
 */
test.describe("zákaznický portál v mobilním Safari", () => {
  test.skip(({ browserName }) => browserName !== "webkit", "Mobilní Safari se dá napodobit jen ve WebKitu.");

  test("portál se načte, ukáže nabídku a jde ji schválit", async ({ browser }) => {
    const mobil = await browser.newContext({ ...devices["iPhone 14"], locale: "cs-CZ", timezoneId: "Europe/Prague" });
    const portal = await mobil.newPage();
    const chyby = hlidejChyby(portal);
    try {
      await portal.goto(`${PORTAL_URL}?t=${encodeURIComponent(portalToken)}`);

      await expect(portal.getByText("Cenová nabídka").first()).toBeVisible({ timeout: 60_000 });
      // Částka se formátuje přes Intl a datum přes DateTimeFormat – obojí je
      // v Safari jiná implementace než v Chromiu.
      await expect(portal.getByText(/3\s*500/).first()).toBeVisible();

      // Stránka se na 390 px nesmí rozjet do šířky; na iPhonu by se pak
      // schovala polovina tlačítek za okraj.
      const preteka = await portal.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
      expect(preteka, "Portál přetéká do šířky – na iPhonu nejde přečíst.").toBe(false);

      // Podpisové pole je canvas nad Pointer Events; na iPhonu se kreslí prstem.
      // Že se opravdu kreslí, se pozná jedině z pixelů – prázdné pole vypadá
      // stejně jako rozbité a zákazník by zakázku nemohl převzít.
      await expect(portal.locator("canvas.sig-pad")).toBeVisible();
      const inkoust = await portal.evaluate(() => {
        const c = document.querySelector("canvas.sig-pad") as HTMLCanvasElement | null;
        if (!c) return -1;
        const r = c.getBoundingClientRect();
        const posli = (typ: string, x: number, y: number) =>
          c.dispatchEvent(new PointerEvent(typ, { bubbles: true, cancelable: true, pointerId: 1, pointerType: "touch", isPrimary: true, clientX: x, clientY: y, buttons: typ === "pointerup" ? 0 : 1 }));
        posli("pointerdown", r.left + 30, r.top + 100);
        for (let i = 30; i <= 200; i += 10) posli("pointermove", r.left + i, r.top + 100 + Math.sin(i / 15) * 30);
        posli("pointerup", r.left + 200, r.top + 100);
        const data = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
        let n = 0;
        for (let i = 3; i < data.length; i += 4) if (data[i] > 0) n++;
        return n;
      });
      expect(inkoust, "Prst v podpisovém poli nezanechal stopu.").toBeGreaterThan(500);
      await expect(portal.getByRole("button", { name: "Podepsat" })).toBeEnabled();
      await portal.getByRole("button", { name: "Vymazat" }).click();

      await portal.getByRole("button", { name: "Schválit opravu" }).click();
      await portal.getByRole("button", { name: "Potvrdit" }).click();
      await expect(portal.getByText(/Schváleno/).first()).toBeVisible({ timeout: 60_000 });

      // Po obnovení drží – rozhodnutí je v databázi, ne jen na obrazovce.
      await portal.reload();
      await expect(portal.getByText(/Schváleno/).first()).toBeVisible({ timeout: 60_000 });

      expect(chyby, `Neodchycené chyby v portálu: ${chyby.join(" | ")}`).toEqual([]);
    } finally {
      await mobil.close();
    }
  });
});
