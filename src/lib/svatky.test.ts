import { describe, expect, it } from "vitest";
import { jePracovniDenCz, jeStatniSvatekCz, velikonocniNedele } from "../../supabase/functions/_shared/svatky";
import { dnySvozu } from "../../supabase/functions/_shared/dpd";

describe("české státní svátky", () => {
  it("pevné svátky", () => {
    expect(jeStatniSvatekCz("2026-11-17")).toBe(true);
    expect(jeStatniSvatekCz("2026-12-24")).toBe(true);
    expect(jeStatniSvatekCz("2026-07-06")).toBe(true);
    expect(jeStatniSvatekCz("2026-11-18")).toBe(false);
  });

  it("Velikonoce: neděle, Velký pátek a pondělí", () => {
    expect(velikonocniNedele(2026).toISOString().slice(0, 10)).toBe("2026-04-05");
    expect(velikonocniNedele(2027).toISOString().slice(0, 10)).toBe("2027-03-28");
    expect(jeStatniSvatekCz("2026-04-03")).toBe(true);
    expect(jeStatniSvatekCz("2026-04-06")).toBe(true);
    expect(jeStatniSvatekCz("2026-04-07")).toBe(false);
  });

  it("pracovní den: bez víkendu a svátku", () => {
    expect(jePracovniDenCz("2026-11-16")).toBe(true);
    expect(jePracovniDenCz("2026-11-17")).toBe(false);
    expect(jePracovniDenCz("2026-11-21")).toBe(false);
  });

  it("svoz „co nejdřív“ přeskočí svátek 17. 11. (dřív se na něj objednal kurýr)", () => {
    expect(dnySvozu(new Date("2026-11-16T14:15:00Z"))).toEqual(["2026-11-16", "2026-11-18", "2026-11-19", "2026-11-20"]);
    // Vánoce: 24.–26. 12. a víkend 26.–27. 12. 2026.
    expect(dnySvozu(new Date("2026-12-23T10:00:00Z"), 3)).toEqual(["2026-12-23", "2026-12-28", "2026-12-29"]);
  });
});
