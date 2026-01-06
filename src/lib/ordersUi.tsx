/**
 * Helper utilities for Orders UI components
 */

import React from "react";

export function formatCZ(dtIso: string) {
  const d = new Date(dtIso);
  return d.toLocaleString("cs-CZ", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatPhoneNumber(value: string): string {
  const cleaned = value.replace(/[^\d+]/g, "");
  if (cleaned.length === 0) return "";

  if (cleaned.startsWith("+")) {
    const digits = cleaned.slice(1);
    if (digits.length === 0) return "+";

    if (cleaned.startsWith("+420")) {
      const rest = digits.slice(3);
      if (rest.length === 0) return "+420";
      if (rest.length <= 3) return `+420 ${rest}`;
      if (rest.length <= 6) return `+420 ${rest.slice(0, 3)} ${rest.slice(3)}`;
      return `+420 ${rest.slice(0, 3)} ${rest.slice(3, 6)} ${rest.slice(6, 9)}`;
    }

    const countryCodeMatch = cleaned.match(/^\+(\d{1,3})(\d*)$/);
    if (countryCodeMatch) {
      const [, countryCode, rest] = countryCodeMatch;
      if (rest.length === 0) return `+${countryCode}`;
      if (rest.length <= 3) return `+${countryCode} ${rest}`;
      if (rest.length <= 6) return `+${countryCode} ${rest.slice(0, 3)} ${rest.slice(3)}`;
      return `+${countryCode} ${rest.slice(0, 3)} ${rest.slice(3, 6)} ${rest.slice(6, 9)}`;
    }

    return cleaned;
  }

  const digitsOnly = cleaned.replace(/[^\d]/g, "");
  if (digitsOnly.length === 0) return "";
  if (digitsOnly.length <= 3) return digitsOnly;
  if (digitsOnly.length <= 6) return `${digitsOnly.slice(0, 3)} ${digitsOnly.slice(3)}`;
  return `${digitsOnly.slice(0, 3)} ${digitsOnly.slice(3, 6)} ${digitsOnly.slice(6, 9)}`;
}

export function DeviceIcon({ size = 16, color = "currentColor" }: { size?: number; color?: string }): React.ReactElement {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="5" y="2" width="14" height="20" rx="2" ry="2"/>
      <path d="M12 18h.01"/>
    </svg>
  );
}

export function WrenchIcon({ size = 16, color = "currentColor" }: { size?: number; color?: string }): React.ReactElement {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>
    </svg>
  );
}
