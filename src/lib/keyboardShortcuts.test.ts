import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Testy běží v Node bez DOM; modul potřebuje jen localStorage a window.dispatchEvent.
vi.hoisted(() => {
  const store = new Map<string, string>();
  const g = globalThis as unknown as Record<string, unknown>;
  g.localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v); },
    removeItem: (k: string) => { store.delete(k); },
  };
  g.CustomEvent = class { constructor(public type: string) {} };
  g.window = { addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => true };
});

import {
  registerShortcut,
  resetShortcutHandlers,
  pickHandler,
  shortcutConflicts,
  shortcutIdsUsing,
  setShortcut,
  resetShortcuts,
  comboMatchesEvent,
  DEFAULT_SHORTCUTS,
} from "./keyboardShortcuts";

/** Náhrada za KeyboardEvent – porovnávání čte jen klávesu a modifikátory. */
function key(init: { key: string; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean; shiftKey?: boolean }): KeyboardEvent {
  return { ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...init } as KeyboardEvent;
}

describe("dispečink zkratek", () => {
  beforeEach(() => {
    resetShortcutHandlers();
    resetShortcuts();
  });
  afterEach(() => {
    resetShortcutHandlers();
    resetShortcuts();
  });

  it("K spustí obsluhu Kalendáře", () => {
    let ran = 0;
    registerShortcut("nav_calendar", () => { ran += 1; });
    const h = pickHandler(key({ key: "k" }), false);
    expect(h).not.toBeNull();
    h!.run(key({ key: "k" }));
    expect(ran).toBe(1);
  });

  it("velké K (Shift) není zkratka pro malé k", () => {
    registerShortcut("nav_calendar", () => {});
    expect(pickHandler(key({ key: "K", shiftKey: true }), false)).toBeNull();
  });

  it("obsluha stránky má přednost před globální navigací", () => {
    const poradi: string[] = [];
    registerShortcut("nav_calendar", () => poradi.push("nav"), { priority: 0 });
    registerShortcut("nav_calendar", () => poradi.push("stranka"), { priority: 10 });
    pickHandler(key({ key: "k" }), false)!.run(key({ key: "k" }));
    expect(poradi).toEqual(["stranka"]);
  });

  it("při shodné prioritě vyhraje pozdější registrace", () => {
    const poradi: string[] = [];
    registerShortcut("nav_orders", () => poradi.push("prvni"), { priority: 10 });
    registerShortcut("nav_orders", () => poradi.push("druhy"), { priority: 10 });
    pickHandler(key({ key: "q" }), false)!.run(key({ key: "q" }));
    expect(poradi).toEqual(["druhy"]);
  });

  it("s fokusem v poli se pustí jen zkratka, která to má povolené", () => {
    registerShortcut("nav_calendar", () => {});
    registerShortcut("orders_search", () => {}, { allowInInput: true });
    expect(pickHandler(key({ key: "k" }), true)).toBeNull();
    expect(pickHandler(key({ key: "f", ctrlKey: true }), true)).not.toBeNull();
  });

  it("vypnutá obsluha se přeskočí a pustí se ta pod ní", () => {
    const poradi: string[] = [];
    registerShortcut("nav_calendar", () => poradi.push("nav"), { priority: 0 });
    registerShortcut("nav_calendar", () => poradi.push("detail"), { priority: 10, enabled: () => false });
    pickHandler(key({ key: "k" }), false)!.run(key({ key: "k" }));
    expect(poradi).toEqual(["nav"]);
  });

  it("odhlášení obsluhu odstraní", () => {
    const off = registerShortcut("nav_devices", () => {});
    expect(pickHandler(key({ key: "d" }), false)).not.toBeNull();
    off();
    expect(pickHandler(key({ key: "d" }), false)).toBeNull();
  });

  it("vlastní zkratka z nastavení se použije místo výchozí", () => {
    registerShortcut("nav_calendar", () => {});
    setShortcut("nav_calendar", "m");
    expect(pickHandler(key({ key: "k" }), false)).toBeNull();
    expect(pickHandler(key({ key: "m" }), false)).not.toBeNull();
  });

  it("výchozí zkratky se navzájem nepřebíjejí", () => {
    expect([...shortcutConflicts().keys()]).toEqual([]);
  });

  it("kolize se najde a pojmenuje", () => {
    setShortcut("nav_devices", "k");
    const konflikty = shortcutConflicts();
    expect(konflikty.get("k")).toEqual(["nav_calendar", "nav_devices"]);
    expect(shortcutIdsUsing("k", "nav_devices")).toEqual(["nav_calendar"]);
  });

  it("Tab už není výchozí zkratka – na seznamu by rozbil pohyb fokusem", () => {
    expect(Object.values(DEFAULT_SHORTCUTS)).not.toContain("Tab");
  });

  it("comboMatchesEvent nespadne na události bez klávesy", () => {
    expect(comboMatchesEvent({ } as KeyboardEvent, "k")).toBe(false);
    expect(comboMatchesEvent(key({ key: "k" }), "")).toBe(false);
  });
});
