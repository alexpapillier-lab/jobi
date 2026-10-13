/**
 * Kód pozvánky při opakovaném pozvání (supabase/functions/_shared/pozvanka.ts).
 *
 * Pozvaný dostal pět e-mailů za sebou a platil jen poslední, protože každé
 * kliknutí na „Pozvat“ přepsalo kód. Tyhle testy drží pravidlo, že čekající
 * pozvánka si kód nechává.
 */
import { describe, expect, it, vi } from "vitest";
import { kodPozvanky } from "../../supabase/functions/_shared/pozvanka";

const TED = new Date("2026-10-13T15:00:00Z");
const za = (dny: number) => new Date(TED.getTime() + dny * 86_400_000).toISOString();
const ceka = { token: "STARY-KOD", expires_at: za(10), accepted_at: null };

describe("kodPozvanky", () => {
  it("první pozvání dostane čerstvý kód", () => {
    expect(kodPozvanky(null, "a@b.cz", TED, () => "NOVY")).toEqual({ token: "NOVY", zachovany: false });
    expect(kodPozvanky(undefined, "a@b.cz", TED, () => "NOVY").token).toBe("NOVY");
  });

  it("čekající pozvánka si kód nechává – opakované kliknutí ho nemění", () => {
    const novy = vi.fn(() => "NOVY");
    expect(kodPozvanky(ceka, "a@b.cz", TED, novy)).toEqual({ token: "STARY-KOD", zachovany: true });
    expect(novy).not.toHaveBeenCalled();
  });

  it("šest kliknutí za sebou dá šestkrát tentýž kód", () => {
    let n = 0;
    const kody = Array.from({ length: 6 }, () => kodPozvanky(ceka, "a@b.cz", TED, () => `NOVY-${++n}`).token);
    expect(new Set(kody)).toEqual(new Set(["STARY-KOD"]));
  });

  it("propadlá pozvánka dostane nový kód", () => {
    const propadla = { ...ceka, expires_at: za(-1) };
    expect(kodPozvanky(propadla, "a@b.cz", TED, () => "NOVY")).toEqual({ token: "NOVY", zachovany: false });
  });

  it("platnost přesně teď už neplatí", () => {
    expect(kodPozvanky({ ...ceka, expires_at: TED.toISOString() }, "a@b.cz", TED, () => "NOVY").zachovany).toBe(false);
  });

  it("už přijatá pozvánka (pozvání po odebrání z týmu) dostane nový kód", () => {
    const prijata = { ...ceka, accepted_at: za(-3) };
    expect(kodPozvanky(prijata, "a@b.cz", TED, () => "NOVY")).toEqual({ token: "NOVY", zachovany: false });
  });

  it("pozvánka bez e-mailu si nikdy nepřevezme cizí kód", () => {
    expect(kodPozvanky(ceka, "", TED, () => "NOVY").token).toBe("NOVY");
    expect(kodPozvanky(ceka, "   ", TED, () => "NOVY").token).toBe("NOVY");
  });

  it("poškozený záznam (chybí kód nebo platnost) se bere jako nepoužitelný", () => {
    expect(kodPozvanky({ ...ceka, token: null }, "a@b.cz", TED, () => "NOVY").token).toBe("NOVY");
    expect(kodPozvanky({ ...ceka, token: "  " }, "a@b.cz", TED, () => "NOVY").token).toBe("NOVY");
    expect(kodPozvanky({ ...ceka, expires_at: null }, "a@b.cz", TED, () => "NOVY").token).toBe("NOVY");
  });
});
