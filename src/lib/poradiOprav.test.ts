import { describe, expect, it } from "vitest";
import { poradiVModelu, posunVModelu, presunVModelu, seradPodleModelu, ulozPoradiModelu, type OpravaSPoradim } from "./poradiOprav";

const r = (id: string, modelIds: string[], modelOrder?: Record<string, number>): OpravaSPoradim => ({ id, modelIds, modelOrder });
// Společný seznam [X, Q, Y, Z]: model A má X, Y, Z; model B má X, Q, Z.
const vse = [r("X", ["A", "B"]), r("Q", ["B"]), r("Y", ["A"]), r("Z", ["A", "B"])];
const ids = (xs: OpravaSPoradim[]) => xs.map((x) => x.id);

describe("pořadí oprav zvlášť pro model", () => {
  it("bez vlastního pořadí se model řadí podle společného seznamu", () => {
    expect(ids(poradiVModelu(vse, "A"))).toEqual(["X", "Y", "Z"]);
    expect(ids(poradiVModelu(vse, "B"))).toEqual(["X", "Q", "Z"]);
  });

  it("posun X pod Y u modelu A nezmění pořadí modelu B", () => {
    const nove = posunVModelu(vse, "A", poradiVModelu(vse, "A"), "X", 1)!;
    expect(ids(poradiVModelu(nove, "A"))).toEqual(["Y", "X", "Z"]);
    expect(ids(poradiVModelu(nove, "B"))).toEqual(["X", "Q", "Z"]);
    // společný seznam zůstal, jak byl
    expect(ids(nove)).toEqual(["X", "Q", "Y", "Z"]);
  });

  it("přetažení a opakované posuny drží pořadí modelu", () => {
    const a = presunVModelu(vse, "B", "Z", "X", false)!;
    expect(ids(poradiVModelu(a, "B"))).toEqual(["Z", "X", "Q"]);
    expect(ids(poradiVModelu(a, "A"))).toEqual(["X", "Y", "Z"]);
    expect(presunVModelu(a, "B", "Z", "Z", false)).toBeNull();
    const b = posunVModelu(a, "B", poradiVModelu(a, "B"), "Q", -1)!;
    expect(ids(poradiVModelu(b, "B"))).toEqual(["Z", "Q", "X"]);
  });

  it("oprava přidaná později jde na konec modelu, který už vlastní pořadí má", () => {
    const s = ulozPoradiModelu(vse, "A", ["Z", "Y", "X"]);
    const s2 = [...s, r("N", ["A"])];
    expect(ids(poradiVModelu(s2, "A"))).toEqual(["Z", "Y", "X", "N"]);
  });

  it("zařízení na víc modelů: nejlepší pozice ze shodných modelů", () => {
    const s = ulozPoradiModelu(vse, "A", ["Z", "Y", "X"]);
    expect(ids(seradPodleModelu(s, ["A"]).filter((x) => x.modelIds?.includes("A")))).toEqual(["Z", "Y", "X"]);
    expect(ids(seradPodleModelu(vse, []))).toEqual(["X", "Q", "Y", "Z"]);
  });
});
