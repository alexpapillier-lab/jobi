/** Částka v Kč: celé koruny bez „,00“ (1 250 Kč), jinak s haléři (1 249,50 Kč). */
export function kc(n: number): string {
  const v = Math.abs(n) < 0.005 ? 0 : n;
  const cele = Math.abs(v - Math.round(v)) < 0.005;
  return `${v.toLocaleString("cs-CZ", { minimumFractionDigits: cele ? 0 : 2, maximumFractionDigits: cele ? 0 : 2 })} Kč`;
}

export function cas(iso: string): string {
  return new Date(iso).toLocaleTimeString("cs-CZ", { hour: "2-digit", minute: "2-digit" });
}

export function denNadpis(den: string, ted = new Date()): string {
  const d = new Date(`${den}T12:00:00`);
  const dnes = new Date(ted);
  dnes.setHours(12, 0, 0, 0);
  const rozdil = Math.round((dnes.getTime() - d.getTime()) / 86_400_000);
  if (rozdil === 0) return "Dnes";
  if (rozdil === 1) return "Včera";
  const t = d.toLocaleDateString("cs-CZ", { weekday: "long", day: "numeric", month: "long" });
  return t.charAt(0).toUpperCase() + t.slice(1);
}
