import { describe, expect, it } from "vitest";
import { MAX_VYLOUCENYCH_OPRAV, seznamVyloucenych, textVyloucenych } from "./provizeVylouceneOpravy";

describe("seznamVyloucenych", () => {
  it("rozdělí řádku na slova a ořeže mezery", () => {
    expect(seznamVyloucenych("tělo, baterie")).toEqual(["tělo", "baterie"]);
    expect(seznamVyloucenych("  tělo ,baterie  ")).toEqual(["tělo", "baterie"]);
  });

  it("prázdný vstup dá prázdný seznam", () => {
    expect(seznamVyloucenych("")).toEqual([]);
    expect(seznamVyloucenych("   ")).toEqual([]);
  });

  it("zahodí prázdné kusy mezi čárkami", () => {
    // Prázdné slovo by jako podřetězec sedlo na každou opravu a vyřadilo vše.
    expect(seznamVyloucenych("tělo,,baterie,")).toEqual(["tělo", "baterie"]);
    expect(seznamVyloucenych(",,,")).toEqual([]);
  });

  it("vyhodí duplicity bez ohledu na velikost písmen", () => {
    expect(seznamVyloucenych("Tělo, tělo, TĚLO, baterie")).toEqual(["Tělo", "baterie"]);
  });

  it("nechá víceslovné názvy vcelku", () => {
    expect(seznamVyloucenych("výměna těla, výměna baterie")).toEqual(["výměna těla", "výměna baterie"]);
  });

  it("uřízne seznam na maximu", () => {
    const vstup = Array.from({ length: MAX_VYLOUCENYCH_OPRAV + 5 }, (_, i) => `oprava ${i}`).join(", ");
    expect(seznamVyloucenych(vstup)).toHaveLength(MAX_VYLOUCENYCH_OPRAV);
  });
});

describe("textVyloucenych", () => {
  it("složí seznam zpátky do řádky", () => {
    expect(textVyloucenych(["tělo", "baterie"])).toBe("tělo, baterie");
  });

  it("NULL z databáze i prázdný seznam dají prázdnou řádku", () => {
    expect(textVyloucenych(null)).toBe("");
    expect(textVyloucenych(undefined)).toBe("");
    expect(textVyloucenych([])).toBe("");
  });

  it("přeskočí prázdné položky", () => {
    expect(textVyloucenych(["tělo", "  ", "baterie"])).toBe("tělo, baterie");
  });

  it("projde tam a zpátky beze změny", () => {
    const radka = "tělo, baterie, výměna motoru";
    expect(textVyloucenych(seznamVyloucenych(radka))).toBe(radka);
  });
});
