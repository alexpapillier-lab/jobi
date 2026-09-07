/**
 * Tisk a export dokumentu ze zakázky – společná logika pro desktop i web.
 *
 * Proč zvlášť: obě větve dosud žily uvnitř Orders.tsx (8 000 řádků), takže se
 * nedaly otestovat. Přitom právě tady se rozhoduje, jestli uživatel uvidí, že
 * se tisk nepovedl – nebo jestli se chyba tiše ztratí a on bude čekat na papír,
 * který nikdy nevyjede.
 *
 * Desktop: data jdou do JobiDocs (localhost:3847), ten je vloží do šablony
 * servisu a pošle na tiskárnu nebo uloží PDF.
 * Web: HTML se skládá v prohlížeči ze stejného jádra (jobidocs/core) a jde do
 * tiskového dialogu prohlížeče.
 *
 * Závislosti se předávají zvenčí, aby šly v testu nahradit – ne kvůli
 * abstrakci, ale proto, že jinak se chování při zavřeném dialogu nebo
 * nedostupné tiskárně nedá ověřit jinak než ručně.
 */
import type { DocumentData } from "./documentData";
import { formatJobiDocsErrorForUser, type DocTypeForPrint } from "./jobidocs";

export type RezimDokumentu = "print" | "export";

export type VysledekJobiDocs = { ok: boolean; error?: string };

export type DruhHlasky = "success" | "error" | "info";

export type ZaznamTelemetrie = {
  action: RezimDokumentu;
  docType: string;
  result: "success" | "error";
  durationMs: number;
  errorMessage?: string;
};

export type ZavislostiDokumentu = {
  /** Běží JobiDocs? Bez něj se na desktopu netiskne ani neexportuje. */
  jobiDocsBezi: () => Promise<boolean>;
  tisk: (docType: DocTypeForPrint, serviceId: string, data: DocumentData) => Promise<VysledekJobiDocs>;
  exportPdf: (docType: DocTypeForPrint, serviceId: string, data: DocumentData, cesta: string) => Promise<VysledekJobiDocs>;
  /** Nativní dialog „Uložit jako“. `null` = uživatel dialog zavřel. */
  vyberCilovySoubor: (vychoziNazev: string) => Promise<string | null>;
  /** Tisk v prohlížeči (webová větev). */
  tiskVProhlizeci: (docType: DocTypeForPrint, serviceId: string, data: DocumentData) => Promise<void>;
  /**
   * Vloží fotky do dokumentu jako data (obrázek uvnitř místo odkazu).
   *
   * Fotky leží v neveřejném úložišti a odkaz na ně platí jen krátce. Dokument
   * se přitom vykresluje jinde – JobiDocs je samostatný program a nemá naši
   * relaci, tiskový dialog prohlížeče kreslí ze skrytého iframu, a při
   * exportu se z HTML dělá PDF, které si obsah odkazu nedotáhne. Kdyby se
   * posílal odkaz, byl by na zákaznickém listu obrázek jen do doby, než
   * podpis vyprší – a v uloženém PDF by nebyl vůbec.
   */
  pripravFotky: (data: DocumentData) => Promise<DocumentData>;
  hlaska: (text: string, druh: DruhHlasky) => void;
  /** Hotový export – na desktopu s nabídkou „Otevřít složku“. */
  hotovyExport: (cesta: string) => void;
  telemetrie: (zaznam: ZaznamTelemetrie) => void;
  /** Oddělené kvůli testům; jinak performance.now(). */
  ted: () => number;
};

/** „Tisk“ / „Export“ pro hlášku uživateli (1. pád). */
function nazevAkce(rezim: RezimDokumentu): string {
  return rezim === "print" ? "Tisk" : "Export";
}

/** „tisku“ / „exportu“ pro hlášku uživateli (2. pád). */
function nazevAkce2Pad(rezim: RezimDokumentu): string {
  return rezim === "print" ? "tisku" : "exportu";
}

/**
 * Desktopová větev: tisk nebo export přes JobiDocs.
 *
 * Každá cesta ven končí buď úspěšnou hláškou, nebo chybovou – kromě jediné:
 * když uživatel sám zavře dialog pro uložení. To není chyba a hláška by jen
 * překážela.
 */
export async function spustDesktopovyDokument(
  rezim: RezimDokumentu,
  docType: DocTypeForPrint,
  serviceId: string,
  data: DocumentData,
  vychoziNazevSouboru: string,
  z: ZavislostiDokumentu
): Promise<void> {
  if (!(await jeJobiDocsSpusteny(z, rezim))) return;

  const zacatek = z.ted();
  const trvani = () => Math.round(z.ted() - zacatek);
  try {
    const sFotkami = await z.pripravFotky(data);
    if (rezim === "print") {
      const res = await z.tisk(docType, serviceId, sFotkami);
      if (res.ok) {
        z.telemetrie({ action: "print", docType, result: "success", durationMs: trvani() });
        z.hlaska("Úloha odeslána do fronty", "success");
      } else {
        z.telemetrie({ action: "print", docType, result: "error", durationMs: trvani(), errorMessage: res.error });
        z.hlaska(`JobiDocs: ${formatJobiDocsErrorForUser(res.error)}`, "error");
      }
      return;
    }

    const cesta = await z.vyberCilovySoubor(vychoziNazevSouboru);
    // Zavřený dialog = uživatel si to rozmyslel. Žádná hláška, žádná telemetrie.
    if (!cesta) return;

    const res = await z.exportPdf(docType, serviceId, sFotkami, cesta);
    if (res.ok) {
      z.telemetrie({ action: "export", docType, result: "success", durationMs: trvani() });
      z.hotovyExport(cesta);
    } else {
      z.telemetrie({ action: "export", docType, result: "error", durationMs: trvani(), errorMessage: res.error });
      z.hlaska(`JobiDocs: ${formatJobiDocsErrorForUser(res.error)}`, "error");
    }
  } catch (e) {
    // Sem spadne i selhání nativního dialogu (chybí oprávnění, plugin se
    // nenačetl). Dřív se to nedalo odlišit od zavřeného dialogu.
    const msg = e instanceof Error ? e.message : String(e);
    z.telemetrie({ action: rezim, docType, result: "error", durationMs: trvani(), errorMessage: msg });
    z.hlaska(`Chyba ${nazevAkce2Pad(rezim)}: ${msg}`, "error");
  }
}

/**
 * Spojí složku a název souboru.
 *
 * Proč ne prosté `${slozka}/${nazev}`: složka od Tauri může končit
 * oddělovačem (pak vznikne „//“) a na Windows je oddělovač zpětné lomítko –
 * smíchané cesty typu `C:\Users\x\Downloads/faktura.pdf` sice většina API
 * spolkne, ale objevují se pak v hláškách, které uživatel čte.
 */
export function spojCestu(slozka: string, nazevSouboru: string): string {
  const oddelovac = slozka.includes("\\") && !slozka.includes("/") ? "\\" : "/";
  return `${slozka.replace(/[\\/]+$/, "")}${oddelovac}${nazevSouboru}`;
}

/**
 * Výchozí složka pro export bez ptaní (doklady se exportují po dávkách,
 * dialog u každého by zdržoval): Stažené, jinak Plocha.
 *
 * Když nejde ani jedna, je to chyba. Dřív se v takovém případě psalo do
 * `/tmp` a uživateli se ohlásilo „PDF uložen“ – soubor existoval, ale nikdo
 * ho nenašel a systém ho po čase smazal.
 */
export async function vychoziSlozkaProExport(cesty: {
  downloadDir: () => Promise<string>;
  desktopDir: () => Promise<string>;
}): Promise<string> {
  try {
    return await cesty.downloadDir();
  } catch {
    // Složka Stažené nemusí existovat (přejmenovaná, přesunutá).
  }
  try {
    return await cesty.desktopDir();
  } catch (e) {
    throw new Error(`Nepodařilo se najít složku pro uložení (Stažené ani Plocha): ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** Společná kontrola dostupnosti JobiDocs i s hláškou, co má uživatel udělat. */
async function jeJobiDocsSpusteny(z: ZavislostiDokumentu, rezim: RezimDokumentu): Promise<boolean> {
  if (await z.jobiDocsBezi()) return true;
  z.hlaska(rezim === "print" ? "Spusťte JobiDocs pro tisk." : "Spusťte JobiDocs pro export do PDF.", "error");
  return false;
}

/**
 * Webová větev: tiskový dialog prohlížeče.
 *
 * Export je tady jen jiná volba cíle v témže dialogu, proto ta hláška navíc.
 */
export async function spustWebovyDokument(
  rezim: RezimDokumentu,
  docType: DocTypeForPrint,
  serviceId: string,
  data: DocumentData,
  z: ZavislostiDokumentu
): Promise<void> {
  const zacatek = z.ted();
  try {
    if (rezim === "export") z.hlaska("V tiskovém dialogu zvolte cíl „Uložit jako PDF“.", "info");
    await z.tiskVProhlizeci(docType, serviceId, await z.pripravFotky(data));
    z.telemetrie({ action: rezim, docType, result: "success", durationMs: Math.round(z.ted() - zacatek) });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    z.telemetrie({ action: rezim, docType, result: "error", durationMs: Math.round(z.ted() - zacatek), errorMessage: msg });
    z.hlaska(`${nazevAkce(rezim)} se nezdařil: ${msg}`, "error");
  }
}
