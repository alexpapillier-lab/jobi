/**
 * Náhledová stránka dokumentů pro testy vzhledu.
 *
 * Vykreslí jeden dokument přes stejné jádro, jaké používá JobiDocs i tisk
 * z webové verze (`jobidocs/core`), takže co se tady zobrazí, dostane
 * zákazník i na papíře. Slouží jen testům – do produkčního buildu se
 * nedostane, protože Vite staví jen `index.html` v kořeni.
 *
 * Adresa: /e2e/dokumenty/nahled.html?typ=zakazkovy_list&varianta=short
 *   typ       – jeden z DOC_TYPES
 *   varianta  – short | long | empty (ukázková data z jádra)
 */
import { documentsFromConfig, normalizeDocuments, renderDocument, sampleData, templateFor, type DocType, type SampleKind } from "../../jobidocs/core/index";

const parametry = new URLSearchParams(location.search);
const typ = (parametry.get("typ") ?? "zakazkovy_list") as DocType;
const varianta = (parametry.get("varianta") ?? "short") as SampleKind;

const dokumenty = normalizeDocuments(documentsFromConfig(null));
const html = renderDocument({
  template: templateFor(dokumenty, typ),
  data: sampleData(typ, varianta),
  brand: dokumenty.brand,
  theme: dokumenty.theme,
  options: { mode: "print" },
});

const ramec = document.getElementById("ramec") as HTMLIFrameElement;
ramec.srcdoc = html;
document.documentElement.dataset.pripraveno = "1";
