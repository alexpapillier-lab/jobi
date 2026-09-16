import { useState } from "react";
import { DiscountPicker } from "./DiscountPicker";
import { jeSlevaAktivni, popisSlevy, type PrednastavenaSleva } from "../../lib/prednastaveneSlevy";

type TypSlevy = "percentage" | "amount" | null;

/**
 * Tlačítka přednastavených slev (Nastavení → Zakázky → Slevy).
 *
 * Jedno klepnutí slevu nastaví, druhé klepnutí na aktivní ji sundá.
 * Používá se u ceny oprav v detailu zakázky a u zařízení v nové zakázce.
 */
export function TlacitkaSlev({
  slevy,
  discountType,
  discountValue,
  onChange,
  children,
}: {
  slevy: PrednastavenaSleva[];
  discountType: TypSlevy;
  discountValue: number;
  onChange: (type: TypSlevy, value: number) => void;
  /** Další tlačítka za přednastavenými (např. „Vlastní…“). */
  children?: React.ReactNode;
}) {
  if (slevy.length === 0 && !children) return null;
  return (
    <div role="group" aria-label="Rychlá sleva" style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
      {slevy.map((s) => {
        const aktivni = jeSlevaAktivni(s, discountType, discountValue);
        return (
          <button
            key={s.id}
            type="button"
            aria-pressed={aktivni}
            onClick={() => (aktivni ? onChange(null, 0) : onChange(s.typ, s.hodnota))}
            style={stylTlacitka(aktivni)}
          >
            {popisSlevy(s)}
          </button>
        );
      })}
      {children}
    </div>
  );
}

export function stylTlacitka(aktivni: boolean): React.CSSProperties {
  return {
    padding: "4px 10px",
    borderRadius: 999,
    border: aktivni ? "1px solid var(--accent)" : "1px solid var(--border)",
    background: aktivni ? "var(--accent)" : "var(--panel)",
    color: aktivni ? "#fff" : "var(--text)",
    fontSize: 12,
    fontWeight: 700,
    cursor: "pointer",
    fontFamily: "inherit",
  };
}

/**
 * Sleva v nové zakázce: přednastavené slevy jako tlačítka a „Vlastní…“,
 * které rozbalí běžný výběr typu a hodnoty. Sleva jde na zakázku hned
 * při založení, ne až dodatečně v detailu.
 */
export function SlevaNovaZakazka({
  slevy,
  discountType,
  discountValue,
  onChange,
}: {
  slevy: PrednastavenaSleva[];
  discountType: TypSlevy;
  discountValue: number;
  onChange: (type: TypSlevy, value: number) => void;
}) {
  const vlastniHodnota = !!discountType && !slevy.some((s) => jeSlevaAktivni(s, discountType, discountValue));
  /* Výběr zůstane rozbalený, dokud ho člověk nezavře – i po klepnutí
     na přednastavenou slevu by jinak zmizel pod rukama. */
  const [vlastniOtevreno, setVlastniOtevreno] = useState(false);
  const ukazatVlastni = vlastniOtevreno || vlastniHodnota;

  return (
    <div style={{ display: "grid", gap: 6 }}>
      <TlacitkaSlev slevy={slevy} discountType={discountType} discountValue={discountValue} onChange={onChange}>
        <button
          type="button"
          aria-pressed={ukazatVlastni}
          aria-expanded={ukazatVlastni}
          onClick={() => {
            if (ukazatVlastni) {
              setVlastniOtevreno(false);
              if (vlastniHodnota) onChange(null, 0);
            } else {
              setVlastniOtevreno(true);
            }
          }}
          style={stylTlacitka(vlastniHodnota)}
        >
          {ukazatVlastni ? "Bez vlastní slevy" : "Vlastní…"}
        </button>
      </TlacitkaSlev>
      {ukazatVlastni && (
        <DiscountPicker discountType={discountType} discountValue={discountValue} onChange={onChange} />
      )}
    </div>
  );
}
