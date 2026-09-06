import { defineConfig } from "@playwright/test";
import zakladni from "./playwright.config";

/**
 * Životní cyklus servisu: založení, pozvánky, smazání.
 *
 * Vlastní config, protože tahle sada jako jediná v ostré databázi servisy
 * i **maže**. V automatickém CI nemá co dělat: běží při každém pushi, a když
 * ho zabije timeout jobu, `afterAll` se nespustí a po testu zůstane servis
 * navíc – účet jich smí mít tři, takže by to zablokovalo všechny další běhy.
 * Pouští se ručně: `npm run test:e2e:servisy`.
 */
export default defineConfig({
  ...zakladni,
  testIgnore: undefined,
  testMatch: /servisy\.spec\.ts$/,
});
