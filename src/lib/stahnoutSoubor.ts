/**
 * Stažení souboru vyrobeného v aplikaci (export, protokol, vzor).
 *
 * Odkaz s `download` funguje ve webu i v desktopu – stejný postup už
 * používá protokol inventury a export statistik, tady je jen na jednom
 * místě pro nové exporty.
 */
export function stahnoutSoubor(obsah: Uint8Array | string, nazev: string, mime: string): void {
  const blob = new Blob([obsah as BlobPart], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nazev;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
