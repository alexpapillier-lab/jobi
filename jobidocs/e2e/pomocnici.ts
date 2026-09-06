/**
 * Společné nářadí pro testy JobiDocs.
 *
 * Aplikace se spouští z buildu (`dist/` + `dist-electron/`), ne z vývojového
 * serveru – testuje se to, co dostane uživatel. Každý běh dostane vlastní
 * adresář s daty a vlastní port, aby nesahal na nainstalovaný JobiDocs ani
 * na jeho uložené šablony.
 */
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { _electron as electron, type ElectronApplication, type Page } from "playwright";

/** Kořen podprojektu jobidocs/. */
export const KOREN = path.resolve(__dirname, "..");

/**
 * E2E servis z kořenového playwright.config.ts. Tady slouží jen jako
 * identifikátor v lokálním kontextu – testy JobiDocs do Supabase nesahají
 * (bez přihlášení z Jobi se šablony berou z lokálního souboru).
 */
export const E2E_SERVICE_ID = "882beee7-4564-4d10-8ac6-16dc19240b57";

export type SpustenaAplikace = {
  app: ElectronApplication;
  okno: Page;
  /** Adresa lokálního API této instance. */
  api: string;
  port: number;
  /** Adresář s daty (settings.json, documents-config.json, last-context.json). */
  dataDir: string;
  /** Chyby z konzole okna a neodchycené výjimky, posbírané od startu. */
  chyby: string[];
};

/** Volný TCP port – aby test běžel i vedle nainstalovaného JobiDocs na 3847. */
export async function volnyPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const adresa = server.address();
      const port = typeof adresa === "object" && adresa ? adresa.port : 0;
      server.close(() => (port ? resolve(port) : reject(new Error("port se nepodařilo získat"))));
    });
  });
}

/**
 * Obsadí volný port, aby na něj JobiDocs nemohl.
 *
 * Nestačí jen `net.createServer().listen()`: okno JobiDocs se na svoje API
 * opakovaně ptá, takže na obsazeném portu skončí otevřená spojení. Server,
 * který je drží, se pak `close()` nedočká konce a úklid testu visí navždy.
 * Proto se každé příchozí spojení hned zahazuje (aplikace tak vidí port jako
 * nefunkční, což je přesně stav, který se testuje) a při uvolnění se pro
 * jistotu zavřou i ta, co ještě zbyla.
 */
export async function obsadPort(): Promise<{ port: number; uvolni: () => Promise<void> }> {
  const port = await volnyPort();
  const spojeni = new Set<net.Socket>();
  const server = net.createServer((socket) => {
    spojeni.add(socket);
    socket.on("close", () => spojeni.delete(socket));
    socket.destroy();
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  return {
    port,
    uvolni: () =>
      new Promise<void>((resolve) => {
        for (const s of spojeni) s.destroy();
        server.close(() => resolve());
      }),
  };
}

/** Cesta k binárce Electronu z jobidocs/node_modules. */
export function electronBinarka(): string {
  const dir = path.join(KOREN, "node_modules", "electron");
  const rel = fs.readFileSync(path.join(dir, "path.txt"), "utf-8").trim();
  return path.join(dir, "dist", rel);
}

/** Dočasný adresář v systémovém tempu (nikdy v repozitáři). */
export function docasnyAdresar(predpona: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `jobidocs-test-${predpona}-`));
}

/**
 * Spustí JobiDocs a počká na hlavní okno.
 *
 * `JOBIDOCS_LOAD_DIST=1` řekne aplikaci, ať načte zabudovaný `dist/`
 * i když není zabalená – vývojový server na 5173 při testu neběží.
 */
export async function spustAplikaci(options?: { port?: number; dataDir?: string }): Promise<SpustenaAplikace> {
  const port = options?.port ?? (await volnyPort());
  const dataDir = options?.dataDir ?? docasnyAdresar("data");
  const chyby: string[] = [];

  const app = await electron.launch({
    executablePath: electronBinarka(),
    args: [KOREN, `--user-data-dir=${dataDir}`],
    cwd: KOREN,
    env: {
      ...process.env,
      JOBIDOCS_API_PORT: String(port),
      JOBIDOCS_LOAD_DIST: "1",
    },
  });

  // Posluchač se věší na každé okno, ne až na to první – jinak by chyby
  // z prvních milisekund běhu utekly.
  app.on("window", (w) => sledujChyby(w, chyby));
  const okno = await app.firstWindow();
  sledujChyby(okno, chyby);
  await okno.waitForLoadState("domcontentloaded");

  return { app, okno, api: `http://127.0.0.1:${port}`, port, dataDir, chyby };
}

function sledujChyby(stranka: Page, chyby: string[]) {
  stranka.on("console", (m) => {
    if (m.type() === "error") chyby.push(`console: ${m.text()}`);
  });
  stranka.on("pageerror", (e) => chyby.push(`výjimka: ${e.message}`));
}

/** Ukončí aplikaci a uklidí data. Chyby při úklidu test neshodí. */
export async function ukonci(a: SpustenaAplikace): Promise<void> {
  try {
    await a.app.close();
  } catch {
    // aplikace už mohla skončit sama (test ukončení)
  }
  try {
    fs.rmSync(a.dataDir, { recursive: true, force: true });
  } catch {
    // dočasný adresář uklidí systém
  }
}

/** Počká, až lokální API začne odpovídat. Vrací verzi aplikace z /v1/health. */
export async function pockejNaApi(api: string, timeoutMs = 30_000): Promise<{ ok: boolean; version: string; api: number }> {
  const konec = Date.now() + timeoutMs;
  let posledni = "";
  while (Date.now() < konec) {
    try {
      const r = await fetch(`${api}/v1/health`);
      if (r.ok) return (await r.json()) as { ok: boolean; version: string; api: number };
      posledni = `HTTP ${r.status}`;
    } catch (e) {
      posledni = e instanceof Error ? e.message : String(e);
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`API na ${api} nenaběhlo do ${timeoutMs} ms (${posledni})`);
}

/**
 * Kontext, který jinak posílá Jobi. Bez něj JobiDocs jen čeká a editor se
 * nevykreslí. Supabase přihlášení se schválně neposílá: testy pracují
 * jen s lokálními šablonami.
 */
export async function poslikontext(api: string, serviceId = E2E_SERVICE_ID): Promise<void> {
  const odpoved = await fetch(`${api}/v1/context`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      services: [{ service_id: serviceId, service_name: "E2E testovací servis", role: "owner" }],
      activeServiceId: serviceId,
      companyData: {
        name: "E2E testovací servis",
        ico: "12345678",
        addressStreet: "Testovací 1",
        addressZip: "110 00",
        addressCity: "Praha",
        phone: "+420 777 000 000",
        email: "e2e@jobi.test",
      },
      canManageDocuments: true,
    }),
  });
  if (!odpoved.ok) throw new Error(`kontext se nepodařilo poslat: HTTP ${odpoved.status}`);
}

/** Počet stran v PDF. */
export async function pocetStran(soubor: string): Promise<number> {
  const { PDFDocument } = await import("pdf-lib");
  const doc = await PDFDocument.load(fs.readFileSync(soubor));
  return doc.getPageCount();
}
