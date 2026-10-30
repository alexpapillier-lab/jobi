import { describe, expect, it, vi } from "vitest";
import { jeCiselnePole, zapniOchranuCiselnychPoli, zpracujKolecko } from "./ciselnaPole";

const pole = (type: string, tagName = "INPUT") => ({ tagName, type, blur: vi.fn() });

describe("jeCiselnePole", () => {
  it("pozná číselné pole a nic jiného", () => {
    expect(jeCiselnePole(pole("number"))).toBe(true);
    expect(jeCiselnePole(pole("text"))).toBe(false);
    expect(jeCiselnePole(pole("number", "TEXTAREA"))).toBe(false);
    expect(jeCiselnePole(null)).toBe(false);
    expect(jeCiselnePole("number")).toBe(false);
    expect(jeCiselnePole({ tagName: "INPUT", type: "number" })).toBe(false); // bez blur()
  });
});

describe("zpracujKolecko", () => {
  it("zaostřené číselné pole pod kolečkem se odostří", () => {
    const cena = pole("number");
    expect(zpracujKolecko(cena, cena)).toBe(true);
    expect(cena.blur).toHaveBeenCalledOnce();
  });

  it("textové pole se nedotkne", () => {
    const jmeno = pole("text");
    expect(zpracujKolecko(jmeno, jmeno)).toBe(false);
    expect(jmeno.blur).not.toHaveBeenCalled();
  });

  it("kdo píše částku a točí kolečkem jinde, o zaostření nepřijde", () => {
    const cena = pole("number");
    const stranka = { tagName: "DIV", blur: vi.fn() };
    expect(zpracujKolecko(stranka, cena)).toBe(false);
    expect(cena.blur).not.toHaveBeenCalled();
  });

  it("číselné pole, které není zaostřené, se nechá být", () => {
    const cena = pole("number");
    expect(zpracujKolecko(cena, pole("number"))).toBe(false);
    expect(cena.blur).not.toHaveBeenCalled();
  });
});

describe("zapniOchranuCiselnychPoli", () => {
  function falesnyDokument(aktivni: unknown) {
    let obsluha: ((e: { target: unknown }) => void) | null = null;
    return {
      doc: {
        activeElement: aktivni,
        addEventListener: vi.fn((typ: string, fn: (e: { target: unknown }) => void) => {
          if (typ === "wheel") obsluha = fn;
        }),
        removeEventListener: vi.fn(),
      },
      kolecko: (cil: unknown) => obsluha?.({ target: cil }),
    };
  }

  it("poslouchá kolečko v zachytávací fázi a pasivně", () => {
    const { doc } = falesnyDokument(null);
    zapniOchranuCiselnychPoli(doc);
    expect(doc.addEventListener).toHaveBeenCalledWith("wheel", expect.any(Function), { passive: true, capture: true });
  });

  it("událost kolečka nad zaostřenou cenou ji odostří", () => {
    const cena = pole("number");
    const { doc, kolecko } = falesnyDokument(cena);
    zapniOchranuCiselnychPoli(doc);
    kolecko(cena);
    expect(cena.blur).toHaveBeenCalledOnce();
  });

  it("vrácená funkce ochranu vypne", () => {
    const { doc } = falesnyDokument(null);
    zapniOchranuCiselnychPoli(doc)();
    expect(doc.removeEventListener).toHaveBeenCalledWith("wheel", expect.any(Function), { capture: true });
  });
});
