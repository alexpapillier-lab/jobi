import { describe, it, expect } from "vitest";
import { textChybyFunkce } from "./edgeFunctionError";

const FN_CHYBA = "Edge Function returned a non-2xx status code";

function httpChyba(telo: string, status = 404) {
  const e = new Error(FN_CHYBA) as Error & { context: Response };
  e.context = new Response(telo, { status });
  return e;
}

describe("textChybyFunkce", () => {
  it("vrátí důvod z těla odpovědi místo obecné věty supabase-js", async () => {
    const e = httpChyba(JSON.stringify({ error: "Pozvánka nenalezena" }));
    expect(await textChybyFunkce(e, "Nepodařilo načíst pozvánku")).toBe("Pozvánka nenalezena");
  });

  it("tělo zůstane čitelné i pro další čtení", async () => {
    const e = httpChyba(JSON.stringify({ error: "Pozvánka vypršela" }), 400);
    await textChybyFunkce(e, "x");
    expect(await e.context.text()).toContain("vypršela");
  });

  it("když tělo není JSON, použije výchozí text, ne obecnou větu", async () => {
    expect(await textChybyFunkce(httpChyba("<html>502</html>", 502), "Nepodařilo načíst pozvánku"))
      .toBe("Nepodařilo načíst pozvánku");
  });

  it("tělo bez pole error se bere jako nepoužitelné", async () => {
    expect(await textChybyFunkce(httpChyba(JSON.stringify({ ok: false })), "výchozí")).toBe("výchozí");
  });

  it("běžná chyba bez odpovědi (síť) si nechá vlastní zprávu", async () => {
    expect(await textChybyFunkce(new Error("Failed to fetch"), "výchozí")).toBe("Failed to fetch");
  });

  it("nikdy nevrátí větu o non-2xx", async () => {
    expect(await textChybyFunkce(new Error(FN_CHYBA), "výchozí")).toBe("výchozí");
    expect(await textChybyFunkce(undefined, "výchozí")).toBe("výchozí");
  });
});
