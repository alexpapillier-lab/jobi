import { describe, it, expect, vi, afterEach } from "vitest";

// Hook potřebuje přihlášení a Supabase, tady jde jen o čtení proměnné prostředí.
vi.mock("../auth/AuthProvider", () => ({ useAuth: () => ({ session: null }) }));
vi.mock("../lib/supabaseClient", () => ({ supabase: null }));

/** Modul si id přečte při načtení, proto se pro každou hodnotu načítá znovu. */
async function nactiSId(hodnota: string | undefined) {
  vi.resetModules();
  if (hodnota === undefined) vi.stubEnv("VITE_ROOT_OWNER_ID", "");
  else vi.stubEnv("VITE_ROOT_OWNER_ID", hodnota);
  const modul = await import("./useIsRootOwner");
  return modul.getRootOwnerId();
}

afterEach(() => {
  vi.unstubAllEnvs();
});

/**
 * Majitel aplikace (root owner) vidí cizí servisy a jejich data. Rozhoduje
 * o tom jediná proražená hodnota v prostředí – když se sem propíše prázdno
 * nebo mezera, nesmí z toho vzniknout „nikdo“ v podobě prázdného řetězce,
 * který by se dal shodou náhod trefit.
 */
describe("id majitele aplikace z prostředí", () => {
  it("nenastavená proměnná znamená, že majitel aplikace není nikdo", async () => {
    expect(await nactiSId(undefined)).toBeNull();
  });

  it("prázdná hodnota nebo samé mezery se nepovažují za id", async () => {
    expect(await nactiSId("")).toBeNull();
    expect(await nactiSId("   ")).toBeNull();
    expect(await nactiSId("\n\t ")).toBeNull();
  });

  it("mezery kolem id z .env se ořežou, aby se id dalo porovnat", async () => {
    expect(await nactiSId("  7f3c1b2a-0000-4444-8888-abcdefabcdef  ")).toBe(
      "7f3c1b2a-0000-4444-8888-abcdefabcdef"
    );
  });

  it("id se vrací tak, jak je zapsané – porovnání velikosti písmen řeší hook", async () => {
    expect(await nactiSId("ABCDEF-123")).toBe("ABCDEF-123");
  });
});
