import { describe, it, expect } from "vitest";
import { bezDuplicitnichZakazek } from "./useNacitaniZakazek";
import type { TicketEx } from "../typy";

const z = (id: string, code = id) => ({ id, code }) as unknown as TicketEx;

describe("bezDuplicitnichZakazek", () => {
  it("bez duplicit vrací tentýž seznam (žádné zbytečné překreslení)", () => {
    const s = [z("a"), z("b")];
    expect(bezDuplicitnichZakazek(s)).toBe(s);
  });
  it("zakázka založená a zároveň přišlá z realtime je v seznamu jednou – vyhrává první", () => {
    const s = [z("a", "nova"), z("b"), z("a", "ozvena")];
    expect(bezDuplicitnichZakazek(s).map((t) => t.code)).toEqual(["nova", "b"]);
  });
});
