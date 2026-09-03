/**
 * Obsazenost míst v Owner obrazovce.
 * Hlídá hlavně české skloňování a chování u plánu bez limitu.
 */
import { describe, it, expect } from "vitest";
import { clenoveTvar, obsazenostText, jeLimitPlny } from "./obsazenostMist";

describe("clenoveTvar", () => {
  it("skloňuje podle počtu", () => {
    expect(clenoveTvar(1)).toBe("1 člen");
    expect(clenoveTvar(2)).toBe("2 členové");
    expect(clenoveTvar(4)).toBe("4 členové");
    expect(clenoveTvar(5)).toBe("5 členů");
    expect(clenoveTvar(11)).toBe("11 členů");
  });

  it("zvládne nulu", () => {
    expect(clenoveTvar(0)).toBe("0 členů");
  });
});

describe("obsazenostText", () => {
  it("u plánu s limitem ukáže obsazenost", () => {
    expect(obsazenostText({ member_count: 3, seat_limit: 6 })).toBe("3 / 6 členů");
  });

  it("u plánu bez omezení ukáže jen počet", () => {
    expect(obsazenostText({ member_count: 3, seat_limit: null })).toBe("3 členové");
    expect(obsazenostText({ member_count: 8 })).toBe("8 členů");
  });

  it("bez známého počtu neukáže nic", () => {
    expect(obsazenostText({})).toBeNull();
    expect(obsazenostText({ seat_limit: 6 })).toBeNull();
  });
});

describe("jeLimitPlny", () => {
  it("pozná vyčerpaný limit", () => {
    expect(jeLimitPlny({ member_count: 6, seat_limit: 6 })).toBe(true);
    expect(jeLimitPlny({ member_count: 5, seat_limit: 6 })).toBe(false);
  });

  it("pozná i překročení po downgradu plánu", () => {
    expect(jeLimitPlny({ member_count: 9, seat_limit: 6 })).toBe(true);
  });

  it("plán bez omezení není nikdy plný", () => {
    expect(jeLimitPlny({ member_count: 50, seat_limit: null })).toBe(false);
    expect(jeLimitPlny({ member_count: 50 })).toBe(false);
  });
});
