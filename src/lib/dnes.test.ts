import { describe, it, expect } from "vitest";
import {
  dnuOd,
  jeDnes,
  mapujRezervaciDnes,
  mapujZakazkuDnes,
  roztridDnes,
  rozpoznejRoleStavu,
  vychoziRozsah,
  zakazkySDilemNaCeste,
  type RezervaceDnes,
  type StavDnes,
  type ZakazkaDnes,
} from "./dnes";

/** Výchozí stavy nového servisu (statuses-init-defaults). */
const VYCHOZI: StavDnes[] = [
  { key: "received", label: "Přijato", isFinal: false },
  { key: "diagnosis", label: "Diagnostika", isFinal: false },
  { key: "repair", label: "Oprava", isFinal: false },
  { key: "testing", label: "Testování", isFinal: false },
  { key: "ready", label: "Připraveno", isFinal: false },
  { key: "completed", label: "Dokončeno", isFinal: true },
  { key: "cancelled", label: "Zrušeno", isFinal: true },
];

/** Servis s vlastními stavy (jako iSwap po importu ze Zakázkového listu). */
const VLASTNI: StavDnes[] = [
  { key: "prijato", label: "Přijato", isFinal: false },
  { key: "v_dilne", label: "V dílně", isFinal: false },
  { key: "waiting_part", label: "Čeká na díl", isFinal: false },
  { key: "waiting_customer", label: "Čeká na zákazníka", isFinal: false },
  { key: "ready_for_pickup", label: "Připraveno k převzetí", isFinal: false },
  { key: "vydano", label: "Vydáno", isFinal: true },
];

const TED = new Date(2026, 8, 27, 10, 0); // 27. 9. 2026 10:00 místního času
const iso = (d: number, h = 12, m = 0) => new Date(2026, 8, d, h, m).toISOString();

let n = 0;
function z(o: Partial<ZakazkaDnes> = {}): ZakazkaDnes {
  n += 1;
  return {
    id: o.id ?? `z${n}`,
    code: o.code ?? `SRV${String(n).padStart(4, "0")}`,
    title: "iPhone 13",
    customerName: "Jan Novák",
    status: "repair",
    createdAt: iso(20),
    updatedAt: null,
    expectedAt: null,
    assignedTo: null,
    branchId: null,
    locationBranchId: null,
    quoteStatus: null,
    ...o,
  };
}

const ids = (xs: Array<{ id: string }>) => xs.map((x) => x.id);

describe("role stavů", () => {
  it("výchozí stavy: Připraveno je k převzetí, na díl ani zákazníka nečeká nic", () => {
    const r = rozpoznejRoleStavu(VYCHOZI);
    expect([...r.kPrevzeti]).toEqual(["ready"]);
    expect(r.cekaNaDil.size).toBe(0);
    expect(r.cekaNaZakaznika.size).toBe(0);
  });

  it("vlastní stavy se poznají podle názvu i klíče; „V dílně“ není díl", () => {
    const r = rozpoznejRoleStavu(VLASTNI);
    expect([...r.kPrevzeti]).toEqual(["ready_for_pickup"]);
    expect([...r.cekaNaDil]).toEqual(["waiting_part"]);
    expect([...r.cekaNaZakaznika]).toEqual(["waiting_customer"]);
  });

  it("„Čeká na vyzvednutí zákazníkem“ je převzetí, ne čekání na zákazníka", () => {
    const r = rozpoznejRoleStavu([
      { key: "a", label: "Přijato", isFinal: false },
      { key: "b", label: "Čeká na vyzvednutí zákazníkem", isFinal: false },
      { key: "c", label: "Vydáno", isFinal: true },
    ]);
    expect([...r.kPrevzeti]).toEqual(["b"]);
    expect(r.cekaNaZakaznika.size).toBe(0);
  });

  it("bez stavu Připraveno je k převzetí poslední nekoncový stav; koncové nikdy", () => {
    const r = rozpoznejRoleStavu([
      { key: "a", label: "Nová", isFinal: false },
      { key: "b", label: "Rozpracováno", isFinal: false },
      { key: "c", label: "Opraveno", isFinal: false },
      { key: "d", label: "Připraveno", isFinal: true },
    ]);
    expect([...r.kPrevzeti]).toEqual(["c"]);
  });

  it("jediný nekoncový stav se za připravený nebere", () => {
    const r = rozpoznejRoleStavu([
      { key: "a", label: "Otevřeno", isFinal: false },
      { key: "b", label: "Uzavřeno", isFinal: true },
    ]);
    expect(r.kPrevzeti.size).toBe(0);
  });

  it("„Převzato“ (příjem od zákazníka) není připraveno k převzetí", () => {
    const r = rozpoznejRoleStavu([
      { key: "prevzato", label: "Převzato", isFinal: false },
      { key: "oprava", label: "Oprava", isFinal: false },
      { key: "hotovo", label: "Hotovo", isFinal: false },
      { key: "vydano", label: "Vydáno", isFinal: true },
    ]);
    expect([...r.kPrevzeti]).toEqual(["hotovo"]);
  });
});

describe("roztřídění do sekcí", () => {
  const zaklad = { stavy: VLASTNI, mujId: "ja", jenMoje: false, ted: TED };

  it("termíny: po termínu (i dnes ráno), dnes později, zítra nikde", () => {
    const vcera = z({ status: "v_dilne", expectedAt: iso(26, 17) });
    const dnesRano = z({ status: "v_dilne", expectedAt: iso(27, 8) });
    const dnesOdpoledne = z({ status: "v_dilne", expectedAt: iso(27, 16) });
    const zitra = z({ status: "v_dilne", expectedAt: iso(28, 9) });
    const bez = z({ status: "v_dilne" });
    const s = roztridDnes({ ...zaklad, zakazky: [zitra, dnesOdpoledne, bez, dnesRano, vcera] });
    expect(ids(s.po_terminu)).toEqual([vcera.id, dnesRano.id]);
    expect(ids(s.dnes_termin)).toEqual([dnesOdpoledne.id]);
  });

  it("vydané zakázky nejsou nikde, ani po termínu nebo přidělené", () => {
    const vydana = z({ status: "vydano", expectedAt: iso(20), assignedTo: "ja", quoteStatus: "sent" });
    const s = roztridDnes({ ...zaklad, zakazky: [vydana] });
    for (const k of ["po_terminu", "dnes_termin", "ceka_dil", "ceka_zakaznik", "k_prevzeti", "moje"] as const) expect(s[k]).toEqual([]);
  });

  it("připravená k převzetí se do termínů nepočítá – dokončená už je", () => {
    const hotova = z({ status: "ready_for_pickup", expectedAt: iso(25) });
    const s = roztridDnes({ ...zaklad, zakazky: [hotova] });
    expect(ids(s.k_prevzeti)).toEqual([hotova.id]);
    expect(s.po_terminu).toEqual([]);
  });

  it("čeká na díl podle stavu i podle objednaného dílu; po termínu zůstává i tam", () => {
    const stav = z({ status: "waiting_part" });
    const objednano = z({ status: "v_dilne", expectedAt: iso(26) });
    const s = roztridDnes({ ...zaklad, zakazky: [stav, objednano], zakazkySDilemNaCeste: new Set([objednano.id]) });
    expect(ids(s.ceka_dil).sort()).toEqual([stav.id, objednano.id].sort());
    expect(ids(s.po_terminu)).toEqual([objednano.id]);
  });

  it("čeká na zákazníka podle stavu i podle odeslané nabídky bez rozhodnutí", () => {
    const stav = z({ status: "waiting_customer" });
    const nabidka = z({ status: "v_dilne", quoteStatus: "sent" });
    const schvalena = z({ status: "v_dilne", quoteStatus: "approved" });
    const s = roztridDnes({ ...zaklad, zakazky: [stav, nabidka, schvalena] });
    expect(ids(s.ceka_zakaznik).sort()).toEqual([stav.id, nabidka.id].sort());
  });

  it("neznámý (smazaný) stav je rozpracovaný – zakázka nezmizí", () => {
    const divna = z({ status: "smazany_stav", expectedAt: iso(26) });
    expect(ids(roztridDnes({ ...zaklad, zakazky: [divna] }).po_terminu)).toEqual([divna.id]);
  });

  it("Jen moje zúží sekce na přidělené mně, Přidělené mně je vždycky jen moje", () => {
    const moje = z({ status: "v_dilne", expectedAt: iso(26), assignedTo: "ja" });
    const kolegova = z({ status: "v_dilne", expectedAt: iso(26), assignedTo: "on" });
    const nikoho = z({ status: "ready_for_pickup" });
    const tym = roztridDnes({ ...zaklad, zakazky: [moje, kolegova, nikoho] });
    expect(ids(tym.po_terminu).sort()).toEqual([moje.id, kolegova.id].sort());
    expect(ids(tym.k_prevzeti)).toEqual([nikoho.id]);
    expect(ids(tym.moje)).toEqual([moje.id]);
    const jen = roztridDnes({ ...zaklad, jenMoje: true, zakazky: [moje, kolegova, nikoho] });
    expect(ids(jen.po_terminu)).toEqual([moje.id]);
    expect(jen.k_prevzeti).toEqual([]);
    expect(ids(jen.moje)).toEqual([moje.id]);
  });

  it("bez přihlášeného uživatele nic „moje“ není", () => {
    const s = roztridDnes({ ...zaklad, mujId: null, zakazky: [z({ assignedTo: null })] });
    expect(s.moje).toEqual([]);
  });
});

describe("řazení", () => {
  const zaklad = { stavy: VLASTNI, mujId: "ja", jenMoje: false, ted: TED };

  it("přidělené mně: podle termínu, bez termínu na konec podle příjmu", () => {
    const pozdeji = z({ assignedTo: "ja", status: "v_dilne", expectedAt: iso(30) });
    const driv = z({ assignedTo: "ja", status: "v_dilne", expectedAt: iso(28) });
    const bezStarsi = z({ assignedTo: "ja", status: "v_dilne", createdAt: iso(10) });
    const bezNovejsi = z({ assignedTo: "ja", status: "v_dilne", createdAt: iso(15) });
    const s = roztridDnes({ ...zaklad, zakazky: [bezNovejsi, pozdeji, bezStarsi, driv] });
    expect(ids(s.moje)).toEqual([driv.id, pozdeji.id, bezStarsi.id, bezNovejsi.id]);
  });

  it("k převzetí a čekající: nejdéle ležící nahoře (poslední změna, jinak příjem)", () => {
    const vcera = z({ status: "ready_for_pickup", updatedAt: iso(26) });
    const tydenStara = z({ status: "ready_for_pickup", updatedAt: iso(20) });
    const bezZmeny = z({ status: "ready_for_pickup", createdAt: iso(22) });
    const s = roztridDnes({ ...zaklad, zakazky: [vcera, bezZmeny, tydenStara] });
    expect(ids(s.k_prevzeti)).toEqual([tydenStara.id, bezZmeny.id, vcera.id]);
  });

  it("shoda se rozhodne číslem zakázky – pořadí se mezi obnoveními nepřehazuje", () => {
    const b = z({ code: "B2", status: "v_dilne", expectedAt: iso(26), createdAt: iso(20) });
    const a = z({ code: "A1", status: "v_dilne", expectedAt: iso(26), createdAt: iso(20) });
    expect(ids(roztridDnes({ ...zaklad, zakazky: [b, a] }).po_terminu)).toEqual([a.id, b.id]);
  });
});

describe("dnešní rezervace", () => {
  const r = (o: Partial<RezervaceDnes>): RezervaceDnes => ({ id: `r${++n}`, status: "new", customerName: "Eva", deviceLabel: "iPhone", repairName: null, preferredAt: null, ticketId: null, ...o });

  it("jen otevřené na dnešek, podle času", () => {
    const odpoledne = r({ preferredAt: iso(27, 15) });
    const rano = r({ preferredAt: iso(27, 9), status: "confirmed" });
    const zitra = r({ preferredAt: iso(28, 9) });
    const zrusena = r({ preferredAt: iso(27, 11), status: "cancelled" });
    const prevedena = r({ preferredAt: iso(27, 12), status: "converted" });
    const kdykoliv = r({ preferredAt: null });
    const s = roztridDnes({ zakazky: [], stavy: VYCHOZI, mujId: null, jenMoje: false, ted: TED, rezervace: [odpoledne, zitra, zrusena, rano, prevedena, kdykoliv] });
    expect(ids(s.rezervace)).toEqual([rano.id, odpoledne.id]);
  });
});

describe("pomocné", () => {
  it("výchozí rozsah: uložená volba, jinak podle přidělených; bez přidělování vždy tým", () => {
    expect(vychoziRozsah(undefined, 3, true)).toBe("moje");
    expect(vychoziRozsah(undefined, 0, true)).toBe("tym");
    expect(vychoziRozsah("tym", 3, true)).toBe("tym");
    expect(vychoziRozsah("moje", 0, true)).toBe("moje");
    expect(vychoziRozsah("moje", 5, false)).toBe("tym");
    expect(vychoziRozsah("nesmysl", 0, true)).toBe("tym");
  });

  it("díl na cestě: jen návrh a objednaná, nepřijatá, s vazbou na zakázku", () => {
    const s = zakazkySDilemNaCeste([
      { ticketId: "a", qty: 1, receivedQty: 0, orderStatus: "ordered" },
      { ticketId: "b", qty: 2, receivedQty: 1, orderStatus: "draft" },
      { ticketId: "c", qty: 1, receivedQty: 1, orderStatus: "ordered" },
      { ticketId: "d", qty: 1, receivedQty: 0, orderStatus: "received" },
      { ticketId: "e", qty: 1, receivedQty: 0, orderStatus: "cancelled" },
      { ticketId: null, qty: 1, receivedQty: 0, orderStatus: "ordered" },
    ]);
    expect([...s].sort()).toEqual(["a", "b"]);
  });

  it("jeDnes a dnuOd v místním čase", () => {
    expect(jeDnes(iso(27, 0, 1), TED)).toBe(true);
    expect(jeDnes(iso(27, 23, 59), TED)).toBe(true);
    expect(jeDnes(iso(28, 0, 0), TED)).toBe(false);
    expect(jeDnes(null, TED)).toBe(false);
    expect(dnuOd(iso(27, 9), TED)).toBe(0);
    expect(dnuOd(iso(24, 23), TED)).toBe(3);
  });

  it("mapování řádků snese chybějící sloupce", () => {
    const zz = mapujZakazkuDnes({ id: "x", status: "ready", expected_completion_at: null });
    expect(zz).toMatchObject({ id: "x", status: "ready", expectedAt: null, quoteStatus: null, title: "Zařízení", customerName: "" });
    const rr = mapujRezervaciDnes({ id: "r", customer_name: "Eva", preferred_at: "2026-09-27T08:00:00Z" });
    expect(rr).toMatchObject({ id: "r", status: "new", customerName: "Eva", ticketId: null });
  });
});
