/**
 * Data a druhy dokladů.
 *
 * Splatnost je datum, do kterého zákazník musí zaplatit – když se spočítá
 * o den vedle, upomíná servis zbytečně, nebo naopak upomene pozdě a přijde
 * o úroky. Přes přelom měsíce a roku se to plete nejsnáz.
 *
 * Počet dní po splatnosti pak rozhoduje o tom, co servis vidí v seznamu
 * jako „dlužné“, a číselné tvary („3 faktury“, „1 den“) jsou to, co pak
 * čte zákazník v upomínce.
 */
import { describe, it, expect } from "vitest";
import {
  addDaysIso,
  asKind,
  asStatus,
  asZpusobPlatby,
  daysOverdue,
  formatDate,
  formatDateTime,
  matchesFilter,
  matchesKind,
  pluralDny,
  pluralFaktury,
  todayIso,
  vystavenoText,
  UNPAID_STATUSES,
  STATUS_LABELS,
  KIND_PREFIX,
  type Invoice,
} from "./types";

const faktura = (o: Record<string, unknown>) => o as unknown as Invoice;

describe("datum splatnosti", () => {
  it("čtrnáctidenní splatnost přeteče do dalšího měsíce správně", () => {
    expect(addDaysIso("2026-01-31", 14)).toBe("2026-02-14");
    expect(addDaysIso("2026-02-20", 14)).toBe("2026-03-06");
  });

  it("splatnost přes Silvestra spadne do dalšího roku", () => {
    expect(addDaysIso("2026-12-20", 14)).toBe("2027-01-03");
  });

  it("v přestupném roce existuje 29. únor", () => {
    expect(addDaysIso("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDaysIso("2026-02-28", 1)).toBe("2026-03-01");
  });

  it("posun přes změnu času neukousne ani nepřidá den", () => {
    // poslední březnová neděle = přechod na letní čas
    expect(addDaysIso("2026-03-28", 3)).toBe("2026-03-31");
    expect(addDaysIso("2026-10-24", 3)).toBe("2026-10-27");
  });

  it("splatnost ihned je den vystavení, ne den následující", () => {
    expect(addDaysIso("2026-05-10", 0)).toBe("2026-05-10");
  });

  it("dny se dají odečíst, například u zpětně vystaveného dokladu", () => {
    expect(addDaysIso("2026-01-01", -1)).toBe("2025-12-31");
  });

  it("měsíc i den mají vždy dvě číslice, jinak by databáze datum nepřijala", () => {
    expect(addDaysIso("2026-01-01", 8)).toBe("2026-01-09");
    expect(/^\d{4}-\d{2}-\d{2}$/.test(addDaysIso("2026-09-01", 5))).toBe(true);
    expect(/^\d{4}-\d{2}-\d{2}$/.test(todayIso())).toBe(true);
  });
});

describe("po splatnosti", () => {
  it("v den splatnosti ještě není faktura po splatnosti", () => {
    expect(daysOverdue("2026-05-10", "2026-05-10")).toBe(0);
    expect(daysOverdue("2026-05-10", "2026-05-09")).toBe(0);
  });

  it("den po splatnosti je jeden den, ne nula ani dva", () => {
    expect(daysOverdue("2026-05-10", "2026-05-11")).toBe(1);
    expect(daysOverdue("2026-05-10", "2026-06-09")).toBe(30);
  });

  it("počítá i přes přelom roku a přes změnu času", () => {
    expect(daysOverdue("2025-12-28", "2026-01-04")).toBe(7);
    expect(daysOverdue("2026-03-27", "2026-04-03")).toBe(7);
  });

  it("faktura bez data splatnosti není po splatnosti", () => {
    expect(daysOverdue(null)).toBe(0);
    expect(daysOverdue(undefined)).toBe(0);
    expect(daysOverdue("")).toBe(0);
  });

  it("zvládne i datum s časem, jak ho vrací databáze", () => {
    expect(daysOverdue("2026-05-10T00:00:00+02:00", "2026-05-12")).toBe(2);
  });
});

describe("české formáty data", () => {
  it("datum se tiskne po česku s tečkami", () => {
    expect(formatDate("2026-01-05T12:00:00")).toBe("5. 1. 2026");
    expect(formatDateTime("2026-01-05T14:03:00")).toBe("5. 1. 2026 14:03");
  });

  it("prázdné datum se netiskne jako „Invalid Date“", () => {
    expect(formatDate(null)).toBe("");
    expect(formatDate(undefined)).toBe("");
    expect(formatDateTime(null)).toBe("");
  });

  it("nesrozumitelnou hodnotu vypíše, jak přišla – lepší než „Invalid Date“ na faktuře", () => {
    expect(formatDate("nevím")).toBe("nevím");
  });
});

describe("druh dokladu", () => {
  it("starší doklad bez druhu je faktura, ne prázdno", () => {
    expect(asKind(null)).toBe("invoice");
    expect(asKind(undefined)).toBe("invoice");
    // starší řádky sloupec kind nemají vůbec – v databázi je tam null
    expect(asKind({ kind: null as unknown as string })).toBe("invoice");
    expect(asKind({ kind: "nesmysl" })).toBe("invoice");
    expect(asKind({ kind: "credit_note" })).toBe("credit_note");
  });

  it("každý druh má vlastní předponu, aby se řady čísel nemíchaly", () => {
    const predpony = Object.values(KIND_PREFIX);
    expect(new Set(predpony).size).toBe(predpony.length);
  });

  it("hlášku o vystavení skloňuje podle druhu dokladu", () => {
    expect(vystavenoText("invoice", "FV2026-1")).toBe("Faktura FV2026-1 vystavena");
    expect(vystavenoText("proforma", "ZF2026-1")).toBe("Zálohová faktura ZF2026-1 vystavena");
    expect(vystavenoText("credit_note", "DB2026-1")).toBe("Dobropis DB2026-1 vystaven");
  });
});

describe("filtry seznamu dokladů", () => {
  it("„čeká na zaplacení“ zahrnuje vystavené i odeslané – pro servis je to jedna hromádka", () => {
    expect(matchesFilter(faktura({ status: "issued" }), "issued")).toBe(true);
    expect(matchesFilter(faktura({ status: "sent" }), "issued")).toBe(true);
    expect(matchesFilter(faktura({ status: "paid" }), "issued")).toBe(false);
    expect(matchesFilter(faktura({ status: "draft" }), "issued")).toBe(false);
  });

  it("filtr „vše“ nic neschová, ani stornované doklady", () => {
    for (const s of ["draft", "issued", "sent", "paid", "overdue", "cancelled"]) {
      expect(matchesFilter(faktura({ status: s }), "all")).toBe(true);
    }
  });

  it("nezaplacené stavy nezahrnují zaplacené ani stornované", () => {
    expect(UNPAID_STATUSES).not.toContain("paid");
    expect(UNPAID_STATUSES).not.toContain("cancelled");
    expect(UNPAID_STATUSES).not.toContain("draft");
  });

  it("filtr druhu pustí starý doklad bez druhu mezi faktury", () => {
    expect(matchesKind(faktura({ kind: null }), "invoice")).toBe(true);
    expect(matchesKind(faktura({ kind: null }), "credit_note")).toBe(false);
    expect(matchesKind(faktura({ kind: "proforma" }), "all")).toBe(true);
  });

  it("neznámý stav z databáze spadne do konceptů, ne mimo seznam", () => {
    expect(asStatus("neco_noveho")).toBe("draft");
    expect(asStatus("paid")).toBe("paid");
    expect(Object.keys(STATUS_LABELS)).toContain(asStatus("cokoliv"));
  });
});

describe("způsob platby", () => {
  it("bere jen známé způsoby, cokoliv jiného je „nevyplněno“", () => {
    expect(asZpusobPlatby("cash")).toBe("cash");
    expect(asZpusobPlatby("transfer")).toBe("transfer");
    expect(asZpusobPlatby("bitcoin")).toBeNull();
    expect(asZpusobPlatby(null)).toBeNull();
    expect(asZpusobPlatby(undefined)).toBeNull();
  });
});

describe("české tvary počtů", () => {
  it("faktury se skloňují podle počtu", () => {
    expect(pluralFaktury(0)).toBe("0 faktur");
    expect(pluralFaktury(1)).toBe("1 faktura");
    expect(pluralFaktury(2)).toBe("2 faktury");
    expect(pluralFaktury(4)).toBe("4 faktury");
    expect(pluralFaktury(5)).toBe("5 faktur");
    expect(pluralFaktury(12)).toBe("12 faktur");
  });

  it("dny po splatnosti se skloňují podle počtu", () => {
    expect(pluralDny(1)).toBe("1 den");
    expect(pluralDny(2)).toBe("2 dny");
    expect(pluralDny(4)).toBe("4 dny");
    expect(pluralDny(5)).toBe("5 dní");
    expect(pluralDny(21)).toBe("21 dní");
  });
});
