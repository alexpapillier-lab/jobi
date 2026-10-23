import { test, expect, type Page, type Request } from "@playwright/test";
import { prihlasSe, testovaciJmeno, vidZakazku, zalozZakazku, zavriDetail } from "./pomocnici";

/**
 * Odměny týmu: pravidlo v Nastavení → Lidé a přístupy → Odměny za opravy,
 * přepínač „Zobrazit Odměny v navigaci“ a stránka Odměny se zaměstnancem
 * měsíce. Pravidla jsou v service_settings celého servisu a přepočítávají
 * odměny za dřívější měsíce, proto si test po sobě pravidlo smaže
 * a přepínač vrátí, jak byl – i když spadne v půlce.
 */

/** Nastavení → Lidé a přístupy → Odměny za opravy (přes hledání, viz nastaveni.spec.ts). */
async function otevriOdmenyVNastaveni(page: Page) {
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("jobsheet:navigate", { detail: { page: "settings" } })));
  const hledani = page.getByPlaceholder("Hledat v nastavení…");
  await expect(hledani).toBeVisible({ timeout: 20_000 });
  await hledani.fill("odměny za opravy");
  await page.getByRole("button", { name: /Odměny za opravy/ }).first().click({ timeout: 20_000 });
  await hledani.fill("");
  // Přidat jde až po načtení nastavení z databáze – jinak by se přepsal celý seznam pravidel.
  await expect(page.getByRole("button", { name: "Přidat pravidlo" })).toBeEnabled({ timeout: 30_000 });
}

/** Řádek pravidla v tabulce – podle textu, který se hledá v názvu opravy (ten je unikátní). */
function radekPravidla(page: Page, hledat: string) {
  return page.locator("tr").filter({ has: page.locator(`input[aria-label="Text v názvu opravy"][value="${hledat}"]`) });
}

function prepinacNavigace(page: Page) {
  return page.getByRole("checkbox", { name: /Zobrazit Odměny v navigaci/ });
}

async function pockejNaUlozeno(page: Page) {
  await expect(page.getByText("Uloženo", { exact: true }).first()).toBeVisible({ timeout: 20_000 });
}

test("pravidlo odměn se uloží, zapne stránku Odměny a po úklidu zmizí", async ({ page }) => {
  test.setTimeout(240_000);
  const nazev = testovaciJmeno("E2E odměna");
  const hledat = `e2e-odmena-${Date.now().toString(36)}`;

  await prihlasSe(page);
  await otevriOdmenyVNastaveni(page);
  const puvodneVNavigaci = await prepinacNavigace(page).isChecked();

  try {
    // Přidání pravidla: název, „v názvu opravy je“, částka v Kč.
    await page.getByPlaceholder("Servisní čištění", { exact: true }).fill(nazev);
    await page.getByPlaceholder("servisní čištění", { exact: true }).fill(hledat);
    await page.getByPlaceholder("100", { exact: true }).fill("150");
    await page.getByRole("button", { name: "Přidat pravidlo" }).click();
    await pockejNaUlozeno(page);

    const radek = radekPravidla(page, hledat);
    await expect(radek).toHaveCount(1, { timeout: 20_000 });
    await expect(radek.getByLabel("Název pravidla")).toHaveValue(nazev);
    await expect(radek.getByLabel("Hodnota odměny")).toHaveValue("150");
    await expect(radek.getByLabel("Aktivní")).toBeChecked();

    // Zkoušeč pod tabulkou musí na název opravy s tím textem najít právě tohle pravidlo.
    await page.getByPlaceholder(/Vyzkoušet název opravy/).fill(`Výměna displeje + ${hledat}`);
    await expect(page.getByText(new RegExp(`Sedí pravidlo „${nazev}“`))).toBeVisible();

    // Přepínač stránky Odměny pro celý tým.
    const prepinac = prepinacNavigace(page);
    await expect(prepinac).toBeVisible();
    if (!puvodneVNavigaci) {
      await prepinac.click();
      await pockejNaUlozeno(page);
    }
    await expect(prepinac).toBeChecked();

    // Nastavení sdílí celý servis, takže musí přežít nové načtení.
    await page.reload();
    await expect(page.getByRole("button", { name: "+ Nová zakázka" })).toBeVisible({ timeout: 45_000 });
    await otevriOdmenyVNastaveni(page);
    await expect(radekPravidla(page, hledat)).toHaveCount(1, { timeout: 30_000 });
    await expect(prepinacNavigace(page)).toBeChecked();

    // Stránka Odměny s dlaždicí zaměstnance měsíce (i když zatím nikdo odměnu nemá).
    await page.evaluate(() => window.dispatchEvent(new CustomEvent("jobsheet:navigate", { detail: { page: "odmeny" } })));
    // Texty dlaždic se kontrolují přes obsah stránky: getByText s regexem
    // je v CI nenašel, i když na snímku byly (přístupový strom je slévá
    // do jednoho textu), toContainText čte textContent kontejneru.
    const stranka = page.locator('[data-tour="page-odmeny"]');
    await expect(stranka).toContainText(/Zaměstnan(ec|ci) měsíce/, { timeout: 30_000 });
    await expect(stranka).toContainText("Celkem odměn za měsíc");
    // Správce má schvalování vždy na jednom místě nahoře – i když nic nečeká.
    const keSchvaleni = page.locator('[data-tour="odmeny-ke-schvaleni"]');
    await expect(keSchvaleni).toContainText("Ke schválení");
    await expect(keSchvaleni).toContainText(/Nic nečeká na schválení|Schválit/);
  } finally {
    // Úklid: pravidlo pryč, přepínač jak byl. Smazání se potvrzuje oknem prohlížeče.
    await otevriOdmenyVNastaveni(page);
    const radek = radekPravidla(page, hledat);
    if ((await radek.count()) > 0) {
      page.once("dialog", (d) => void d.accept());
      await radek.getByRole("button", { name: "Smazat" }).click();
      await expect(radek).toHaveCount(0, { timeout: 20_000 });
      await pockejNaUlozeno(page);
    }
    const prepinac = prepinacNavigace(page);
    if ((await prepinac.isChecked()) !== puvodneVNavigaci) {
      await prepinac.click();
      await pockejNaUlozeno(page);
    }
    // Poslední zápis jde přes síť; bez chvilky čekání by test skončil dřív, než odejde.
    await page.waitForTimeout(1500);
  }
});

/** Přidá pravidlo v Kč (Nastavení musí být otevřené na Odměnách za opravy). */
async function pridejPravidlo(page: Page, nazev: string, hledat: string, hodnota: string) {
  await page.getByPlaceholder("Servisní čištění", { exact: true }).fill(nazev);
  await page.getByPlaceholder("servisní čištění", { exact: true }).fill(hledat);
  await page.getByPlaceholder("100", { exact: true }).fill(hodnota);
  await page.getByRole("button", { name: "Přidat pravidlo" }).click();
  await pockejNaUlozeno(page);
  await expect(radekPravidla(page, hledat)).toHaveCount(1, { timeout: 20_000 });
}

/** Úklid pravidla podle hledaného textu (smazání se potvrzuje oknem prohlížeče). */
async function smazPravidlo(page: Page, hledat: string) {
  // Spadlý test mohl nechat otevřené okno Nová zakázka přes Nastavení.
  const zrusit = page.getByRole("button", { name: "Zrušit", exact: true });
  if (await zrusit.last().isVisible().catch(() => false)) {
    const potvrdit = (d: { accept: () => Promise<void> }) => void d.accept();
    page.once("dialog", potvrdit);
    await zrusit.last().click({ timeout: 10_000 }).catch(() => {});
    await page.waitForTimeout(500);
    page.off("dialog", potvrdit);
  }
  await otevriOdmenyVNastaveni(page);
  const radek = radekPravidla(page, hledat);
  if ((await radek.count()) > 0) {
    page.once("dialog", (d) => void d.accept());
    await radek.getByRole("button", { name: "Smazat" }).click();
    await expect(radek).toHaveCount(0, { timeout: 20_000 });
    await pockejNaUlozeno(page);
  }
  await page.waitForTimeout(1500);
}

/** Stránka Odměny; vrací odpověď odmeny_prehled, ať test pozná, co server umí. */
async function otevriStrankuOdmeny(page: Page): Promise<Record<string, unknown>> {
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("jobsheet:navigate", { detail: { page: "odmeny" } })));
  await expect(page.locator('[data-tour="page-odmeny"]')).toContainText("Celkem odměn za měsíc", { timeout: 30_000 });
  // Stránka zůstává připojená a podruhé nic nenačte sama – proto vždy Obnovit.
  const obnovit = page.locator('[data-tour="odmeny-filtr"]').getByRole("button", { name: "Obnovit", exact: true });
  await expect(obnovit).toBeEnabled({ timeout: 30_000 });
  const odpoved = page.waitForResponse((r) => r.url().includes("/rpc/odmeny_prehled") && r.request().method() === "POST", { timeout: 30_000 });
  await obnovit.click();
  const json = await (await odpoved).json().catch(() => null);
  await expect(obnovit).toBeEnabled({ timeout: 30_000 });
  return json && typeof json === "object" ? (json as Record<string, unknown>) : {};
}

/*
 * Arman (iSwap, říjen 2026) při příjmu zaškrtl „Nabídnuto navíc“, na stránce
 * Odměny nic neviděl (zakázka ještě nebyla vydaná) a odměnu zadal ještě
 * ručně – po vydání by ji měl dvakrát. Teď: věta u zaškrtávátka, sekce
 * „Čeká na vydání“, varování v Přidat odměnu a po vydání řádek v tabulce.
 */
test("označená oprava z příjmu čeká na vydání, po vydání se připíše", async ({ page }) => {
  test.setTimeout(300_000);
  const nazev = testovaciJmeno("E2E nabídnuto");
  const hledat = `e2e-nabidnuto-${Date.now().toString(36)}`;
  const oprava = `Servisní čištění ${hledat}`;
  const zakaznik = testovaciJmeno("Odměna příjem");

  await prihlasSe(page);
  await otevriOdmenyVNastaveni(page);
  try {
    await pridejPravidlo(page, nazev, hledat, "150");
    // Testovací servis počítá odměny po vydání (výchozí režim).
    await expect(page.getByRole("radio", { name: /Po vydání zakázky/ })).toBeChecked();

    // Pravidla si stránka Zakázky načte z nastavení servisu – po novém načtení určitě.
    await page.reload();
    await expect(page.getByRole("button", { name: "+ Nová zakázka" })).toBeVisible({ timeout: 45_000 });
    // Bez načtených stavů servisu aplikace založení zakázky odmítne (jako v prihlasSe).
    await page.waitForLoadState("networkidle").catch(() => {});

    const kod = await zalozZakazku(page, {
      zakaznik,
      zarizeni: "Telefon (odměny)",
      predVytvorenim: async () => {
        await page.getByLabel("Název další opravy").first().fill(oprava);
        await page.getByLabel("Cena další opravy").first().fill("300");
        await page.getByTitle("Přidat opravu k zakázce").first().click();
        const veta = page.getByTestId("nabidnuto-veta").first();
        await expect(veta).toContainText("Zaškrtněte, jen když jste opravu nabídli navíc", { timeout: 20_000 });
        await page.getByRole("checkbox", { name: new RegExp(`Nabídnuto navíc: ${oprava}`) }).check();
        await expect(veta).toContainText("Odměna je zaevidovaná a připíše se po vydání zakázky");
        await expect(veta).toContainText("Čeká na vydání");
      },
    });

    const prehled = await otevriStrankuOdmeny(page);
    const ceka = page.locator('[data-tour="odmeny-ceka"]');
    const radky = page.locator('[data-tour="odmeny-radky"]');
    // Pole přidává migrace 20261023170000. Dokud není v produkci (e2e jede
    // proti ní), tahle část se výslovně přeskočí – ne potichu.
    const serverUmi = Array.isArray(prehled.cekajiciNaZapocteni);
    if (serverUmi) {
      await expect(ceka).toContainText("Čeká na vydání", { timeout: 20_000 });
      await expect(ceka).toContainText(kod);
      await expect(ceka).toContainText(oprava);
      await expect(radky).not.toContainText(kod);

      // Ruční odměna se stejným pravidlem k téže zakázce = upozornění na dvojí odměnu.
      await page.getByRole("button", { name: "+ Přidat s poznámkou" }).click();
      const dialog = page.getByRole("dialog", { name: "Přidat odměnu" });
      await dialog.getByLabel("Pravidlo").selectOption({ label: `${nazev} – 150 Kč` });
      await expect(dialog).toContainText("se počítají samy");
      await dialog.getByLabel("Hledat zakázku").fill(kod);
      await dialog.getByRole("button", { name: new RegExp(kod) }).first().click();
      await expect(dialog.getByTestId("odmena-dvoji")).toContainText(oprava, { timeout: 20_000 });
      await dialog.getByRole("button", { name: "Zrušit" }).click();
      await expect(dialog).toHaveCount(0);
    } else {
      test.info().annotations.push({ type: "přeskočeno", description: "Server ještě nevrací cekajiciNaZapocteni (migrace 20261023170000 není nasazená) – sekce Čeká na vydání a varování se neověřily." });
    }

    // Vydání: stav v hlavičce detailu → Dokončeno (koncový stav testovacího servisu).
    await page.evaluate(() => window.dispatchEvent(new CustomEvent("jobsheet:navigate", { detail: { page: "orders" } })));
    await expect(page.getByRole("button", { name: "+ Nová zakázka" })).toBeVisible({ timeout: 45_000 });
    // Číslo je v DOM vícekrát (schované stránky) – kliká se na viditelný výskyt.
    await vidZakazku(page, kod).first().click({ timeout: 30_000 });
    // „Zákazník · zařízení“ je i na schované stránce Odměn (Čeká na vydání) – jen viditelný výskyt.
    const hlavicka = page
      .getByText(new RegExp(`^${zakaznik} · `))
      .filter({ visible: true })
      .first()
      .locator("xpath=ancestor::*[.//button[contains(., 'Přijato')]][1]");
    await hlavicka.getByRole("button", { name: /Přijato/ }).first().click({ timeout: 30_000 });
    await page.getByRole("button", { name: "Dokončeno", exact: true }).first().click();
    await expect(hlavicka.getByRole("button", { name: /Dokončeno/ }).first()).toBeVisible({ timeout: 20_000 });
    await zavriDetail(page);

    // Po vydání: řádek v tabulce tohoto měsíce, v čekajících už není.
    await otevriStrankuOdmeny(page);
    await expect(radky).toContainText(kod, { timeout: 20_000 });
    await expect(radky).toContainText(oprava);
    // Sekce bez dalších čekajících zmizí úplně – stačí, že v ní zakázka není.
    if (serverUmi) await expect(ceka.filter({ hasText: kod })).toHaveCount(0);
  } finally {
    await smazPravidlo(page, hledat);
  }
});

/** Pobočky testovacího servisu (viz pobocky-pristup.spec.ts). */
const POBOCKY = { hlavni: "Hlavní pobočka", brno: "Brno – E2E" };

/**
 * Na stránce Odměn přepne pobočku v horní liště (null = Všechny pobočky)
 * a počká, až stránka přenačte přehled. Vrací parametry prvního volání
 * odmeny_prehled (s pobočkou, nebo bez ní) a poslední úspěšnou odpověď –
 * se starší databází první volání s pobočkou selže a stránka zavolá znovu bez ní.
 */
async function prepniPobockuNaOdmenach(page: Page, pobocka: string | null): Promise<{ parametry: Record<string, unknown>; odpoved: Record<string, unknown> }> {
  const lista = page.getByRole("group", { name: "Přepnout pobočku" }).filter({ visible: true }).first();
  await expect(lista).toBeVisible({ timeout: 20_000 });
  const tlacitko = lista.getByRole("button", { name: pobocka ?? "Všechny pobočky", exact: true });
  const parametry: Record<string, unknown>[] = [];
  const zachyt = (r: Request) => {
    if (r.url().includes("/rpc/odmeny_prehled") && r.method() === "POST") parametry.push((r.postDataJSON() ?? {}) as Record<string, unknown>);
  };
  page.on("request", zachyt);
  const odpoved = page.waitForResponse((r) => r.url().includes("/rpc/odmeny_prehled") && r.request().method() === "POST" && r.ok(), { timeout: 30_000 });
  if ((await tlacitko.getAttribute("aria-pressed")) === "true") {
    // Už vybraná – přenačíst ručně.
    await page.locator('[data-tour="odmeny-filtr"]').getByRole("button", { name: "Obnovit", exact: true }).click();
  } else {
    await tlacitko.click();
  }
  const json = await (await odpoved).json().catch(() => null);
  page.off("request", zachyt);
  await expect(page.locator('[data-tour="odmeny-filtr"]').getByRole("button", { name: "Obnovit", exact: true })).toBeEnabled({ timeout: 30_000 });
  return { parametry: parametry[0] ?? {}, odpoved: json && typeof json === "object" ? (json as Record<string, unknown>) : {} };
}

/*
 * Majitel iSwapu přepnutý na Brno viděl na stránce Odměny odměny za zakázky
 * Prahy – stránka pobočku z horní lišty vůbec nepoužívala. Teď se řídí
 * pobočkou jako Zakázky a Statistiky: nadpis řekne, za kterou pobočku čísla
 * jsou, zakázka jiné pobočky se neukáže a ruční odměna přidaná v Brně
 * patří Brnu.
 */
test("stránka Odměny se řídí pobočkou z horní lišty", async ({ page }) => {
  test.setTimeout(300_000);
  const nazev = testovaciJmeno("E2E pobočka odměna");
  const hledat = `e2e-pobocka-${Date.now().toString(36)}`;
  const oprava = `Servisní čištění ${hledat}`;
  const zakaznik = testovaciJmeno("Odměna pobočka");
  let pridanaRucni = false;

  await prihlasSe(page);
  await otevriOdmenyVNastaveni(page);
  try {
    await pridejPravidlo(page, nazev, hledat, "150");
    await page.reload();
    await expect(page.getByRole("button", { name: "+ Nová zakázka" })).toBeVisible({ timeout: 45_000 });
    await page.waitForLoadState("networkidle").catch(() => {});

    // Zakázka s označenou opravou v Hlavní pobočce (nová zakázka jde do aktivní pobočky).
    await page.getByRole("group", { name: "Přepnout pobočku" }).filter({ visible: true }).first()
      .getByRole("button", { name: POBOCKY.hlavni, exact: true }).click();
    const kod = await zalozZakazku(page, {
      zakaznik,
      zarizeni: "Telefon (odměny pobočka)",
      predVytvorenim: async () => {
        await page.getByLabel("Název další opravy").first().fill(oprava);
        await page.getByLabel("Cena další opravy").first().fill("300");
        await page.getByTitle("Přidat opravu k zakázce").first().click();
        await page.getByRole("checkbox", { name: new RegExp(`Nabídnuto navíc: ${oprava}`) }).check();
      },
    });

    await otevriStrankuOdmeny(page);
    const stranka = page.locator('[data-tour="page-odmeny"]');
    const nadpis = stranka.getByTestId("odmeny-nadpis-pobocka");
    const veta = stranka.getByTestId("odmeny-pobocka");
    const ceka = page.locator('[data-tour="odmeny-ceka"]');

    // Hlavní pobočka: pobočka jde do RPC, nadpis ji jmenuje, zakázka čeká na vydání.
    const hlavni = await prepniPobockuNaOdmenach(page, POBOCKY.hlavni);
    expect(typeof hlavni.parametry.p_branch_id, "odmeny_prehled dostane vybranou pobočku").toBe("string");
    await expect(nadpis).toContainText(POBOCKY.hlavni);
    // Pobočku umí databáze s migrací 20261023190000 (e2e jede proti produkci).
    const serverUmi = "pobocka" in hlavni.odpoved;
    if (serverUmi) {
      expect(hlavni.odpoved.pobocka).toBe(hlavni.parametry.p_branch_id);
      await expect(veta).toContainText(`Jen pobočka ${POBOCKY.hlavni}`);
      await expect(ceka).toContainText(kod, { timeout: 20_000 });
      await expect(page.locator('[data-tour="odmeny-dlazdice"]')).toContainText(`měsíce · ${POBOCKY.hlavni}`);
    } else {
      await expect(veta).toContainText("zatím za všechny pobočky");
    }

    // Brno: zakázka Hlavní pobočky tu není.
    const brno = await prepniPobockuNaOdmenach(page, POBOCKY.brno);
    expect(brno.parametry.p_branch_id).not.toBe(hlavni.parametry.p_branch_id);
    await expect(nadpis).toContainText(POBOCKY.brno);
    if (serverUmi) {
      await expect(page.locator('[data-tour="odmeny-soucty"]')).toContainText(`Součty – `);
      await expect(page.locator('[data-tour="odmeny-soucty"]')).toContainText(`· ${POBOCKY.brno}`);
      await expect(page.locator(`[data-tour="odmeny-ceka"]:has-text("${kod}")`)).toHaveCount(0);

      // Ruční odměna jedním klikem v Brně patří Brnu: v Brně je, v Hlavní ne.
      await page.locator('[data-tour="odmeny-rychle"]').getByRole("button", { name: new RegExp(`^\\+ ${nazev} · `) }).click();
      pridanaRucni = true;
      await expect(page.getByText(new RegExp(`${nazev} · .* – přidáno`)).first()).toBeVisible({ timeout: 20_000 });
      const rucni = page.locator('[data-tour="odmeny-rucni"]');
      await expect(rucni).toContainText(nazev, { timeout: 20_000 });
      await prepniPobockuNaOdmenach(page, POBOCKY.hlavni);
      await expect(page.locator(`[data-tour="odmeny-rucni"]:has-text("${nazev}")`)).toHaveCount(0);
      await expect(ceka).toContainText(kod);
    } else {
      // Starší databáze: stránka čísla neschová, jen řekne, že jsou za všechny.
      await expect(veta).toContainText("zatím za všechny pobočky");
      await expect(ceka).toContainText(kod, { timeout: 20_000 });
      test.info().annotations.push({ type: "přeskočeno", description: "Databáze ještě nezná p_branch_id (migrace 20261023190000 není nasazená) – filtr podle pobočky se ověřil jen sondami 1760–1765." });
    }

    // Všechny pobočky: bez parametru (projde i na starší databázi), zakázka je vidět.
    const vse = await prepniPobockuNaOdmenach(page, null);
    expect("p_branch_id" in vse.parametry, "Všechny pobočky = bez p_branch_id").toBe(false);
    await expect(nadpis).toContainText("Všechny pobočky");
    await expect(veta).toContainText("Čísla za všechny pobočky.");
    await expect(ceka).toContainText(kod, { timeout: 20_000 });
    if (serverUmi) await expect(page.locator('[data-tour="odmeny-rucni"]')).toContainText(nazev);
  } finally {
    // Úklid ruční odměny (je jen se serverem, který pobočku umí) – správce ji smaže ve Všech pobočkách.
    if (pridanaRucni) await prepniPobockuNaOdmenach(page, null).catch(() => {});
    const radek = page.locator('[data-tour="odmeny-rucni"] tr').filter({ hasText: nazev });
    if ((await radek.count().catch(() => 0)) > 0) {
      page.once("dialog", (d) => void d.accept());
      await radek.first().getByRole("button", { name: "Smazat" }).click().catch(() => {});
      await expect(radek).toHaveCount(0, { timeout: 20_000 }).catch(() => {});
    }
    await smazPravidlo(page, hledat);
  }
});
