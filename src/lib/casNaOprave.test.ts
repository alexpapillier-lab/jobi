import { describe, expect, it } from "vitest";
import { delkaSekund, formatDelka } from "./casNaOprave";

describe("čas na opravě", () => {
  it("délka úseku a formát", () => {
    expect(delkaSekund({ started_at: "2026-09-06T10:00:00Z", ended_at: "2026-09-06T11:05:30Z" })).toBe(3930);
    expect(delkaSekund({ started_at: "2026-09-06T10:00:00Z", ended_at: null }, Date.parse("2026-09-06T10:12:00Z"))).toBe(720);
    expect(formatDelka(3930)).toBe("1 h 06 min");
    expect(formatDelka(720)).toBe("12 min");
    expect(formatDelka(0)).toBe("0 min");
  });
});
