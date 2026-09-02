import type { InputHTMLAttributes } from "react";

/**
 * Textové pole.
 *
 * Přesunuto ze src/lib/settingsUi.tsx, kde bylo jako TextInput a používalo
 * ho 76 míst. Vzhled se nemění; přibyl jen viditelný fokus – původní styl
 * měl `outline: none` bez náhrady, takže při ovládání klávesnicí nebylo
 * poznat, ve kterém poli uživatel stojí.
 */
export function Input({
  className = "",
  invalid = false,
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }) {
  return (
    <input
      className={["ui-input", invalid ? "ui-input--invalid" : "", className].filter(Boolean).join(" ")}
      aria-invalid={invalid || undefined}
      {...rest}
    />
  );
}

/**
 * Popisek nad polem.
 *
 * `spaced` přidá horní odsazení – kvůli zpětné kompatibilitě s FieldLabel
 * ze settingsUi, který ho měl napevno.
 */
export function Label({
  className = "",
  spaced = false,
  children,
}: {
  className?: string;
  spaced?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={["ui-label", spaced ? "ui-label--spaced" : "", className].filter(Boolean).join(" ")}>
      {children}
    </div>
  );
}
