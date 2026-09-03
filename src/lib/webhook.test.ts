/**
 * Kontrola adresy webhooku.
 *
 * Adresu zadává servis a požadavek se posílá ze serveru – bez téhle
 * kontroly je to SSRF. Testuje se odsud, protože edge funkce běží v Denu.
 */
import { describe, it, expect } from "vitest";
import { zkontrolujWebhook } from "../../supabase/functions/_shared/webhook";

const ok = (x: string) => zkontrolujWebhook(x).ok;

describe("zkontrolujWebhook", () => {
  it("pustí běžnou https adresu", () => {
    expect(ok("https://api.cloudflare.com/client/v4/pages/webhooks/xyz")).toBe(true);
    expect(ok("https://example.com")).toBe(true);
  });

  it("nepustí http – adresa i obsah by šly otevřeně", () => {
    const v = zkontrolujWebhook("http://example.com");
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.duvod).toMatch(/https/);
  });

  it("nepustí jiné protokoly", () => {
    expect(ok("file:///etc/passwd")).toBe(false);
    expect(ok("ftp://example.com")).toBe(false);
    expect(ok("javascript:alert(1)")).toBe(false);
  });

  it("nepustí smyčku ani vnitřní síť", () => {
    expect(ok("https://localhost/hook")).toBe(false);
    expect(ok("https://127.0.0.1/hook")).toBe(false);
    expect(ok("https://10.0.0.5/hook")).toBe(false);
    expect(ok("https://192.168.1.1/hook")).toBe(false);
    expect(ok("https://172.16.0.1/hook")).toBe(false);
    expect(ok("https://172.31.255.255/hook")).toBe(false);
    expect(ok("https://[::1]/hook")).toBe(false);
  });

  it("nepustí metadata službu cloudu", () => {
    expect(ok("https://169.254.169.254/latest/meta-data/")).toBe(false);
    expect(ok("https://metadata.google.internal/x")).toBe(false);
  });

  it("veřejné adresy z podobných rozsahů pustí", () => {
    expect(ok("https://172.32.0.1/hook")).toBe(true);   // těsně za privátním rozsahem
    expect(ok("https://11.0.0.1/hook")).toBe(true);
  });

  it("poradí si s nesmyslem", () => {
    expect(ok("")).toBe(false);
    expect(zkontrolujWebhook(null).ok).toBe(false);
    expect(zkontrolujWebhook(42).ok).toBe(false);
    expect(ok("https://" + "a".repeat(600))).toBe(false);
  });
});
