import qrcode from "qrcode-generator";

/**
 * Text na UTF-8 bajty vyjádřené jako „binární" řetězec (jeden znak = jeden bajt).
 *
 * Knihovna ve výchozím režimu bere z každého znaku jen spodní bajt, takže
 * diakritika se zakóduje špatně a QR se pak dekóduje jako PRÁZDNÝ. Původní
 * řešení přes api.qrserver.com UTF-8 zvládalo, takže bez tohohle by náhrada
 * byla krok zpět.
 *
 * Knihovna sice nabízí i globální přepínač stringToBytesFuncs["UTF-8"], ale
 * ten mění sdílený stav modulu a přes ESM import není dostupný. Převod tady
 * je lokální a předvídatelný.
 *
 * Odhaleno testem v jobi/src/lib/qr.test.ts, který QR zpětně dekóduje.
 */
function toUtf8Bytes(text: string): string {
  return Array.from(new TextEncoder().encode(text))
    .map((b) => String.fromCharCode(b))
    .join("");
}

/**
 * Generování QR kódu lokálně.
 *
 * Dřív se QR obrázky tahaly z api.qrserver.com. To mělo tři problémy:
 *
 * 1. Bez internetu se QR nevykreslil – v aplikaci, jejímž jediným úkolem
 *    je tisknout dokumenty lokálně. Faktura se vytiskla bez QR platby
 *    a nikdo si toho nemusel všimnout.
 * 2. Obsah QR odcházel cizí službě v URL, tedy i do jejích logů.
 *    U QR platby to znamenalo číslo účtu servisu, částku a variabilní
 *    symbol (formát SPAYD).
 * 3. Kdyby ta služba skončila nebo změnila API, QR kódy by přestaly
 *    fungovat bez varování.
 *
 * qrcode-generator je synchronní a bez závislostí, takže funguje i tam,
 * kde se HTML skládá do řetězce (generateDocumentHtml) i ve webové verzi.
 */

/** Úroveň korekce chyb. "M" snese ~15 % poškození, na tisk bohatě stačí. */
type ErrorCorrection = "L" | "M" | "Q" | "H";

/**
 * Vrátí QR kód jako data URL (GIF), připravený do `<img src>`.
 * Prázdný vstup vrátí prázdný řetězec, ať volající nemusí hlídat.
 */
/**
 * Sestaví QR mřížku. Vytažené zvlášť, aby test mohl ověřit přesně to,
 * co se opravdu tiskne – ne vlastní kopii kódování.
 */
export function qrMatrix(text: string, ecc: ErrorCorrection = "M") {
  // typeNumber 0 = knihovna si velikost mřížky zvolí podle délky dat
  const qr = qrcode(0, ecc);
  qr.addData(toUtf8Bytes(text), "Byte");
  qr.make();
  return qr;
}

export function qrDataUrl(text: string, sizePx = 120, ecc: ErrorCorrection = "M"): string {
  if (!text) return "";
  try {
    const qr = qrMatrix(text, ecc);

    // Velikost buňky odvodíme z požadované velikosti v pixelech, ať výsledek
    // zhruba sedí. Minimum 2, jinak by byl QR na tisku nečitelný.
    const modules = qr.getModuleCount();
    const cell = Math.max(2, Math.round(sizePx / modules));
    return qr.createDataURL(cell, 0);
  } catch {
    // Nečitelný QR je lepší než rozbitý dokument.
    return "";
  }
}
