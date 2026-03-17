/**
 * Sanitize rich text for custom text block: allow only <b>, <strong>, <br>.
 * Escapes everything else so HTML is safe for preview and PDF.
 */
export function sanitizeRichText(html: string): string {
  if (!html || typeof html !== "string") return "";
  const escaped = html
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return escaped
    .replace(/&lt;b&gt;/gi, "<b>")
    .replace(/&lt;\/b&gt;/gi, "</b>")
    .replace(/&lt;strong&gt;/gi, "<strong>")
    .replace(/&lt;\/strong&gt;/gi, "</strong>")
    .replace(/&lt;br\s*\/?&gt;/gi, "<br/>");
}

/**
 * Convert plain text (e.g. legacy content) to display HTML: newlines -> <br/>.
 */
export function plainToDisplayHtml(text: string): string {
  if (!text || typeof text !== "string") return "";
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br/>");
}
