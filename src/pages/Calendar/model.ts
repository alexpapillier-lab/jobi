/**
 * Společný datový model stránky Kalendář.
 *
 * Agenda i časová osa pracují nad stejnou položkou – zakázkou nebo
 * reklamací – jen ji jinak kreslí. Položka drží surová data (vytvořeno,
 * předpokládaný termín, dokončeno); co z nich která část vyvodí
 * (konec pruhu, skupina v agendě), si spočítá sama.
 */

export type CalendarItemType = "ticket" | "claim";

export type CalendarItem = {
  type: CalendarItemType;
  id: string;
  code: string;
  deviceLabel: string;
  /** Požadovaná oprava / poznámka, zkráceno na 80 znaků. */
  issue: string;
  customerName: string;
  /** Vytvoření zakázky – začátek pruhu na časové ose. */
  createdAt: Date;
  /** Předpokládaný termín dokončení; null = bez termínu. */
  expectedAt: Date | null;
  completedAt: Date | null;
  statusKey: string | null;
  statusLabel: string;
  statusBg?: string;
  isFinal: boolean;
  isClaim: boolean;
};

export type MainView = "agenda" | "timeline";
export type TimelineView = "day" | "week" | "month";

export const VIEW_STORAGE_KEY = "jobsheet_calendar_view";

export function readStoredMainView(): MainView {
  try {
    const v = localStorage.getItem(VIEW_STORAGE_KEY);
    return v === "timeline" ? "timeline" : "agenda";
  } catch {
    return "agenda";
  }
}

export function storeMainView(v: MainView): void {
  try {
    localStorage.setItem(VIEW_STORAGE_KEY, v);
  } catch {
    /* localStorage nemusí být dostupné – volba se jen nezapamatuje */
  }
}

/* ---------- Datum a čas ---------- */

const DAY_MS = 86_400_000;

export function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

/** Pondělí 00:00 týdne, do kterého `d` patří. */
export function startOfWeek(d: Date): Date {
  const x = startOfDay(d);
  const day = x.getDay();
  const back = day === 0 ? 6 : day - 1;
  x.setDate(x.getDate() - back);
  return x;
}

export function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export function formatTime(d: Date): string {
  return d.toLocaleTimeString("cs-CZ", { hour: "2-digit", minute: "2-digit" });
}

/** „6. 9.“ */
export function formatDayMonth(d: Date): string {
  return d.toLocaleDateString("cs-CZ", { day: "numeric", month: "numeric" });
}

/** „st 6. 9.“ */
export function formatWeekdayDay(d: Date): string {
  return d.toLocaleDateString("cs-CZ", { weekday: "short", day: "numeric", month: "numeric" });
}

/** „6. 9. 2026 14:30“ */
export function formatFull(d: Date): string {
  return d.toLocaleDateString("cs-CZ", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * „o 5 min“ / „o 3 h“ / „o 2 dny“ – o kolik je termín překročený.
 * České skloňování: 1 den, 2–4 dny, 5+ dní.
 */
export function overdueLabel(expectedAt: Date, now: Date): string {
  const diff = Math.max(0, now.getTime() - expectedAt.getTime());
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 60) return `o ${Math.max(1, minutes)} min`;
  const hours = Math.floor(diff / 3_600_000);
  if (hours < 24) return `o ${hours} h`;
  const days = Math.floor(diff / DAY_MS);
  if (days === 1) return "o 1 den";
  if (days < 5) return `o ${days} dny`;
  return `o ${days} dní`;
}

/** 0 termínů, 1 termín, 2–4 termíny, 5+ termínů */
export function pluralTerminy(n: number): string {
  if (n === 1) return "1 termín";
  if (n >= 2 && n <= 4) return `${n} termíny`;
  return `${n} termínů`;
}

/* ---------- Rozsah časové osy ---------- */

export function computeTimelineRange(view: TimelineView, baseDate: Date): { rangeStart: Date; rangeEnd: Date } {
  const d = startOfDay(baseDate);
  if (view === "day") return { rangeStart: d, rangeEnd: addDays(d, 1) };
  if (view === "week") {
    const start = startOfWeek(d);
    return { rangeStart: start, rangeEnd: addDays(start, 7) };
  }
  return {
    rangeStart: new Date(d.getFullYear(), d.getMonth(), 1),
    rangeEnd: new Date(d.getFullYear(), d.getMonth() + 1, 1),
  };
}

export function formatTimelineRangeLabel(view: TimelineView, rangeStart: Date, rangeEnd: Date): string {
  if (view === "day") {
    return rangeStart.toLocaleDateString("cs-CZ", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  }
  if (view === "week") {
    const last = new Date(rangeEnd.getTime() - 1);
    return `${rangeStart.toLocaleDateString("cs-CZ", { day: "numeric", month: "short" })} – ${last.toLocaleDateString("cs-CZ", { day: "numeric", month: "short", year: "numeric" })}`;
  }
  return rangeStart.toLocaleDateString("cs-CZ", { month: "long", year: "numeric" });
}

/** Aktivní = nemá finální status. Jen takové mají v agendě smysl. */
export function isActive(item: CalendarItem): boolean {
  return !item.isFinal;
}

export function isOverdue(item: CalendarItem, now: Date): boolean {
  return isActive(item) && item.expectedAt !== null && item.expectedAt.getTime() < now.getTime();
}
