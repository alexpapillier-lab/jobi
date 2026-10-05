# PDF ve webové verzi bez tiskového dialogu

Na desktopu dělá PDF JobiDocs. V prohlížeči nic takového není, takže
„Uložit PDF“ dřív znamenalo tiskový dialog a v něm ručně zvolit cíl
„Uložit jako PDF“. Edge funkce `document-pdf` pošle HTML dokumentu do
**Cloudflare Browser Rendering** (headless Chromium na účtu Cloudflare,
na kterém už běží Worker `jobi-api`) a vrátí hotové PDF; aplikace ho
rovnou stáhne pod názvem jako na desktopu (`zarucni-list-J-28A99Z.pdf`).

Bez nastavení se nic nerozbije: funkce vrátí `503 not_configured`
a aplikace otevře tiskový dialog jako dřív.

## Zřízení

1. **API token.** Cloudflare → My Profile → API Tokens → Create Token →
   Custom token. Oprávnění: *Account › Browser Rendering › Edit*, účet
   ten, kde běží `jobi-api`. Token si zkopíruj, ukáže se jen jednou.
2. **ID účtu.** Cloudflare → Workers & Pages, v pravém panelu *Account ID*
   (je i v adrese dashboardu za `dash.cloudflare.com/`).
3. **Secrets funkce.** Supabase → Edge Functions → Secrets (nebo
   `supabase secrets set …`):

   | secret | hodnota |
   |---|---|
   | `CF_ACCOUNT_ID` | ID účtu |
   | `CF_BROWSER_RENDERING_TOKEN` | token z kroku 1 |

4. **Nasadit funkci** `document-pdf` – GitHub → Actions → *Nasazení edge
   funkcí na produkci*, nebo `npx supabase functions deploy document-pdf`.

Ověření: ve webové verzi u zakázky Tisk → PDF u záručního listu. Soubor
se má stáhnout rovnou, bez dialogu. Když se místo toho otevře tiskový
dialog, je v konzoli prohlížeče odpověď funkce (503 = chybí secrets,
502 = Cloudflare odmítl; text chyby je v těle).

## Co se posílá a kolik to stojí

Posílá se celé HTML dokumentu včetně fotek vložených jako `data:`
(server k úložišti nemá relaci), nejvýš 12 MB. Cloudflare dokument
vykreslí, počká na `html[data-fit="done"]` (dokument sám hlásí, že má
načtené obrázky a písma a doměřenou stránku) a vrátí A4 s pozadím.

Browser Rendering se účtuje podle času běhu prohlížeče. Jeden dokument
jsou jednotky sekund. Limity a ceny: Free plán má denní kvótu v
minutách, Workers Paid má v ceně hodiny měsíčně – aktuální čísla jsou v
dokumentaci Cloudflare (Browser Rendering → Limits / Pricing).

## Kde to je v kódu

| co | kde |
|---|---|
| edge funkce | `supabase/functions/document-pdf/index.ts` |
| volání z aplikace, stažení | `src/lib/pdfServer.ts` |
| napojení na tisk zakázky (export → server, jinak dialog) | `src/lib/tiskDokumentu.ts`, `src/pages/Orders/tiskZakazky.ts` |
| faktury | `src/pages/Invoices.tsx` (`handleExport`) |
| název souboru | `src/lib/nazevPdf.ts` |

Tvar požadavku na Cloudflare (`POST /accounts/{id}/browser-rendering/pdf`
s `html`, `waitForSelector`, `gotoOptions`, `pdfOptions`) odpovídá
dokumentaci REST API Browser Rendering; při změně API je to jediné místo,
kde se sahá.
