/**
 * Výchozí šablony, značka a motiv.
 *
 * Vlastní rozvržení JobiDocs: logo a servis vlevo, typ dokumentu s velkým
 * číslem vpravo, údaje v mřížce, právní text ve dvou sloupcích, podpisy
 * v zóně u spodního okraje. Výchozí šablona žije tady, v jádru – servis,
 * který si nic nenastavil, tiskne přesně to, co vidí v editoru.
 */
import type { Block, Brand, DocType, DocumentsV2, FieldRow, SlotItem, Template, Theme, ThemeStyle } from "./types.js";

let seq = 0;
/** Stabilní id pro výchozí šablony (deterministické, aby snapshoty seděly). */
function id(prefix: string): string {
  seq += 1;
  return `${prefix}-${seq}`;
}

export function newId(prefix = "b"): string {
  const rnd = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${Date.now().toString(36)}-${rnd}`;
}

export const DEFAULT_BRAND: Brand = {
  reviewText: "Ohodnoťte náš servis",
};

export const DEFAULT_THEME: Theme = {
  style: "modern",
  font: "roboto",
  accent: "#0e7c86",
  tableLines: "rows",
  color: "color",
};

export const THEME_PRESETS: { style: ThemeStyle; name: string; description: string; accent: string }[] = [
  { style: "modern", name: "Moderní", description: "Barevný pruh v hlavičce, údaje v mřížce, vzdušné.", accent: "#0e7c86" },
  { style: "plain", name: "Strohý", description: "Černobílý, hustý, bez ozdob. Šetří toner.", accent: "#111111" },
  { style: "form", name: "Formulář", description: "Rámečky kolem polí, zřetelné kolonky pro podpis a razítko.", accent: "#1f4e79" },
];

export const LEGAL_TEXTS: Partial<Record<DocType, string>> = {
  zakazkovy_list:
    "Předáním zařízení do servisu zákazník objednává diagnostiku a případnou opravu popsanou výše a zavazuje se uhradit sjednanou cenu. Překročí-li skutečná cena opravy uvedený odhad, servis si před pokračováním vyžádá souhlas zákazníka.\n\nServis neodpovídá za data uložená v zařízení; zákazník potvrzuje, že si před předáním pořídil zálohu. Nevyzvedne-li zákazník zařízení do 30 dnů od výzvy k převzetí, může servis účtovat skladné 20 Kč za každý započatý den; zařízení nevyzvednuté do 6 měsíců od výzvy může servis po předchozím upozornění prodat na účet zákazníka (§ 2609 občanského zákoníku).\n\nZákazník podpisem stvrzuje správnost uvedených údajů a souhlas s těmito podmínkami.",
  zarucni_list:
    "Na provedenou práci a použité náhradní díly poskytuje servis záruku {{warranty.duration}} ode dne převzetí zařízení zákazníkem. Práva spotřebitele z vadného plnění podle občanského zákoníku (24 měsíců od převzetí) tím nejsou dotčena. Záruka se vztahuje na vadu, která byla předmětem opravy, a na použité díly; nekryje mechanické poškození, zásah kapaliny, neodborný zásah ani běžné opotřebení.\n\nZákazník při převzetí zkontroluje stav zařízení a zjištěné vnější poškození oznámí hned. Reklamaci lze uplatnit v provozovně servisu uvedené v hlavičce.",
  prijemka_reklamace:
    "Servis převzal zařízení k posouzení reklamace a tímto potvrzuje, kdy byla uplatněna, co je jejím obsahem a jaký způsob vyřízení zákazník požaduje. Reklamace bude vyřízena bez zbytečného odkladu, nejpozději do 30 dnů od uplatnění, nedohodnou-li se strany na delší lhůtě; o způsobu a datu vyřízení vydá servis písemné potvrzení. Uznaná reklamace se řeší bezplatnou opravou nebo výměnou dílu.",
  vydejka_reklamace: "Zákazník podpisem potvrzuje převzetí zařízení po vyřízení reklamace a seznámení s jejím výsledkem.",
  smlouva_zapujcka:
    "Servis půjčuje zákazníkovi výše uvedené náhradní zařízení bezplatně na dobu opravy zakázky {{number}}. Zákazník zařízení převzal funkční a bez viditelného poškození, zavazuje se s ním zacházet šetrně, nepředávat ho třetí osobě a vrátit ho při vyzvednutí své opravy, nejpozději však do 3 dnů od výzvy servisu, ve stavu, v jakém ho převzal, včetně příslušenství. Za poškození, ztrátu nebo odcizení odpovídá zákazník v plné výši. Zákazník před vrácením odstraní své účty a data; servis zařízení po vrácení uvede do továrního nastavení.",
};

function row(label: string, value: string): FieldRow {
  return { id: id("r"), label, value };
}

function fields(rows: FieldRow[], title?: string, layout: "grid" | "table" = "grid"): Block {
  return { id: id("b"), type: "fields", title, rows, layout };
}

function text(content: string, opts?: { title?: string; size?: "normal" | "small"; align?: "left" | "justify" | "center"; columns?: 1 | 2; when?: "always" | "notEmpty" }): Block {
  return { id: id("b"), type: "text", content, size: opts?.size ?? "normal", align: opts?.align ?? "left", columns: opts?.columns, title: opts?.title, when: opts?.when };
}

function spacer(mm: number): Block {
  return { id: id("b"), type: "spacer", height: mm };
}

function titleSlot(): SlotItem {
  return { id: id("s"), type: "title", style: "plain", showNumber: true, showDate: true };
}

function brandSlot(): SlotItem {
  return { id: id("s"), type: "brand", showContact: true };
}

function logoSlot(): SlotItem {
  return { id: id("s"), type: "logo", height: 14 };
}

function stampSlot(label = "Razítko a podpis servisu"): SlotItem {
  return { id: id("s"), type: "stamp", label, height: 20 };
}

function signatureSlot(label: string): SlotItem {
  return { id: id("s"), type: "signature", label, width: 55 };
}

const DEFAULT_MARGINS = { top: 12, right: 14, bottom: 12, left: 14 };

function emptySlots(): Template["slots"] {
  return { headerLeft: [], headerRight: [], bottomLeft: [], bottomCenter: [], bottomRight: [] };
}

function base(docType: DocType): Template {
  return {
    schemaVersion: 2,
    docType,
    page: { margins: { ...DEFAULT_MARGINS }, fit: "onePage", fontSize: 10 },
    slots: { ...emptySlots(), headerLeft: [logoSlot(), brandSlot()], headerRight: [titleSlot()] },
    blocks: [],
  };
}

function zakazkovyList(): Template {
  const t = base("zakazkovy_list");
  t.blocks = [
    fields([row("Jméno", "{{customer.name}}"), row("Telefon", "{{customer.phone}}"), row("E-mail", "{{customer.email}}"), row("Adresa", "{{customer.address}}")], "Zákazník"),
    fields(
      [
        row("Zařízení", "{{device.name}}"),
        row("Sériové číslo / IMEI", "{{device.serialOrImei}}"),
        row("Heslo / kód obrazovky", "{{device.passcode}}"),
        row("Příslušenství", "{{device.accessories}}"),
        row("Stav při převzetí", "{{device.condition}}"),
        row("Požadovaná oprava", "{{device.issue}}"),
      ],
      "Zařízení"
    ),
    fields([row("Přijato", "{{dates.received}}"), row("Předpokládané dokončení", "{{dates.eta}}"), row("Odhad ceny", "{{totals.estimated}}"), row("Způsob vrácení", "{{handoff.return}}")], "Zakázka"),
    text(LEGAL_TEXTS.zakazkovy_list!, { size: "small", align: "justify", columns: 2 }),
  ];
  t.slots.bottomLeft = [signatureSlot("Zákazník – předání do opravy")];
  t.slots.bottomCenter = [stampSlot("Za servis převzal")];
  t.slots.bottomRight = [signatureSlot("Zákazník – vyzvednutí z opravy")];
  return t;
}

function zarucniList(): Template {
  const t = base("zarucni_list");
  t.blocks = [
    fields([row("Zákazník", "{{customer.name}}"), row("Telefon", "{{customer.phone}}"), row("Zařízení", "{{device.name}}"), row("Sériové číslo / IMEI", "{{device.serialOrImei}}"), row("Přijato", "{{dates.received}}"), row("Dokončeno", "{{dates.completed}}")], "Zakázka"),
    { id: id("b"), type: "items", title: "Provedené práce", columns: ["name", "total"], showTotal: true, when: "notEmpty" },
    { id: id("b"), type: "warranty", title: "Záruka", when: "notEmpty" },
    text(LEGAL_TEXTS.zarucni_list!, { size: "small", align: "justify", columns: 2 }),
  ];
  t.slots.bottomLeft = [signatureSlot("Zákazník")];
  t.slots.bottomRight = [stampSlot()];
  return t;
}

function diagnostika(): Template {
  const t = base("diagnosticky_protokol");
  t.blocks = [
    fields([row("Zákazník", "{{customer.name}}"), row("Zařízení", "{{device.name}}"), row("Sériové číslo / IMEI", "{{device.serialOrImei}}"), row("Stav při převzetí", "{{device.condition}}"), row("Přijato", "{{dates.received}}"), row("Diagnostika provedena", "{{dates.diagnosed}}")], "Zakázka"),
    text("{{diagnostic}}", { title: "Zjištěný stav a závady", when: "notEmpty" }),
    { id: id("b"), type: "items", title: "Doporučený postup a cena", columns: ["name", "total"], showTotal: true, when: "notEmpty" },
    { id: id("b"), type: "photos", mode: "pages", when: "notEmpty" },
  ];
  t.slots.bottomRight = [stampSlot("Technik")];
  return t;
}

function prijemka(): Template {
  const t = base("prijemka_reklamace");
  t.blocks = [
    fields([row("Jméno", "{{customer.name}}"), row("Telefon", "{{customer.phone}}"), row("E-mail", "{{customer.email}}"), row("Původní zakázka", "{{relatedNumber}}")], "Zákazník"),
    fields([row("Zařízení", "{{device.name}}"), row("Sériové číslo / IMEI", "{{device.serialOrImei}}"), row("Stav při převzetí", "{{device.condition}}"), row("Reklamovaná závada", "{{device.issue}}"), row("Přijato k reklamaci", "{{dates.received}}")], "Reklamace"),
    text(LEGAL_TEXTS.prijemka_reklamace!, { size: "small", align: "justify" }),
  ];
  t.slots.bottomLeft = [signatureSlot("Zákazník")];
  t.slots.bottomRight = [signatureSlot("Za servis převzal")];
  return t;
}

function vydejka(): Template {
  const t = base("vydejka_reklamace");
  t.blocks = [
    fields([row("Jméno", "{{customer.name}}"), row("Telefon", "{{customer.phone}}"), row("Zařízení", "{{device.name}}"), row("Sériové číslo / IMEI", "{{device.serialOrImei}}"), row("Přijato k reklamaci", "{{dates.received}}"), row("Vydáno", "{{dates.released}}")], "Reklamace"),
    text("{{note}}", { title: "Výsledek reklamace", when: "notEmpty" }),
    { id: id("b"), type: "items", title: "Provedené úkony", columns: ["name", "total"], showTotal: true, when: "notEmpty" },
    text(LEGAL_TEXTS.vydejka_reklamace!, { size: "small", align: "justify" }),
  ];
  t.slots.bottomLeft = [signatureSlot("Zákazník")];
  t.slots.bottomRight = [stampSlot()];
  return t;
}

function faktura(): Template {
  const t = base("faktura");
  t.blocks = [
    {
      id: id("b"),
      type: "columns",
      left: [fields([row("Název", "{{service.name}}"), row("IČO", "{{service.ico}}"), row("DIČ", "{{service.dic}}"), row("Adresa", "{{service.address}}"), row("E-mail", "{{service.email}}"), row("Telefon", "{{service.phone}}")], "Dodavatel", "table")],
      right: [fields([row("Název", "{{customer.name}}"), row("IČO", "{{customer.ico}}"), row("DIČ", "{{customer.dic}}"), row("Adresa", "{{customer.address}}"), row("E-mail", "{{customer.email}}")], "Odběratel", "table")],
    },
    fields([row("Datum vystavení", "{{dates.issued}}"), row("Datum zdanitelného plnění", "{{dates.taxable}}"), row("Datum splatnosti", "{{dates.due}}"), row("Variabilní symbol", "{{payment.vs}}"), row("Zakázka", "{{relatedNumber}}")]),
    { id: id("b"), type: "items", title: "Položky", columns: ["name", "qty", "unit", "unitPrice", "vatRate", "total"], showTotal: false },
    { id: id("b"), type: "vatSummary" },
    { id: id("b"), type: "payment", title: "Platební údaje", showQr: true },
    text("{{note}}", { size: "small", when: "notEmpty" }),
    spacer(2),
  ];
  t.slots.bottomLeft = [{ id: id("s"), type: "contact" }];
  t.slots.bottomRight = [{ id: id("s"), type: "pageNumber" }];
  return t;
}

function zapujcka(): Template {
  const t = base("smlouva_zapujcka");
  t.blocks = [
    fields([row("Jméno", "{{customer.name}}"), row("Telefon", "{{customer.phone}}"), row("E-mail", "{{customer.email}}"), row("Adresa", "{{customer.address}}")], "Zákazník"),
    fields(
      [
        row("Zařízení", "{{loaner.name}}"),
        row("Sériové číslo / IMEI", "{{loaner.serial}}"),
        row("Příslušenství", "{{loaner.accessories}}"),
        row("Kauce", "{{loaner.deposit}}"),
        row("Půjčeno dne", "{{loaner.lentAt}}"),
        row("Vráceno dne", "{{loaner.returnedAt}}"),
      ],
      "Náhradní zařízení"
    ),
    fields([row("Zakázka", "{{number}}"), row("Zařízení v opravě", "{{device.name}}"), row("Předpokládané dokončení", "{{dates.eta}}")], "Souvisí s opravou"),
    text("{{loaner.note}}", { title: "Poznámka", when: "notEmpty" }),
    text(LEGAL_TEXTS.smlouva_zapujcka!, { size: "small", align: "justify", columns: 2 }),
    // Věta o kauci jen když nějaká je – bez ní by zněla „proti složené kauci bez kauce“.
    text("Zákazník složil kauci {{loaner.depositText}}; servis je oprávněn započíst proti ní škodu. Kauce se vrací při vrácení nepoškozeného zařízení.", { size: "small", align: "justify", when: "notEmpty" }),
  ];
  t.slots.bottomLeft = [signatureSlot("Zákazník – převzetí zařízení")];
  t.slots.bottomCenter = [stampSlot("Za servis")];
  t.slots.bottomRight = [signatureSlot("Zákazník – vrácení zařízení")];
  return t;
}

const BUILDERS: Record<DocType, () => Template> = {
  zakazkovy_list: zakazkovyList,
  zarucni_list: zarucniList,
  diagnosticky_protokol: diagnostika,
  prijemka_reklamace: prijemka,
  vydejka_reklamace: vydejka,
  faktura,
  smlouva_zapujcka: zapujcka,
};

/** Výchozí šablona dokumentu. Vždy nová instance (dá se bez obav upravovat). */
export function defaultTemplate(docType: DocType): Template {
  seq = 0;
  return BUILDERS[docType]();
}

export function defaultDocuments(): DocumentsV2 {
  return { schemaVersion: 2, brand: { ...DEFAULT_BRAND }, theme: { ...DEFAULT_THEME }, templates: {} };
}

/** Šablona servisu, nebo výchozí, když si ji ještě neupravil. */
export function templateFor(docs: DocumentsV2 | null | undefined, docType: DocType): Template {
  const t = docs?.templates?.[docType];
  return t ? normalizeTemplate(t) : defaultTemplate(docType);
}

/**
 * Starší znění záručního textu v už uložených šablonách.
 *
 * Do verze s {{warranty.duration}} se počet měsíců dosazoval jako holé číslo
 * a slovo „měsíců“ bylo v šabloně napsané natvrdo. Servisu, který délku
 * záruky nemá nastavenou, tak na papíře zbyla díra („záruku  měsíců“),
 * a u 21 nebo 24 měsíců navíc špatný tvar slova. Šablony si servisy ukládají
 * do databáze, takže samotná změna výchozí šablony na ně nedosáhne – znění
 * se proto přepisuje při každém načtení.
 */
const STARY_ZARUCNI_TEXT = "{{warranty.months}} měsíců";
const NOVY_ZARUCNI_TEXT = "{{warranty.duration}}";

function opravStaryZarucniText(t: Template): Template {
  const json = JSON.stringify(t);
  if (!json.includes(STARY_ZARUCNI_TEXT)) return t;
  try {
    return JSON.parse(json.split(STARY_ZARUCNI_TEXT).join(NOVY_ZARUCNI_TEXT)) as Template;
  } catch {
    return t;
  }
}

/** Doplní chybějící pole (starší uložené šablony, ručně editovaný JSON). Nikdy nevyhodí výjimku. */
export function normalizeTemplate(vstup: Template): Template {
  const t = opravStaryZarucniText(vstup);
  const slots = { ...emptySlots() };
  for (const k of Object.keys(slots) as (keyof typeof slots)[]) {
    const arr = (t.slots as Record<string, unknown> | undefined)?.[k];
    slots[k] = Array.isArray(arr) ? (arr.filter((i) => i && typeof i === "object" && typeof (i as SlotItem).type === "string" && typeof (i as SlotItem).id === "string") as SlotItem[]) : [];
  }
  const fontSize = Number(t.page?.fontSize);
  return {
    schemaVersion: 2,
    docType: t.docType,
    page: {
      margins: { ...DEFAULT_MARGINS, ...(t.page?.margins ?? {}) },
      fit: t.page?.fit === "auto" ? "auto" : "onePage",
      fontSize: Number.isFinite(fontSize) && fontSize >= 6 && fontSize <= 14 ? fontSize : 10,
    },
    slots,
    blocks: Array.isArray(t.blocks) ? t.blocks.filter((b) => b && typeof b === "object" && typeof (b as Block).type === "string" && typeof (b as Block).id === "string") : [],
  };
}

export function normalizeDocuments(raw: unknown): DocumentsV2 {
  const d = (raw && typeof raw === "object" ? raw : {}) as Partial<DocumentsV2>;
  const templates: DocumentsV2["templates"] = {};
  for (const [k, v] of Object.entries(d.templates ?? {})) {
    if (v && typeof v === "object") templates[k as DocType] = normalizeTemplate({ ...(v as Template), docType: k as DocType });
  }
  const theme = { ...DEFAULT_THEME, ...(d.theme ?? {}) };
  if (!["modern", "plain", "form"].includes(theme.style)) theme.style = "modern";
  if (!/^#[0-9a-fA-F]{6}$/.test(theme.accent)) theme.accent = DEFAULT_THEME.accent;
  return {
    schemaVersion: 2,
    brand: { ...DEFAULT_BRAND, ...(d.brand ?? {}) },
    theme,
    templates,
  };
}
