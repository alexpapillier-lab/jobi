/**
 * Desktopová aplikace JobiDocs od spuštění po ukončení.
 *
 * Jádro (`core/`) má vlastní jednotkové testy – ty hlídají, co je na papíře.
 * Tady jde o to, co se z jádra na papír vůbec dostane: že se okno otevře,
 * že editor doopravdy vykreslí dokument, že uložená šablona přežije restart
 * a že export vyrobí PDF se správným počtem stran. Nic z toho jádro neví.
 *
 * Netiskne se na skutečnou tiskárnu: jediný test tisku schválně volí
 * neexistující frontu a kontroluje, že se chyba dostane k uživateli.
 */
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import {
  docasnyAdresar,
  E2E_SERVICE_ID,
  KOREN,
  obsadPort,
  pocetStran,
  pockejNaApi,
  poslikontext,
  spustAplikaci,
  ukonci,
  type SpustenaAplikace,
} from "./pomocnici";

let a: SpustenaAplikace;

test.beforeEach(async () => {
  a = await spustAplikaci();
  await pockejNaApi(a.api);
});

test.afterEach(async () => {
  if (a) await ukonci(a);
});

test("okno se otevře, vykreslí editor a v konzoli nejsou chyby", async () => {
  const { okno } = a;

  // Bez kontextu z Jobi editor schválně nic nenabízí – to je taky stav,
  // který musí být srozumitelný, ne prázdné okno.
  await expect(okno.getByText("Čekám na Jobi…")).toBeVisible();
  await expect(okno.getByText("JobiDocs čeká na Jobi.")).toBeVisible();

  await poslikontext(a.api);
  await expect(okno.getByText("Připojeno k Jobi")).toBeVisible();

  // Pojistka: okno musí mluvit s API téhle instance. Když renderer sáhne
  // na pevný port 3847, obsluhuje nainstalovaný JobiDocs a test by
  // pracoval s ostrými servisy uživatele.
  await expect(okno.locator("main > .ed-toolbar select option")).toHaveText(["E2E testovací servis"]);

  // Záložky typů dokumentů a vybraný Zakázkový list.
  await expect(okno.locator(".doc-type-tabs button", { hasText: "Zakázkový list" })).toBeVisible();
  await expect(okno.locator(".doc-type-tabs button.active")).toHaveText(/Zakázkový list/);

  // Náhled je iframe se stejným HTML, jaké jde do PDF. Musí v něm být
  // vykreslená stránka a údaje ze servisu, ne jen bílá plocha.
  const ramec = okno.frameLocator("iframe.cv-frame");
  await expect(ramec.locator("section.page[data-main]")).toBeVisible();
  await expect(ramec.locator("body")).toContainText("E2E testovací servis");
  // Měřicí skript doběhl a editor ví, kolik stran dokument zabere.
  await expect(okno.locator(".ed-toolbar .ed-status", { hasText: "strana" })).toBeVisible();

  expect(a.chyby, `chyby v konzoli okna:\n${a.chyby.join("\n")}`).toEqual([]);
});

test("úprava šablony se uloží a přežije znovunačtení okna", async () => {
  const { okno } = a;
  await poslikontext(a.api);
  await expect(okno.getByText("Připojeno k Jobi")).toBeVisible();

  const pismo = okno.locator(".in-row", { hasText: "Velikost písma" }).locator("input");
  await expect(pismo).toBeVisible();
  const puvodni = Number(await pismo.inputValue());
  const nove = puvodni === 12 ? 11 : 12;

  await pismo.fill(String(nove));
  await expect(okno.getByText("● Neuložené změny")).toBeVisible();

  await okno.getByRole("button", { name: "Uložit", exact: true }).click();
  await expect(okno.locator(".ed-status.ok")).toContainText("Uloženo");

  // Uložení má skončit na disku, ne jen ve stavu Reactu.
  const soubor = path.join(a.dataDir, "documents-config.json");
  expect(fs.existsSync(soubor), "documents-config.json v adresáři s daty").toBe(true);
  const ulozeno = JSON.parse(fs.readFileSync(soubor, "utf-8")) as {
    entries: Array<{ service_id: string; config: { v2?: { templates?: Record<string, { page?: { fontSize?: number } }> } } }>;
  };
  const zaznam = ulozeno.entries.find((e) => e.service_id === E2E_SERVICE_ID);
  expect(zaznam?.config?.v2?.templates?.zakazkovy_list?.page?.fontSize).toBe(nove);

  // Po znovunačtení okna se musí načíst uložená hodnota, ne výchozí.
  await okno.reload();
  await expect(okno.getByText("Připojeno k Jobi")).toBeVisible();
  await expect(okno.locator(".in-row", { hasText: "Velikost písma" }).locator("input")).toHaveValue(String(nove));
  await expect(okno.locator(".doc-type-tabs button.active .tab-dot")).toBeVisible();
});

test("export do PDF vytvoří neprázdný soubor se správným počtem stran", async () => {
  await poslikontext(a.api);
  const vystup = docasnyAdresar("pdf");

  // Zakázkový list se má vejít na jednu stranu; diagnostika má navíc
  // vlastní stranu s fotkami. Kdyby se šablona rozjela, počet stran
  // je první, co se změní.
  const ocekavane: Array<{ typ: string; sample: string; stran: number }> = [
    { typ: "zakazkovy_list", sample: "short", stran: 1 },
    { typ: "diagnosticky_protokol", sample: "short", stran: 2 },
    { typ: "diagnosticky_protokol", sample: "long", stran: 4 },
    { typ: "faktura", sample: "short", stran: 1 },
  ];

  for (const { typ, sample, stran } of ocekavane) {
    const cil = path.join(vystup, `${typ}-${sample}.pdf`);
    const odpoved = await fetch(`${a.api}/v2/export`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ service_id: E2E_SERVICE_ID, doc_type: typ, sample, target_path: cil }),
    });
    expect(odpoved.status, `${typ}/${sample}: ${await odpoved.clone().text()}`).toBe(200);
    expect(await odpoved.json()).toMatchObject({ ok: true, path: cil });

    expect(fs.existsSync(cil)).toBe(true);
    const velikost = fs.statSync(cil).size;
    // Prázdné PDF má kolem 1 kB; skutečný doklad je řádově větší.
    expect(velikost, `${typ}/${sample} má jen ${velikost} B`).toBeGreaterThan(5000);
    expect(fs.readFileSync(cil).subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(await pocetStran(cil), `${typ}/${sample}`).toBe(stran);
  }

  // Export se propíše do Aktivit – uživatel se má kde podívat, co proběhlo.
  const aktivity = (await (await fetch(`${a.api}/v1/activity`)).json()) as { entries: Array<{ action: string; status: string }> };
  expect(aktivity.entries.filter((e) => e.action === "export" && e.status === "ok").length).toBe(ocekavane.length);

  fs.rmSync(vystup, { recursive: true, force: true });
});

test("PDF z aplikace odpovídá HTML z jádra", async () => {
  await poslikontext(a.api);

  // /v2/html je tatáž cesta, kterou se dělá PDF i tisk. Počet stránek
  // v HTML musí sedět s počtem stran ve vytištěném PDF – jinak se šablona
  // a tisk rozešly a zákazník to uvidí až na papíře.
  const html = await (
    await fetch(`${a.api}/v2/html`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ service_id: E2E_SERVICE_ID, doc_type: "diagnosticky_protokol", sample: "long" }),
    })
  ).text();
  const stranekVHtml = (html.match(/<section class="page/g) ?? []).length;

  const vystup = docasnyAdresar("pdf-html");
  const cil = path.join(vystup, "diagnostika.pdf");
  await fetch(`${a.api}/v2/export`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ service_id: E2E_SERVICE_ID, doc_type: "diagnosticky_protokol", sample: "long", target_path: cil }),
  });
  expect(await pocetStran(cil)).toBe(stranekVHtml);
  fs.rmSync(vystup, { recursive: true, force: true });
});

test("tisk na neexistující tiskárnu skončí chybou, ne tichým úspěchem", async () => {
  await poslikontext(a.api);
  const odpoved = await fetch(`${a.api}/v2/print`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      service_id: E2E_SERVICE_ID,
      doc_type: "zakazkovy_list",
      sample: "short",
      // Fronta, která na žádném počítači neexistuje – nic se nevytiskne.
      printer: "jobidocs-e2e-neexistujici-tiskarna",
    }),
  });
  expect(odpoved.status).toBeGreaterThanOrEqual(400);
  const telo = (await odpoved.json()) as { error?: string };
  expect(telo.error, "chyba tisku musí mít text pro uživatele").toBeTruthy();

  const aktivity = (await (await fetch(`${a.api}/v1/activity`)).json()) as { entries: Array<{ action: string; status: string; detail?: string }> };
  expect(aktivity.entries.some((e) => e.action === "print" && e.status === "error")).toBe(true);
});

test("ikona do horní lišty je součástí buildu", async () => {
  // Bez ní by JobiDocs na macOS běžel bez tray. Chybějící krok
  // `copy-tray-icon` v buildu se jinak pozná až na hotové aplikaci.
  const ikona = path.join(KOREN, "dist-electron", "electron", "tray-icon-template.png");
  const velikost = await a.app.evaluate(async ({ nativeImage }, cesta) => {
    const obr = nativeImage.createFromPath(cesta);
    return obr.isEmpty() ? null : obr.getSize();
  }, ikona);
  expect(velikost, "tray-icon-template.png chybí v dist-electron nebo je prázdný").not.toBeNull();
});

test("aplikace se korektně ukončí", async () => {
  const { app } = a;
  const proces = app.process();
  await poslikontext(a.api);

  const konec = new Promise<number | null>((resolve) => proces.once("exit", (code) => resolve(code)));
  await app.close();
  const kod = await konec;

  // Zavření okna na macOS aplikaci jen schová; ukončení musí projít i tak
  // (jinak by se nenainstalovala ani aktualizace).
  expect(kod === 0 || kod === null).toBe(true);
  // Port se uvolnil – žádný osiřelý API server nezůstal viset.
  await expect(fetch(`${a.api}/v1/health`)).rejects.toThrow();
});

test("obsazený port aplikaci neshodí a důvod se ukáže v okně", async () => {
  // Druhá kopie JobiDocs (nebo cokoli jiného na portu) dřív znamenala, že se
  // okno vůbec nevytvořilo a v horní liště zůstala mrtvá ikona.
  const prekazka = await obsadPort();

  const druha = await spustAplikaci({ port: prekazka.port });
  try {
    await expect(druha.okno.locator('[data-test="api-error"]')).toBeVisible();
    await expect(druha.okno.locator('[data-test="api-error"]')).toContainText(String(prekazka.port));
  } finally {
    await ukonci(druha);
    await prekazka.uvolni();
  }
});
