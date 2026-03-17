/** SVG trofeje – bronz, stříbro, zlato, diamant, platina. Čistý, moderní design. */

import { useId } from "react";

export type TrophyTier = "bronze" | "silver" | "gold" | "diamond" | "platinum";

const TIERS: Record<TrophyTier, { primary: string; secondary: string; accent?: string }> = {
  bronze: { primary: "#cd7f32", secondary: "#8b5a2b" },
  silver: { primary: "#c0c0c0", secondary: "#909090" },
  gold: { primary: "#ffd700", secondary: "#daa520" },
  diamond: { primary: "#87ceeb", secondary: "#4fc3f7", accent: "#fff" },
  platinum: { primary: "#e5e4e2", secondary: "#b0b0b0" },
};

type TrophyIconProps = { tier: TrophyTier; size?: number };

export function TrophyIcon({ tier, size = 28 }: TrophyIconProps) {
  const uid = useId();
  const { primary, secondary, accent } = TIERS[tier] ?? TIERS.bronze;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      style={{ filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.15))" }}
    >
      <defs>
        <linearGradient id={`trophy-body-${uid}`} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor={primary} stopOpacity={1} />
          <stop offset="100%" stopColor={secondary} stopOpacity={1} />
        </linearGradient>
      </defs>
      {/* Tělo trofeje – pohárový tvar */}
      <path
        d="M24 6 L30 6 L30 12 C30 18 27 22 24 24 C21 22 18 18 18 12 L18 6 Z"
        fill={`url(#trophy-body-${uid})`}
        stroke={secondary}
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      {/* Ucha */}
      <path
        d="M18 10 C14 10 12 12 12 16 L12 18"
        fill="none"
        stroke={secondary}
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M30 10 C34 10 36 12 36 16 L36 18"
        fill="none"
        stroke={secondary}
        strokeWidth="2"
        strokeLinecap="round"
      />
      {/* Podstavec */}
      <rect x="20" y="24" width="8" height="4" rx="1" fill={`url(#trophy-body-${uid})`} stroke={secondary} strokeWidth="1" />
      <rect x="22" y="28" width="4" height="6" rx="0.5" fill={`url(#trophy-body-${uid})`} stroke={secondary} strokeWidth="1" />
      <rect x="18" y="34" width="12" height="3" rx="1" fill={`url(#trophy-body-${uid})`} stroke={secondary} strokeWidth="1" />
      {/* Hvězda / odlesk na diamond a platinum */}
      {(tier === "diamond" || tier === "platinum") && accent && (
        <circle cx="24" cy="14" r="2.5" fill={accent} opacity="0.85" />
      )}
    </svg>
  );
}
