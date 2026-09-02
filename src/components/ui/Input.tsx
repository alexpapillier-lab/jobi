import type { InputHTMLAttributes } from "react";

/**
 * Textové pole.
 *
 * Přesunuto ze src/lib/settingsUi.tsx, kde bylo jako TextInput a používalo
 * ho 76 míst. Vzhled se nemění; přibyl jen viditelný fokus – původní styl
 * měl `outline: none` bez náhrady, takže při ovládání klávesnicí nebylo
 * poznat, ve kterém poli uživatel stojí.
 */
export function Input({ className = "", ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={["ui-input", className].filter(Boolean).join(" ")} {...rest} />;
}

/** Popisek nad polem. */
export function Label({ className = "", children }: { className?: string; children: React.ReactNode }) {
  return <div className={["ui-label", className].filter(Boolean).join(" ")}>{children}</div>;
}
