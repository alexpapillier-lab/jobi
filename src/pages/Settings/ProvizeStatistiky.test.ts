/** Provize po měsících – podklad grafu v Owner → Provize. */
import { describe, expect, it } from "vitest";
import { poMesicich, type StatPolozka } from "./ProvizeStatistiky";

const p = (zapsano_at: string, provize: number, o: Partial<StatPolozka> = {}): StatPolozka => ({ poradi: 0, zaklad: provize / 0.075, provize, zapsano_at, vyrazeno: false, vyuctovani_id: null, ...o });

describe("poMesicich", () => {
  const ted = new Date(2026, 8, 18); // 18. 9. 2026

  it("vrátí posledních 12 měsíců včetně prázdných, nejnovější poslední", () => {
    const m = poMesicich([], ted);
    expect(m).toHaveLength(12);
    expect(m[0].klic).toBe("2025-10");
    expect(m[11].klic).toBe("2026-09");
    expect(m.every((x) => x.provize === 0)).toBe(true);
  });

  it("sčítá provize v měsíci, doplatek nepočítá jako další zakázku a vyřazené vynechá", () => {
    const m = poMesicich(
      [p("2026-09-02T10:00:00Z", 100), p("2026-09-10T10:00:00Z", 50, { poradi: 1 }), p("2026-09-11T10:00:00Z", 999, { vyrazeno: true }), p("2026-08-30T10:00:00Z", 70), p("2024-01-01T10:00:00Z", 500)],
      ted,
    );
    const zari = m.find((x) => x.klic === "2026-09")!;
    expect(zari.provize).toBe(150);
    expect(zari.pocet).toBe(1);
    expect(m.find((x) => x.klic === "2026-08")!.provize).toBe(70);
    expect(m.reduce((s, x) => s + x.provize, 0)).toBe(220); // rok 2024 je mimo okno
  });
});

describe("ruční a měsíční řádky nejsou zakázky", () => {
  it("do počtu zakázek za měsíc nepatří, provize se ale sčítá", () => {
    const ted = new Date(2026, 10, 15);
    const m = poMesicich([p("2026-11-02T10:00:00Z", 100, { kod: "IRP26000001" }), p("2026-11-03T10:00:00Z", -6000, { kod: "RUCNI-1" }), p("2026-11-04T10:00:00Z", 326.43, { kod: "MESICNI-2026-11" })], ted, 1);
    expect(m[0].pocet).toBe(1);
    expect(m[0].provize).toBeCloseTo(100 - 6000 + 326.43, 2);
  });
});
