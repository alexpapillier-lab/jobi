import { describe, it, expect } from "vitest";
import { jeCasNaReload } from "./aktualizaceWebu";

const stav = (o: Partial<Parameters<typeof jeCasNaReload>[0]>) => ({ skryta: false, klidMs: 0, dialog: false, neulozeno: 0, ...o });

describe("kdy se web smí sám obnovit", () => {
  it("schovaná záložka bez rozdělané práce hned", () => {
    expect(jeCasNaReload(stav({ skryta: true }))).toBe(true);
  });

  it("viditelná záložka až po klidu – uživatel by přišel o rozepsaný text", () => {
    expect(jeCasNaReload(stav({ klidMs: 30_000 }))).toBe(false);
    expect(jeCasNaReload(stav({ klidMs: 3 * 60_000 }))).toBe(true);
  });

  it("nikdy s neuloženými změnami, ani schovaná", () => {
    expect(jeCasNaReload(stav({ skryta: true, neulozeno: 1 }))).toBe(false);
    expect(jeCasNaReload(stav({ klidMs: 10 * 60_000, neulozeno: 2 }))).toBe(false);
  });

  it("nikdy nad otevřeným dialogem – k rozepsanému detailu se uživatel vrátí", () => {
    expect(jeCasNaReload(stav({ skryta: true, dialog: true }))).toBe(false);
    expect(jeCasNaReload(stav({ klidMs: 10 * 60_000, dialog: true }))).toBe(false);
  });
});
