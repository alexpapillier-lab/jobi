/**
 * Interní chat týmu – klientská knihovna.
 *
 * Databáze (tabulky `chat_messages`, `chat_reads`, `chat_reactions`, RPC
 * `chat_kanaly`, `chat_neprectene`, `chat_precteno`, `chat_hledej`, bucket
 * `chat-prilohy`) vzniká souběžně podle kontraktu; typy tu jsou psané ručně
 * a klient se volá přes `any` stejně jako u přepínání účtů.
 *
 * Kanál je odvozený ze sloupců zprávy, ne uložený zvlášť:
 *  - `branch_id` i `recipient_id` prázdné → celý servis (`servis`),
 *  - `branch_id` → pobočka (`pobocka:<id>`),
 *  - `recipient_id` → soukromá zpráva (`dm:<id druhého člověka>`).
 *
 * Zmínky (`#SN26000012`, `#Pavel Konečný`, `@Aleki`) se ukládají do pole
 * `mentions` a to je při vykreslení zdroj pravdy – regex se používá jen
 * v našeptávači. Kdyby se zmínky poznávaly z textu, „#Pavel Konečný“ by
 * se nedalo odlišit od věty, která náhodou začíná mřížkou.
 */

import { supabase } from "./supabaseClient";
import { devWarn } from "./devLog";

// ---------------------------------------------------------------------------
// Typy
// ---------------------------------------------------------------------------

export type TypZminky = "zakazka" | "zakaznik" | "clen";

export type Zminka = {
  typ: TypZminky;
  id: string;
  /** Text, který je ve zprávě za `#` nebo `@`: „SN26000012“, „Pavel Konečný“, „Aleki“. */
  popis: string;
};

export type PrilohaChatu = {
  /** Cesta v bucketu `chat-prilohy`: `<service_id>/<uuid>/<název>`. */
  path: string;
  name: string;
  type: string;
  size: number;
};

export type ReakceChatu = {
  messageId: string;
  userId: string;
  emoji: string;
  createdAt: string;
};

export type StavOdeslani = "odesila" | "chyba";

export type ZpravaChatu = {
  id: string;
  serviceId: string;
  branchId: string | null;
  recipientId: string | null;
  senderId: string;
  text: string;
  mentions: Zminka[];
  attachments: PrilohaChatu[];
  pinned: boolean;
  createdAt: string;
  editedAt: string | null;
  deletedAt: string | null;
  reakce: ReakceChatu[];
  /** Jen u zpráv, které ještě nedorazily na server. */
  stav?: StavOdeslani;
};

export type TypKanalu = "servis" | "pobocka" | "dm";

export type Kanal = {
  /** Klíč: `servis` | `pobocka:<branch_id>` | `dm:<user_id>`. */
  kanal: string;
  typ: TypKanalu;
  /** Id pobočky nebo druhého člověka; u servisu null. */
  id: string | null;
  nazev: string;
  avatarUrl: string | null;
};

export const KANAL_SERVIS = "servis";
export const BUCKET_PRILOH = "chat-prilohy";
/** Větší příloha se nenahraje – chat není úložiště, a signed URL by se tahal dlouho. */
export const MAX_PRILOHA_B = 15 * 1024 * 1024;
export const EMOJI_REAKCI = ["👍", "❤️", "😂", "✅"] as const;
/** Kolik zpráv se načte na jedno „načíst starší“. */
export const STRANKA_ZPRAV = 50;

/** Událost pro otevření panelu odjinud (detail zakázky, upozornění). */
export const UDALOST_OTEVRIT_CHAT = "jobi:chat-otevrit";
export type OtevritChatDetail = { kanal?: string; text?: string; zminka?: Zminka };

export function otevriChat(detail: OtevritChatDetail = {}): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(UDALOST_OTEVRIT_CHAT, { detail }));
}

/**
 * Otevře cíl zmínky: zakázku nebo zákazníka. Posílá `jobsheet:navigate`
 * s `openTicketId` / `openCustomerId` – App.tsx podle toho nastaví
 * `openTicketIntent` / `openCustomerIntent` (stejně jako z kalendáře či faktur).
 * Člen (@) žádný cíl nemá, jen se zvýrazní.
 */
export function otevriZminku(z: Zminka): void {
  if (typeof window === "undefined") return;
  if (z.typ === "zakazka") {
    window.dispatchEvent(new CustomEvent("jobsheet:navigate", { detail: { page: "orders", openTicketId: z.id } }));
  } else if (z.typ === "zakaznik") {
    window.dispatchEvent(new CustomEvent("jobsheet:navigate", { detail: { page: "customers", openCustomerId: z.id } }));
  }
}

// ---------------------------------------------------------------------------
// Klíče kanálů
// ---------------------------------------------------------------------------

export function klicKanalu(typ: TypKanalu, id?: string | null): string {
  if (typ === "servis") return KANAL_SERVIS;
  if (!id) throw new Error(`Kanál typu ${typ} potřebuje id`);
  return `${typ}:${id}`;
}

export function rozlozKlic(kanal: string): { typ: TypKanalu; id: string | null } {
  if (kanal === KANAL_SERVIS) return { typ: "servis", id: null };
  const m = /^(pobocka|dm):(.+)$/.exec(kanal);
  if (m) return { typ: m[1] as TypKanalu, id: m[2] };
  // Neznámý klíč (starý záznam v localStorage) – radši servis než rozbitý panel.
  return { typ: "servis", id: null };
}

export function jePlatnyKlic(kanal: string): boolean {
  return kanal === KANAL_SERVIS || /^(pobocka|dm):.+$/.test(kanal);
}

/**
 * Kanál zprávy z pohledu daného člověka: u soukromé zprávy je to
 * „ten druhý“, ať jsem odesílatel nebo příjemce.
 */
export function kanalZpravy(z: Pick<ZpravaChatu, "branchId" | "recipientId" | "senderId">, mujId: string): string {
  if (z.recipientId) return klicKanalu("dm", z.recipientId === mujId ? z.senderId : z.recipientId);
  if (z.branchId) return klicKanalu("pobocka", z.branchId);
  return KANAL_SERVIS;
}

/** Sloupce, které zprávu do kanálu zařadí. */
export function sloupceKanalu(kanal: string): { branch_id: string | null; recipient_id: string | null } {
  const { typ, id } = rozlozKlic(kanal);
  if (typ === "pobocka") return { branch_id: id, recipient_id: null };
  if (typ === "dm") return { branch_id: null, recipient_id: id };
  return { branch_id: null, recipient_id: null };
}

const PORADI_TYPU: Record<TypKanalu, number> = { servis: 0, pobocka: 1, dm: 2 };

/** Servis, pak pobočky, pak lidé – v pořadí, v jakém je poslal server. */
export function seradKanaly(kanaly: Kanal[]): Kanal[] {
  return kanaly.map((k, i) => ({ k, i })).sort((a, b) => PORADI_TYPU[a.k.typ] - PORADI_TYPU[b.k.typ] || a.i - b.i).map((x) => x.k);
}

// ---------------------------------------------------------------------------
// Zmínky – čisté funkce
// ---------------------------------------------------------------------------

export type CastTextu = { typ: "text"; text: string } | { typ: "zminka"; text: string; zminka: Zminka };

function znakZminky(typ: TypZminky): "#" | "@" {
  return typ === "clen" ? "@" : "#";
}

/** Jak zmínka vypadá v textu: `#SN26000012`, `@Aleki`. */
export function textZminky(z: Zminka): string {
  return znakZminky(z.typ) + z.popis;
}

/**
 * Rozdělí text zprávy na obyčejné části a zmínky podle uloženého pole
 * `mentions`. Delší popisy mají přednost (jinak by „#SN26“ ukousl začátek
 * „#SN260001“), každá zmínka se hledá od začátku a použije na všech místech.
 */
export function rozdelTextPodleZminek(text: string, mentions: readonly Zminka[] | null | undefined): CastTextu[] {
  const platne = (mentions ?? []).filter((m) => m && typeof m.popis === "string" && m.popis.length > 0);
  if (!text) return [];
  if (platne.length === 0) return [{ typ: "text", text }];

  const serazene = [...platne].sort((a, b) => b.popis.length - a.popis.length);
  type Vyskyt = { od: number; do: number; zminka: Zminka };
  const vyskyty: Vyskyt[] = [];
  const obsazeno = (od: number, do_: number) => vyskyty.some((v) => od < v.do && do_ > v.od);

  for (const z of serazene) {
    const token = textZminky(z);
    let od = text.indexOf(token);
    while (od >= 0) {
      const do_ = od + token.length;
      // Za zmínkou nesmí hned pokračovat písmeno/číslice – „#SN26“ uvnitř „#SN2600“.
      const dalsi = text[do_];
      const hranice = dalsi === undefined || !/[\p{L}\p{N}]/u.test(dalsi);
      if (hranice && !obsazeno(od, do_)) vyskyty.push({ od, do: do_, zminka: z });
      od = text.indexOf(token, od + 1);
    }
  }

  vyskyty.sort((a, b) => a.od - b.od);
  const casti: CastTextu[] = [];
  let pozice = 0;
  for (const v of vyskyty) {
    if (v.od > pozice) casti.push({ typ: "text", text: text.slice(pozice, v.od) });
    casti.push({ typ: "zminka", text: text.slice(v.od, v.do), zminka: v.zminka });
    pozice = v.do;
  }
  if (pozice < text.length) casti.push({ typ: "text", text: text.slice(pozice) });
  return casti;
}

/** Zmínky, které v textu ještě jsou – uživatel je mohl před odesláním smazat. */
export function zminkyVTextu(text: string, mentions: readonly Zminka[]): Zminka[] {
  const vysledek: Zminka[] = [];
  for (const m of mentions) {
    if (!text.includes(textZminky(m))) continue;
    if (vysledek.some((v) => v.typ === m.typ && v.id === m.id)) continue;
    vysledek.push(m);
  }
  return vysledek;
}

export type RozepsanaZminka = { znak: "#" | "@"; dotaz: string; od: number };

/** Nejdelší dotaz našeptávače – delší text už je věta, ne hledání. */
const MAX_DOTAZ = 40;

/**
 * Rozepsaná zmínka před kurzorem: `#` nebo `@` na začátku slova a to, co je
 * za ním. Zákazník má v názvu mezery („#Pavel Kon“), proto se mezery
 * dovolují – ale ne nový řádek a ne víc než dvě, jinak by našeptávač
 * vyskakoval uprostřed každé věty, která někde vlevo mřížku má.
 */
export function najdiRozepsanouZminku(text: string, kurzor: number): RozepsanaZminka | null {
  const pred = text.slice(0, kurzor);
  for (let i = pred.length - 1; i >= 0 && pred.length - i <= MAX_DOTAZ + 1; i--) {
    const ch = pred[i];
    if (ch === "\n") return null;
    if (ch === "#" || ch === "@") {
      const predtim = i === 0 ? "" : pred[i - 1];
      if (predtim && !/\s/.test(predtim)) return null;
      const dotaz = pred.slice(i + 1);
      if ((dotaz.match(/ /g) ?? []).length > 2) return null;
      if (dotaz.startsWith(" ")) return null;
      return { znak: ch, dotaz, od: i };
    }
  }
  return null;
}

/**
 * Nahradí rozepsanou zmínku vybranou položkou a přidá mezeru, ať se hned
 * píše dál. Vrací nový text a polohu kurzoru.
 */
export function vlozZminku(text: string, rozepsana: RozepsanaZminka, zminka: Zminka, kurzor: number): { text: string; kurzor: number } {
  const vlozeny = textZminky(zminka) + " ";
  const novy = text.slice(0, rozepsana.od) + vlozeny + text.slice(kurzor);
  return { text: novy, kurzor: rozepsana.od + vlozeny.length };
}

// ---------------------------------------------------------------------------
// Drobné pomocné funkce pro zobrazení
// ---------------------------------------------------------------------------

/** Iniciály do kolečka místo fotky: „Pavel Konečný“ → „PK“. */
export function inicialy(jmeno: string | null | undefined): string {
  const casti = (jmeno ?? "").trim().split(/\s+/).filter(Boolean);
  if (casti.length === 0) return "?";
  const prvni = casti[0][0] ?? "";
  const druhe = casti.length > 1 ? casti[casti.length - 1][0] ?? "" : "";
  return (prvni + druhe).toUpperCase();
}

const DNY = ["ne", "po", "út", "st", "čt", "pá", "so"];

/** Čas zprávy: dnes jen hodina, tenhle týden den + hodina, jinak datum. */
export function formatCasZpravy(iso: string, ted: Date = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const hodina = `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
  const stejnyDen = d.getFullYear() === ted.getFullYear() && d.getMonth() === ted.getMonth() && d.getDate() === ted.getDate();
  if (stejnyDen) return hodina;
  const rozdilDni = (ted.getTime() - d.getTime()) / 86_400_000;
  if (rozdilDni > 0 && rozdilDni < 6) return `${DNY[d.getDay()]} ${hodina}`;
  const rok = d.getFullYear() === ted.getFullYear() ? "" : ` ${d.getFullYear()}`;
  return `${d.getDate()}. ${d.getMonth() + 1}.${rok} ${hodina}`;
}

/** Souhrn pro upozornění a náhled: text bez řádků, s přílohou. */
export function nahledZpravy(z: Pick<ZpravaChatu, "text" | "attachments" | "deletedAt">, max = 90): string {
  if (z.deletedAt) return "Zpráva smazána";
  const t = z.text.replace(/\s+/g, " ").trim();
  const priloha = z.attachments.length > 0 ? (t ? " 📎" : `📎 ${z.attachments[0].name}`) : "";
  const cely = t + priloha;
  return cely.length > max ? cely.slice(0, max - 1) + "…" : cely;
}

export function novyId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  // Starší webview bez randomUUID – v4 podle náhodných bajtů.
  const b = new Uint8Array(16);
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") crypto.getRandomValues(b);
  else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

// ---------------------------------------------------------------------------
// Fronta neodeslaných zpráv – čisté funkce + localStorage
// ---------------------------------------------------------------------------

/**
 * Zpráva čekající na odeslání. Id je vygenerované na klientovi a posílá se
 * jako `id` řádku, takže opakovaný pokus nezdvojí zprávu – duplicitní klíč
 * znamená „už tam je“ a bere se jako úspěch. To je důvod, proč se nepoužívá
 * `frontaZapisu` (ta umí jen `update`).
 */
export type NeodeslanaZprava = {
  id: string;
  serviceId: string;
  kanal: string;
  senderId: string;
  text: string;
  mentions: Zminka[];
  attachments: PrilohaChatu[];
  vlozeno: number;
  pokusy: number;
  posledniChyba?: string;
};

export const KLIC_FRONTY = "jobi_chat_neodeslane_v1";
export const MAX_VE_FRONTE = 100;
/** Starší zprávu už nemá smysl doručit – rozhovor je jinde. */
export const MAX_STARI_FRONTY_MS = 3 * 24 * 60 * 60 * 1000;

export function pridejDoFronty(fronta: readonly NeodeslanaZprava[], z: NeodeslanaZprava): NeodeslanaZprava[] {
  const bez = fronta.filter((p) => p.id !== z.id);
  bez.push(z);
  return bez.length > MAX_VE_FRONTE ? bez.slice(bez.length - MAX_VE_FRONTE) : bez;
}

export function odeberZFronty(fronta: readonly NeodeslanaZprava[], id: string): NeodeslanaZprava[] {
  return fronta.filter((p) => p.id !== id);
}

export function proberFrontu(fronta: readonly NeodeslanaZprava[], ted = Date.now()): NeodeslanaZprava[] {
  return fronta.filter((p) => ted - p.vlozeno < MAX_STARI_FRONTY_MS);
}

export function nactiFrontu(): NeodeslanaZprava[] {
  try {
    if (typeof localStorage === "undefined") return [];
    const raw = localStorage.getItem(KLIC_FRONTY);
    if (!raw) return [];
    const p: unknown = JSON.parse(raw);
    if (!Array.isArray(p)) return [];
    return p.filter(
      (x): x is NeodeslanaZprava =>
        !!x && typeof x === "object" && typeof (x as NeodeslanaZprava).id === "string" && typeof (x as NeodeslanaZprava).kanal === "string" && typeof (x as NeodeslanaZprava).serviceId === "string"
    );
  } catch {
    return [];
  }
}

export function ulozFrontu(fronta: readonly NeodeslanaZprava[]): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(KLIC_FRONTY, JSON.stringify(fronta));
  } catch {
    /* plný nebo nedostupný localStorage – zpráva zůstane aspoň v paměti */
  }
}

/** Neodeslané zprávy daného servisu jako zprávy k vykreslení (stav „odesílá se“). */
export function frontaJakoZpravy(fronta: readonly NeodeslanaZprava[], serviceId: string, kanal: string): ZpravaChatu[] {
  return fronta
    .filter((p) => p.serviceId === serviceId && p.kanal === kanal)
    .map((p) => {
      const sloupce = sloupceKanalu(p.kanal);
      return {
        id: p.id,
        serviceId: p.serviceId,
        branchId: sloupce.branch_id,
        recipientId: sloupce.recipient_id,
        senderId: p.senderId,
        text: p.text,
        mentions: p.mentions,
        attachments: p.attachments,
        pinned: false,
        createdAt: new Date(p.vlozeno).toISOString(),
        editedAt: null,
        deletedAt: null,
        reakce: [],
        stav: p.pokusy > 0 ? "chyba" : "odesila",
      };
    });
}

// ---------------------------------------------------------------------------
// Databáze
// ---------------------------------------------------------------------------

/* eslint-disable @typescript-eslint/no-explicit-any */
function klient(): any {
  return supabase as any;
}

function textChyby(err: unknown): string {
  if (!err) return "";
  if (err instanceof Error) return err.message;
  if (typeof err === "object" && err !== null && "message" in err) return String((err as { message: unknown }).message);
  return String(err);
}

function jeDuplicita(err: unknown): boolean {
  const kod = typeof err === "object" && err !== null && "code" in err ? String((err as { code: unknown }).code) : "";
  return kod === "23505" || textChyby(err).toLowerCase().includes("duplicate key");
}

function poleZminek(v: unknown): Zminka[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((m) => m && typeof m === "object" && ["zakazka", "zakaznik", "clen"].includes(String((m as Zminka).typ)) && typeof (m as Zminka).id === "string")
    .map((m) => ({ typ: (m as Zminka).typ, id: String((m as Zminka).id), popis: String((m as Zminka).popis ?? "") }));
}

function polePriloh(v: unknown): PrilohaChatu[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((p) => p && typeof p === "object" && typeof (p as PrilohaChatu).path === "string")
    .map((p) => ({
      path: String((p as PrilohaChatu).path),
      name: String((p as PrilohaChatu).name ?? (p as PrilohaChatu).path.split("/").pop() ?? "soubor"),
      type: String((p as PrilohaChatu).type ?? ""),
      size: Number((p as PrilohaChatu).size ?? 0) || 0,
    }));
}

export function mapujZpravu(r: Record<string, unknown>): ZpravaChatu {
  return {
    id: String(r.id),
    serviceId: String(r.service_id),
    branchId: r.branch_id ? String(r.branch_id) : null,
    recipientId: r.recipient_id ? String(r.recipient_id) : null,
    senderId: String(r.sender_id),
    text: typeof r.text === "string" ? r.text : "",
    mentions: poleZminek(r.mentions),
    attachments: polePriloh(r.attachments),
    pinned: r.pinned === true,
    createdAt: String(r.created_at ?? new Date().toISOString()),
    editedAt: r.edited_at ? String(r.edited_at) : null,
    deletedAt: r.deleted_at ? String(r.deleted_at) : null,
    reakce: [],
  };
}

export function mapujReakci(r: Record<string, unknown>): ReakceChatu | null {
  if (!r || !r.message_id || !r.user_id || typeof r.emoji !== "string") return null;
  return { messageId: String(r.message_id), userId: String(r.user_id), emoji: r.emoji, createdAt: String(r.created_at ?? "") };
}

export async function nactiKanaly(serviceId: string): Promise<Kanal[]> {
  const k = klient();
  if (!k) return [{ kanal: KANAL_SERVIS, typ: "servis", id: null, nazev: "Servis", avatarUrl: null }];
  const { data, error } = await k.rpc("chat_kanaly", { p_service_id: serviceId });
  if (error) throw new Error(textChyby(error));
  const radky: unknown[] = Array.isArray(data) ? data : [];
  const kanaly = radky
    .filter((r): r is Record<string, unknown> => !!r && typeof r === "object" && typeof (r as Record<string, unknown>).kanal === "string")
    .filter((r) => jePlatnyKlic(String(r.kanal)))
    .map((r) => {
      const kanal = String(r.kanal);
      const { typ, id } = rozlozKlic(kanal);
      return { kanal, typ, id, nazev: String(r.nazev ?? (typ === "servis" ? "Servis" : kanal)), avatarUrl: typeof r.avatar_url === "string" ? r.avatar_url : null };
    });
  if (!kanaly.some((x) => x.typ === "servis")) kanaly.unshift({ kanal: KANAL_SERVIS, typ: "servis", id: null, nazev: "Servis", avatarUrl: null });
  return seradKanaly(kanaly);
}

/** Dotaz na zprávy jednoho kanálu; RLS už sama zajistí, že u DM přijdou jen ty moje. */
function dotazKanalu(q: any, kanal: string): any {
  const { typ, id } = rozlozKlic(kanal);
  if (typ === "pobocka") return q.eq("branch_id", id);
  if (typ === "dm") return q.not("recipient_id", "is", null).or(`sender_id.eq.${id},recipient_id.eq.${id}`);
  return q.is("branch_id", null).is("recipient_id", null);
}

async function nactiReakce(ids: string[]): Promise<Map<string, ReakceChatu[]>> {
  const mapa = new Map<string, ReakceChatu[]>();
  const k = klient();
  if (!k || ids.length === 0) return mapa;
  const { data, error } = await k.from("chat_reactions").select("message_id, user_id, emoji, created_at").in("message_id", ids);
  if (error) {
    devWarn("[chat] reakce se nenačetly:", error);
    return mapa;
  }
  for (const r of (data ?? []) as Record<string, unknown>[]) {
    const re = mapujReakci(r);
    if (!re) continue;
    const s = mapa.get(re.messageId) ?? [];
    s.push(re);
    mapa.set(re.messageId, s);
  }
  return mapa;
}

/**
 * Zprávy kanálu od nejstarší po nejnovější. `pred` = načíst starší než
 * daný čas (stránkování „načíst starší“). Vrací i to, jestli je ještě co
 * načítat – přišla-li plná stránka.
 */
export async function nactiZpravy(serviceId: string, kanal: string, pred?: string, limit = STRANKA_ZPRAV): Promise<{ zpravy: ZpravaChatu[]; maStarsi: boolean }> {
  const k = klient();
  if (!k) return { zpravy: [], maStarsi: false };
  let q = k.from("chat_messages").select("*").eq("service_id", serviceId);
  q = dotazKanalu(q, kanal);
  if (pred) q = q.lt("created_at", pred);
  const { data, error } = await q.order("created_at", { ascending: false }).limit(limit);
  if (error) throw new Error(textChyby(error));
  const radky = ((data ?? []) as Record<string, unknown>[]).map(mapujZpravu).reverse();
  const reakce = await nactiReakce(radky.map((z) => z.id));
  for (const z of radky) z.reakce = reakce.get(z.id) ?? [];
  return { zpravy: radky, maStarsi: radky.length >= limit };
}

/** Připnutá zpráva kanálu (nejnovější připnutá), když nějaká je. */
export async function nactiPripnutou(serviceId: string, kanal: string): Promise<ZpravaChatu | null> {
  const k = klient();
  if (!k) return null;
  let q = k.from("chat_messages").select("*").eq("service_id", serviceId).eq("pinned", true).is("deleted_at", null);
  q = dotazKanalu(q, kanal);
  const { data, error } = await q.order("created_at", { ascending: false }).limit(1);
  if (error) return null;
  const r = Array.isArray(data) && data[0] ? mapujZpravu(data[0] as Record<string, unknown>) : null;
  return r;
}

/** Jeden pokus o zápis zprávy z fronty. Duplicita = už tam je = hotovo. */
async function zapisZpravu(p: NeodeslanaZprava): Promise<ZpravaChatu> {
  const k = klient();
  if (!k) throw new Error("Databáze není dostupná");
  const radek = {
    id: p.id,
    service_id: p.serviceId,
    ...sloupceKanalu(p.kanal),
    sender_id: p.senderId,
    text: p.text,
    mentions: p.mentions,
    attachments: p.attachments,
  };
  const { data, error } = await k.from("chat_messages").insert(radek).select("*").single();
  if (error) {
    if (jeDuplicita(error)) {
      const { data: uz } = await k.from("chat_messages").select("*").eq("id", p.id).maybeSingle();
      if (uz) return mapujZpravu(uz as Record<string, unknown>);
    }
    throw new Error(textChyby(error));
  }
  return mapujZpravu(data as Record<string, unknown>);
}

/** Chyba, kterou opakování nespraví: RLS, špatná data. Taková zpráva se z fronty vyhodí. */
export function jeTrvalaChybaChatu(err: unknown): boolean {
  const t = textChyby(err).toLowerCase();
  return t.includes("row-level security") || t.includes("violates") || t.includes("not authorized") || t.includes("permission denied");
}

type PosluchacFronty = (fronta: NeodeslanaZprava[]) => void;
const posluchaciFronty = new Set<PosluchacFronty>();
let odesilaSe = false;
let naplanovano: ReturnType<typeof setTimeout> | null = null;

function ohlasFrontu(): void {
  const f = nactiFrontu();
  for (const p of posluchaciFronty) {
    try {
      p(f);
    } catch {
      /* posluchač si za svoje chyby může sám */
    }
  }
}

/** Odběr změn fronty – panel podle něj kreslí „odesílá se“ a „neodesláno“. */
export function naFrontuChatu(cb: PosluchacFronty): () => void {
  posluchaciFronty.add(cb);
  cb(nactiFrontu());
  return () => {
    posluchaciFronty.delete(cb);
  };
}

/**
 * Pošle, co ve frontě je. Volá se po každém odeslání, po návratu sítě a
 * při otevření panelu. Vrací zprávy, které se povedlo zapsat – panel je
 * vymění za ty čekající (realtime je zpravidla přinese taky, ale odesílateli
 * chodí vlastní zprávy zpátky až po potvrzení a mezitím by blikaly).
 */
export async function odesliFrontuChatu(onOdeslano?: (z: ZpravaChatu) => void): Promise<number> {
  if (odesilaSe) return 0;
  odesilaSe = true;
  let odeslano = 0;
  try {
    const fronta = proberFrontu(nactiFrontu());
    ulozFrontu(fronta);
    for (const p of fronta) {
      try {
        const z = await zapisZpravu(p);
        ulozFrontu(odeberZFronty(nactiFrontu(), p.id));
        odeslano += 1;
        onOdeslano?.(z);
      } catch (e) {
        if (jeTrvalaChybaChatu(e)) {
          devWarn("[chat] zpráva se nedá odeslat, zahazuje se:", textChyby(e));
          ulozFrontu(odeberZFronty(nactiFrontu(), p.id));
          continue;
        }
        const aktualni = nactiFrontu();
        const i = aktualni.findIndex((x) => x.id === p.id);
        if (i >= 0) {
          aktualni[i] = { ...aktualni[i], pokusy: aktualni[i].pokusy + 1, posledniChyba: textChyby(e) };
          ulozFrontu(aktualni);
        }
        // Síť je pryč – zbytek počká na další kolo, ať se nezpřehází pořadí.
        break;
      } finally {
        ohlasFrontu();
      }
    }
    if (nactiFrontu().length > 0) naplanujOdeslani(15_000, onOdeslano);
  } finally {
    odesilaSe = false;
  }
  return odeslano;
}

function naplanujOdeslani(ms: number, onOdeslano?: (z: ZpravaChatu) => void): void {
  if (naplanovano) return;
  naplanovano = setTimeout(() => {
    naplanovano = null;
    void odesliFrontuChatu(onOdeslano);
  }, ms);
}

export type NovaZprava = {
  serviceId: string;
  kanal: string;
  senderId: string;
  text: string;
  mentions?: Zminka[];
  attachments?: PrilohaChatu[];
};

/**
 * Zařadí zprávu do fronty a hned ji zkusí odeslat. Vrací zprávu ve stavu
 * „odesílá se“ – panel ji ukáže okamžitě; skutečný řádek přijde přes
 * `onOdeslano` nebo realtime.
 */
export function posliZpravu(vstup: NovaZprava, onOdeslano?: (z: ZpravaChatu) => void): ZpravaChatu {
  const text = vstup.text.trim();
  const polozka: NeodeslanaZprava = {
    id: novyId(),
    serviceId: vstup.serviceId,
    kanal: vstup.kanal,
    senderId: vstup.senderId,
    text,
    mentions: zminkyVTextu(text, vstup.mentions ?? []),
    attachments: vstup.attachments ?? [],
    vlozeno: Date.now(),
    pokusy: 0,
  };
  ulozFrontu(pridejDoFronty(nactiFrontu(), polozka));
  ohlasFrontu();
  void odesliFrontuChatu(onOdeslano);
  return frontaJakoZpravy([polozka], vstup.serviceId, vstup.kanal)[0];
}

/** Zpráva, která se nedá doručit ani po opakování – uživatel ji zahodí sám. */
export function zahodNeodeslanou(id: string): void {
  ulozFrontu(odeberZFronty(nactiFrontu(), id));
  ohlasFrontu();
}

export async function oznacPrecteno(serviceId: string, kanal: string): Promise<void> {
  const k = klient();
  if (!k) return;
  const { error } = await k.rpc("chat_precteno", { p_service_id: serviceId, p_kanal: kanal });
  if (error) devWarn("[chat] označení přečteno selhalo:", error);
}

export async function nactiNeprectene(serviceId: string): Promise<Record<string, number>> {
  const k = klient();
  if (!k) return {};
  const { data, error } = await k.rpc("chat_neprectene", { p_service_id: serviceId });
  if (error) throw new Error(textChyby(error));
  const vysledek: Record<string, number> = {};
  if (data && typeof data === "object" && !Array.isArray(data)) {
    for (const [kanal, pocet] of Object.entries(data as Record<string, unknown>)) {
      const n = Number(pocet);
      if (jePlatnyKlic(kanal) && Number.isFinite(n) && n > 0) vysledek[kanal] = n;
    }
  }
  return vysledek;
}

export function souhrnNeprectenych(neprectene: Record<string, number>): number {
  return Object.values(neprectene).reduce((a, b) => a + b, 0);
}

export async function pripni(id: string, pinned: boolean): Promise<void> {
  const k = klient();
  if (!k) throw new Error("Databáze není dostupná");
  const { error } = await k.from("chat_messages").update({ pinned }).eq("id", id);
  if (error) throw new Error(textChyby(error));
}

export async function smaz(id: string): Promise<void> {
  const k = klient();
  if (!k) throw new Error("Databáze není dostupná");
  const { error } = await k.from("chat_messages").update({ deleted_at: new Date().toISOString() }).eq("id", id);
  if (error) throw new Error(textChyby(error));
}

/** Přidá, nebo odebere vlastní reakci. */
export async function reaguj(messageId: string, userId: string, emoji: string, pridat: boolean): Promise<void> {
  const k = klient();
  if (!k) throw new Error("Databáze není dostupná");
  if (pridat) {
    const { error } = await k.from("chat_reactions").insert({ message_id: messageId, user_id: userId, emoji });
    if (error && !jeDuplicita(error)) throw new Error(textChyby(error));
  } else {
    const { error } = await k.from("chat_reactions").delete().eq("message_id", messageId).eq("user_id", userId).eq("emoji", emoji);
    if (error) throw new Error(textChyby(error));
  }
}

/** Reakce po přepnutí jednoho kliknutí – čistá funkce pro optimistické překreslení. */
export function prepniReakci(reakce: readonly ReakceChatu[], messageId: string, userId: string, emoji: string): { reakce: ReakceChatu[]; pridano: boolean } {
  const uz = reakce.some((r) => r.userId === userId && r.emoji === emoji);
  if (uz) return { reakce: reakce.filter((r) => !(r.userId === userId && r.emoji === emoji)), pridano: false };
  return { reakce: [...reakce, { messageId, userId, emoji, createdAt: new Date().toISOString() }], pridano: true };
}

export async function hledej(serviceId: string, dotaz: string, limit = 30): Promise<ZpravaChatu[]> {
  const k = klient();
  const d = dotaz.trim();
  if (!k || !d) return [];
  const { data, error } = await k.rpc("chat_hledej", { p_service_id: serviceId, p_dotaz: d, p_limit: limit });
  if (error) throw new Error(textChyby(error));
  return ((Array.isArray(data) ? data : []) as Record<string, unknown>[]).map(mapujZpravu);
}

/** Zakázky a zákazníci pro našeptávač po `#`. */
export type NapovedaZminky = Zminka & { detail: string };

export async function napovezZminky(serviceId: string, dotaz: string): Promise<NapovedaZminky[]> {
  const k = klient();
  const d = dotaz.trim();
  if (!k) return [];
  const vzor = `%${d.replace(/[%_]/g, "")}%`;
  const [zakazky, zakaznici] = await Promise.all([
    k
      .from("tickets")
      .select("id, code, customer_name, title")
      .eq("service_id", serviceId)
      .is("deleted_at", null)
      .or(`code.ilike.${vzor},customer_name.ilike.${vzor}`)
      .order("created_at", { ascending: false })
      .limit(8),
    k.from("customers").select("id, name, phone").eq("service_id", serviceId).ilike("name", vzor).limit(5),
  ]);
  const vysledek: NapovedaZminky[] = [];
  for (const t of ((zakazky.data ?? []) as Record<string, unknown>[])) {
    vysledek.push({ typ: "zakazka", id: String(t.id), popis: String(t.code ?? ""), detail: [t.customer_name, t.title].filter(Boolean).join(" · ") });
  }
  for (const c of ((zakaznici.data ?? []) as Record<string, unknown>[])) {
    const jmeno = String(c.name ?? "").trim();
    if (!jmeno) continue;
    vysledek.push({ typ: "zakaznik", id: String(c.id), popis: jmeno, detail: String(c.phone ?? "") });
  }
  return vysledek;
}

// ---------------------------------------------------------------------------
// Přílohy
// ---------------------------------------------------------------------------

/** Znaky, které v cestě bucketu dělají potíže (Storage odmítá i některé diakritické kombinace). */
function bezpecnyNazev(name: string): string {
  const cisty = name.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "");
  return cisty || "soubor";
}

export async function nahrajPrilohu(serviceId: string, file: File): Promise<PrilohaChatu> {
  const k = klient();
  if (!k) throw new Error("Databáze není dostupná");
  if (file.size > MAX_PRILOHA_B) throw new Error(`Soubor je větší než ${Math.round(MAX_PRILOHA_B / 1024 / 1024)} MB`);
  const name = bezpecnyNazev(file.name || (file.type.startsWith("image/") ? "obrazek.png" : "soubor"));
  const path = `${serviceId}/${novyId()}/${name}`;
  const { error } = await k.storage.from(BUCKET_PRILOH).upload(path, file, { contentType: file.type || undefined, upsert: false });
  if (error) throw new Error(textChyby(error));
  return { path, name: file.name || name, type: file.type, size: file.size };
}

const PLATNOST_PRILOHY_S = 3600;
const REZERVA_MS = 60_000;
const podpisy = new Map<string, { url: string; platiDo: number }>();
const rozdelanePodpisy = new Map<string, Promise<string | null>>();

/** Podepsaný odkaz na přílohu (hodinu platný, sdílená cache). `null`, když se nepovede. */
export function podepsanaPriloha(path: string): Promise<string | null> {
  const k = klient();
  if (!k) return Promise.resolve(null);
  const z = podpisy.get(path);
  if (z && z.platiDo - REZERVA_MS > Date.now()) return Promise.resolve(z.url);
  const bezi = rozdelanePodpisy.get(path);
  if (bezi) return bezi;
  const p = (async () => {
    try {
      const { data, error } = await k.storage.from(BUCKET_PRILOH).createSignedUrl(path, PLATNOST_PRILOHY_S);
      if (error || !data?.signedUrl) {
        devWarn("[chat] podpis přílohy selhal:", path, error);
        return null;
      }
      podpisy.set(path, { url: data.signedUrl, platiDo: Date.now() + PLATNOST_PRILOHY_S * 1000 });
      return data.signedUrl as string;
    } catch {
      return null;
    } finally {
      rozdelanePodpisy.delete(path);
    }
  })();
  rozdelanePodpisy.set(path, p);
  return p;
}

export function jeObrazek(p: Pick<PrilohaChatu, "type" | "name">): boolean {
  return p.type.startsWith("image/") || /\.(png|jpe?g|gif|webp|heic)$/i.test(p.name);
}

// ---------------------------------------------------------------------------
// Realtime
// ---------------------------------------------------------------------------

export type UdalostZpravy = { udalost: "INSERT" | "UPDATE"; zprava: ZpravaChatu };
/** `reakce: null` = u smazání nepřišly sloupce (bez REPLICA IDENTITY FULL) – reakce se mají načíst znovu. */
export type UdalostReakce = { udalost: "INSERT" | "DELETE"; reakce: ReakceChatu | null };

export function sledujChat(serviceId: string, onZprava: (u: UdalostZpravy) => void, onReakce: (u: UdalostReakce) => void): () => void {
  const k = klient();
  if (!k) return () => {};
  const filter = `service_id=eq.${serviceId}`;
  const channel = k
    .channel(`chat:${serviceId}`)
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "chat_messages", filter }, (p: any) => {
      if (p?.new?.id) onZprava({ udalost: "INSERT", zprava: mapujZpravu(p.new) });
    })
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "chat_messages", filter }, (p: any) => {
      if (p?.new?.id) onZprava({ udalost: "UPDATE", zprava: mapujZpravu(p.new) });
    })
    // Reakce nemají service_id – filtruje je RLS (jen zprávy, které smím vidět).
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "chat_reactions" }, (p: any) => {
      onReakce({ udalost: "INSERT", reakce: mapujReakci(p?.new ?? {}) });
    })
    .on("postgres_changes", { event: "DELETE", schema: "public", table: "chat_reactions" }, (p: any) => {
      onReakce({ udalost: "DELETE", reakce: mapujReakci(p?.old ?? {}) });
    })
    .subscribe();
  return () => {
    try {
      k.removeChannel(channel);
    } catch {
      /* odpojený klient */
    }
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** Načte reakce k daným zprávám znovu (po realtime DELETE bez sloupců). */
export async function obnovReakce(ids: string[]): Promise<Map<string, ReakceChatu[]>> {
  return nactiReakce(ids);
}
