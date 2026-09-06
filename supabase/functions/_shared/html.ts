/**
 * Escapování do HTML e-mailů, které skládáme z uživatelských dat.
 *
 * Rezervace z webu, faktura i automatická zpráva berou text, který napsal
 * někdo cizí – u rezervace dokonce kdokoli z internetu, bez přihlášení.
 * Ten text pak čte majitel servisu ve svém e-mailu. Kdyby se vložil
 * neošetřený, stačilo by do jména napsat `<img src=x onerror=...>` a máme
 * cizí kód v poště zákazníka.
 *
 * Escapuje se i apostrof a uvozovka, i když dneska všechny naše šablony
 * vkládají text jen mezi značky. Kdo příště přidá `title="${...}"`, nemá
 * čekat, že mu tahle funkce hlídá jen půlku případů.
 */
export function escapeHtml(text: unknown): string {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
