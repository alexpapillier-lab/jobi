/**
 * Renderer: šablona + data → HTML.
 *
 * Totéž HTML se zobrazí v editoru (iframe) i pošle do Chromia na PDF. Proto
 * je součástí HTML i skript, který dokument změří a při `fit: onePage`
 * postupně zmenšuje písmo a mezery, dokud se nevejde na jednu stranu. Běží
 * stejně v editoru i před tiskem, takže náhled a výstup se neliší.
 *
 * V režimu editoru přibývají atributy data-block / data-slot-item / data-edit
 * a skript, který umožňuje upravovat text přímo v dokumentu, přetahovat
 * bloky a prvky a vkládat nové bloky mezi stávající. Tisk nic z toho nemá.
 */
import { qrDataUrl } from "../src/qr.js";
import { ROBOTO_FONT_FACES } from "./fonts.js";
import { DOC_TYPE_LABELS, type Block, type Brand, type DocumentData, type RenderOptions, type SlotItem, type SlotName, type Template, type Theme } from "./types.js";
import { VARIABLES, formatDate, formatMoney, formatQty, isEmptyAfterSubstitution, itemsTotal, monthsText, substitute, substitutePlaceholders } from "./variables.js";

export type RenderInput = {
  template: Template;
  data: DocumentData;
  brand: Brand;
  theme: Theme;
  options: RenderOptions;
};

// ---------------------------------------------------------------------------
// Pomocné
// ---------------------------------------------------------------------------

export function escapeHtml(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Text s povoleným tučným / kurzívou / zalomením, odstavce z prázdných řádků. */
function richText(raw: string): string {
  const escaped = escapeHtml(raw)
    .replace(/&lt;(\/?)(b|strong|i|em|u)&gt;/gi, "<$1$2>")
    .replace(/&lt;br\s*\/?&gt;/gi, "<br>");
  const paragraphs = escaped.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  if (paragraphs.length === 0) return "";
  return paragraphs.map((p) => `<p>${p.replace(/\n/g, "<br>")}</p>`).join("");
}

const attr = escapeHtml;

function mm(n: number): string {
  return `${Math.round(n * 100) / 100}mm`;
}

type Ctx = {
  data: DocumentData;
  brand: Brand;
  theme: Theme;
  template: Template;
  editor: boolean;
  placeholders: boolean;
  currency: string;
};

function sub(ctx: Ctx, text: string): string {
  return ctx.placeholders ? substitutePlaceholders(text) : substitute(text, ctx.data);
}

/** Editovatelný text: v editoru nese původní šablonu (data-src), aby šel upravovat i s proměnnými. */
function editable(ctx: Ctx, target: string, raw: string, multiline = false): string {
  if (!ctx.editor) return "";
  return ` data-edit="${attr(target)}" data-src="${attr(raw)}"${multiline ? ' data-multiline="1"' : ""}`;
}

function isBlockEmpty(ctx: Ctx, block: Block): boolean {
  if (ctx.placeholders) return false;
  const d = ctx.data;
  switch (block.type) {
    case "fields":
      return block.rows.every((r) => isEmptyAfterSubstitution(r.value, d));
    case "items":
      return !(d.items && d.items.length > 0);
    case "text":
      return isEmptyAfterSubstitution(block.content, d);
    case "photos":
      return !(d.photos && d.photos.length > 0);
    case "warranty":
      return d.warranty?.months == null && !d.warranty?.text && !d.warranty?.until;
    case "vatSummary":
      return d.totals?.total == null && itemsTotal(d) == null;
    case "payment":
      return !d.payment?.account && !d.payment?.iban;
    default:
      return false;
  }
}

function blockVisible(ctx: Ctx, block: Block): boolean {
  const when = "when" in block ? block.when : undefined;
  if (when === "notEmpty" && isBlockEmpty(ctx, block)) return false;
  return true;
}

function wrap(_ctx: Ctx, block: Block, inner: string, extraClass = ""): string {
  return `<div class="blk blk-${block.type}${extraClass ? " " + extraClass : ""}" data-block="${attr(block.id)}" data-type="${block.type}">${inner}</div>`;
}

function blockTitle(ctx: Ctx, block: Block, title: string | undefined, fallback?: string): string {
  const raw = title ?? "";
  if (!raw.trim() && !fallback && !ctx.editor) return "";
  if (!raw.trim() && !fallback) return `<div class="block-title ph-title"${editable(ctx, `block:${block.id}:title`, "")}>Nadpis (nepovinný)</div>`;
  const text = raw.trim() ? sub(ctx, raw) : fallback!;
  return `<div class="block-title"${editable(ctx, `block:${block.id}:title`, raw)}>${escapeHtml(text)}</div>`;
}

// ---------------------------------------------------------------------------
// Bloky
// ---------------------------------------------------------------------------

function renderFields(ctx: Ctx, block: Extract<Block, { type: "fields" }>): string {
  const layout = block.layout === "table" ? "table" : "grid";
  const rows = block.rows.filter((r) => ctx.editor || ctx.placeholders || r.hideEmpty === false || !isEmptyAfterSubstitution(r.value, ctx.data));
  if (rows.length === 0 && !ctx.editor) return "";
  const cells = rows
    .map((r) => {
      const empty = !ctx.placeholders && isEmptyAfterSubstitution(r.value, ctx.data);
      const value = empty ? "" : richText(sub(ctx, r.value));
      const valueHtml = value || (ctx.editor ? `<span class="ph">—</span>` : "");
      const plain = sub(ctx, r.value);
      const wide = layout === "grid" && (plain.length > 48 || plain.includes("\n")) ? " wide" : "";
      if (layout === "table") {
        return `<tr class="f-row${empty ? " empty" : ""}" data-row="${attr(r.id)}"><th${editable(ctx, `row:${r.id}:label`, r.label)}>${escapeHtml(sub(ctx, r.label))}</th><td${editable(ctx, `row:${r.id}:value`, r.value)}>${valueHtml}</td></tr>`;
      }
      return `<div class="f-cell${wide}${empty ? " empty" : ""}" data-row="${attr(r.id)}"><div class="f-label"${editable(ctx, `row:${r.id}:label`, r.label)}>${escapeHtml(sub(ctx, r.label))}</div><div class="f-value"${editable(ctx, `row:${r.id}:value`, r.value)}>${valueHtml}</div></div>`;
    })
    .join("");
  const body =
    layout === "table"
      ? `<table class="fields lines-${ctx.theme.tableLines}"><tbody>${cells || `<tr><td class="ph" colspan="2">Tabulka bez řádků</td></tr>`}</tbody></table>`
      : `<div class="fgrid lines-${ctx.theme.tableLines}">${cells || `<div class="ph">Tabulka bez řádků – přidejte řádek v panelu vpravo.</div>`}</div>`;
  return wrap(ctx, block, `${blockTitle(ctx, block, block.title)}${body}`);
}

const ITEM_COL_LABELS: Record<string, string> = {
  name: "Položka",
  qty: "Množství",
  unit: "Jedn.",
  unitPrice: "Cena / jedn.",
  vatRate: "DPH",
  total: "Celkem",
};

function renderItems(ctx: Ctx, block: Extract<Block, { type: "items" }>): string {
  const items = ctx.data.items ?? [];
  const cols = block.columns.length ? block.columns : ["name", "total"];
  const numeric = (c: string) => c !== "name" && c !== "unit";
  const head = cols.map((c) => `<th class="${numeric(c) ? "num" : ""}">${ITEM_COL_LABELS[c] ?? c}</th>`).join("");
  const rows = items
    .map((it) => {
      const cells = cols.map((c) => {
        let v = "";
        switch (c) {
          case "name":
            v = escapeHtml(it.name) + (it.description ? `<div class="item-desc">${escapeHtml(it.description)}</div>` : "");
            break;
          case "qty":
            v = formatQty(it.qty ?? 1);
            break;
          case "unit":
            v = escapeHtml(it.unit ?? "ks");
            break;
          case "unitPrice":
            v = formatMoney(it.unitPrice ?? (it.total != null ? it.total / (it.qty || 1) : undefined), ctx.currency);
            break;
          case "vatRate":
            v = it.vatRate != null ? `${formatQty(it.vatRate)} %` : "";
            break;
          case "total":
            v = formatMoney(it.total ?? (it.unitPrice != null ? it.unitPrice * (it.qty ?? 1) : undefined), ctx.currency);
            break;
        }
        return `<td class="${numeric(c) ? "num" : ""}">${v}</td>`;
      });
      return `<tr>${cells.join("")}</tr>`;
    })
    .join("");
  let foot = "";
  if (block.showTotal !== false) {
    const total = itemsTotal(ctx.data);
    const parts: string[] = [];
    if (ctx.data.discount) {
      const d = ctx.data.discount;
      parts.push(`<tr class="discount"><td colspan="${Math.max(1, cols.length - 1)}">Sleva</td><td class="num">${d.type === "percentage" ? `${formatQty(d.value)} %` : `−${formatMoney(d.value, ctx.currency)}`}</td></tr>`);
    }
    if (total != null) parts.push(`<tr class="total"><td colspan="${Math.max(1, cols.length - 1)}">Celkem</td><td class="num">${formatMoney(total, ctx.currency)}</td></tr>`);
    if (parts.length) foot = `<tfoot>${parts.join("")}</tfoot>`;
  }
  if (!rows && !ctx.editor) return "";
  const body = rows || `<tr><td colspan="${cols.length}" class="ph">Žádné položky – při tisku se blok vynechá.</td></tr>`;
  return wrap(ctx, block, `${blockTitle(ctx, block, block.title)}<table class="items"><thead><tr>${head}</tr></thead><tbody>${body}</tbody>${foot}</table>`);
}

function renderText(ctx: Ctx, block: Extract<Block, { type: "text" }>): string {
  const content = richText(sub(ctx, block.content));
  const cls = `text ${block.size === "small" ? "small" : ""} ${block.align ?? "left"} ${block.columns === 2 ? "cols2" : ""}`;
  const inner = content || (ctx.editor ? `<p class="ph">Prázdný text – klikněte a pište.</p>` : "");
  return wrap(ctx, block, `${blockTitle(ctx, block, block.title)}<div class="${cls}"${editable(ctx, `block:${block.id}:content`, block.content, true)}>${inner}</div>`);
}

function renderSignature(ctx: Ctx, block: Extract<Block, { type: "signature" }>): string {
  const w = block.width ?? 55;
  return wrap(ctx, block, `<div class="sig-row ${block.align ?? "left"}"><div class="sig" style="width:${mm(w)}"><div class="line"></div><div class="label"${editable(ctx, `block:${block.id}:label`, block.label)}>${escapeHtml(sub(ctx, block.label))}</div></div></div>`);
}

function renderWarranty(ctx: Ctx, block: Extract<Block, { type: "warranty" }>): string {
  const w = ctx.data.warranty;
  const parts: string[] = [];
  if (ctx.placeholders) {
    parts.push(`<p>Záruční doba činí ⟨Záruka (měsíce)⟩. Záruka do: ⟨Záruka do⟩</p>`);
  } else {
    if (w?.months != null) parts.push(`<p>Záruční doba činí <b>${monthsText(w.months)}</b>${w.until ? `, platí do <b>${escapeHtml(formatDate(w.until))}</b>` : ""}.</p>`);
    else if (w?.until) parts.push(`<p>Záruka platí do <b>${escapeHtml(formatDate(w.until))}</b>.</p>`);
    if (w?.text) parts.push(richText(w.text));
  }
  if (!parts.length && !ctx.editor) return "";
  return wrap(ctx, block, `${blockTitle(ctx, block, block.title, "Záruka")}<div class="text">${parts.join("") || `<p class="ph">Záruka – doplní se z dat zakázky.</p>`}</div>`);
}

function renderVatSummary(ctx: Ctx, block: Extract<Block, { type: "vatSummary" }>): string {
  const t = ctx.data.totals ?? {};
  const total = itemsTotal(ctx.data);
  const payer = t.vatPayer !== false;
  const rows: string[] = [];
  if (payer && t.subtotal != null) rows.push(`<tr><th>Základ daně</th><td class="num">${formatMoney(t.subtotal, ctx.currency)}</td></tr>`);
  if (payer && t.vat != null) rows.push(`<tr><th>DPH</th><td class="num">${formatMoney(t.vat, ctx.currency)}</td></tr>`);
  if (t.rounding) rows.push(`<tr><th>Zaokrouhlení</th><td class="num">${formatMoney(t.rounding, ctx.currency)}</td></tr>`);
  if (total != null) rows.push(`<tr class="total"><th>Celkem k úhradě</th><td class="num">${formatMoney(total, ctx.currency)}</td></tr>`);
  if (!payer) rows.push(`<tr><td colspan="2" class="muted">Nejsme plátci DPH.</td></tr>`);
  if (!rows.length && !ctx.editor) return "";
  return wrap(ctx, block, `<table class="summary"><tbody>${rows.join("") || `<tr><td class="ph">Rekapitulace – doplní se z faktury.</td></tr>`}</tbody></table>`);
}

function renderPayment(ctx: Ctx, block: Extract<Block, { type: "payment" }>): string {
  const p = ctx.data.payment ?? {};
  const rows: string[] = [];
  if (p.account) rows.push(`<tr><th>Číslo účtu</th><td>${escapeHtml(p.account)}</td></tr>`);
  if (p.iban) rows.push(`<tr><th>IBAN</th><td>${escapeHtml(p.iban)}</td></tr>`);
  if (p.swift) rows.push(`<tr><th>SWIFT</th><td>${escapeHtml(p.swift)}</td></tr>`);
  if (p.vs) rows.push(`<tr><th>Variabilní symbol</th><td>${escapeHtml(p.vs)}</td></tr>`);
  const total = itemsTotal(ctx.data);
  if (total != null) rows.push(`<tr><th>Částka</th><td>${formatMoney(total, ctx.currency)}</td></tr>`);
  const qr = block.showQr !== false && p.spayd ? qrDataUrl(p.spayd, 160, "M") : "";
  const qrHtml = qr ? `<div class="pay-qr"><img src="${qr}" alt="QR platba"><div class="muted">QR platba</div></div>` : ctx.editor && block.showQr !== false ? `<div class="pay-qr ph-box">QR platba</div>` : "";
  if (!rows.length && !ctx.editor) return "";
  return wrap(ctx, block, `${blockTitle(ctx, block, block.title)}<div class="payment"><table class="fields lines-${ctx.theme.tableLines}"><tbody>${rows.join("") || `<tr><td class="ph">Platební údaje – doplní se z faktury.</td></tr>`}</tbody></table>${qrHtml}</div>`);
}

function renderPhotosGrid(ctx: Ctx, block: Extract<Block, { type: "photos" }>): string {
  const photos = ctx.data.photos ?? [];
  const imgs = photos.map((u) => `<img src="${attr(u)}" alt="Foto" onerror="this.style.display='none'">`).join("");
  if (!imgs && !ctx.editor) return "";
  return wrap(ctx, block, `${blockTitle(ctx, block, block.title, "Fotodokumentace")}<div class="photo-grid">${imgs || `<div class="ph-box">Fotky z Jobi</div>`}</div>`);
}

function renderBlock(ctx: Ctx, block: Block): string {
  if (!blockVisible(ctx, block)) return "";
  switch (block.type) {
    case "fields":
      return renderFields(ctx, block);
    case "items":
      return renderItems(ctx, block);
    case "text":
      return renderText(ctx, block);
    case "heading":
      return wrap(ctx, block, `<h2 class="heading l${block.level ?? 2}"${editable(ctx, `block:${block.id}:text`, block.text)}>${escapeHtml(sub(ctx, block.text)) || (ctx.editor ? `<span class="ph">Nadpis</span>` : "")}</h2>`);
    case "divider":
      return wrap(ctx, block, `<hr class="divider">`);
    case "spacer":
      return wrap(ctx, block, `<div class="spacer" style="height:${mm(block.height)}"></div>`);
    case "columns": {
      const l = block.left.map((b) => renderBlock(ctx, b)).join("");
      const r = block.right.map((b) => renderBlock(ctx, b)).join("");
      const ph = ctx.editor ? `<div class="ph-box col-empty">Prázdný sloupec</div>` : "";
      return wrap(ctx, block, `<div class="columns"><div class="col" data-col="left">${l || ph}</div><div class="col" data-col="right">${r || ph}</div></div>`);
    }
    case "signature":
      return renderSignature(ctx, block);
    case "photos":
      if (block.mode === "pages") {
        const n = ctx.data.photos?.length ?? 0;
        return ctx.editor ? wrap(ctx, block, `<div class="ph-note">Fotodokumentace: ${n ? `${n}× vlastní strana níže` : "žádné fotky, při tisku se vynechá"}</div>`) : "";
      }
      return renderPhotosGrid(ctx, block);
    case "warranty":
      return renderWarranty(ctx, block);
    case "vatSummary":
      return renderVatSummary(ctx, block);
    case "payment":
      return renderPayment(ctx, block);
  }
}

// ---------------------------------------------------------------------------
// Sloty
// ---------------------------------------------------------------------------

function renderSlotItem(ctx: Ctx, item: SlotItem, titleOverride?: string): string {
  const wrapItem = (inner: string, cls = "") => `<div class="si si-${item.type} ${cls}" data-slot-item="${attr(item.id)}" data-type="${item.type}">${inner}</div>`;
  const d = ctx.data;
  switch (item.type) {
    case "title": {
      // Nadpis z dat (druh faktury) přebíjí text ze šablony – jinak by dobropis
      // vyšel s nadpisem „Faktura“; v editoru šablony data nadpis nemají.
      const kind = titleOverride ?? (d.title?.trim() || (item.text?.trim() ? sub(ctx, item.text) : DOC_TYPE_LABELS[ctx.template.docType]));
      const number = ctx.placeholders ? "⟨Číslo dokumentu⟩" : d.number ?? "";
      const dateRaw = d.dates?.issued ?? d.dates?.received;
      const date = ctx.placeholders ? "⟨Datum⟩" : dateRaw ? formatDate(dateRaw) : "";
      const showNumber = item.showNumber !== false && !titleOverride;
      const showDate = item.showDate === true && !titleOverride;
      return wrapItem(
        `<div class="doc-title ${item.style === "box" ? "boxed" : ""}"><div class="doc-kind"${editable(ctx, `item:${item.id}:text`, item.text ?? "")}>${escapeHtml(kind)}</div>${showNumber && number ? `<div class="doc-number">${escapeHtml(number)}</div>` : ""}${showDate && date ? `<div class="doc-date">${escapeHtml(date)}</div>` : ""}</div>`
      );
    }
    case "brand": {
      const s = d.service;
      const name = s.name || (ctx.editor ? "Název servisu" : "");
      const line1 = [s.address, s.ico ? `IČO ${s.ico}` : undefined, s.dic ? `DIČ ${s.dic}` : undefined].filter(Boolean);
      const line2 = [s.phone, s.email, s.web].filter(Boolean);
      const contact =
        item.showContact !== false && (line1.length || line2.length)
          ? `<div class="brand-contact">${line1.length ? `<div>${line1.map((x) => escapeHtml(x)).join(" · ")}</div>` : ""}${line2.length ? `<div>${line2.map((x) => escapeHtml(x)).join(" · ")}</div>` : ""}</div>`
          : "";
      return wrapItem(`<div class="brand-name">${escapeHtml(name)}</div>${contact}`);
    }
    case "logo": {
      const h = item.height ?? 14;
      if (ctx.brand.logoUrl) return wrapItem(`<div class="logo"><img src="${attr(ctx.brand.logoUrl)}" alt="Logo" style="height:${mm(h)}" onerror="this.style.display='none'"></div>`);
      return ctx.editor ? wrapItem(`<div class="logo ph-box" style="height:${mm(h)};width:${mm(h * 2.6)}">Logo – nahrajte ve Značce</div>`) : "";
    }
    case "stamp": {
      const h = item.height ?? 20;
      const img = ctx.brand.stampUrl
        ? `<img src="${attr(ctx.brand.stampUrl)}" alt="Razítko" style="height:${mm(h)}" onerror="this.style.display='none'">`
        : ctx.editor
          ? `<div class="ph-box" style="height:${mm(h)};width:${mm(h * 2.2)}">Razítko – nahrajte ve Značce</div>`
          : `<div style="height:${mm(h)}"></div>`;
      const label = item.label ?? "Razítko a podpis";
      return wrapItem(`<div class="stamp"><div class="stamp-img">${img}</div><div class="line"><span${editable(ctx, `item:${item.id}:label`, label)}>${escapeHtml(sub(ctx, label))}</span></div></div>`);
    }
    case "qr": {
      const portal = item.source === "portal";
      const url = portal ? ctx.data.portalUrl ?? "" : ctx.brand.reviewUrl ?? "";
      const size = item.size ?? 22;
      const defaultText = portal ? "Stav zakázky sledujte online – načtěte QR kód." : ctx.brand.reviewText ?? "";
      const text = item.text?.trim() ? sub(ctx, item.text) : defaultText;
      // Bez odkazu se v tisku nic nevykreslí; v editoru zůstane rámeček s vysvětlením.
      if (!url) {
        const why = portal ? "Odkaz na stav zakázky doplní Jobi při tisku" : "Odkaz na hodnocení nastavte ve Značce";
        return ctx.editor ? wrapItem(`<div class="qr"><div class="ph-box" style="width:${mm(size)};height:${mm(size)}">QR</div><div class="muted">${why}</div></div>`) : "";
      }
      return wrapItem(`<div class="qr"><img src="${qrDataUrl(url, 200, "M")}" alt="QR" style="width:${mm(size)};height:${mm(size)}"><div class="qr-text"${editable(ctx, `item:${item.id}:text`, item.text ?? "")}>${escapeHtml(text)}</div></div>`);
    }
    case "signature": {
      const w = item.width ?? 55;
      return wrapItem(`<div class="sig" style="width:${mm(w)}"><div class="line"></div><div class="label"${editable(ctx, `item:${item.id}:label`, item.label)}>${escapeHtml(sub(ctx, item.label))}</div></div>`);
    }
    case "text":
      return wrapItem(`<div class="text ${item.size === "small" ? "small" : ""}"${editable(ctx, `item:${item.id}:content`, item.content, true)}>${richText(sub(ctx, item.content)) || (ctx.editor ? `<p class="ph">Text – klikněte a pište</p>` : "")}</div>`);
    case "contact": {
      const s = d.service;
      const parts = [s.name, s.phone, s.email, s.web].filter(Boolean).map((x) => escapeHtml(x!));
      return wrapItem(`<div class="contact">${parts.join(" · ")}</div>`);
    }
    case "pageNumber":
      return wrapItem(`<div class="page-number muted">Strana <span data-page-no></span> / <span data-page-total></span></div>`);
  }
}

function renderSlot(ctx: Ctx, name: SlotName, items: SlotItem[], cls: string, titleOverride?: string): string {
  const inner = items.map((it) => renderSlotItem(ctx, it, titleOverride)).join("");
  const empty = !inner.trim();
  return `<div class="slot ${cls}${empty ? " empty" : ""}" data-slot="${name}">${inner}</div>`;
}

function renderHeader(ctx: Ctx, titleOverride?: string): string {
  const s = ctx.template.slots;
  return `<header class="hdr">${renderSlot(ctx, "headerLeft", s.headerLeft, "h-left", titleOverride)}${renderSlot(ctx, "headerRight", s.headerRight, "h-right", titleOverride)}</header>`;
}

function renderBottom(ctx: Ctx): string {
  const s = ctx.template.slots;
  const any = s.bottomLeft.length + s.bottomCenter.length + s.bottomRight.length > 0;
  return `<footer class="bottom${any ? "" : " all-empty"}">${renderSlot(ctx, "bottomLeft", s.bottomLeft, "b-left")}${renderSlot(ctx, "bottomCenter", s.bottomCenter, "b-center")}${renderSlot(ctx, "bottomRight", s.bottomRight, "b-right")}</footer>`;
}

// ---------------------------------------------------------------------------
// CSS
// ---------------------------------------------------------------------------

const FONTS: Record<Theme["font"], string> = {
  roboto: `Roboto, "Helvetica Neue", Helvetica, Arial, sans-serif`,
  inter: `Inter, "Helvetica Neue", Helvetica, Arial, sans-serif`,
  system: `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif`,
};

function css(t: Template, theme: Theme, editor: boolean): string {
  const m = t.page.margins;
  const style = theme.style;
  const accent = style === "plain" ? "#111111" : theme.accent;
  const styleCss =
    style === "modern"
      ? `
.hdr{padding-bottom:calc(3.5mm*var(--sp));border-bottom:0.7mm solid var(--accent)}
.doc-kind{color:var(--accent)}
.block-title{color:var(--accent);border-bottom:0.25mm solid var(--line)}
.items thead th{background:color-mix(in srgb,var(--accent) 9%,#fff);border-bottom:0.3mm solid var(--accent)}
.items tbody tr:nth-child(even) td{background:#fafbfc}
.bottom{border-top:0.25mm solid var(--line)}
.f-cell{border-bottom:0.2mm solid var(--line)}`
      : style === "plain"
        ? `
.hdr{padding-bottom:calc(3mm*var(--sp));border-bottom:0.4mm solid var(--text)}
.block-title{border-bottom:0.3mm solid var(--text)}
.items thead th{border-bottom:0.4mm solid var(--text)}
.f-cell{border-bottom:0.2mm solid var(--line)}
.bottom{border-top:0.3mm solid var(--text)}`
        : `
.hdr{padding-bottom:calc(3mm*var(--sp));border-bottom:0.4mm solid var(--accent)}
.doc-kind{color:var(--accent)}
.doc-title.boxed,.doc-title{border:0.4mm solid var(--accent);padding:2mm 4mm;display:inline-block;text-align:right}
.block-title{color:var(--accent)}
.fgrid{gap:1.2mm}
.f-cell{border:0.3mm solid var(--text);padding:1.4mm 2mm 1.2mm}
.items thead th{border:0.3mm solid var(--text);background:#f3f4f6}
.items td{border:0.3mm solid var(--text)}
.sig{border:0.3mm solid var(--text);padding:14mm 2mm 1.5mm;text-align:left}
.sig .line{display:none}
.stamp{border:0.3mm solid var(--text);padding:2mm}
.stamp .line{border-top:none}
.bottom{border-top:none}`;

  return `
:root{--fs:${t.page.fontSize}pt;--sp:1;--accent:${accent};--line:#d3d8dd;--text:#151a1f;--muted:#6b7480}
*{box-sizing:border-box}
html,body{margin:0;padding:0}
body{font-family:${FONTS[theme.font] ?? FONTS.roboto};font-size:var(--fs);line-height:1.35;color:var(--text);background:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact}
@page{size:A4;margin:0}
.page{width:210mm;min-height:296.6mm;padding:${mm(m.top)} ${mm(m.right)} ${mm(m.bottom)} ${mm(m.left)};display:flex;flex-direction:column;position:relative;background:#fff;break-after:page;page-break-after:always}
.page:last-child{break-after:auto;page-break-after:auto}
${theme.color === "bw" ? "img{filter:grayscale(1)}" : ""}
.hdr{display:flex;justify-content:space-between;align-items:flex-end;gap:8mm;margin-bottom:calc(5mm*var(--sp))}
.slot{display:flex;flex-direction:column;gap:calc(2.5mm*var(--sp));min-width:0}
.slot.h-left{align-items:flex-start;flex:1 1 55%}
.slot.h-right{align-items:flex-end;text-align:right;flex:1 1 45%}
.body{flex:1 0 auto;display:flex;flex-direction:column;gap:calc(4.5mm*var(--sp))}
.bottom{margin-top:auto;padding-top:calc(6mm*var(--sp));display:grid;grid-template-columns:1fr 1fr 1fr;gap:6mm;align-items:end}
.bottom.all-empty{display:none}
.slot.b-left{align-items:flex-start}
.slot.b-center{align-items:center;text-align:center}
.slot.b-right{align-items:flex-end;text-align:right}
.doc-title{display:flex;flex-direction:column;align-items:flex-end}
.doc-kind{font-size:0.85em;font-weight:700;text-transform:uppercase;letter-spacing:0.12em}
.doc-number{font-size:2.3em;font-weight:800;line-height:1.05;letter-spacing:-0.01em;font-variant-numeric:tabular-nums}
.doc-date{font-size:0.85em;color:var(--muted);margin-top:0.6mm}
.brand-name{font-weight:800;font-size:1.55em;letter-spacing:-0.01em;line-height:1.1}
.brand-contact{font-size:0.85em;color:var(--muted);line-height:1.35;margin-top:0.8mm}
.logo img{display:block}
.block-title{font-size:0.78em;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;padding-bottom:1mm;margin-bottom:calc(2.2mm*var(--sp))}
.fgrid{display:grid;grid-template-columns:1fr 1fr;gap:calc(2mm*var(--sp)) 6mm}
.f-cell{padding-bottom:calc(1.2mm*var(--sp));min-width:0}
.fgrid.lines-none .f-cell{border:0 !important;padding-bottom:calc(0.6mm*var(--sp))}
.fgrid.lines-all{gap:1.2mm}
.fgrid.lines-all .f-cell{border:0.25mm solid var(--line) !important;padding:1.3mm 2mm 1.1mm}
.f-cell.wide{grid-column:1/-1}
.f-label{font-size:0.74em;text-transform:uppercase;letter-spacing:0.06em;color:var(--muted);line-height:1.2;margin-bottom:0.5mm}
.f-value{line-height:1.3;overflow-wrap:anywhere}
.f-value p{margin:0}
table.fields{width:100%;border-collapse:collapse}
.fields th{width:34%;text-align:left;font-weight:700;padding:calc(1.4mm*var(--sp)) 2mm;vertical-align:top}
.fields td{padding:calc(1.4mm*var(--sp)) 2mm;vertical-align:top}
.fields td p{margin:0}
.fields.lines-rows th,.fields.lines-rows td{border-bottom:0.2mm solid var(--line)}
.fields.lines-all th,.fields.lines-all td{border:0.2mm solid var(--line)}
.fields.lines-none th,.fields.lines-none td{padding:calc(0.8mm*var(--sp)) 2mm 0 0}
.text p{margin:0 0 0.8em}
.text p:last-child{margin-bottom:0}
.text.small{font-size:0.76em;line-height:1.3;color:#2b3138}
.text.justify{text-align:justify}
.text.center{text-align:center}
.text.cols2{column-count:2;column-gap:6mm}
.text.cols2 p{break-inside:avoid}
h2.heading{margin:0;font-weight:700;font-size:1.4em;line-height:1.2}
h2.heading.l1{font-size:1.9em}
hr.divider{border:0;border-top:0.25mm solid var(--line);margin:0;width:100%}
.columns{display:grid;grid-template-columns:1fr 1fr;gap:6mm}
.columns .col{display:flex;flex-direction:column;gap:calc(4mm*var(--sp));min-width:0}
.sig-row{display:flex}
.sig-row.center{justify-content:center}
.sig-row.right{justify-content:flex-end}
.sig{display:inline-block;text-align:center}
.sig .line{border-top:0.35mm solid var(--text);margin-bottom:1mm}
.sig .label{font-size:0.82em;color:var(--muted)}
table.items{width:100%;border-collapse:collapse}
.items th{text-align:left;font-weight:700;padding:calc(1.6mm*var(--sp)) 2mm;font-size:0.85em;text-transform:uppercase;letter-spacing:0.05em}
.items td{padding:calc(1.6mm*var(--sp)) 2mm;border-bottom:0.2mm solid var(--line);vertical-align:top}
.items .num{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}
.items tfoot td{border-bottom:0;background:none}
.items tfoot .total td{font-weight:800;border-top:0.4mm solid var(--text);font-size:1.05em}
.item-desc{font-size:0.85em;color:var(--muted)}
table.summary{border-collapse:collapse;margin-left:auto;min-width:70mm}
.summary th{text-align:left;font-weight:400;padding:1.2mm 6mm 1.2mm 0}
.summary td{padding:1.2mm 0;text-align:right;font-variant-numeric:tabular-nums}
.summary .total th,.summary .total td{font-weight:800;border-top:0.4mm solid var(--text);font-size:1.15em}
.payment{display:flex;gap:6mm;align-items:flex-start}
.payment table{flex:1}
.pay-qr{text-align:center;font-size:0.8em}
.pay-qr img{width:32mm;height:32mm;display:block}
.stamp{display:inline-block;text-align:center;min-width:48mm}
.stamp-img{display:flex;align-items:flex-end;justify-content:center;min-height:6mm}
.stamp img{display:block;margin:0 auto}
.stamp .line{border-top:0.35mm solid var(--text);margin-top:1mm;padding-top:1mm;font-size:0.82em;color:var(--muted)}
.qr{display:flex;align-items:center;gap:3mm;text-align:left}
.qr img{display:block}
.qr-text{font-size:0.85em;max-width:40mm;color:var(--muted)}
.contact{font-size:0.78em;color:var(--muted)}
.muted{color:var(--muted);font-size:0.9em}
.photo-page .photo{flex:1 1 auto;display:flex;align-items:center;justify-content:center;min-height:0;margin-top:4mm}
.photo-page .photo img{width:100%;max-height:230mm;object-fit:contain}
.photo-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:3mm}
.photo-grid img{width:100%;height:45mm;object-fit:cover}
${styleCss}
${editor ? EDITOR_CSS : ""}
@media print{body{background:#fff;padding:0}.page{box-shadow:none;margin:0}}
`;
}

const EDITOR_CSS = `
body{background:#e6eaee;padding:8mm 0}
.page{box-shadow:0 2px 14px rgba(0,0,0,.18);margin:0 auto 8mm}
.ph,.ph-note,.ph-title{color:#8a94a0;font-style:italic}
.ph-title{font-style:italic;text-transform:none;letter-spacing:0;color:#9aa4ae;border-bottom-color:transparent}
.ph-box{display:flex;align-items:center;justify-content:center;border:0.4mm dashed #b5bec7;border-radius:1mm;color:#8a94a0;font-size:0.75em;padding:1mm;text-align:center}
.ph-note{border:0.4mm dashed #b5bec7;border-radius:1mm;padding:2mm 3mm;font-size:0.9em}
.col-empty{min-height:12mm}
.slot.empty{min-height:12mm;border:0.4mm dashed #c4ccd4;border-radius:1mm;justify-content:center;align-items:center;position:relative}
.slot.empty::after{display:block;font-size:0.7em;color:#9aa4ae;content:"+ prvek";font-style:italic}
.slot.empty:hover{border-color:#2563eb;background:rgba(37,99,235,.04)}
.bottom.all-empty{display:grid}
[data-block],[data-slot-item]{position:relative;cursor:pointer;border-radius:0.8mm;outline:0.35mm solid transparent;outline-offset:1.2mm;transition:outline-color .12s}
[data-block]:hover,[data-slot-item]:hover{outline-color:rgba(37,99,235,.35)}
.selected{outline-color:#2563eb !important}
[data-edit]{cursor:text;border-radius:0.5mm}
[data-edit]:hover{background:rgba(37,99,235,.06)}
[data-edit][contenteditable="true"]{outline:0.35mm solid #2563eb;outline-offset:0.8mm;background:#fff;cursor:text;min-width:8mm;min-height:1em}
.var{display:inline-block;background:#e0ecff;color:#1e40af;border-radius:0.8mm;padding:0 1.2mm;margin:0 0.3mm;font-size:0.92em;line-height:1.3;white-space:nowrap;font-style:normal;user-select:all}
.dragging{opacity:.4}
.drop-target{outline:0.5mm dashed #2563eb !important;outline-offset:1mm;background:rgba(37,99,235,.06)}
.drop-before{box-shadow:0 -0.8mm 0 0 #2563eb}
.drop-after{box-shadow:0 0.8mm 0 0 #2563eb}
.ins{height:0;position:relative;margin:calc(-2.25mm*var(--sp)) 0}
.ins::before{content:"";position:absolute;left:0;right:0;top:-3mm;height:6mm}
.ins .ins-btn{position:absolute;left:50%;top:0;transform:translate(-50%,-50%);width:6mm;height:6mm;border-radius:50%;background:#2563eb;color:#fff;font-size:4mm;line-height:6mm;text-align:center;font-weight:700;opacity:0;transition:opacity .12s;cursor:pointer;box-shadow:0 1px 4px rgba(0,0,0,.25);z-index:5;font-style:normal}
.ins::after{content:"";position:absolute;left:0;right:0;top:0;border-top:0.35mm dashed #2563eb;opacity:0;transition:opacity .12s}
.ins:hover .ins-btn,.ins:hover::after{opacity:1}
.etb{position:absolute;z-index:20;display:flex;gap:0.5mm;background:#1f2937;border-radius:1.5mm;padding:0.8mm;box-shadow:0 2px 8px rgba(0,0,0,.3);font-style:normal}
.etb button{border:0;background:transparent;color:#fff;width:6mm;height:6mm;border-radius:1mm;font-size:3.4mm;line-height:6mm;cursor:pointer;padding:0;font-family:inherit}
.etb button:hover{background:rgba(255,255,255,.18)}
.etb button.grip{cursor:grab}
.etb button.danger:hover{background:#dc2626}
.etb .sep{width:0.3mm;background:rgba(255,255,255,.25);margin:1mm 0.5mm}
.etb.edit{background:#2563eb}
.rtb{position:absolute;right:-1mm;top:0;transform:translateY(-100%);z-index:19;display:none;gap:0.3mm;background:#374151;border-radius:1.2mm;padding:0.5mm}
.rtb button{border:0;background:transparent;color:#fff;width:5mm;height:5mm;border-radius:0.8mm;font-size:3mm;line-height:5mm;cursor:pointer;padding:0}
.rtb button:hover{background:rgba(255,255,255,.2)}
.f-cell:hover>.rtb,.f-row:hover .rtb{display:flex}
.f-cell,.f-row th{position:relative}
`;

// ---------------------------------------------------------------------------
// Skripty (běží v editoru i před tiskem)
// ---------------------------------------------------------------------------

function fitScript(t: Template): string {
  const fit = t.page.fit === "onePage";
  return `<script>
(function(){
  var root=document.documentElement,FIT=${fit ? "true" : "false"},base=${t.page.fontSize},done=false;
  function px(mmv){var d=document.createElement('div');d.style.cssText='position:absolute;visibility:hidden;height:'+mmv+'mm;width:1px;top:0;left:0';document.body.appendChild(d);var h=d.getBoundingClientRect().height;d.remove();return h;}
  function main(){return document.querySelector('.page[data-main]');}
  function overflow(){var p=main();if(!p)return 0;return p.getBoundingClientRect().height-px(296.6);}
  function apply(fs,sp){root.style.setProperty('--fs',fs+'pt');root.style.setProperty('--sp',String(sp));}
  function finish(pages,fs,over){if(done)return;done=true;root.dataset.fit='done';root.dataset.pages=String(pages);root.dataset.fontSize=String(fs);root.dataset.overflow=over?'1':'0';try{if(window.parent&&window.parent!==window)window.parent.postMessage({source:'jobidocs-doc',type:'fit',pages:pages,fontSize:fs,overflow:!!over},'*');}catch(e){}}
  function run(){
    try{
      var steps=[[base,1],[base-0.5,1],[base-0.5,0.85],[base-1,0.85],[base-1,0.7],[base-1.5,0.7],[base-2,0.6],[base-2.5,0.5]];
      var chosen=steps[0];apply(chosen[0],chosen[1]);
      if(FIT){for(var i=0;i<steps.length;i++){apply(steps[i][0],steps[i][1]);chosen=steps[i];if(overflow()<=0.5)break;}}
      var over=overflow();var pages=document.querySelectorAll('.page').length;
      if(over>0.5)pages+=Math.ceil(over/px(296.6));
      var tots=document.querySelectorAll('[data-page-total]');
      document.querySelectorAll('.page').forEach(function(p,i){p.querySelectorAll('[data-page-no]').forEach(function(e){e.textContent=String(i+1)});});
      for(var j=0;j<tots.length;j++)tots[j].textContent=String(pages);
      finish(pages,chosen[0],over>0.5);
    }catch(e){finish(1,base,false);}
  }
  window.addEventListener('error',function(){finish(1,base,false);});
  function ready(){var imgs=[].slice.call(document.images).filter(function(i){return !i.complete});var ps=imgs.map(function(i){return new Promise(function(r){i.onload=i.onerror=r})});var f=(document.fonts&&document.fonts.ready)?document.fonts.ready:Promise.resolve();return Promise.all(ps.concat([f]));}
  var t=setTimeout(run,3000);
  ready().then(function(){clearTimeout(t);run();},function(){clearTimeout(t);run();});
})();
</script>`;
}

/** Štítky proměnných pro čipy v editoru. */
function variableLabelsJson(): string {
  const o: Record<string, string> = {};
  for (const v of VARIABLES) o[v.key] = v.label;
  return JSON.stringify(o);
}

function editorScript(): string {
  return `<script>
(function(){
  var VARS=${variableLabelsJson()};
  var selected=null,editing=null,editOrig='',dragging=null,savedRange=null,toolbar=null;
  function post(m){m.source='jobidocs-doc';try{window.parent.postMessage(m,'*');}catch(e){}}
  function q(sel){return document.querySelector(sel);}
  function all(sel){return [].slice.call(document.querySelectorAll(sel));}
  function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}

  // ---- výběr + plovoucí lišta ----
  function clearSel(){all('.selected').forEach(function(x){x.classList.remove('selected')});if(toolbar){toolbar.remove();toolbar=null;}selected=null;}
  function select(el,notify){if(editing&&editing!==el&&!el.contains(editing))finishEdit(true);clearSel();if(!el)return;selected=el;el.classList.add('selected');showToolbar(el);if(notify){var k=el.hasAttribute('data-block')?'block':el.hasAttribute('data-slot-item')?'slotItem':'slot';post({type:'select',kind:k,id:el.getAttribute('data-block')||el.getAttribute('data-slot-item')||el.getAttribute('data-slot')});}}
  function btn(label,title,cls,fn){var b=document.createElement('button');b.type='button';b.textContent=label;b.title=title;if(cls)b.className=cls;b.addEventListener('mousedown',function(e){e.preventDefault();e.stopPropagation();});b.addEventListener('click',function(e){e.preventDefault();e.stopPropagation();fn();});return b;}
  function showToolbar(el){if(toolbar)toolbar.remove();toolbar=document.createElement('div');toolbar.className='etb';var isBlock=el.hasAttribute('data-block'),isItem=el.hasAttribute('data-slot-item'),isSlot=el.hasAttribute('data-slot');
    if(isBlock||isItem){var g=btn('⋮⋮','Táhnout','grip',function(){});g.draggable=true;g.addEventListener('dragstart',function(e){startDrag(el,e);});g.addEventListener('dragend',endDrag);toolbar.appendChild(g);}
    if(isBlock){toolbar.appendChild(btn('↑','Posunout výš','',function(){post({type:'moveBy',id:el.getAttribute('data-block'),delta:-1});}));toolbar.appendChild(btn('↓','Posunout níž','',function(){post({type:'moveBy',id:el.getAttribute('data-block'),delta:1});}));toolbar.appendChild(btn('⧉','Duplikovat','',function(){post({type:'duplicate',id:el.getAttribute('data-block')});}));}
    if(isSlot){toolbar.appendChild(btn('+','Přidat prvek','',function(){post({type:'addSlotItem',slot:el.getAttribute('data-slot')});}));}
    if(isBlock||isItem){toolbar.appendChild(btn('⚙','Vlastnosti','',function(){post({type:'properties'});}));var s=document.createElement('span');s.className='sep';toolbar.appendChild(s);toolbar.appendChild(btn('✕','Odebrat','danger',function(){post({type:'delete'});}));}
    el.appendChild(toolbar);positionToolbar(el);}
  function positionToolbar(el){if(!toolbar)return;var r=el.getBoundingClientRect();toolbar.style.right='0';toolbar.style.top='0';toolbar.style.transform='translateY(calc(-100% - 1.5mm))';if(r.top<40){toolbar.style.top='';toolbar.style.bottom='0';toolbar.style.transform='translateY(calc(100% + 1.5mm))';}}

  // ---- úpravy textu v dokumentu ----
  function chipify(src){var out='',re=/\\{\\{\\s*([\\w.]+)\\s*\\}\\}/g,last=0,m;while((m=re.exec(src))){out+=esc(src.slice(last,m.index)).replace(/\\n/g,'<br>');out+='<span class="var" contenteditable="false" data-var="'+esc(m[1])+'">'+esc(VARS[m[1]]||m[1])+'</span>';last=m.index+m[0].length;}out+=esc(src.slice(last)).replace(/\\n/g,'<br>');return out;}
  function serialize(el){var out='';function walk(n){for(var i=0;i<n.childNodes.length;i++){var c=n.childNodes[i];if(c.nodeType===3){out+=c.nodeValue;}else if(c.nodeType===1){var tag=c.tagName;if(c.classList.contains('var')){out+='{{'+c.getAttribute('data-var')+'}}';}else if(tag==='BR'){out+='\\n';}else if(tag==='DIV'||tag==='P'){if(out&&!/\\n$/.test(out))out+='\\n';walk(c);if(!/\\n$/.test(out))out+='\\n';}else{walk(c);}}}}walk(el);return out.replace(/\\u00a0/g,' ').replace(/\\n+$/,'');}
  function startEdit(el){if(editing===el)return;if(editing)finishEdit(true);editing=el;editOrig=el.innerHTML;el.innerHTML=chipify(el.getAttribute('data-src')||'')||'';el.setAttribute('contenteditable','true');el.setAttribute('spellcheck','false');el.focus();var sel=window.getSelection(),range=document.createRange();range.selectNodeContents(el);range.collapse(false);sel.removeAllRanges();sel.addRange(range);var owner=el.closest('[data-block],[data-slot-item]');if(owner&&owner!==selected)select(owner,true);if(toolbar){toolbar.classList.add('edit');var vb=btn('{ }','Vložit údaj (proměnnou)','',function(){saveRange();post({type:'pickVariable'});});vb.style.width='auto';vb.style.padding='0 1.5mm';vb.textContent='＋ údaj';toolbar.insertBefore(vb,toolbar.firstChild);}}
  function finishEdit(commit){if(!editing)return;var el=editing;editing=null;var value=serialize(el);el.removeAttribute('contenteditable');if(commit&&value!==(el.getAttribute('data-src')||'')){el.setAttribute('data-src',value);post({type:'edit',target:el.getAttribute('data-edit'),value:value});}else{el.innerHTML=editOrig;}if(toolbar)toolbar.classList.remove('edit');}
  function saveRange(){var s=window.getSelection();if(s&&s.rangeCount>0&&editing&&editing.contains(s.getRangeAt(0).startContainer))savedRange=s.getRangeAt(0).cloneRange();}
  function insertVariable(key,label){if(!editing)return;editing.focus();var s=window.getSelection();if(savedRange){s.removeAllRanges();s.addRange(savedRange);}var r=s.rangeCount?s.getRangeAt(0):null;if(!r){r=document.createRange();r.selectNodeContents(editing);r.collapse(false);}r.deleteContents();var chip=document.createElement('span');chip.className='var';chip.setAttribute('contenteditable','false');chip.setAttribute('data-var',key);chip.textContent=label||VARS[key]||key;r.insertNode(chip);var sp=document.createTextNode(' ');chip.parentNode.insertBefore(sp,chip.nextSibling);r.setStartAfter(sp);r.collapse(true);s.removeAllRanges();s.addRange(r);}
  document.addEventListener('selectionchange',saveRange);
  document.addEventListener('paste',function(e){if(!editing)return;e.preventDefault();var t=(e.clipboardData||window.clipboardData).getData('text/plain');document.execCommand('insertText',false,t);});
  document.addEventListener('focusout',function(e){if(editing&&e.target===editing)setTimeout(function(){if(editing===e.target&&document.activeElement!==e.target)finishEdit(true);},0);});

  // ---- klikání ----
  document.addEventListener('mousedown',function(e){if(editing&&!editing.contains(e.target)&&!(toolbar&&toolbar.contains(e.target)))finishEdit(true);});
  document.addEventListener('click',function(e){
    if(toolbar&&toolbar.contains(e.target))return;
    var ins=e.target.closest('.ins');if(ins){e.preventDefault();post({type:'insertBlock',index:Number(ins.getAttribute('data-insert'))});return;}
    var ed=e.target.closest('[data-edit]');
    var owner=e.target.closest('[data-block],[data-slot-item]');
    if(ed&&editing===ed)return;
    if(ed&&owner){if(selected===owner||e.detail>=2){e.preventDefault();select(owner,true);startEdit(ed);return;}}
    if(owner){e.preventDefault();select(owner,true);return;}
    var slot=e.target.closest('[data-slot]');if(slot){e.preventDefault();select(slot,true);if(slot.classList.contains('empty'))post({type:'addSlotItem',slot:slot.getAttribute('data-slot')});return;}
    clearSel();post({type:'select',kind:'none'});
  });
  document.addEventListener('dblclick',function(e){var ed=e.target.closest('[data-edit]');if(ed&&editing!==ed){e.preventDefault();var owner=ed.closest('[data-block],[data-slot-item]');if(owner)select(owner,true);startEdit(ed);}});

  // ---- klávesy ----
  document.addEventListener('keydown',function(e){
    var meta=e.metaKey||e.ctrlKey;
    if(editing){if(e.key==='Escape'){e.preventDefault();finishEdit(false);return;}var multi=editing.hasAttribute('data-multiline');if(e.key==='Enter'&&(!multi||meta)){e.preventDefault();finishEdit(true);return;}if(meta&&e.key.toLowerCase()==='z'){e.preventDefault();}return;}
    if(meta&&e.key.toLowerCase()==='z'){e.preventDefault();post({type:e.shiftKey?'redo':'undo'});return;}
    if(meta&&e.key.toLowerCase()==='d'&&selected&&selected.hasAttribute('data-block')){e.preventDefault();post({type:'duplicate',id:selected.getAttribute('data-block')});return;}
    if(e.key==='Escape'){clearSel();post({type:'select',kind:'none'});return;}
    if((e.key==='Delete'||e.key==='Backspace')&&selected&&!selected.hasAttribute('data-slot')){e.preventDefault();post({type:'delete'});return;}
    if(e.key==='Enter'&&selected){var ed=selected.querySelector('[data-edit]');if(ed){e.preventDefault();startEdit(ed);}}
  });

  // ---- řádky tabulky údajů ----
  all('.f-cell,.f-row').forEach(function(cell){var id=cell.getAttribute('data-row');var tb=document.createElement('div');tb.className='rtb';tb.appendChild(btn('↑','Řádek výš','',function(){post({type:'rowMove',id:id,delta:-1});}));tb.appendChild(btn('↓','Řádek níž','',function(){post({type:'rowMove',id:id,delta:1});}));tb.appendChild(btn('+','Přidat řádek pod','',function(){post({type:'rowAdd',afterId:id});}));tb.appendChild(btn('✕','Odebrat řádek','',function(){post({type:'rowDelete',id:id});}));(cell.tagName==='TR'?cell.querySelector('th'):cell).appendChild(tb);});

  // ---- přetahování ----
  function startDrag(el,e){dragging={kind:el.hasAttribute('data-slot-item')?'slotItem':'block',id:el.getAttribute('data-slot-item')||el.getAttribute('data-block'),el:el};el.classList.add('dragging');try{e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',dragging.id);e.dataTransfer.setDragImage(el,10,10);}catch(x){}}
  function clearDrop(){all('.drop-target,.drop-before,.drop-after').forEach(function(x){x.classList.remove('drop-target');x.classList.remove('drop-before');x.classList.remove('drop-after');});}
  function endDrag(){if(dragging&&dragging.el)dragging.el.classList.remove('dragging');clearDrop();dragging=null;}
  var body=q('.body[data-main]');
  all('[data-block],[data-slot-item]').forEach(function(el){var isSlot=el.hasAttribute('data-slot-item');var isTop=!isSlot&&body&&el.parentElement===body;if(!isSlot&&!isTop)return;el.setAttribute('draggable','true');el.addEventListener('dragstart',function(e){if(editing){e.preventDefault();return;}if(e.target!==el&&!e.target.classList.contains('grip')){/* povolit jen z prvku samotného */}startDrag(el,e);e.stopPropagation();});el.addEventListener('dragend',endDrag);});
  all('[data-slot]').forEach(function(slot){slot.addEventListener('dragover',function(e){if(!dragging||dragging.kind!=='slotItem')return;e.preventDefault();e.dataTransfer.dropEffect='move';clearDrop();slot.classList.add('drop-target');});slot.addEventListener('dragleave',function(){slot.classList.remove('drop-target');});slot.addEventListener('drop',function(e){if(!dragging||dragging.kind!=='slotItem')return;e.preventDefault();var items=all('[data-slot-item]').filter(function(i){return i.parentElement===slot});var idx=items.length;for(var i=0;i<items.length;i++){var r=items[i].getBoundingClientRect();if(e.clientY<r.top+r.height/2){idx=i;break;}}post({type:'moveSlotItem',id:dragging.id,toSlot:slot.getAttribute('data-slot'),index:idx});clearDrop();});});
  if(body){body.addEventListener('dragover',function(e){if(!dragging||dragging.kind!=='block')return;e.preventDefault();e.dataTransfer.dropEffect='move';clearDrop();var t=e.target.closest('[data-block]');while(t&&t.parentElement!==body)t=t.parentElement.closest('[data-block]');if(t){var r=t.getBoundingClientRect();t.classList.add(e.clientY<r.top+r.height/2?'drop-before':'drop-after');}else body.classList.add('drop-target');});
    body.addEventListener('drop',function(e){if(!dragging||dragging.kind!=='block')return;e.preventDefault();var blocks=[].slice.call(body.children).filter(function(c){return c.hasAttribute('data-block')});var idx=blocks.length;for(var i=0;i<blocks.length;i++){var r=blocks[i].getBoundingClientRect();if(e.clientY<r.top+r.height/2){idx=i;break;}}post({type:'moveBlock',id:dragging.id,toIndex:idx});clearDrop();});}

  // ---- zprávy od editoru ----
  window.addEventListener('message',function(e){var m=e.data||{};
    if(m.type==='jobidocs:select'){var el=null;if(m.kind==='block')el=q('[data-block="'+m.id+'"]');if(m.kind==='slotItem')el=q('[data-slot-item="'+m.id+'"]');if(m.kind==='slot')el=q('[data-slot="'+m.id+'"]');if(el){if(selected!==el)select(el,false);if(m.scroll)el.scrollIntoView({block:'nearest',behavior:'smooth'});}else{clearSel();}}
    if(m.type==='jobidocs:insertVariable')insertVariable(m.key,m.label);
    if(m.type==='jobidocs:edit'&&m.kind&&m.id){var owner=m.kind==='block'?q('[data-block="'+m.id+'"]'):q('[data-slot-item="'+m.id+'"]');var ed=owner&&owner.querySelector('[data-edit]');if(ed){select(owner,false);startEdit(ed);}}
  });
  window.addEventListener('resize',function(){if(selected)positionToolbar(selected);});
  post({type:'ready'});
})();
</script>`;
}

// ---------------------------------------------------------------------------
// Dokument
// ---------------------------------------------------------------------------

export function renderDocument(input: RenderInput): string {
  const { template, data, brand, theme, options } = input;
  const editor = options.mode === "editor";
  const ctx: Ctx = {
    data,
    brand,
    theme,
    template,
    editor,
    placeholders: editor && options.showPlaceholders === true,
    currency: data.totals?.currency ?? "CZK",
  };

  const rendered = template.blocks.map((b) => renderBlock(ctx, b));
  let bodyHtml: string;
  if (editor) {
    const ins = (i: number) => `<div class="ins" data-insert="${i}"><span class="ins-btn" title="Vložit blok sem">+</span></div>`;
    const parts: string[] = [ins(0)];
    rendered.forEach((html, i) => {
      if (html) parts.push(html, ins(i + 1));
    });
    bodyHtml = parts.join("");
  } else {
    bodyHtml = rendered.join("");
  }
  const mainPage = `<section class="page" data-main data-page="1">${renderHeader(ctx)}<main class="body" data-main>${bodyHtml}</main>${renderBottom(ctx)}</section>`;

  const photoBlock = template.blocks.find((b): b is Extract<Block, { type: "photos" }> => b.type === "photos" && b.mode === "pages");
  let photoPages = "";
  if (photoBlock && data.photos && data.photos.length > 0 && blockVisible(ctx, photoBlock)) {
    const n = data.photos.length;
    photoPages = data.photos
      .map((url, i) => {
        const title = `${photoBlock.title?.trim() ? sub(ctx, photoBlock.title) : "Fotodokumentace"} ${i + 1}/${n}`;
        return `<section class="page photo-page" data-page="${i + 2}">${renderHeader(ctx, title)}<div class="photo"><img src="${attr(url)}" alt="Foto ${i + 1}" onerror="this.style.display='none'"></div></section>`;
      })
      .join("");
  }

  // Roboto je přibalené (tisk nezávisí na síti); Inter se stahuje z Google Fonts a bez internetu spadne na systémové písmo.
  const fontLink =
    theme.font === "roboto"
      ? `<style>${ROBOTO_FONT_FACES}</style>`
      : theme.font === "inter"
        ? `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;700;800&display=swap">`
        : "";

  return `<!DOCTYPE html>
<html lang="cs">
<head>
<meta charset="utf-8">
<title>${escapeHtml(data.title?.trim() || DOC_TYPE_LABELS[template.docType])}${data.number ? " " + escapeHtml(data.number) : ""}</title>
${fontLink}
<style>${css(template, theme, editor)}</style>
</head>
<body class="${editor ? "mode-editor" : "mode-print"} style-${theme.style}">
${mainPage}${photoPages}
${fitScript(template)}
${editor ? editorScript() : ""}
</body>
</html>`;
}
