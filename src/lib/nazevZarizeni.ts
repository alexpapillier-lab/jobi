/**
 * Plný název zařízení = značka + model. Když model už značkou začíná
 * (značka „Dyson“, model „Dyson V15“), značku podruhé nepřidáváme –
 * jinak by vzniklo „Dyson Dyson V15“. U Applu to nevadí, tam se model jmenuje „iPhone 16“.
 */
export function nazevSeZnackou(znacka: string | null | undefined, model: string): string {
  const m = (model ?? "").trim();
  const z = (znacka ?? "").trim();
  if (!z) return m;
  if (!m) return z;
  const mm = m.toLowerCase();
  const zz = z.toLowerCase();
  if (mm === zz || mm.startsWith(`${zz} `) || mm.startsWith(`${zz}-`)) return m;
  return `${z} ${m}`;
}
