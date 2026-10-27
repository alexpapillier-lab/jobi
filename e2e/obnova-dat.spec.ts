import { test, expect, type APIRequestContext, type Page, type WebSocketRoute } from "@playwright/test";
import { prihlasSe, SERVIS, testovaciJmeno, vidZakazku, zavriDetail } from "./pomocnici";

/**
 * Otevřené Zakázky se musí obnovit samy – i po výpadku spojení.
 *
 * Majitel 27. 10. 2026: „Občas se Jobi neobnoví automaticky, musí se dát
 * refresh.“ Karta, která chvíli ležela na pozadí, neukázala zakázky přidané
 * odjinud, dokud ji nikdo neobnovil. Spojení realtime spadne (uspaný počítač,
 * Wi-Fi, prohlížeč přiškrtí kartu na pozadí) a knihovna se sice znovu připojí,
 * ale co přišlo mezitím, už nikdy nepošle – a aplikace nic nedotahovala.
 * Před opravou tenhle test padal na kroku „spojení spadne…“ (zakázka se
 * neukázala ani po 40 s). Oprava: src/lib/zivyOdber.ts.
 *
 * Krok s detailem hlídá, že otevření detailu odběr nepřeruší: odběr se dřív
 * při každém otevření a zavření detailu rušil a zakládal znovu pod stejným
 * názvem kanálu.
 *
 * Zakázky „odjinud“ zakládá test přímo přes REST pod stejným přihlášením –
 * jako kolega u jiného počítače nebo objednávka z webu. Výpadek se dělá přes
 * `page.routeWebSocket`: zprávy ze serveru se zahazují (ztracené události)
 * a socket se pak zavře, nebo zůstane tiše mrtvý jako po uspání.
 */
test.describe.configure({ mode: "serial" });

type Relace = { url: string; apikey: string; token: string };

function role(token: string): string {
  try {
    return String(JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8")).role ?? "");
  } catch {
    return "";
  }
}

/** Mezi prohlížečem a realtime serverem – umí zahazovat zprávy a zavřít spojení. */
function prostrednik() {
  const s = { ztlumeno: false, spojeni: [] as WebSocketRoute[] };
  return {
    stav: s,
    async zapoj(page: Page) {
      await page.routeWebSocket(/\/realtime\/v1\/websocket/, (ws) => {
        const server = ws.connectToServer();
        ws.onMessage((m) => server.send(m));
        server.onMessage((m) => {
          if (!s.ztlumeno) ws.send(m);
        });
        ws.onClose(() => server.close());
        server.onClose(() => ws.close());
        s.spojeni.push(ws);
      });
    },
    async zavriVse() {
      const vse = s.spojeni.splice(0);
      await Promise.all(vse.map((ws) => ws.close({ code: 1006 }).catch(() => undefined)));
    },
  };
}

async function prihlasSeAOdchytRelaci(page: Page): Promise<Relace> {
  const zachyt: Partial<Relace> = {};
  page.on("request", (r) => {
    if (!r.url().includes("/rest/v1/")) return;
    const h = r.headers();
    if (h["apikey"]) zachyt.apikey = h["apikey"];
    const auth = h["authorization"];
    if (auth?.startsWith("Bearer ") && role(auth.slice(7)) === "authenticated") zachyt.token = auth.slice(7);
    zachyt.url = new URL(r.url()).origin;
  });
  await prihlasSe(page);
  await expect.poll(() => zachyt.token ?? null, { timeout: 30_000, message: "Nepřišel token přihlášeného." }).not.toBeNull();
  return zachyt as Relace;
}

/** Zakázka založená „odjinud“ – mimo tuhle kartu, rovnou do databáze. */
async function zakazkaOdjinud(api: APIRequestContext, r: Relace, predpona: string): Promise<{ id: string; kod: string }> {
  const kod = `RT${Date.now().toString().slice(-8)}`;
  const o = await api.post(`${r.url}/rest/v1/tickets`, {
    headers: { apikey: r.apikey, Authorization: `Bearer ${r.token}`, "Content-Type": "application/json", Prefer: "return=representation" },
    data: { service_id: SERVIS.id, code: kod, title: "Telefon (obnova dat)", customer_name: testovaciJmeno(predpona), status: "received" },
  });
  expect(o.status(), await o.text()).toBeLessThan(300);
  const [radek] = (await o.json()) as Array<{ id: string }>;
  return { id: radek.id, kod };
}

async function uklid(api: APIRequestContext, r: Relace | undefined, ids: string[]) {
  if (!r || ids.length === 0) return;
  await api
    .patch(`${r.url}/rest/v1/tickets?id=in.(${ids.join(",")})`, {
      headers: { apikey: r.apikey, Authorization: `Bearer ${r.token}`, "Content-Type": "application/json" },
      data: { deleted_at: new Date().toISOString() },
    })
    .catch(() => undefined);
}

/** Přepne kartu do „skryté“ a po chvíli zpátky – jako přepnutí na jinou kartu nebo aplikaci. */
async function nastavViditelnost(page: Page, stav: "visible" | "hidden") {
  await page.evaluate((s) => {
    const w = window as unknown as { __viditelnost?: string };
    if (!w.__viditelnost) {
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => w.__viditelnost });
      Object.defineProperty(document, "hidden", { configurable: true, get: () => w.__viditelnost === "hidden" });
    }
    w.__viditelnost = s;
    document.dispatchEvent(new Event("visibilitychange"));
  }, stav);
}

test("zakázky přidané odjinud se ukážou i po výpadku spojení, návratu na kartu a otevření detailu", async ({ page, request }) => {
  test.setTimeout(180_000);
  const vypadek = prostrednik();
  await vypadek.zapoj(page);
  const relace = await prihlasSeAOdchytRelaci(page);
  const zalozene: string[] = [];

  try {
    await test.step("realtime funguje: zakázka odjinud přijde sama", async () => {
      const z = await zakazkaOdjinud(request, relace, "Obnova živě");
      zalozene.push(z.id);
      await expect(vidZakazku(page, z.kod).first()).toBeVisible({ timeout: 30_000 });
    });

    await test.step("spojení spadne a během výpadku přibude zakázka", async () => {
      vypadek.stav.ztlumeno = true;
      const z = await zakazkaOdjinud(request, relace, "Obnova výpadek");
      zalozene.push(z.id);
      await page.waitForTimeout(3_000);
      vypadek.stav.ztlumeno = false;
      await vypadek.zavriVse();
      // Knihovna se sama připojí znovu; událost z výpadku už ale nikdy nepošle.
      await expect(vidZakazku(page, z.kod).first()).toBeVisible({ timeout: 40_000 });
    });

    await test.step("karta ležela na pozadí nad tiše mrtvým spojením", async () => {
      vypadek.stav.ztlumeno = true;
      await nastavViditelnost(page, "hidden");
      const z = await zakazkaOdjinud(request, relace, "Obnova pozadí");
      zalozene.push(z.id);
      await page.waitForTimeout(12_000);
      await nastavViditelnost(page, "visible");
      await expect(vidZakazku(page, z.kod).first()).toBeVisible({ timeout: 20_000 });
      vypadek.stav.ztlumeno = false;
      await vypadek.zavriVse();
    });

    await test.step("otevření a zavření detailu odběr nezabije", async () => {
      const prvni = await zakazkaOdjinud(request, relace, "Obnova detail A");
      zalozene.push(prvni.id);
      await expect(vidZakazku(page, prvni.kod).first()).toBeVisible({ timeout: 40_000 });
      await vidZakazku(page, prvni.kod).first().click();
      await expect(page.locator('button[aria-label="Zavřít"]:not([title*="rozpracované"])').last()).toBeVisible();
      // Zakázka přibude, zatímco má uživatel otevřený detail jiné.
      const druha = await zakazkaOdjinud(request, relace, "Obnova detail B");
      zalozene.push(druha.id);
      await page.waitForTimeout(5_000);
      await zavriDetail(page);
      // Krátce: tady se nic nedotahuje (okno nebylo skryté, spojení nespadlo),
      // zakázka musí přijít realtime událostí.
      await expect(vidZakazku(page, druha.kod).first()).toBeVisible({ timeout: 8_000 });
    });
  } finally {
    await uklid(request, relace, zalozene);
  }
});
