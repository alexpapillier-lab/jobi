/**
 * Období pro Statistiky – čistý výpočet hranic, bez Reactu, aby se dal
 * otestovat.
 *
 * Hranice počítá prohlížeč a posílá je serveru jako dva okamžiky, takže
 * „tenhle měsíc“ znamená měsíc v pásmu, ve kterém servis stojí (u nás
 * Evropa/Praha), ne v UTC. Zakázka založená 1. ledna v 00:30 patří do ledna,
 * i když v UTC je pořád 31. prosince.
 */

export type PeriodType = "all" | "today" | "week" | "month" | "quarter" | "year" | "custom";

export type DateRange = { start: Date; end: Date };

/** Období, pro která má smysl „předchozí období“ (stejná délka, o krok dozadu). */
export const COMPARABLE_PERIODS: PeriodType[] = ["today", "week", "month", "quarter", "year"];

export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}

export function endOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
}

/** Pondělí týdne, do kterého spadá `d`. */
export function mondayOf(d: Date): Date {
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  return new Date(d.getFullYear(), d.getMonth(), diff, 0, 0, 0, 0);
}

/**
 * Datum z pole „Od“ / „Do“ (tvar RRRR-MM-DD) jako místní půlnoc.
 *
 * `new Date("2026-01-01")` je podle normy půlnoc **v UTC**. V Praze to ještě
 * vyjde na správný den, ale na počítači se západním pásmem (technik na
 * cestách, uživatel v Americe) by to byl 31. prosinec a vlastní období by
 * začínalo o den dřív. Datum z formuláře je vždycky místní.
 */
export function parseDatum(text: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(text.trim());
  if (m) {
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 0, 0, 0, 0);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(text);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function periodRange(period: PeriodType, customStart: string, customEnd: string, now: Date): DateRange | null {
  switch (period) {
    case "all":
      return null;
    case "today":
      return { start: startOfDay(now), end: endOfDay(now) };
    case "week":
      return { start: mondayOf(now), end: endOfDay(now) };
    case "month":
      return { start: new Date(now.getFullYear(), now.getMonth(), 1), end: endOfDay(now) };
    case "quarter": {
      const q = Math.floor(now.getMonth() / 3);
      return { start: new Date(now.getFullYear(), q * 3, 1), end: endOfDay(now) };
    }
    case "year":
      return { start: new Date(now.getFullYear(), 0, 1), end: endOfDay(now) };
    case "custom": {
      if (!customStart || !customEnd) return null;
      const start = parseDatum(customStart);
      const end = parseDatum(customEnd);
      if (!start || !end) return null;
      return { start: startOfDay(start), end: endOfDay(end) };
    }
    default:
      return null;
  }
}

/** Posun o celé měsíce; den v měsíci se ořízne na poslední den cílového měsíce (31. 3. → 28. 2.). */
export function shiftMonths(d: Date, months: number): Date {
  const target = new Date(d.getFullYear(), d.getMonth() + months, 1, d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds());
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(d.getDate(), lastDay));
  return target;
}

export function shiftDays(d: Date, days: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + days, d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds());
}

/**
 * Předchozí období stejné délky – včera, minulý týden do stejného dne,
 * minulý měsíc do stejného dne… Aktuální období běží jen „do dneška“, takže
 * porovnávat ho s celým minulým měsícem by vždy vycházelo v neprospěch.
 */
export function previousPeriodRange(period: PeriodType, now: Date): DateRange | null {
  const current = periodRange(period, "", "", now);
  if (!current) return null;
  switch (period) {
    case "today":
      return { start: shiftDays(current.start, -1), end: shiftDays(current.end, -1) };
    case "week":
      return { start: shiftDays(current.start, -7), end: shiftDays(current.end, -7) };
    case "month":
      return { start: shiftMonths(current.start, -1), end: shiftMonths(current.end, -1) };
    case "quarter":
      return { start: shiftMonths(current.start, -3), end: shiftMonths(current.end, -3) };
    case "year":
      return { start: shiftMonths(current.start, -12), end: shiftMonths(current.end, -12) };
    default:
      return null;
  }
}

export function vObdobi(cas: string | number | Date, range: DateRange): boolean {
  const d = cas instanceof Date ? cas : new Date(cas);
  return d >= range.start && d <= range.end;
}
