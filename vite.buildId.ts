import { execSync } from "node:child_process";

/**
 * Otisk buildu webu – podle něj běžící aplikace pozná, že na serveru je
 * nová verze (src/lib/aktualizaceWebu.ts). Na Cloudflare Pages je to SHA
 * commitu, lokálně git HEAD, bez gitu časová značka. Stejná hodnota jde do
 * kódu (`__JOBI_BUILD__`) i do dist-web/version.json.
 */
export function buildId(): string {
  const env = process.env;
  const sha = env.CF_PAGES_COMMIT_SHA || env.GITHUB_SHA || "";
  if (sha) return sha.slice(0, 12);
  try {
    return execSync("git rev-parse --short=12 HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim() || String(Date.now());
  } catch {
    return String(Date.now());
  }
}
