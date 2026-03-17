type StatusBadgeProps = {
  label: string;
  bg: string;
  isFinal?: boolean;
  size?: "sm" | "md";
};

export function StatusBadge({ label, bg, isFinal, size = "sm" }: StatusBadgeProps) {
  const isSmall = size === "sm";
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: isSmall ? "3px 8px" : "4px 10px",
        borderRadius: 6,
        background: `${bg}20`,
        color: bg,
        fontSize: isSmall ? 10 : 12,
        fontWeight: 700,
        whiteSpace: "nowrap",
        border: `1px solid ${bg}35`,
        lineHeight: 1.3,
        letterSpacing: "0.01em",
      }}
    >
      {isFinal && <span style={{ fontSize: isSmall ? 8 : 9 }}>✓</span>}
      {label}
    </span>
  );
}
