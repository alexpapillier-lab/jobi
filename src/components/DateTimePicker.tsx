import { useCallback, useMemo, useRef, useEffect, useState } from "react";

type DateTimePickerProps = {
  /** ISO string nebo null */
  value: string | null;
  onChange: (iso: string | null) => void;
  /** Volitelné – předá se do kontejneru */
  style?: React.CSSProperties;
  /** Volitelné – třída pro inputy */
  inputStyle?: React.CSSProperties;
  disabled?: boolean;
  /** Zobrazit tlačítka Dnes 17:00, Zítra 12:00 (výchozí false pro zakládání zakázky) */
  showPresets?: boolean;
};

const calNavBtn: React.CSSProperties = {
  width: 32,
  height: 32,
  borderRadius: 8,
  border: "1px solid var(--border)",
  background: "var(--panel-2)",
  color: "var(--text)",
  fontSize: 18,
  fontWeight: 700,
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};
const calDayBtn: React.CSSProperties = {
  width: 32,
  height: 32,
  padding: 0,
  borderRadius: 8,
  border: "none",
  background: "transparent",
  color: "var(--text)",
  fontSize: 13,
  cursor: "pointer",
  transition: "background 0.15s, color 0.15s",
};

const baseInput: React.CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  borderRadius: 10,
  border: "1px solid var(--border)",
  outline: "none",
  background: "var(--panel)",
  color: "var(--text)",
  fontSize: 14,
  fontFamily: "system-ui, -apple-system, sans-serif",
};

const WEEKDAYS = ["Po", "Út", "St", "Čt", "Pá", "So", "Ne"];
const MONTHS = ["Leden", "Únor", "Březen", "Duben", "Květen", "Červen", "Červenec", "Srpen", "Září", "Říjen", "Listopad", "Prosinec"];

export function DateTimePicker({
  value,
  onChange,
  style,
  inputStyle = {},
  disabled = false,
  showPresets = false,
}: DateTimePickerProps) {
  const d = value ? new Date(value) : null;
  const dateStr = d ? d.toISOString().slice(0, 10) : "";
  const hour = d ? d.getHours() : 12;
  const minute = d ? d.getMinutes() : 0;
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [calendarMonth, setCalendarMonth] = useState(() => (d ? new Date(d.getFullYear(), d.getMonth(), 1) : new Date()));
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (calendarOpen && d) setCalendarMonth(new Date(d.getFullYear(), d.getMonth(), 1));
  }, [calendarOpen, d]);

  useEffect(() => {
    if (!calendarOpen) return;
    const onOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setCalendarOpen(false);
    };
    document.addEventListener("mousedown", onOutside);
    return () => document.removeEventListener("mousedown", onOutside);
  }, [calendarOpen]);

  const setTime = useCallback(
    (h: number, m: number) => {
      const base = d ? new Date(d) : new Date();
      base.setHours(h, m, 0, 0);
      onChange(base.toISOString());
    },
    [d, onChange]
  );

  const setDateOnly = useCallback(
    (v: string) => {
      if (!v) {
        onChange(null);
        return;
      }
      const next = new Date(v);
      next.setHours(hour, minute, 0, 0);
      onChange(next.toISOString());
    },
    [hour, minute, onChange]
  );

  const presetToday = useCallback(() => {
    const t = new Date();
    t.setHours(17, 0, 0, 0);
    onChange(t.toISOString());
  }, [onChange]);

  const presetTomorrow = useCallback(() => {
    const t = new Date();
    t.setDate(t.getDate() + 1);
    t.setHours(12, 0, 0, 0);
    onChange(t.toISOString());
  }, [onChange]);

  const clear = useCallback(() => onChange(null), [onChange]);

  const dateInputStyle = useMemo(
    () => ({ ...baseInput, ...inputStyle }),
    [inputStyle]
  );

  const timeCellStyle = useMemo(
    () => ({
      ...baseInput,
      ...inputStyle,
      padding: "10px 8px",
      textAlign: "center" as const,
      minWidth: 0,
    }),
    [inputStyle]
  );

  const presetBtnStyle: React.CSSProperties = {
    padding: "6px 12px",
    borderRadius: 8,
    border: "1px solid var(--border)",
    background: "var(--panel)",
    color: "var(--text)",
    fontSize: 12,
    fontWeight: 500,
    cursor: "pointer",
  };

  const daysInMonth = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 0).getDate();
  const firstDay = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), 1).getDay();
  const startOffset = firstDay === 0 ? 6 : firstDay - 1;
  const days: (number | null)[] = [...Array(startOffset).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];

  const pickDay = (day: number) => {
    const next = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), day);
    next.setHours(hour, minute, 0, 0);
    setDateOnly(next.toISOString().slice(0, 10));
    setCalendarOpen(false);
  };

  const prevMonth = () => setCalendarMonth((m) => new Date(m.getFullYear(), m.getMonth() - 1, 1));
  const nextMonth = () => setCalendarMonth((m) => new Date(m.getFullYear(), m.getMonth() + 1, 1));

  const displayDate = dateStr
    ? new Date(dateStr + "T12:00:00").toLocaleDateString("cs-CZ", { day: "numeric", month: "short", year: "numeric" })
    : "Vyberte datum";

  return (
    <div ref={containerRef} style={{ display: "flex", flexDirection: "column", gap: 10, ...style }}>
      <style>{`[data-dt-cal] button:hover:not([data-selected]) { background: var(--panel-2) !important; }`}</style>
      <div style={{ display: "flex", gap: 8, alignItems: "stretch", flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 160px", minWidth: 0, position: "relative" }}>
          <button
            type="button"
            onClick={() => !disabled && setCalendarOpen((o) => !o)}
            disabled={disabled}
            style={{
              ...dateInputStyle,
              cursor: disabled ? "not-allowed" : "pointer",
              textAlign: "left",
              appearance: "none",
            }}
            title="Datum"
          >
            {displayDate}
          </button>
          {calendarOpen && (
            <div
              data-dt-cal
              style={{
                position: "absolute",
                top: "100%",
                left: 0,
                marginTop: 4,
                zIndex: 1000,
                minWidth: 260,
                padding: 12,
                background: "var(--panel)",
                border: "1px solid var(--border)",
                borderRadius: 12,
                boxShadow: "0 8px 24px rgba(0,0,0,0.15)",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                <button type="button" onClick={prevMonth} style={calNavBtn}>‹</button>
                <span style={{ fontWeight: 700, fontSize: 14, color: "var(--text)" }}>
                  {MONTHS[calendarMonth.getMonth()]} {calendarMonth.getFullYear()}
                </span>
                <button type="button" onClick={nextMonth} style={calNavBtn}>›</button>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4 }}>
                {WEEKDAYS.map((w) => (
                  <div key={w} style={{ textAlign: "center", fontSize: 11, fontWeight: 600, color: "var(--muted)", padding: "4px 0" }}>{w}</div>
                ))}
                {days.map((day, i) =>
                  day === null ? (
                    <div key={`e-${i}`} />
                  ) : (
                    <button
                      key={day}
                      type="button"
                      onClick={() => pickDay(day)}
                      data-selected={dateStr === `${calendarMonth.getFullYear()}-${String(calendarMonth.getMonth() + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}` ? "" : undefined}
                      style={{
                        ...calDayBtn,
                        ...(dateStr === `${calendarMonth.getFullYear()}-${String(calendarMonth.getMonth() + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`
                          ? { background: "var(--accent)", color: "white", fontWeight: 700 }
                          : {}),
                      }}
                    >
                      {day}
                    </button>
                  )
                )}
              </div>
            </div>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 4, flex: "0 0 auto" }}>
          <input
            type="number"
            min={0}
            max={23}
            value={dateStr ? hour : ""}
            onChange={(e) => {
              const v = parseInt(e.target.value, 10);
              if (dateStr) setTime(isNaN(v) ? 0 : Math.min(23, Math.max(0, v)), minute);
            }}
            disabled={disabled || !dateStr}
            placeholder="h"
            style={timeCellStyle}
            title="Hodiny"
          />
          <span style={{ color: "var(--muted)", fontWeight: 700, fontSize: 14 }}>:</span>
          <input
            type="number"
            min={0}
            max={59}
            step={5}
            value={dateStr ? String(minute).padStart(2, "0") : ""}
            onChange={(e) => {
              const v = parseInt(e.target.value, 10);
              if (dateStr) setTime(hour, isNaN(v) ? 0 : Math.min(59, Math.max(0, v)));
            }}
            disabled={disabled || !dateStr}
            placeholder="m"
            style={timeCellStyle}
            title="Minuty"
          />
        </div>
      </div>
      {(showPresets || !!value) && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {showPresets && (
            <>
              <button type="button" onClick={presetToday} disabled={disabled} style={presetBtnStyle}>
                Dnes 17:00
              </button>
              <button type="button" onClick={presetTomorrow} disabled={disabled} style={presetBtnStyle}>
                Zítra 12:00
              </button>
            </>
          )}
          <button
            type="button"
            onClick={clear}
            disabled={disabled || !value}
            style={{
              ...presetBtnStyle,
              cursor: value ? "pointer" : "not-allowed",
              opacity: value ? 1 : 0.6,
            }}
          >
            Smazat
          </button>
        </div>
      )}
    </div>
  );
}
