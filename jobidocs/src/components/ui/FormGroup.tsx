import React from "react";

interface FormGroupProps {
  label: string;
  hint?: string;
  children: React.ReactNode;
  horizontal?: boolean;
}

export function FormGroup({ label, hint, children, horizontal }: FormGroupProps) {
  return (
    <div className={`fg-root ${horizontal ? "fg-horizontal" : ""}`}>
      <div className="fg-header">
        <label className="fg-label">{label}</label>
        {hint && <span className="fg-hint">{hint}</span>}
      </div>
      <div className="fg-body">{children}</div>
    </div>
  );
}
