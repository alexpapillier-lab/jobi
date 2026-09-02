/**
 * Ikony aplikace.
 *
 * Vzniklo po auditu UI (docs/AUDIT_UI_2026-09.md), který našel emoji použitá
 * jako ikony rozhraní. Emoji vykresluje každý systém po svém – na Windows
 * vypadají jinak než na macOS, jsou barevná tam, kde má být jednobarevná
 * ikona, a nedají se obarvit podle motivu. Po vydání Windows verze to
 * přestalo být kosmetikou.
 *
 * Styl odpovídá ikonám v Sidebaru: viewBox 24×24, stroke currentColor,
 * strokeWidth 2, zaoblené konce. `currentColor` znamená, že se ikona
 * obarví podle textu kolem, tedy i podle zvoleného motivu.
 */

type IconProps = { size?: number; color?: string };

function Svg({ size = 16, color = "currentColor", children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export function UserIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </Svg>
  );
}

export function DeviceIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="5" y="2" width="14" height="20" rx="2" ry="2" />
      <path d="M12 18h.01" />
    </Svg>
  );
}

export function WrenchIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
    </Svg>
  );
}

export function ClockIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </Svg>
  );
}

/** Stav zakázky – nahrazuje 📊 */
export function StatusIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <line x1="18" y1="20" x2="18" y2="10" />
      <line x1="12" y1="20" x2="12" y2="4" />
      <line x1="6" y1="20" x2="6" y2="14" />
    </Svg>
  );
}

/** Diagnostika – nahrazuje 🔍 */
export function SearchIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </Svg>
  );
}

/** Interní komentáře – nahrazuje 💬 */
export function ChatIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </Svg>
  );
}

/** Tisk – nahrazuje 🖨️ (dosud to byl emoji span, ne ikona) */
export function PrintIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <polyline points="6 9 6 2 18 2 18 9" />
      <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
      <rect x="6" y="14" width="12" height="8" />
    </Svg>
  );
}

/** Dokument – nahrazuje 📄 a 📋 */
export function DocumentIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
    </Svg>
  );
}

/** Peníze – nahrazuje 💰 a 💸 */
export function CoinsIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="8" cy="8" r="6" />
      <path d="M18.09 10.37A6 6 0 1 1 10.34 18" />
      <path d="M7 6h1v4" />
      <path d="M16.71 13.88l.7.71-2.82 2.82" />
    </Svg>
  );
}

/** Růst / zisk – nahrazuje 📈 */
export function TrendIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
      <polyline points="17 6 23 6 23 12" />
    </Svg>
  );
}

/** Ostatní / bonus – nahrazuje 🎁 */
export function GiftIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <polyline points="20 12 20 22 4 22 4 12" />
      <rect x="2" y="7" width="20" height="5" />
      <line x1="12" y1="22" x2="12" y2="7" />
      <path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z" />
      <path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z" />
    </Svg>
  );
}

export function DragIcon({ size = 16, color = "currentColor" }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
      {[6, 12, 18].map((y) =>
        [9, 15].map((x) => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.5" fill={color} />)
      )}
    </svg>
  );
}
