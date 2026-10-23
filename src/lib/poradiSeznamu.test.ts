import { describe, expect, it } from "vitest";
import { posunVPoradi, presunKPolozce } from "./poradiSeznamu";

const s = (ids: string) => ids.split("").map((id) => ({ id }));
const ids = (x: { id: string }[] | null) => x?.map((y) => y.id).join("") ?? null;

describe("posunVPoradi", () => {
  it("v celém seznamu prohodí se sousedem", () => {
    expect(ids(posunVPoradi(s("abcd"), s("abcd"), "c", -1))).toBe("acbd");
    expect(ids(posunVPoradi(s("abcd"), s("abcd"), "b", 1))).toBe("acbd");
  });

  it("v zúženém seznamu skočí před/za zobrazeného souseda, ostatní zůstanou", () => {
    // Model vidí jen a, c, e; b a d patří jiným modelům.
    expect(ids(posunVPoradi(s("abcde"), s("ace"), "e", -1))).toBe("abecd");
    expect(ids(posunVPoradi(s("abcde"), s("ace"), "a", 1))).toBe("bcade");
  });

  it("na kraji nebo neznámé id = nic", () => {
    expect(posunVPoradi(s("abc"), s("abc"), "a", -1)).toBeNull();
    expect(posunVPoradi(s("abc"), s("abc"), "c", 1)).toBeNull();
    expect(posunVPoradi(s("abc"), s("abc"), "x", 1)).toBeNull();
  });
});

describe("presunKPolozce (přetažení)", () => {
  it("před i za cíl, ostatní zůstanou", () => {
    expect(ids(presunKPolozce(s("abcde"), "e", "b", false))).toBe("aebcd");
    expect(ids(presunKPolozce(s("abcde"), "a", "c", true))).toBe("bcade");
  });
  it("na sebe nebo na stejné místo = nic", () => {
    expect(presunKPolozce(s("abc"), "b", "b", true)).toBeNull();
    expect(presunKPolozce(s("abc"), "b", "c", false)).toBeNull();
    expect(presunKPolozce(s("abc"), "b", "a", true)).toBeNull();
  });
});
