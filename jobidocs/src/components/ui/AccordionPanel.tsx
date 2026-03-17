import React, { useRef, useEffect, useState } from "react";

interface AccordionPanelProps {
  title: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
  badge?: string | number;
}

export function AccordionPanel({ title, open, onToggle, children, badge }: AccordionPanelProps) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | undefined>(undefined);

  useEffect(() => {
    if (!bodyRef.current) return;
    if (open) {
      setHeight(bodyRef.current.scrollHeight);
      const timer = setTimeout(() => setHeight(undefined), 300);
      return () => clearTimeout(timer);
    } else {
      setHeight(bodyRef.current.scrollHeight);
      requestAnimationFrame(() => setHeight(0));
    }
  }, [open]);

  return (
    <div className={`ap-root ${open ? "ap-open" : ""}`}>
      <button type="button" className="ap-head" onClick={onToggle} aria-expanded={open}>
        <span className="ap-title">
          {title}
          {badge != null && <span className="ap-badge">{badge}</span>}
        </span>
        <svg className="ap-chevron" width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <div
        ref={bodyRef}
        className="ap-body-wrap"
        style={{ height: open ? (height != null ? height : "auto") : 0 }}
      >
        <div className="ap-body">{children}</div>
      </div>
    </div>
  );
}
