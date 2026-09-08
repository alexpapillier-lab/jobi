import { test, expect } from "@playwright/test";
import { prihlasSe, testovaciJmeno, zalozZakazku } from "./pomocnici";

/**
 * Fotky zakázky na dotykovém zařízení.
 *
 * PROČ TENHLE TEST EXISTUJE
 * Na telefonu má sekce fotek nabízet „Vyfotit“ (rovnou kamera) a „Z galerie“
 * a schovat tlačítko s QR kódem – kód, který člověk drží v ruce, si sám
 * nenaskenuje. Přitom musí zůstat jediný `<input type="file">`, přes který
 * nahrání dál běží (vodoznak, Storage). `capture` se na něj smí dostat až
 * při klepnutí na „Vyfotit“ a „Z galerie“ ho musí zase sundat – jinak by
 * iPhone zahodil výběr z galerie i víc fotek najednou.
 *
 * Dotyk se emuluje (`hasTouch`), okno zůstává velké, protože zakládání
 * zakázky v pomocnících počítá s 1440×1000.
 */
test.use({ hasTouch: true, isMobile: true });

const zakaznik = testovaciJmeno("Telefon");

/** 1×1 PNG – jde o cestu, ne o obrázek. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

test("na dotykovém zařízení nabízí sekce fotek Vyfotit a Z galerie místo QR", async ({ page }) => {
  test.setTimeout(150_000);
  await prihlasSe(page);
  await zalozZakazku(page, { zakaznik, zarizeni: "iPhone (telefon)", popis: "Focení z telefonu", nechatOtevrene: true });

  const sekce = page.getByText("Diagnostické fotografie", { exact: true }).locator("xpath=..");
  await expect(sekce).toBeVisible({ timeout: 30_000 });

  const vyfotit = sekce.getByRole("button", { name: "Vyfotit", exact: true });
  const zGalerie = sekce.getByRole("button", { name: "Z galerie" });
  await expect(vyfotit).toBeVisible();
  await expect(zGalerie).toBeVisible();
  await expect(sekce.getByRole("button", { name: /Vyfotit z telefonu/ })).toHaveCount(0);
  const input = sekce.locator('input[type="file"]');
  await expect(input).toHaveCount(1);

  // „Vyfotit“ otevře výběr přes ten samý input a nastaví mu kameru.
  const [kamera] = await Promise.all([page.waitForEvent("filechooser"), vyfotit.click()]);
  expect(await input.getAttribute("capture")).toBe("environment");
  await kamera.setFiles({ name: "zkouska.png", mimeType: "image/png", buffer: PNG });
  await expect(sekce.locator('img[alt^="Diagnostika"]').first()).toBeVisible({ timeout: 45_000 });

  // „Z galerie“ kameru zase sundá a nechá výběr více souborů.
  const [galerie] = await Promise.all([page.waitForEvent("filechooser"), zGalerie.click()]);
  expect(await input.getAttribute("capture")).toBeNull();
  expect(galerie.isMultiple()).toBe(true);
});
