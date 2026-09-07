import { defineConfig } from "@playwright/test";
import zakladni from "./playwright.config";

/**
 * První hodina nového zákazníka: registrace → servis → zakázka → doklad.
 *
 * Vlastní config ze stejného důvodu jako `playwright.servisy.config.ts`: tahle
 * sada v ostré databázi **zakládá účty a servisy** a na konci je maže. V CI,
 * které běží při každém pushi, by po zabitém jobu zůstal servis navíc – účet
 * jich smí mít tři, takže by se další běhy zablokovaly. A účet se smazat
 * nedá vůbec (na to nemá aplikace rozhraní), takže každý běh navíc nechává
 * v Auth jednu adresu; při každém pushi by jich byly tisíce.
 *
 * Pouští se ručně a heslo si volající vygeneruje sám:
 *
 * ```bash
 * E2E_ONBOARDING_PASSWORD="$(openssl rand -base64 24)" npm run test:e2e:onboarding
 * ```
 *
 * Delší časový limit než v hlavní sadě: registrace, založení servisu,
 * zavedení výchozích stavů a první zakázka jdou v jednom testu za sebou.
 */
export default defineConfig({
  ...zakladni,
  testIgnore: undefined,
  testMatch: /onboarding\.spec\.ts$/,
  timeout: 240_000,
});
