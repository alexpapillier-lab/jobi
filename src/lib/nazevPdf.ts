/**
 * Název souboru, který tiskový dialog prohlížeče nabídne při „Uložit jako PDF“.
 *
 * Prohlížeč ho bere z titulku STRÁNKY, ne z titulku tištěného iframu –
 * takže se každý záruční list ukládal jako „Jobi.pdf“ a uživatel ho
 * přejmenovával ručně. Tvar odpovídá desktopu: druh dokumentu a číslo
 * zakázky bez diakritiky („zarucni-list-J-28A99Z“).
 *
 * Mimo webPrint.ts, protože ten tahá konfiguraci ze Supabase a v testu
 * se importovat nedá.
 */
import { DOC_TYPE_LABELS, type DocType } from "../../jobidocs/core/index";

function bezDiakritiky(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

export function nazevPdfProTisk(docType: DocType, data: { number?: string | null }): string {
  const druh = bezDiakritiky(DOC_TYPE_LABELS[docType] ?? docType).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const cislo = bezDiakritiky((data.number ?? "").trim()).replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-|-$/g, "");
  return cislo ? `${druh}-${cislo}` : druh;
}
