import { test, expect, request as novaZadost, type APIRequestContext, type Page } from "@playwright/test";
import { SERVIS, TECHNIK, prihlasSe } from "./pomocnici";

/**
 * Přístup člena k více pobočkám.
 *
 * PROČ TENHLE TEST EXISTUJE
 * Správce vybere technikovi v Týmu pobočky, na které vidí. Od té chvíle
 * technik v přepínači, v seznamu zakázek ani u nové zakázky nesmí potkat
 * pobočku, kterou mu správce nedal – hlídá to databáze (sondy 300/600/800
 * v rls-probe), ale rozhraní to musí ukázat stejně, jinak technik hledá
 * zakázku, která „zmizela“. Test jde přes skutečné rozhraní: zaškrtávátka
 * v Týmu, přepínač v postranním panelu, hledání, formulář nové zakázky.
 *
 * Zakázky pro test se zakládají přes REST (číslo se dává ručně, přes holý
 * REST by zůstalo prázdné), technik má vlastní kontext prohlížeče.
 * Na konci se technikovi vrátí původní nastavení.
 */
test.describe.configure({ mode: "serial" });

const POBOCKY = { hlavni: "Hlavní pobočka", brno: "Brno – E2E", ostrava: "Ostrava – E2E" };

type Relace = { url: string; apikey: string; token: string; uid: string };
const stav: {
  api?: APIRequestContext;
  majitel?: Relace;
  technikUid?: string;
  pobocky?: Record<string, string>;
  kodHlavni?: string;
  kodBrno?: string;
  puvodni?: { branch_ids: string[] | null; home_branch_id: string | null; capabilities: Record<string, boolean> };
} = {};

async function prihlasSeAOdchytRelaci(page: Page, kdo: "owner" | "technik"): Promise<Relace> {
  const zachyt: { url?: string; apikey?: string; token?: string } = {};
  page.on("request", (r) => {
    if (!r.url().includes("/rest/v1/")) return;
    const h = r.headers();
    if (h["apikey"]) zachyt.apikey = h["apikey"];
    if (h["authorization"]?.startsWith("Bearer ")) zachyt.token = h["authorization"].slice(7);
    zachyt.url = new URL(r.url()).origin;
  });
  await prihlasSe(page, kdo);
  await expect
    .poll(() => {
      try { return zachyt.token ? String(JSON.parse(Buffer.from(zachyt.token.split(".")[1], "base64url").toString("utf8")).role) : null; } catch { return null; }
    }, { timeout: 30_000 })
    .toBe("authenticated");
  const naklad = JSON.parse(Buffer.from(zachyt.token!.split(".")[1], "base64url").toString("utf8"));
  return { url: zachyt.url!, apikey: zachyt.apikey!, token: zachyt.token!, uid: String(naklad.sub) };
}
const hlavicky = (r: Relace) => ({ apikey: r.apikey, Authorization: `Bearer ${r.token}`, "Content-Type": "application/json", Prefer: "return=representation" });
async function cti<T = Record<string, unknown>>(r: Relace, cesta: string): Promise<T[]> {
  const o = await stav.api!.get(`${r.url}/rest/v1/${cesta}`, { headers: hlavicky(r) });
  expect(o.status(), `GET ${cesta}`).toBeLessThan(300);
  return (await o.json()) as T[];
}
async function zapis(r: Relace, cesta: string, telo: unknown): Promise<{ stav: number; radky: unknown[]; text: string }> {
  const o = await stav.api!.post(`${r.url}/rest/v1/${cesta}`, { headers: hlavicky(r), data: telo as never });
  const text = await o.text();
  let radky: unknown[] = [];
  try { const j = JSON.parse(text); if (Array.isArray(j)) radky = j; } catch { /* chyba není pole */ }
  return { stav: o.status(), radky, text };
}
async function rpc(r: Relace, jmeno: string, argumenty: unknown): Promise<{ stav: number; text: string }> {
  const o = await stav.api!.post(`${r.url}/rest/v1/rpc/${jmeno}`, { headers: hlavicky(r), data: argumenty as never });
  return { stav: o.status(), text: await o.text() };
}

/**
 * Jméno technika tak, jak je vidět v Týmu.
 *
 * Stejné jméno visí i na kartách zakázek jako štítek přiděleného technika.
 * Stránka Zakázky zůstává pod Nastavením v DOM, takže hledání podle textu
 * na ni narazí dřív – a čeká pak na prvek, který je schovaný.
 */
function clenTymu(page: Page) {
  return page.locator(`:text-is("${TECHNIK.prezdivka}"):visible`).first();
}

/** Nastavení → Lidé a přístupy → Tým a oprávnění. */
async function otevriTym(page: Page): Promise<void> {
  // Sekce pro správce se odemyká až po načtení role – přímý skok událostí
  // proto občas skončí na Údajích firmy. Klik v nabídce počká, až tam je.
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("jobsheet:navigate", { detail: { page: "settings" } })));
  const polozka = page.getByRole("button", { name: "Tým a oprávnění" }).first();
  await expect(polozka).toBeVisible({ timeout: 30_000 });
  await polozka.click();
  await expect(clenTymu(page)).toBeVisible({ timeout: 30_000 });
}

test.beforeAll(async () => { stav.api = await novaZadost.newContext(); });

test.afterAll(async () => {
  // Úklid i po spadlém testu: technik zůstane, jaký byl.
  const m = stav.majitel;
  if (m && stav.technikUid && stav.puvodni) {
    await rpc(m, "set_member_branches", { p_service_id: SERVIS.id, p_user_id: stav.technikUid, p_branch_ids: stav.puvodni.branch_ids });
    await rpc(m, "set_member_capabilities", { p_service_id: SERVIS.id, p_user_id: stav.technikUid, p_capabilities: stav.puvodni.capabilities });
    await rpc(m, "set_member_home_branch", { p_service_id: SERVIS.id, p_user_id: stav.technikUid, p_branch_id: stav.puvodni.home_branch_id });
  }
  await stav.api?.dispose();
});

test("příprava: zakázky na hlavní pobočce a v Brně", async ({ page }) => {
  test.setTimeout(180_000);
  stav.majitel = await prihlasSeAOdchytRelaci(page, "owner");
  const m = stav.majitel;
  const pobocky = await cti<{ id: string; name: string }>(m, `branches?service_id=eq.${SERVIS.id}&select=id,name`);
  stav.pobocky = Object.fromEntries(pobocky.map((p) => [p.name, p.id]));
  for (const n of Object.values(POBOCKY)) expect(stav.pobocky[n], `V E2E servisu chybí pobočka ${n}`).toBeTruthy();

  const razitko = Date.now().toString(36).toUpperCase();
  for (const [klic, nazev, znacka] of [["kodHlavni", POBOCKY.hlavni, "H"], ["kodBrno", POBOCKY.brno, "B"]] as const) {
    const kod = `E2EPR${razitko}${znacka}`;
    const z = await zapis(m, "tickets", { service_id: SERVIS.id, code: kod, title: "Přístup k pobočkám", status: "received", customer_name: "Pobočky", branch_id: stav.pobocky[nazev] });
    expect(z.stav, `Zakázku se nepodařilo založit: ${z.text}`).toBeLessThan(300);
    stav[klic] = kod;
  }

  const kontext = await page.context().browser()!.newContext({ baseURL: test.info().project.use.baseURL, locale: "cs-CZ" });
  const technik = await prihlasSeAOdchytRelaci(await kontext.newPage(), "technik");
  await kontext.close();
  stav.technikUid = technik.uid;
  const clenstvi = await cti<{ branch_ids: string[] | null; home_branch_id: string | null; capabilities: Record<string, boolean> | null }>(
    m, `service_memberships?service_id=eq.${SERVIS.id}&user_id=eq.${technik.uid}&select=branch_ids,home_branch_id,capabilities`);
  stav.puvodni = { branch_ids: clenstvi[0].branch_ids, home_branch_id: clenstvi[0].home_branch_id, capabilities: clenstvi[0].capabilities ?? {} };
});

test("správce vybere technikovi v Týmu Brno a Ostravu", async ({ page }) => {
  test.setTimeout(180_000);
  await prihlasSe(page);
  await otevriTym(page);
  const radek = clenTymu(page).locator('xpath=ancestor::*[.//button[@aria-label="Přístup k pobočkám"]][1]');
  const tlacitko = radek.getByRole("button", { name: "Přístup k pobočkám" });
  await tlacitko.click();
  const skupina = page.getByRole("group", { name: "Pobočky člena" });
  await expect(skupina).toBeVisible();

  // Nejdřív zrušit „všechny“, pak zaškrtnout chtěné a odškrtnout zbytek –
  // v tomhle pořadí nikdy nezůstane nula poboček, což rozhraní odmítá.
  const vsechny = skupina.getByLabel("Všechny pobočky");
  if (await vsechny.isChecked()) await vsechny.uncheck();
  for (const n of [POBOCKY.brno, POBOCKY.ostrava]) {
    const box = skupina.getByLabel(n, { exact: true });
    if (!(await box.isChecked())) await box.check();
  }
  for (const box of await skupina.getByRole("checkbox").all()) {
    const popis = (await box.locator("xpath=..").innerText()).trim();
    if (popis === "Všechny pobočky" || popis === POBOCKY.brno || popis === POBOCKY.ostrava) continue;
    if (await box.isChecked()) await box.uncheck();
  }
  await expect(tlacitko).toContainText(POBOCKY.brno, { timeout: 15_000 });
  await expect(tlacitko).toContainText(POBOCKY.ostrava);
  await expect(tlacitko).not.toContainText(POBOCKY.hlavni);

  // A opravdu v databázi, ne jen na obrazovce.
  const m = stav.majitel!;
  await expect.poll(async () => {
    const r = await cti<{ branch_ids: string[] | null }>(m, `service_memberships?service_id=eq.${SERVIS.id}&user_id=eq.${stav.technikUid}&select=branch_ids`);
    return (r[0]?.branch_ids ?? []).slice().sort();
  }, { timeout: 15_000 }).toEqual([stav.pobocky![POBOCKY.brno], stav.pobocky![POBOCKY.ostrava]].sort());
});

test("technik vidí jen Brno a Ostravu: přepínač, seznam i nová zakázka", async ({ page }) => {
  test.setTimeout(180_000);
  page.setDefaultNavigationTimeout(30_000);
  await prihlasSe(page, "technik");

  // Přepínač poboček nabízí jen povolené. Je v rozbaleném postranním panelu –
  // ten se rozbaluje najetím myší.
  await page.getByRole("navigation", { name: "Hlavní navigace" }).first().hover();
  const prepinac = page.getByRole("button", { name: /^Pobočka:/ }).first();
  await expect(prepinac).toBeVisible({ timeout: 15_000 });
  await prepinac.click();
  const nabidka = page.getByRole("listbox").first();
  await expect(nabidka).toBeVisible();
  await expect(nabidka.getByText(POBOCKY.brno, { exact: true })).toBeVisible();
  await expect(nabidka.getByText(POBOCKY.ostrava, { exact: true })).toBeVisible();
  await expect(nabidka.getByText(POBOCKY.hlavni, { exact: true })).toHaveCount(0);
  await page.keyboard.press("Escape");

  // Zakázka z Brna se najde, z hlavní pobočky ne.
  const hledani = page.locator('input[data-tour="orders-search"]:visible').first();
  await expect(hledani).toBeVisible({ timeout: 30_000 });
  await hledani.fill(stav.kodBrno!);
  await expect(page.locator(`:text-is("${stav.kodBrno}"):visible`).first()).toBeVisible({ timeout: 20_000 });
  await hledani.fill(stav.kodHlavni!);
  await expect(page.locator(`:text-is("${stav.kodHlavni}"):visible`)).toHaveCount(0, { timeout: 20_000 });
  await hledani.fill("");

  // Nová zakázka jde založit jen do povolené pobočky.
  await page.getByRole("button", { name: "+ Nová zakázka" }).click();
  const vyber = page.getByRole("combobox", { name: "Pobočka nové zakázky" });
  await expect(vyber).toBeVisible({ timeout: 15_000 });
  const moznosti = await vyber.locator("option").allInnerTexts();
  expect(moznosti.map((s) => s.trim()).sort()).toEqual([POBOCKY.brno, POBOCKY.ostrava].sort());
  await page.keyboard.press("Escape");
});

test("po vrácení „všechny pobočky“ technik hlavní pobočku zase vidí", async ({ page }) => {
  test.setTimeout(180_000);
  const m = stav.majitel!;
  const r = await rpc(m, "set_member_branches", { p_service_id: SERVIS.id, p_user_id: stav.technikUid, p_branch_ids: null });
  expect(r.stav, r.text).toBeLessThan(300);
  page.setDefaultNavigationTimeout(30_000);
  await prihlasSe(page, "technik");
  // Filtr seznamu startuje na domovské pobočce (Brno z předchozího testu) –
  // to není omezení, jen výchozí volba. Přepnout na všechny a pak hledat.
  await page.getByRole("navigation", { name: "Hlavní navigace" }).first().hover();
  const prepinac = page.getByRole("button", { name: /^Pobočka:/ }).first();
  await expect(prepinac).toBeVisible({ timeout: 15_000 });
  await prepinac.click();
  const nabidka = page.getByRole("listbox").first();
  await expect(nabidka.getByText(POBOCKY.hlavni, { exact: true })).toBeVisible();
  await nabidka.getByText("Všechny pobočky", { exact: true }).click();
  const hledani = page.locator('input[data-tour="orders-search"]:visible').first();
  await expect(hledani).toBeVisible({ timeout: 30_000 });
  await hledani.fill(stav.kodHlavni!);
  await expect(page.locator(`:text-is("${stav.kodHlavni}"):visible`).first()).toBeVisible({ timeout: 20_000 });
});
