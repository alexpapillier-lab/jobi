/**
 * Stránka „Dnes“ – čistá logika: jak se zakázky roztřídí do sekcí a jak se
 * v nich řadí.
 *
 * Technik chce ráno jednu obrazovku bez klikání: co je po termínu, co má
 * dnes dokončit, co čeká na díl nebo na zákazníka, co je připravené
 * k převzetí, co má přidělené a kdo má na dnešek rezervaci. Seznam zakázek
 * to s filtry umí také, ale je to pět kliknutí a pořád jen jeden pohled.
 *
 * Stavy si každý servis pojmenovává sám, a vlastnost mají jen jednu
 * (`isFinal`). Kde to jde, pozná se sekce z vlastností zakázky, ne ze
 * jména stavu:
 *   - termín = `expected_completion_at` („Předpokládaný termín dokončení“),
 *   - čeká na díl = na zakázku je objednaný díl, který ještě nepřišel
 *     (položka objednávky s `ticket_id` v návrhu nebo objednané),
 *   - čeká na zákazníka = odeslaná cenová nabídka bez rozhodnutí
 *     (`quote_status = "sent"`),
 *   - přidělené mně = `assigned_to` je přihlášený uživatel.
 * Jen „připraveno k převzetí“ a stav typu „Čeká na díl“ bez objednávky
 * v Jobi vlastnost nemají – ty se poznají podle klíče a názvu stavu (jako
 * storno v `stornoStav.ts`), a když servis žádný takový stav nemá, bere se
 * za „připraveno“ poslední nekoncový stav v pořadí (typicky Připraveno /
 * Hotovo před Vydáno).
 */

export type ZakazkaDnes = {
  id: string;
  code: string | null;
  /** Zařízení (sloupec `title`). */
  title: string;
  customerName: string;
  status: string | null;
  createdAt: string;
  updatedAt: string | null;
  /** Předpokládaný termín dokončení; null = bez termínu. */
  expectedAt: string | null;
  assignedTo: string | null;
  branchId: string | null;
  locationBranchId: string | null;
  /** Stav cenové nabídky z portálu; chybí na databázi bez portálových sloupců. */
  quoteStatus: string | null;
};

export type StavDnes = { key: string; label: string; isFinal: boolean };

export type RezervaceDnes = {
  id: string;
  status: string;
  customerName: string;
  deviceLabel: string;
  repairName: string | null;
  preferredAt: string | null;
  ticketId: string | null;
};

export type SekceKlic = "po_terminu" | "dnes_termin" | "ceka_dil" | "ceka_zakaznik" | "k_prevzeti" | "moje";

/** Řádek databáze → zakázka pro Dnes. Neznámé tvary se nesmí propsat jako „undefined“. */
export function mapujZakazkuDnes(r: Record<string, unknown>): ZakazkaDnes {
  const s = (v: unknown) => (typeof v === "string" && v ? v : null);
  return {
    id: String(r.id ?? ""),
    code: s(r.code),
    title: s(r.title) ?? "Zařízení",
    customerName: s(r.customer_name) ?? "",
    status: s(r.status),
    createdAt: s(r.created_at) ?? new Date(0).toISOString(),
    updatedAt: s(r.updated_at),
    expectedAt: s(r.expected_completion_at),
    assignedTo: s(r.assigned_to),
    branchId: s(r.branch_id),
    locationBranchId: s(r.location_branch_id),
    quoteStatus: s(r.quote_status),
  };
}

export function mapujRezervaciDnes(r: Record<string, unknown>): RezervaceDnes {
  const s = (v: unknown) => (typeof v === "string" && v ? v : null);
  return {
    id: String(r.id ?? ""),
    status: s(r.status) ?? "new",
    customerName: s(r.customer_name) ?? "",
    deviceLabel: s(r.device_label) ?? "",
    repairName: s(r.repair_name),
    preferredAt: s(r.preferred_at),
    ticketId: s(r.ticket_id),
  };
}

// ---------------------------------------------------------------------------
// Role stavů
// ---------------------------------------------------------------------------

/** Malá písmena bez diakritiky. */
function norm(s: string | null | undefined): string {
  return (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/* „Připraveno k převzetí“, „Čeká na vyzvednutí“, „Hotovo“. Holé „převzato“
   schválně ne – tak si servisy často pojmenovávají příjem od zákazníka. */
const K_PREVZETI_NAZEV = /\b(k|na) (prevzeti|vyzvednuti)\b|vyzvednut|\bpripraven|\bhotov/;
const K_PREVZETI_KLIC = /(ready|pickup|pick_up|hotov|pripraven|vyzved)/;
/* „Čeká na díl“, „Objednán díl“, „Čeká na součástky“, „U dodavatele“.
   Slovo „díl“ se hledá celé – jinak by sedlo i na „V dílně“. */
const DIL_NAZEV = /\bdil(u|y|em|ech)?\b|\bsoucast|\bobjedn|\bdodavatel/;
const DIL_KLIC = /(^|[_-])(parts?|dil|dily|objednano|ordered|supplier)([_-]|$)/;
/* „Čeká na zákazníka“, „Čeká na schválení“, „Nabídka odeslána“. */
const ZAKAZNIK_NAZEV = /zakaznik|klient|schval|nabid|vyjadren|odsouhlas|souhlas/;
const ZAKAZNIK_KLIC = /(customer|client|approval|approve|quote|schval|zakaznik)/;

export type RoleStavu = {
  kPrevzeti: ReadonlySet<string>;
  cekaNaDil: ReadonlySet<string>;
  cekaNaZakaznika: ReadonlySet<string>;
};

/**
 * Které stavy servisu znamenají „připraveno k převzetí“, „čeká na díl“
 * a „čeká na zákazníka“. Koncové stavy nikdy – to už je vydáno.
 *
 * Převzetí má přednost: „Čeká na vyzvednutí zákazníkem“ je hotová zakázka,
 * ne zakázka, která čeká na rozhodnutí zákazníka.
 */
export function rozpoznejRoleStavu(stavy: readonly StavDnes[]): RoleStavu {
  const kPrevzeti = new Set<string>();
  const cekaNaDil = new Set<string>();
  const cekaNaZakaznika = new Set<string>();
  const nekoncove = stavy.filter((s) => !s.isFinal);
  for (const s of nekoncove) {
    const n = norm(s.label);
    const k = norm(s.key);
    if (K_PREVZETI_NAZEV.test(n) || K_PREVZETI_KLIC.test(k)) kPrevzeti.add(s.key);
    else if (DIL_NAZEV.test(n) || DIL_KLIC.test(k)) cekaNaDil.add(s.key);
    else if (ZAKAZNIK_NAZEV.test(n) || ZAKAZNIK_KLIC.test(k)) cekaNaZakaznika.add(s.key);
  }
  /* Servis bez stavu „Připraveno“: poslední nekoncový stav v pořadí, pokud to
     není ten první (servis s jediným nekoncovým stavem by jinak měl všechno
     „připravené“) a nemá jinou roli. */
  if (kPrevzeti.size === 0 && nekoncove.length >= 2) {
    const posledni = nekoncove[nekoncove.length - 1];
    if (!cekaNaDil.has(posledni.key) && !cekaNaZakaznika.has(posledni.key)) kPrevzeti.add(posledni.key);
  }
  return { kPrevzeti, cekaNaDil, cekaNaZakaznika };
}

// ---------------------------------------------------------------------------
// Čas
// ---------------------------------------------------------------------------

export function zacatekDne(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function konecDne(d: Date): Date {
  const x = zacatekDne(d);
  x.setDate(x.getDate() + 1);
  return x;
}

function cas(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? null : t;
}

/** Je čas v kalendářním dni `ted` (místní čas)? */
export function jeDnes(iso: string | null | undefined, ted: Date): boolean {
  const t = cas(iso);
  if (t === null) return false;
  return t >= zacatekDne(ted).getTime() && t < konecDne(ted).getTime();
}

/** Celé dny od okamžiku do teď (0 = dnes). */
export function dnuOd(iso: string | null | undefined, ted: Date): number {
  const t = cas(iso);
  if (t === null) return 0;
  const den = 24 * 3600_000;
  return Math.max(0, Math.round((zacatekDne(ted).getTime() - zacatekDne(new Date(t)).getTime()) / den));
}

// ---------------------------------------------------------------------------
// Roztřídění
// ---------------------------------------------------------------------------

export type VstupDnes = {
  zakazky: readonly ZakazkaDnes[];
  stavy: readonly StavDnes[];
  /** Zakázky s objednaným dílem, který ještě nepřišel. */
  zakazkySDilemNaCeste?: ReadonlySet<string>;
  rezervace?: readonly RezervaceDnes[];
  mujId: string | null;
  /** „Jen moje“: sekce se zúží na zakázky přidělené mně. */
  jenMoje: boolean;
  ted: Date;
};

export type SekceDnes = Record<SekceKlic, ZakazkaDnes[]> & { rezervace: RezervaceDnes[] };

/**
 * Roztřídí zakázky do sekcí stránky Dnes. Koncové (vydané) zakázky nejsou
 * nikde. Zakázka může být ve víc sekcích – každá odpovídá na jinou otázku
 * (po termínu *a* čeká na díl je přesně ta, kvůli které se volá zákazníkovi).
 * Jen připravená k převzetí se nepočítá do termínů: dokončit už ji není
 * potřeba.
 *
 * Neznámý stav (mezitím smazaný) se bere jako rozpracovaný, ať zakázka
 * z přehledu nezmizí.
 */
export function roztridDnes(v: VstupDnes): SekceDnes {
  const role = rozpoznejRoleStavu(v.stavy);
  const koncove = new Set(v.stavy.filter((s) => s.isFinal).map((s) => s.key));
  const ted = v.ted.getTime();
  const konec = konecDne(v.ted).getTime();
  const dilNaCeste = v.zakazkySDilemNaCeste ?? new Set<string>();

  const out: SekceDnes = { po_terminu: [], dnes_termin: [], ceka_dil: [], ceka_zakaznik: [], k_prevzeti: [], moje: [], rezervace: [] };

  for (const z of v.zakazky) {
    const st = z.status ?? "";
    if (koncove.has(st)) continue;
    const moje = !!v.mujId && z.assignedTo === v.mujId;
    if (moje) out.moje.push(z);
    if (v.jenMoje && !moje) continue;

    const pripraveno = role.kPrevzeti.has(st);
    if (pripraveno) {
      out.k_prevzeti.push(z);
    } else {
      const termin = cas(z.expectedAt);
      if (termin !== null && termin < ted) out.po_terminu.push(z);
      else if (termin !== null && termin < konec) out.dnes_termin.push(z);
    }
    if (!pripraveno && (role.cekaNaDil.has(st) || dilNaCeste.has(z.id))) out.ceka_dil.push(z);
    if (!pripraveno && (role.cekaNaZakaznika.has(st) || z.quoteStatus === "sent")) out.ceka_zakaznik.push(z);
  }

  out.rezervace = (v.rezervace ?? []).filter((r) => (r.status === "new" || r.status === "confirmed") && jeDnes(r.preferredAt, v.ted));
  return seradSekce(out);
}

/** Starší napřed; bez času na konec. */
function vzestupne(a: number | null, b: number | null): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a - b;
}

/** Kdy se zakázky naposledy dotkl někdo (a přibližně kdy se změnil stav). */
function posledniZmena(z: ZakazkaDnes): number | null {
  return cas(z.updatedAt) ?? cas(z.createdAt);
}

const podleKodu = (a: ZakazkaDnes, b: ZakazkaDnes) => (a.code ?? "").localeCompare(b.code ?? "", "cs");

/**
 * Řazení v sekcích:
 *   - po termínu a dnešní termín: nejdřívější termín nahoře (nejdéle po termínu první),
 *   - čeká na díl / na zákazníka / k převzetí: nejdéle ležící nahoře,
 *   - přidělené mně: podle termínu, bez termínu na konec, pak nejstarší příjem,
 *   - rezervace: podle času.
 * Při shodě rozhoduje číslo zakázky, ať se řádky mezi obnoveními nepřehazují.
 */
export function seradSekce(s: SekceDnes): SekceDnes {
  const podleTerminu = (a: ZakazkaDnes, b: ZakazkaDnes) => vzestupne(cas(a.expectedAt), cas(b.expectedAt)) || vzestupne(cas(a.createdAt), cas(b.createdAt)) || podleKodu(a, b);
  const podleCekani = (a: ZakazkaDnes, b: ZakazkaDnes) => vzestupne(posledniZmena(a), posledniZmena(b)) || podleKodu(a, b);
  return {
    po_terminu: [...s.po_terminu].sort(podleTerminu),
    dnes_termin: [...s.dnes_termin].sort(podleTerminu),
    ceka_dil: [...s.ceka_dil].sort(podleCekani),
    ceka_zakaznik: [...s.ceka_zakaznik].sort(podleCekani),
    k_prevzeti: [...s.k_prevzeti].sort(podleCekani),
    moje: [...s.moje].sort(podleTerminu),
    rezervace: [...s.rezervace].sort((a, b) => vzestupne(cas(a.preferredAt), cas(b.preferredAt)) || a.customerName.localeCompare(b.customerName, "cs")),
  };
}

// ---------------------------------------------------------------------------
// Přepínač „Jen moje / Celý tým“
// ---------------------------------------------------------------------------

export type RozsahDnes = "moje" | "tym";

/**
 * Výchozí rozsah: uložená volba, jinak „Jen moje“, když má uživatel něco
 * přiděleného (a servis přiděluje), jinak celý tým. Bez přidělování je
 * „Jen moje“ nesmysl – vždycky by bylo prázdno.
 */
export function vychoziRozsah(ulozeny: unknown, pocetMojich: number, pridelovani: boolean): RozsahDnes {
  if (!pridelovani) return "tym";
  if (ulozeny === "moje" || ulozeny === "tym") return ulozeny;
  return pocetMojich > 0 ? "moje" : "tym";
}

// ---------------------------------------------------------------------------
// Díly na cestě
// ---------------------------------------------------------------------------

export type PolozkaObjednavkyDnes = { ticketId: string | null; qty: number; receivedQty: number; orderStatus: string };

/**
 * Zakázky, na které je objednaný díl a ještě nedorazil: položka s vazbou na
 * zakázku v objednávce, která je v návrhu nebo objednaná, a přijato méně,
 * než se objednalo. Přijatá a zrušená objednávka už nečeká.
 */
export function zakazkySDilemNaCeste(polozky: readonly PolozkaObjednavkyDnes[]): Set<string> {
  const out = new Set<string>();
  for (const p of polozky) {
    if (!p.ticketId) continue;
    if (p.orderStatus !== "draft" && p.orderStatus !== "ordered") continue;
    if (p.receivedQty >= p.qty) continue;
    out.add(p.ticketId);
  }
  return out;
}
