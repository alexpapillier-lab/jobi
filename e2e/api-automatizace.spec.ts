import { test, expect, type Page } from "@playwright/test";
import { prihlasSe, testovaciJmeno, zalozZakazku, vidZakazku } from "./pomocnici";

/**
 * Veřejné API servisu a automatizace – proti ostrým edge funkcím,
 * ale výhradně v E2E testovacím servisu.
 *
 * Proč to nejde otestovat jen jednotkově: token se vydává v aplikaci,
 * zapisuje se jím do ostré databáze přes `api-write` a pravidla vykonává
 * edge funkce `automations-run`. Ani jedno neběží v prohlížeči, takže
 * jednotkový test v `src/lib/apiVerejne.test.ts` a `src/lib/automatizace.test.ts`
 * ověřuje rozhodování, tenhle test celou cestu.
 *
 * Co se tu SCHVÁLNĚ nedělá: pravidla s akcí SMS a e-mail. Ta by
 * zákazníkovi doopravdy zavolala Twilio a Resend. Používá se jen
 * „Zapsat poznámku technikovi“, která zůstává uvnitř zakázky.
 *
 * Veřejná adresa (api.appjobi.com) je schválně – přes ni chodí zákazníci,
 * takže se testuje i cesta přes Cloudflare, ne jen samotná edge funkce.
 */

const API = "https://api.appjobi.com/v1";
/** Předpona názvů, ať jde po testu poznat, co uklidit. */
const PREDPONA = "E2E API test";

/** Token se předává mezi testy – běží sériově (workers: 1). */
let token = "";
let nazevTokenu = "";
let nazevPravidla = "";
let kodZakazky = "";

/** Nastavení → Servis → API. Přes hledání, stejně jako ostatní testy nastavení. */
async function otevriApi(page: Page): Promise<void> {
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("jobsheet:navigate", { detail: { page: "settings" } })));
  const hledani = page.getByPlaceholder("Hledat v nastavení…");
  await expect(hledani).toBeVisible({ timeout: 20_000 });
  await hledani.fill("token");
  await page.getByRole("button", { name: /› API$/ }).first().click();
  await hledani.fill("");
}

/** Nastavení → Komunikace → Automatizace. */
async function otevriAutomatizace(page: Page): Promise<void> {
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("jobsheet:navigate", { detail: { page: "settings" } })));
  const hledani = page.getByPlaceholder("Hledat v nastavení…");
  await expect(hledani).toBeVisible({ timeout: 20_000 });
  await hledani.fill("automatizace");
  await page.getByRole("button", { name: /› Automatizace$/ }).first().click();
  await hledani.fill("");
}

/**
 * Modul veřejného API je placený a v testovacím servisu se dá vypnout.
 * Když je vypnutý, obrazovka to sama říká – test pak nemá co ověřovat
 * a přeskočí se s důvodem, místo aby padal na něčem, co je v pořádku.
 */
async function apiJeZapnute(page: Page): Promise<boolean> {
  const vypnuto = page.getByText("Veřejné API není pro tenhle servis zapnuté");
  return !(await vypnuto.isVisible().catch(() => false));
}

/** Odvolá všechny tokeny z dřívějších běhů – jinak servis narazí na strop 10 tokenů. */
async function uklidStareTokeny(page: Page): Promise<void> {
  for (let i = 0; i < 12; i++) {
    const radek = page
      .locator("div")
      .filter({ hasText: new RegExp(`^${PREDPONA}`) })
      .filter({ has: page.getByRole("button", { name: "Odvolat" }) })
      .last();
    if (!(await radek.isVisible().catch(() => false))) return;
    await radek.getByRole("button", { name: "Odvolat" }).click();
    await expect(page.getByText("Token odvolán")).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(400);
  }
}

test.describe.configure({ mode: "serial" });

// ---------------------------------------------------------------------------
// Token v aplikaci
// ---------------------------------------------------------------------------

test("token se ukáže jedinkrát a v seznamu už nikde není", async ({ page }) => {
  test.setTimeout(150_000);
  await prihlasSe(page);
  await otevriApi(page);
  test.skip(!(await apiJeZapnute(page)), "Servis nemá zapnutý modul veřejného API.");

  await uklidStareTokeny(page);

  nazevTokenu = testovaciJmeno(PREDPONA);
  await page.getByPlaceholder("K čemu token je (např. web, pokladna)…").fill(nazevTokenu);
  // Bez rozsahu je tlačítko schválně nedostupné – token, který nic nesmí,
  // by jen mátl.
  const vytvorit = page.getByRole("button", { name: /Vytvořit token/ });
  await expect(vytvorit).toBeDisabled();
  await page.getByRole("checkbox").first().check();
  await vytvorit.click();

  const ramecek = page.getByText("Token vytvořen. Uložte si ho teď.");
  await expect(ramecek).toBeVisible({ timeout: 20_000 });
  token = (await page.locator("pre").filter({ hasText: /^jobi_/ }).first().innerText()).trim();
  expect(token).toMatch(/^jobi_[0-9a-f]{64}$/);

  // Řádek v seznamu smí nést název a rozsahy, ne token.
  const radek = page.locator("div").filter({ hasText: nazevTokenu }).last();
  await expect(radek).toContainText("catalog:write");
  await expect(radek).not.toContainText(token);

  // „Mám ho uložený“ – od téhle chvíle je token pryč z celé obrazovky.
  await page.getByRole("button", { name: "Mám ho uložený" }).click();
  await expect(ramecek).toHaveCount(0);
  expect(await page.content()).not.toContain(token);

  // A po znovunačtení taky – v databázi je jen otisk, není odkud ho vzít.
  await page.reload();
  await expect(page.getByRole("button", { name: "+ Nová zakázka" })).toBeVisible({ timeout: 45_000 });
  await otevriApi(page);
  await expect(page.getByText(nazevTokenu).first()).toBeVisible({ timeout: 20_000 });
  expect(await page.content()).not.toContain(token);
});

// ---------------------------------------------------------------------------
// Zápis přes API
// ---------------------------------------------------------------------------

test("zápis přes API: autorizace, idempotence a částečný úspěch", async ({ request }) => {
  test.skip(!token, "Token se nepodařilo vytvořit (modul API je vypnutý).");
  test.setTimeout(120_000);

  const zapis = (telo: unknown, hlavicky: Record<string, string> = {}) =>
    request.post(`${API}/write`, {
      headers: { "Content-Type": "application/json", ...hlavicky },
      data: telo,
      failOnStatusCode: false,
    });
  const sTokenem = (telo: unknown, klic?: string) =>
    zapis(telo, { Authorization: `Bearer ${token}`, ...(klic ? { "Idempotency-Key": klic } : {}) });

  // --- bez tokenu a s vymyšleným tokenem ---
  const bezTokenu = await zapis({ brands: [] });
  expect(bezTokenu.status()).toBe(401);

  const vymysleny = await zapis({ brands: [] }, { Authorization: `Bearer jobi_${"0".repeat(64)}` });
  expect(vymysleny.status()).toBe(401);
  // Odpověď nesmí prozradit, jestli takový token (a tedy servis) existuje.
  expect(await vymysleny.json()).toEqual({ error: "Neplatný token" });

  const znacka = testovaciJmeno("E2E-API");

  // --- běžný zápis ---
  const zalozeni = await sTokenem({ brands: [{ name: znacka }] });
  expect(zalozeni.status()).toBe(200);
  const telo = await zalozeni.json();
  expect(telo.ok).toBe(true);
  expect(telo.brands.created).toBe(1);
  const idZnacky: string = telo.brands.created_ids[0];

  // --- idempotence ---
  // Zkouší se na ZALOŽENÍ, ne na úpravě: kdyby se opakovaný požadavek
  // provedl podruhé, vznikla by druhá značka a odpověď by nesla jiné
  // created_ids. Shodná odpověď je tedy důkaz, že se zápis neprovedl znovu.
  const klic = `e2e-${Date.now()}`;
  const telo2 = { brands: [{ name: `${znacka}-idem` }] };
  const prvni = await sTokenem(telo2, klic);
  const opakovani = await sTokenem(telo2, klic);
  expect(prvni.status()).toBe(200);
  const prvniTelo = await prvni.json();
  expect(prvniTelo.brands.created).toBe(1);
  expect(opakovani.headers()["idempotency-replayed"]).toBe("true");
  expect(await opakovani.json()).toEqual(prvniTelo);

  // Stejný klíč s jiným tělem je chyba klienta, ne opakování.
  const jineTelo = await sTokenem({ brands: [{ name: `${znacka}-jinak` }] }, klic);
  expect(jineTelo.status()).toBe(409);

  // --- částečný úspěch ---
  const castecny = await sTokenem({ brands: [{ name: `${znacka}-2` }, { neco: 1 }] });
  expect(castecny.status()).toBe(207);
  const ct = await castecny.json();
  expect(ct.ok).toBe(false);
  expect(ct.brands.created).toBe(1);
  expect(ct.errors.join(" ")).toContain("brands[1]");

  // --- cizí id se podstrčit nedá ---
  // Náhodné id z jiného servisu tady nemá co dělat: zápis je omezený na
  // servis tokenu, takže se vrátí „nenalezeno“ a nic se nezmění.
  const cizi = await sTokenem({ brands: [{ id: "00000000-0000-4000-8000-000000000000", name: "NESMÍ" }] });
  expect(cizi.status()).toBe(200);
  expect((await cizi.json()).brands.not_found).toEqual(["00000000-0000-4000-8000-000000000000"]);

  // --- neznámé sekce těla ---
  const nesmysl = await sTokenem({ tickets: [{ id: "x" }] });
  expect(nesmysl.status()).toBe(400);

  // --- úklid: značky založené testem ---
  // Značky přes API mazat nejdou (kaskáda), takže se aspoň schovají
  // z veřejného ceníku a poznají se podle názvu.
  const zalozene: string[] = [idZnacky, ...prvniTelo.brands.created_ids, ...ct.brands.created_ids];
  const uklid = await sTokenem({
    brands: zalozene.map((id, i) => ({ id, name: `${znacka} (uklizeno ${i})`, public_visible: false })),
  });
  // Úklid je úklid, ne předmět testu: 200 i 207 (něco už zmizelo jinudy) stačí.
  expect([200, 207]).toContain(uklid.status());
});

test("veřejné čtení nerozliší neexistující servis od vypnutého modulu", async ({ request }) => {
  const neexistujici = await request.get(`${API}/catalog?service=takovy-servis-tu-neni`, { failOnStatusCode: false });
  expect(neexistujici.status()).toBe(404);
  expect(await neexistujici.json()).toEqual({ error: "Ceník není k dispozici" });

  const bezParametru = await request.get(`${API}/catalog`, { failOnStatusCode: false });
  expect(bezParametru.status()).toBe(400);

  const sklad = await request.get(`${API}/inventory?service=takovy-servis-tu-neni`, { failOnStatusCode: false });
  expect(sklad.status()).toBe(404);
  expect(await sklad.json()).toEqual({ error: "Sklad není k dispozici" });
});

test("odvolaný token přestane zapisovat okamžitě", async ({ page, request }) => {
  test.skip(!token, "Token se nepodařilo vytvořit (modul API je vypnutý).");
  test.setTimeout(120_000);
  await prihlasSe(page);
  await otevriApi(page);

  const radek = page
    .locator("div")
    .filter({ hasText: nazevTokenu })
    .filter({ has: page.getByRole("button", { name: "Odvolat" }) })
    .last();
  await expect(radek).toBeVisible({ timeout: 20_000 });
  await radek.getByRole("button", { name: "Odvolat" }).click();
  await expect(page.getByText("Token odvolán")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(nazevTokenu).first()).toBeVisible();
  // Odvolaný token ze seznamu nemizí – ať je dohledatelné, co se kdy dělo.
  await expect(page.locator("div").filter({ hasText: nazevTokenu }).last()).toContainText("odvolán");

  const po = await request.post(`${API}/write`, {
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    data: { brands: [{ name: "Po odvolání" }] },
    failOnStatusCode: false,
  });
  expect(po.status()).toBe(401);
  // Stejná hláška jako u neexistujícího tokenu.
  expect(await po.json()).toEqual({ error: "Neplatný token" });
  token = "";
});

// ---------------------------------------------------------------------------
// Automatizace
// ---------------------------------------------------------------------------

test("pravidlo se spustí nad novou zakázkou a zapíše se do historie", async ({ page }) => {
  test.setTimeout(180_000);
  await prihlasSe(page);
  await otevriAutomatizace(page);

  const nedostupne = page.getByText("Automatizace nejsou na serveru zapnuté");
  test.skip(await nedostupne.isVisible().catch(() => false), "Tabulky automatizací na serveru nejsou.");

  // --- nové pravidlo: nová zakázka → poznámka technikovi ---
  // Schválně poznámka, ne SMS ani e-mail: test nesmí nic poslat ven.
  nazevPravidla = testovaciJmeno(PREDPONA);
  await page.getByRole("button", { name: "Nové pravidlo" }).click();
  const editor = page.getByRole("dialog", { name: "Nové pravidlo" });
  await expect(editor).toBeVisible({ timeout: 15_000 });

  const vyberKdy = editor.locator("select").filter({ has: page.locator('option[value="ticket_created"]') });
  await vyberKdy.selectOption("ticket_created");
  const vyberCo = editor.locator("select").filter({ has: page.locator('option[value="notify"]') });
  await vyberCo.selectOption("notify");
  await editor.getByPlaceholder(/Zakázka \{\{code\}\} čeká/).fill("E2E automatizace: {{code}}");
  // Pole „Název pravidla“ nemá vlastní popisek pro čtečku a jeho zástupný text
  // se dopočítává z rozepsaného pravidla – při akci „poznámka“ je to jediné
  // textové pole v editoru, zbytek jsou zaškrtávátka a textarea.
  await editor.locator('input:not([type="checkbox"])').first().fill(nazevPravidla);
  await editor.getByRole("button", { name: "Uložit" }).click();

  await expect(editor).toHaveCount(0, { timeout: 20_000 });
  await expect(page.getByText(nazevPravidla).first()).toBeVisible({ timeout: 20_000 });

  // --- podnět: nová zakázka ---
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("jobsheet:navigate", { detail: { page: "orders" } })));
  await expect(page.getByRole("button", { name: "+ Nová zakázka" })).toBeVisible({ timeout: 30_000 });
  kodZakazky = await zalozZakazku(page, {
    zakaznik: testovaciJmeno("E2E automatizace"),
    zarizeni: "Telefon (automatizace)",
  });

  // --- historie spuštění ---
  await otevriAutomatizace(page);
  // Historie spuštění je jediná tabulka v téhle sekci.
  await expect(page.getByText("Historie spuštění")).toBeVisible({ timeout: 20_000 });
  const historie = page.locator("table").first();
  // Běh se zapisuje na serveru, obnovení seznamu je na nás.
  for (let i = 0; i < 6; i++) {
    if (await historie.getByText(kodZakazky).first().isVisible().catch(() => false)) break;
    await page.getByRole("button", { name: "Obnovit" }).first().click();
    await page.waitForTimeout(2000);
  }
  const radekBehu = historie.getByRole("row").filter({ hasText: kodZakazky }).first();
  await expect(radekBehu).toBeVisible({ timeout: 30_000 });
  await expect(radekBehu).toContainText(nazevPravidla);
  await expect(radekBehu).toContainText("Provedeno");
  // Detail běhu nese i výsledný text – tedy že se {{code}} opravdu dosadilo
  // číslem zakázky, ne že zůstalo v šabloně.
  await expect(radekBehu).toContainText(`Poznámka: E2E automatizace: ${kodZakazky}`);
});

test("vypnuté pravidlo se nespustí a smazané zmizí ze seznamu", async ({ page }) => {
  test.skip(!nazevPravidla, "Pravidlo se nepodařilo vytvořit.");
  test.setTimeout(180_000);
  await prihlasSe(page);
  await otevriAutomatizace(page);

  const radek = page
    .locator("div")
    .filter({ hasText: nazevPravidla })
    .filter({ has: page.getByRole("checkbox", { checked: true }) })
    .last();
  await radek.getByRole("checkbox").uncheck();

  // Nová zakázka teď už nesmí nic spustit.
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("jobsheet:navigate", { detail: { page: "orders" } })));
  await expect(page.getByRole("button", { name: "+ Nová zakázka" })).toBeVisible({ timeout: 30_000 });
  const druha = await zalozZakazku(page, {
    zakaznik: testovaciJmeno("E2E vypnuté"),
    zarizeni: "Telefon (vypnuté pravidlo)",
  });

  await otevriAutomatizace(page);
  const historie = page.locator("table").first();
  await page.getByRole("button", { name: "Obnovit" }).first().click();
  await page.waitForTimeout(3000);
  await expect(historie.getByRole("row").filter({ hasText: druha })).toHaveCount(0);

  // --- úklid: smazat pravidlo ---
  const radekPravidla = page.locator("div").filter({ hasText: nazevPravidla }).filter({ has: page.getByRole("button", { name: "Další akce" }) }).last();
  await radekPravidla.getByRole("button", { name: "Další akce" }).click();
  await page.getByText("Smazat", { exact: true }).first().click();
  await page.getByRole("button", { name: "Smazat", exact: true }).click();
  await expect(page.getByText("Pravidlo smazáno")).toBeVisible({ timeout: 20_000 });

  // Historie spuštění zůstává – jen bez názvu pravidla.
  await expect(page.getByText(nazevPravidla)).toHaveCount(0, { timeout: 20_000 });
  nazevPravidla = "";

  // --- úklid: obě testovací zakázky do koše ---
  for (const kod of [kodZakazky, druha].filter(Boolean)) {
    await page.evaluate(() => window.dispatchEvent(new CustomEvent("jobsheet:navigate", { detail: { page: "orders" } })));
    await expect(page.getByRole("button", { name: "+ Nová zakázka" })).toBeVisible({ timeout: 30_000 });
    const zakazka = vidZakazku(page, kod).first();
    if (!(await zakazka.isVisible().catch(() => false))) continue;
    await zakazka.click();
    await page.getByRole("button", { name: "Další akce" }).first().click();
    await page.getByText("Smazat zakázku").first().click();
    await page.getByRole("button", { name: "Smazat", exact: true }).click();
    await expect(vidZakazku(page, kod)).toHaveCount(0, { timeout: 30_000 });
  }
  kodZakazky = "";
});
