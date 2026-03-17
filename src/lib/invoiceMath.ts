export type InvoiceLineItem = {
  name: string;
  qty: number;
  unit: string;
  unit_price: number;
  vat_rate: number;
};

export type ComputedLine = InvoiceLineItem & {
  line_total: number;
  line_vat: number;
};

export type InvoiceTotals = {
  subtotal: number;
  vat_amount: number;
  total: number;
  rounding: number;
  total_rounded: number;
  vat_breakdown: { rate: number; base: number; vat: number }[];
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function computeLine(item: InvoiceLineItem): ComputedLine {
  const line_total = round2(item.qty * item.unit_price);
  const line_vat = round2(line_total * (item.vat_rate / 100));
  return { ...item, line_total, line_vat };
}

export function computeTotals(items: InvoiceLineItem[]): InvoiceTotals {
  const lines = items.map(computeLine);

  const subtotal = round2(lines.reduce((s, l) => s + l.line_total, 0));

  const vatMap = new Map<number, { base: number; vat: number }>();
  for (const l of lines) {
    const existing = vatMap.get(l.vat_rate) ?? { base: 0, vat: 0 };
    existing.base = round2(existing.base + l.line_total);
    existing.vat = round2(existing.vat + l.line_vat);
    vatMap.set(l.vat_rate, existing);
  }
  const vat_breakdown = Array.from(vatMap.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([rate, v]) => ({ rate, base: v.base, vat: v.vat }));

  const vat_amount = round2(vat_breakdown.reduce((s, v) => s + v.vat, 0));
  const total = round2(subtotal + vat_amount);

  const total_rounded = Math.round(total);
  const rounding = round2(total_rounded - total);

  return { subtotal, vat_amount, total, rounding, total_rounded, vat_breakdown };
}

export function formatCurrency(amount: number, currency = "CZK"): string {
  return new Intl.NumberFormat("cs-CZ", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

export function emptyLineItem(): InvoiceLineItem {
  return { name: "", qty: 1, unit: "ks", unit_price: 0, vat_rate: 21 };
}
