import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Odběr po výpadku dotáhne, co uteklo (hlášení 27. 10. 2026: „musí se dát
 * refresh“). Supabase je tu nahrazený kanálem, kterému test sám říká, v jakém
 * je stavu – jako by spojení padalo a vracelo se.
 */
type FalesnyKanal = {
  topic: string;
  stav: ((status: string) => void) | null;
  on: () => FalesnyKanal;
  subscribe: (cb: (status: string) => void) => FalesnyKanal;
};

const kanaly: FalesnyKanal[] = [];
const odebrane: string[] = [];

vi.mock("./supabaseClient", () => ({
  supabase: {
    channel(topic: string) {
      const k: FalesnyKanal = {
        topic,
        stav: null,
        on: () => k,
        subscribe: (cb) => {
          k.stav = cb;
          return k;
        },
      };
      kanaly.push(k);
      return k;
    },
    removeChannel(k: FalesnyKanal) {
      odebrane.push(k.topic);
      return Promise.resolve("ok");
    },
  },
}));

let viditelnost: "visible" | "hidden" = "visible";
let odebirejZmeny: typeof import("./zivyOdber").odebirejZmeny;
let NAVRAT_PO_MS: number;
let POJISTKA_MS: number;

beforeAll(async () => {
  vi.useFakeTimers();
  const doc = new EventTarget() as EventTarget & { visibilityState: string };
  Object.defineProperty(doc, "visibilityState", { get: () => viditelnost });
  (globalThis as any).document = doc;
  (globalThis as any).window = new EventTarget();
  ({ odebirejZmeny, NAVRAT_PO_MS, POJISTKA_MS } = await import("./zivyOdber"));
});

const zrusit: Array<() => void> = [];
afterEach(() => {
  zrusit.splice(0).forEach((f) => f());
  kanaly.length = 0;
  odebrane.length = 0;
  vi.advanceTimersByTime(10_000);
});

function odber() {
  const dotahni = vi.fn();
  zrusit.push(odebirejZmeny("tickets:s1", (k) => k, dotahni));
  return dotahni;
}

const posledni = () => kanaly[kanaly.length - 1];

describe("odebirejZmeny", () => {
  it("první přihlášení nic nedotahuje, znovupřihlášení po výpadku ano", () => {
    const dotahni = odber();
    posledni().stav!("SUBSCRIBED");
    expect(dotahni).not.toHaveBeenCalled();

    posledni().stav!("CHANNEL_ERROR");
    vi.advanceTimersByTime(6_000);
    posledni().stav!("SUBSCRIBED");
    expect(dotahni).toHaveBeenCalledWith("znovupripojeni");
  });

  it("kanál zavřený serverem se založí znovu pod jiným názvem a pak dotáhne", () => {
    const dotahni = odber();
    const prvni = posledni();
    prvni.stav!("SUBSCRIBED");
    prvni.stav!("CLOSED");
    vi.advanceTimersByTime(5_000);
    const druhy = posledni();
    expect(druhy).not.toBe(prvni);
    expect(druhy.topic).not.toBe(prvni.topic);
    expect(odebrane).toContain(prvni.topic);
    druhy.stav!("SUBSCRIBED");
    expect(dotahni).toHaveBeenCalledWith("znovupripojeni");
  });

  it("dva odběry stejné tabulky nesdílí kanál (supabase.channel vrací existující podle názvu)", () => {
    odber();
    odber();
    expect(kanaly).toHaveLength(2);
    expect(kanaly[0].topic).not.toBe(kanaly[1].topic);
  });

  it("návrat na kartu po delší době dotáhne, krátké přepnutí ne", () => {
    const dotahni = odber();
    posledni().stav!("SUBSCRIBED");

    viditelnost = "hidden";
    document.dispatchEvent(new Event("visibilitychange"));
    vi.advanceTimersByTime(2_000);
    viditelnost = "visible";
    document.dispatchEvent(new Event("visibilitychange"));
    expect(dotahni).not.toHaveBeenCalled();

    viditelnost = "hidden";
    document.dispatchEvent(new Event("visibilitychange"));
    vi.advanceTimersByTime(NAVRAT_PO_MS + 1_000);
    viditelnost = "visible";
    document.dispatchEvent(new Event("visibilitychange"));
    expect(dotahni).toHaveBeenCalledWith("navrat");
  });

  it("návrat s kanálem v chybě kanál rovnou založí znovu", () => {
    odber();
    const prvni = posledni();
    prvni.stav!("SUBSCRIBED");
    prvni.stav!("TIMED_OUT");
    window.dispatchEvent(new Event("online"));
    vi.advanceTimersByTime(1);
    expect(posledni()).not.toBe(prvni);
  });

  it("obnovení sítě dotáhne; shluk událostí jen jednou", () => {
    const dotahni = odber();
    posledni().stav!("SUBSCRIBED");
    window.dispatchEvent(new Event("online"));
    window.dispatchEvent(new Event("online"));
    expect(dotahni).toHaveBeenCalledTimes(1);
  });

  it("záložní dotažení jednou za pojistku, když je okno vidět", () => {
    const dotahni = odber();
    posledni().stav!("SUBSCRIBED");
    vi.advanceTimersByTime(POJISTKA_MS + 20_000);
    expect(dotahni).toHaveBeenCalledWith("pojistka");
    expect(dotahni.mock.calls.length).toBeLessThanOrEqual(1);
  });

  it("zrušený odběr už nic nevolá", () => {
    const dotahni = vi.fn();
    const zrus = odebirejZmeny("tickets:s1", (k) => k, dotahni);
    const k = posledni();
    k.stav!("SUBSCRIBED");
    zrus();
    k.stav!("SUBSCRIBED");
    window.dispatchEvent(new Event("online"));
    expect(dotahni).not.toHaveBeenCalled();
    expect(odebrane).toContain(k.topic);
  });
});
