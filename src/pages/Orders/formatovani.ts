/**
 * Ověření a formátování polí příjmu (telefon, e-mail, PSČ, IČO).
 * Vyneseno z Orders.tsx beze změny obsahu.
 */

export function isEmailValid(v: string) {
  const s = v.trim();
  if (!s) return true;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

export function isPhoneValid(v: string) {
  const s = v.trim();
  if (!s) return true;
  const digits = s.replace(/[^\d]/g, "");
  return digits.length >= 9 && digits.length <= 15;
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
  if (digitsOnly.length <= 9) return `${digitsOnly.slice(0, 3)} ${digitsOnly.slice(3, 6)} ${digitsOnly.slice(6)}`;
  return `${digitsOnly.slice(0, 3)} ${digitsOnly.slice(3, 6)} ${digitsOnly.slice(6, 9)} ${digitsOnly.slice(9)}`;
}

export function formatZipCode(value: string): string {
  const digits = value.replace(/[^\d]/g, "");
  if (digits.length === 0) return "";
  if (digits.length <= 3) return digits;
  return `${digits.slice(0, 3)} ${digits.slice(3, 5)}`;
}

export function formatIco(value: string): string {
  const digits = value.replace(/[^\d]/g, "");
  if (digits.length === 0) return "";
  if (digits.length <= 4) return digits;
  return `${digits.slice(0, 4)} ${digits.slice(4, 8)}`;
}

export function isZipValid(v: string) {
  const s = v.trim();
  if (!s) return true;
  const digits = s.replace(/[^\d]/g, "");
  return digits.length === 5;
}

export function isIcoValid(v: string) {
  const s = v.trim();
  if (!s) return true;
  const digits = s.replace(/[^\d]/g, "");
  return digits.length === 8;
}
