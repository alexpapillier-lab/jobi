import { describe, it, expect } from "vitest";
import { looksLikeSvg } from "./assetUrl";

describe("looksLikeSvg", () => {
  it("přijme SVG s XML deklarací a DOCTYPE (takhle vypadá logopic.svg)", () => {
    const real = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">
<svg width="260" height="260" xmlns="http://www.w3.org/2000/svg"><rect id="background"/></svg>`;
    expect(looksLikeSvg(real)).toBe(true);
  });

  it("přijme holé <svg>", () => {
    expect(looksLikeSvg('<svg viewBox="0 0 10 10"></svg>')).toBe(true);
  });

  it("odmítne HTML stránku, kterou Cloudflare vrací místo 404", () => {
    const fallback = `<!DOCTYPE html>
<html lang="cs"><head><title>Jobi</title></head><body><header class="site-header"></header></body></html>`;
    expect(looksLikeSvg(fallback)).toBe(false);
  });

  it("odmítne HTML i bez doctype", () => {
    expect(looksLikeSvg("<html><body>něco</body></html>")).toBe(false);
  });

  it("odmítne prázdnou odpověď", () => {
    expect(looksLikeSvg("")).toBe(false);
  });
});
