
interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  disabled?: boolean;
}

export function Toggle({ checked, onChange, label, disabled }: ToggleProps) {
  return (
    <label className={`tgl-root ${disabled ? "tgl-disabled" : ""}`}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        className={`tgl-track ${checked ? "tgl-on" : ""}`}
        onClick={() => !disabled && onChange(!checked)}
        disabled={disabled}
      >
        <span className="tgl-thumb" />
      </button>
      {label && <span className="tgl-label">{label}</span>}
    </label>
  );
}
