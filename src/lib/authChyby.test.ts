import { describe, it, expect } from "vitest";
import { prelozAuthChybu } from "./authChyby";

/**
 * První věta, kterou nový zákazník v Jobi uvidí, když se přepíše v hesle.
 * Do teď to byla anglická hláška ze Supabase („Invalid login credentials“) –
 * a u obsazeného e-mailu dokonce taková, ze které nebylo poznat, že se má
 * místo zakládání účtu přihlásit.
 */
describe("prelozAuthChybu", () => {
  it("špatné heslo je česky a neprozrazuje, jestli účet existuje", () => {
    expect(prelozAuthChybu({ error_code: "invalid_credentials", message: "Invalid login credentials" })).toBe(
      "Špatný e-mail nebo heslo.",
    );
  });

  it("obsazený e-mail rovnou říká, co dělat dál", () => {
    const h = prelozAuthChybu({ error_code: "user_already_exists", message: "User already registered" });
    expect(h).toContain("už existuje");
    expect(h).toContain("Přihlaste se");
  });

  it("krátké heslo řekne, kolik znaků je potřeba", () => {
    expect(prelozAuthChybu({ error_code: "weak_password", message: "Password should be at least 6 characters." })).toContain(
      "6 znaků",
    );
  });

  it("starší odpověď bez kódu se pozná podle textu", () => {
    expect(prelozAuthChybu({ message: "Invalid login credentials" })).toBe("Špatný e-mail nebo heslo.");
    expect(prelozAuthChybu({ message: "User already registered" })).toContain("už existuje");
  });

  it("výpadek sítě není chyba hesla a nemá se tak tvářit", () => {
    expect(prelozAuthChybu({ message: "Failed to fetch" })).toContain("připojení k internetu");
  });

  it("česká hláška z edge funkce Jobi projde beze změny", () => {
    expect(prelozAuthChybu({ message: "Máte už 3 servisy. Další vám na požádání založíme." })).toBe(
      "Máte už 3 servisy. Další vám na požádání založíme.",
    );
  });

  it("neznámou anglickou chybu nezahodí – podpora podle ní hledá", () => {
    const h = prelozAuthChybu({ message: "Something exploded upstream" });
    expect(h).toContain("Something exploded upstream");
    expect(h).toContain("Přihlášení se nepodařilo.");
  });

  it("chybějící chyba dá záložní větu, ne prázdno", () => {
    expect(prelozAuthChybu(null)).toBe("Přihlášení se nepodařilo.");
    expect(prelozAuthChybu(undefined, "Účet se nepodařilo založit.")).toBe("Účet se nepodařilo založit.");
    expect(prelozAuthChybu({ message: "" }, "Účet se nepodařilo založit.")).toBe("Účet se nepodařilo založit.");
  });

  it("kód `code` místo `error_code` funguje taky – Supabase posílá obojí", () => {
    expect(prelozAuthChybu({ code: "invalid_credentials" })).toBe("Špatný e-mail nebo heslo.");
  });

  it("číselný `code` (HTTP status) se za chybový kód nepovažuje", () => {
    // 422 by jinak trefilo klíč „422" a vrátilo undefined – hláška by zmizela.
    expect(prelozAuthChybu({ code: 422, message: "User already registered" })).toContain("už existuje");
  });
});
