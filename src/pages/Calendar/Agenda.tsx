import { useMemo, useState, type KeyboardEvent } from "react";
import { Button, Pill } from "../../components/ui";
import { ClockIcon, ChevronDownIcon } from "../../components/icons";
import { StatusBadge } from "../../components/tickets/StatusBadge";
import { ReschedulePopover } from "./ReschedulePopover";
import {
  addDays,
  formatDayMonth,
  formatTime,
  formatWeekdayDay,
  isActive,
  isSameDay,
  overdueLabel,
  startOfDay,
  startOfWeek,
  type CalendarItem,
} from "./model";

/**
 * Agenda – aktivní zakázky a reklamace seskupené podle termínu.
 *
 * Odpovídá na otázku „co mám dnes / co hoří“, na kterou časová osa
 * odpovídala špatně: pruhy bez termínu se v ní vytrácely a po termínu
 * nebylo nic vidět, dokud člověk nenajel myší.
 */

type GroupKey = "overdue" | "today" | "tomorrow" | "week" | "later" | "none";

type AgendaGroup = {
  key: GroupKey;
  title: string;
  items: CalendarItem[];
  danger: boolean;
  collapsible: boolean;
};

type Props = {
  /** Položky už profiltrované podle statusů. */
  items: CalendarItem[];
  now: Date;
  isNarrow: boolean;
  onOpen: (item: CalendarItem) => void;
  onReschedule: (item: CalendarItem, iso: string | null) => void;
};

function buildGroups(items: CalendarItem[], now: Date): AgendaGroup[] {
  const today = startOfDay(now);
  const tomorrow = addDays(today, 1);
  const dayAfter = addDays(today, 2);
  const nextMonday = addDays(startOfWeek(now), 7);

  const buckets: Record<GroupKey, CalendarItem[]> = {
    overdue: [],
    today: [],
    tomorrow: [],
    week: [],
    later: [],
    none: [],
  };

  for (const item of items) {
    if (!isActive(item)) continue;
    const at = item.expectedAt;
    if (!at) {
      buckets.none.push(item);
      continue;
    }
    const t = at.getTime();
    if (t < now.getTime()) buckets.overdue.push(item);
    else if (t < tomorrow.getTime()) buckets.today.push(item);
    else if (t < dayAfter.getTime()) buckets.tomorrow.push(item);
    else if (t < nextMonday.getTime()) buckets.week.push(item);
    else buckets.later.push(item);
  }

  const byExpected = (a: CalendarItem, b: CalendarItem) =>
    (a.expectedAt?.getTime() ?? 0) - (b.expectedAt?.getTime() ?? 0);
  const byCreated = (a: CalendarItem, b: CalendarItem) => a.createdAt.getTime() - b.createdAt.getTime();

  (["overdue", "today", "tomorrow", "week", "later"] as GroupKey[]).forEach((k) => buckets[k].sort(byExpected));
  buckets.none.sort(byCreated);

  return [
    { key: "overdue", title: "Po termínu", items: buckets.overdue, danger: true, collapsible: false },
    { key: "today", title: "Dnes", items: buckets.today, danger: false, collapsible: false },
    { key: "tomorrow", title: "Zítra", items: buckets.tomorrow, danger: false, collapsible: false },
    { key: "week", title: "Tento týden", items: buckets.week, danger: false, collapsible: false },
    { key: "later", title: "Později", items: buckets.later, danger: false, collapsible: false },
    { key: "none", title: "Bez termínu", items: buckets.none, danger: false, collapsible: true },
  ].filter((g) => g.items.length > 0) as AgendaGroup[];
}

/** Co se ukáže v levém sloupci řádku – závisí na skupině, ne na položce. */
function timeCell(group: GroupKey, item: CalendarItem, now: Date): { primary: string; secondary?: string; secondaryDanger?: boolean } {
  const at = item.expectedAt;
  if (!at) return { primary: "—" };
  switch (group) {
    case "overdue":
      return {
        primary: isSameDay(at, now) ? formatTime(at) : `${formatDayMonth(at)} ${formatTime(at)}`,
        secondary: overdueLabel(at, now),
        secondaryDanger: true,
      };
    case "today":
    case "tomorrow":
      return { primary: formatTime(at) };
    case "week":
      return { primary: formatWeekdayDay(at), secondary: formatTime(at) };
    default:
      return { primary: formatDayMonth(at), secondary: formatTime(at) };
  }
}

export function Agenda({ items, now, isNarrow, onOpen, onReschedule }: Props) {
  const groups = useMemo(() => buildGroups(items, now), [items, now]);
  const [expandedNone, setExpandedNone] = useState(false);
  const [reschedule, setReschedule] = useState<{ item: CalendarItem; anchor: HTMLElement } | null>(null);

  if (groups.length === 0) {
    return (
      <div
        style={{
          padding: "var(--space-8) var(--space-4)",
          textAlign: "center",
          color: "var(--muted)",
          fontSize: "var(--text-base)",
          lineHeight: 1.6,
          maxWidth: 420,
          margin: "0 auto",
        }}
      >
        <div style={{ fontWeight: 700, color: "var(--text)", marginBottom: "var(--space-1)" }}>Žádné termíny.</div>
        Termín zadáte u zakázky v poli Předpokládaný termín dokončení.
      </div>
    );
  }

  // Když má každá zakázka termín prázdný, zbyde jen sbalená skupina „Bez
  // termínu“ – bez nápovědy by stránka vypadala rozbitě.
  const hasDated = groups.some((g) => !g.collapsible);

  const gridColumns = isNarrow
    ? "64px minmax(0, 1fr) auto"
    : "92px 104px minmax(0, 1fr) minmax(0, 180px) auto auto";

  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <style>{`
        [data-agenda-row] { transition: background 0.12s ease; }
        [data-agenda-row]:hover { background: var(--panel-2); }
        [data-agenda-row]:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
        [data-agenda-group-toggle]:hover { background: var(--panel-2); }
      `}</style>

      {!hasDated && (
        <div
          style={{
            padding: "var(--space-6) var(--space-4)",
            textAlign: "center",
            color: "var(--muted)",
            fontSize: "var(--text-base)",
            lineHeight: 1.6,
            maxWidth: 460,
            margin: "0 auto",
          }}
        >
          <div style={{ fontWeight: 700, color: "var(--text)", marginBottom: "var(--space-1)" }}>Žádné zakázky s termínem.</div>
          Termín nastavíte tlačítkem Změnit termín u zakázky níže, nebo v detailu zakázky v poli Předpokládaný termín dokončení.
        </div>
      )}

      {groups.map((group) => {
        const collapsed = group.collapsible && !expandedNone;
        const headerColor = group.danger ? "var(--danger-text)" : "var(--muted)";
        const headerContent = (
          <>
            <span style={{ fontSize: "var(--text-xs)", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.05em", color: headerColor }}>
              {group.title}
            </span>
            <Pill color={group.danger ? "var(--danger-text)" : undefined}>{group.items.length}</Pill>
            {group.collapsible && (
              <span
                aria-hidden="true"
                style={{
                  display: "inline-flex",
                  color: "var(--muted)",
                  transform: collapsed ? "rotate(-90deg)" : "none",
                  transition: "transform 0.15s ease",
                }}
              >
                <ChevronDownIcon size={14} />
              </span>
            )}
          </>
        );

        return (
          <section key={group.key} aria-label={group.title}>
            {group.collapsible ? (
              <button
                type="button"
                data-agenda-group-toggle
                aria-expanded={!collapsed}
                onClick={() => setExpandedNone((v) => !v)}
                style={{
                  width: "100%",
                  display: "flex",
                  alignItems: "center",
                  gap: "var(--space-2)",
                  padding: isNarrow ? "10px 12px" : "10px 20px",
                  border: "none",
                  borderTop: "1px solid var(--border)",
                  borderBottom: collapsed ? "none" : "1px solid var(--border)",
                  background: "var(--panel)",
                  cursor: "pointer",
                  textAlign: "left",
                  position: "sticky",
                  top: 0,
                  zIndex: 1,
                }}
              >
                {headerContent}
              </button>
            ) : (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "var(--space-2)",
                  padding: isNarrow ? "10px 12px" : "10px 20px",
                  borderTop: "1px solid var(--border)",
                  borderBottom: "1px solid var(--border)",
                  background: group.danger ? "var(--danger-soft)" : "var(--panel)",
                  position: "sticky",
                  top: 0,
                  zIndex: 1,
                }}
              >
                {headerContent}
              </div>
            )}

            {!collapsed &&
              group.items.map((item) => {
                const tc = timeCell(group.key, item, now);
                const openItem = () => onOpen(item);
                const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    openItem();
                  }
                };
                const deviceLine = item.issue && item.issue !== "—" ? `${item.deviceLabel} · ${item.issue}` : item.deviceLabel;

                const isRescheduling = reschedule?.item.id === item.id && reschedule.item.type === item.type;
                const rescheduleBtn = (
                  <Button
                    size="sm"
                    variant={isRescheduling ? "primary" : "soft"}
                    iconOnly={isNarrow}
                    aria-label={`Změnit termín ${item.code}`}
                    title="Změnit termín"
                    icon={<ClockIcon size={14} />}
                    onClick={(e) => {
                      e.stopPropagation();
                      setReschedule({ item, anchor: e.currentTarget });
                    }}
                    style={{ flexShrink: 0, whiteSpace: "nowrap" }}
                  >
                    Změnit termín
                  </Button>
                );

                const statusBadge = item.statusBg ? (
                  <StatusBadge label={item.statusLabel} bg={item.statusBg} isFinal={item.isFinal} size="md" />
                ) : (
                  <Pill>{item.statusLabel}</Pill>
                );

                return (
                  <div
                    key={`${item.type}-${item.id}`}
                    data-agenda-row
                    role="button"
                    tabIndex={0}
                    onClick={openItem}
                    onKeyDown={onKey}
                    style={{
                      display: "grid",
                      gridTemplateColumns: gridColumns,
                      alignItems: "center",
                      columnGap: "var(--space-3)",
                      padding: isNarrow ? "8px 12px" : "8px 20px",
                      borderBottom: "1px solid var(--border)",
                      cursor: "pointer",
                      minHeight: 44,
                      background: "transparent",
                    }}
                  >
                    {/* Čas */}
                    <div style={{ minWidth: 0, lineHeight: 1.25 }}>
                      <div
                        style={{
                          fontSize: "var(--text-base)",
                          fontWeight: 700,
                          color: "var(--text)",
                          fontVariantNumeric: "tabular-nums",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {tc.primary}
                      </div>
                      {tc.secondary && (
                        <div
                          style={{
                            fontSize: "var(--text-xs)",
                            fontWeight: tc.secondaryDanger ? 700 : 500,
                            color: tc.secondaryDanger ? "var(--danger-text)" : "var(--muted)",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {tc.secondary}
                        </div>
                      )}
                    </div>

                    {isNarrow ? (
                      <>
                        <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", minWidth: 0 }}>
                            <span style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: "var(--text-sm)", fontWeight: 700, color: "var(--text)" }}>
                              {item.code}
                            </span>
                            {item.isClaim && <Pill color="var(--info-text)">Reklamace</Pill>}
                            {statusBadge}
                          </div>
                          <div style={{ fontSize: "var(--text-base)", color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {deviceLine}
                          </div>
                          <div style={{ fontSize: "var(--text-sm)", color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {item.customerName}
                          </div>
                        </div>
                        {rescheduleBtn}
                      </>
                    ) : (
                      <>
                        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-1)", minWidth: 0 }}>
                          <span style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: "var(--text-sm)", fontWeight: 700, color: "var(--text)", whiteSpace: "nowrap" }}>
                            {item.code}
                          </span>
                          {item.isClaim && (
                            <span
                              title="Reklamace"
                              aria-label="Reklamace"
                              style={{
                                fontSize: "var(--text-xs)",
                                fontWeight: 800,
                                padding: "0 5px",
                                borderRadius: "var(--radius-2xs)",
                                background: "var(--info-soft)",
                                color: "var(--info-text)",
                                lineHeight: "16px",
                              }}
                            >
                              R
                            </span>
                          )}
                        </div>
                        <div style={{ minWidth: 0, fontSize: "var(--text-base)", color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={deviceLine}>
                          {deviceLine}
                        </div>
                        <div style={{ minWidth: 0, fontSize: "var(--text-base)", color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={item.customerName}>
                          {item.customerName}
                        </div>
                        <div style={{ display: "flex", justifyContent: "flex-end" }}>{statusBadge}</div>
                        {rescheduleBtn}
                      </>
                    )}
                  </div>
                );
              })}
          </section>
        );
      })}

      {reschedule && (
        <ReschedulePopover
          key={`${reschedule.item.type}-${reschedule.item.id}`}
          anchor={reschedule.anchor}
          value={reschedule.item.expectedAt ? reschedule.item.expectedAt.toISOString() : null}
          onCommit={(iso) => onReschedule(reschedule.item, iso)}
          onClose={() => setReschedule(null)}
        />
      )}
    </div>
  );
}
