import { afterEach, describe, expect, it, vi } from "vitest";
import { jeTestovaciEmail, resendFetch } from "../../supabase/functions/_shared/resend";

describe("testovací adresy se přes Resend neposílají", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("pozná testovací domény (RFC 2606) i se jménem", () => {
    for (const a of ["e2e@jobi.test", "x@foo.example", "a@b.invalid", "dev@localhost", "jan@example.com", "Jan <jan@EXAMPLE.org>", "x@sub.jobi.test."]) {
      expect(jeTestovaciEmail(a), a).toBe(true);
    }
    for (const a of ["jan@gmail.com", "servis@iswap.cz", "hlidac@appjobi.com", "x@testy.cz", "x@example.com.cz", "", null]) {
      expect(jeTestovaciEmail(a), String(a)).toBe(false);
    }
  });

  it("jen testovací příjemce → Resend se nevolá, vrátí se 200", async () => {
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    const r = await resendFetch({ method: "POST", body: JSON.stringify({ to: ["e2e-pozvany@jobi.test"], subject: "x" }) });
    expect(f).not.toHaveBeenCalled();
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ id: null, skipped: "test" });
  });

  it("smíšení příjemci → testovací se vyřadí, zbytek odejde", async () => {
    const f = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", f);
    await resendFetch({ method: "POST", body: JSON.stringify({ to: ["a@jobi.test", "jan@gmail.com"], bcc: ["b@example.com"], subject: "x" }) });
    const telo = JSON.parse((f.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(telo.to).toEqual(["jan@gmail.com"]);
    expect(telo.bcc).toEqual([]);
  });
});
