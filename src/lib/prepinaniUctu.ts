import { supabase } from "./supabaseClient";
import { odesliFrontu } from "./frontaZapisu";
import { clearOnSignOut } from "./storageInvalidation";

/**
 * Přepínání účtů na sdíleném počítači.
 *
 * Servis má na pobočce jeden počítač a víc lidí. Místo odhlásit/přihlásit
 * heslem drží aplikace „zaparkované“ relace dalších lidí a přepíná mezi
 * nimi na čtyřmístný PIN (ověřuje ho server, viz migrace
 * 20260913120000_pin_prepinani_uctu.sql – po pěti chybách zámek na 5 minut).
 *
 * Zaparkovaná relace = refresh token (a poslední access token) v localStorage
 * pod klíčem `jobi_zaparkovane_ucty_v1`. Je to stejné úložiště, ve kterém
 * dnes leží i relace přihlášeného – laťka se tím nesnižuje; klíčenka
 * systému v desktopové aplikaci je případné pozdější zpevnění.
 *
 * Po přepnutí se aplikace celá znovu načte. Stav, který se váže k člověku
 * (profil, oprávnění, pobočka, předvolby, realtime), je na příliš mnoha
 * místech na to, aby se dal spolehlivě přepnout za běhu.
 */

export type ZaparkovanyUcet = {
  userId: string;
  email: string | null;
  nickname: string | null;
  avatarUrl: string | null;
  refreshToken: string;
  accessToken: string;
  zaparkovanoV: string;
};

export type ProfilProZaparkovani = { nickname: string | null; avatarUrl: string | null } | null | undefined;

export const KLIC_ZAPARKOVANE = "jobi_zaparkovane_ucty_v1";
export const KLIC_ZAMEK = "jobi_zamek_po_minutach";
/** Událost pro ostatní části aplikace: seznam zaparkovaných se změnil. */
export const UDALOST_ZAPARKOVANE = "jobi:zaparkovane-ucty";
export const UDALOST_OTEVRIT_PREPINAC = "jobi:prepnout-ucet";
export const UDALOST_ZAMKNOUT = "jobi:zamknout";
export const UDALOST_PIN_ZMENEN = "jobi:pin-zmenen";
export const UDALOST_ZAMEK_ZMENEN = "jobi:zamek-zmenen";

/** Volby zámku po nečinnosti (minuty, 0 = vypnuto). Nastavení počítače, ne účtu. */
export const ZAMEK_MOZNOSTI = [0, 1, 2, 5, 10, 15, 30] as const;

type Uloziste = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function uloziste(): Uloziste | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

export function jePlatnyPin(pin: string): boolean {
  return /^[0-9]{4}$/.test(pin);
}

export function nactiZaparkovane(storage: Uloziste | null = uloziste()): ZaparkovanyUcet[] {
  try {
    const raw = storage?.getItem(KLIC_ZAPARKOVANE);
    if (!raw) return [];
    const data = JSON.parse(raw);
    if (!Array.isArray(data)) return [];
    return data.filter(
      (u): u is ZaparkovanyUcet =>
        !!u && typeof u.userId === "string" && typeof u.refreshToken === "string" && typeof u.accessToken === "string"
    );
  } catch {
    return [];
  }
}

export function ulozZaparkovane(seznam: ZaparkovanyUcet[], storage: Uloziste | null = uloziste()): void {
  try {
    if (seznam.length === 0) storage?.removeItem(KLIC_ZAPARKOVANE);
    else storage?.setItem(KLIC_ZAPARKOVANE, JSON.stringify(seznam));
  } catch {
    /* plné úložiště – přepnutí pak skončí přihlášením heslem */
  }
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(UDALOST_ZAPARKOVANE));
}

/** Přidá účet na začátek; tentýž účet (podle id) nahradí, ať tokeny nezastarají. */
export function pridejZaparkovany(seznam: ZaparkovanyUcet[], ucet: ZaparkovanyUcet): ZaparkovanyUcet[] {
  return [ucet, ...seznam.filter((u) => u.userId !== ucet.userId)];
}

export function odeberZaparkovany(seznam: ZaparkovanyUcet[], userId: string): ZaparkovanyUcet[] {
  return seznam.filter((u) => u.userId !== userId);
}

export function zamekPoMinutach(storage: Uloziste | null = uloziste()): number {
  try {
    const n = Number(storage?.getItem(KLIC_ZAMEK) ?? 0);
    return (ZAMEK_MOZNOSTI as readonly number[]).includes(n) ? n : 0;
  } catch {
    return 0;
  }
}

export function nastavZamekPoMinutach(minut: number, storage: Uloziste | null = uloziste()): void {
  try {
    if (minut <= 0) storage?.removeItem(KLIC_ZAMEK);
    else storage?.setItem(KLIC_ZAMEK, String(minut));
  } catch {
    /* ignore */
  }
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(UDALOST_ZAMEK_ZMENEN));
}

/* ── Server ──────────────────────────────────────────────────────────── */

export type VysledekPinu =
  | { ok: true }
  | { ok: false; duvod: "bez_pinu" | "zamceno" | "spatny"; zbyva?: number; zamceno_do?: string };

function klient() {
  if (!supabase) throw new Error("Supabase není k dispozici.");
  return supabase;
}

export async function maPin(userId: string): Promise<boolean> {
  const { data, error } = await (klient() as any).rpc("ma_pin", { p_user: userId });
  if (error) throw new Error(error.message);
  return data === true;
}

export async function nastavPin(pin: string | null): Promise<void> {
  if (pin !== null && !jePlatnyPin(pin)) throw new Error("PIN musí mít přesně čtyři číslice.");
  const { error } = await (klient() as any).rpc("nastav_pin", { p_pin: pin });
  if (error) throw new Error(error.message);
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(UDALOST_PIN_ZMENEN));
}

export async function overPin(userId: string, pin: string): Promise<VysledekPinu> {
  const { data, error } = await (klient() as any).rpc("over_pin", { p_user: userId, p_pin: pin });
  if (error) throw new Error(error.message);
  return (data ?? { ok: false, duvod: "spatny" }) as VysledekPinu;
}

export function hlaskaPinu(v: VysledekPinu): string {
  if (v.ok) return "";
  if (v.duvod === "bez_pinu") return "Tento účet nemá nastavený PIN – přihlaste se heslem.";
  if (v.duvod === "zamceno") {
    const do_ = v.zamceno_do ? new Date(v.zamceno_do) : null;
    const zbyvaMin = do_ ? Math.max(1, Math.ceil((do_.getTime() - Date.now()) / 60000)) : 5;
    return `Příliš mnoho chybných pokusů. Zkuste to znovu za ${zbyvaMin} min.`;
  }
  return v.zbyva != null && v.zbyva > 0 ? `Nesprávný PIN. Zbývá ${v.zbyva} ${v.zbyva === 1 ? "pokus" : v.zbyva < 5 ? "pokusy" : "pokusů"}.` : "Nesprávný PIN.";
}

/* ── Přepnutí ────────────────────────────────────────────────────────── */

/**
 * Neuložené změny odcházejícího člověka musí odejít pod jeho jménem. Když
 * se fronta neodešle (není spojení), přepnout nejde – jinak by se zapsaly
 * pod tím dalším.
 */
async function odesliFrontuNeboSelz(): Promise<void> {
  const { zbyva } = await odesliFrontu(true);
  if (zbyva > 0) {
    throw new Error("Nejdřív se musí odeslat neuložené změny (chybí spojení). Zkuste to za chvíli.");
  }
}

async function aktualniSession() {
  const { data } = await klient().auth.getSession();
  return data.session;
}

/** Odloží relaci právě přihlášeného do trezoru (bez odhlášení). */
export async function zaparkujAktualni(profil: ProfilProZaparkovani): Promise<ZaparkovanyUcet | null> {
  const s = await aktualniSession();
  if (!s?.refresh_token) return null;
  const ucet: ZaparkovanyUcet = {
    userId: s.user.id,
    email: s.user.email ?? null,
    nickname: profil?.nickname ?? null,
    avatarUrl: profil?.avatarUrl ?? null,
    refreshToken: s.refresh_token,
    accessToken: s.access_token,
    zaparkovanoV: new Date().toISOString(),
  };
  ulozZaparkovane(pridejZaparkovany(nactiZaparkovane(), ucet));
  return ucet;
}

/** Po přepnutí se nesmí z mezipaměti ukázat data, na která nový člověk nemá právo; servis ale zůstává. */
function vycistiProNovehoClovekaAZnovuNacti(): void {
  let servis: string | null = null;
  try { servis = localStorage.getItem("jobsheet_active_service_id_v1"); } catch { /* ignore */ }
  clearOnSignOut();
  try { if (servis) localStorage.setItem("jobsheet_active_service_id_v1", servis); } catch { /* ignore */ }
  window.location.reload();
}

/**
 * Přepne na zaparkovaný účet. PIN se ověřuje ještě pod odcházejícím
 * člověkem; teprve pak se jeho relace odloží a nasadí se ta cílová.
 * Když je cílový token mrtvý (odhlášení jinde), vrátí se odchozí relace
 * a účet se z trezoru vyhodí – dál je jen přihlášení heslem.
 */
export async function prepniNaUcet(cil: ZaparkovanyUcet, pin: string, profilOdchoziho: ProfilProZaparkovani): Promise<void> {
  const v = await overPin(cil.userId, pin);
  if (!v.ok) throw new Error(hlaskaPinu(v));
  await odesliFrontuNeboSelz();

  const odchozi = await aktualniSession();
  const odchoziUcet = odchozi && odchozi.user.id !== cil.userId ? await zaparkujAktualni(profilOdchoziho) : null;

  const { data, error } = await klient().auth.setSession({ access_token: cil.accessToken, refresh_token: cil.refreshToken });
  if (error || !data.session) {
    if (odchozi) {
      await klient().auth.setSession({ access_token: odchozi.access_token, refresh_token: odchozi.refresh_token }).catch(() => undefined);
    }
    let seznam = odeberZaparkovany(nactiZaparkovane(), cil.userId);
    if (odchoziUcet) seznam = odeberZaparkovany(seznam, odchoziUcet.userId);
    ulozZaparkovane(seznam);
    throw new Error("Přihlášení tohoto účtu vypršelo – přihlaste se heslem.");
  }
  ulozZaparkovane(odeberZaparkovany(nactiZaparkovane(), cil.userId));
  vycistiProNovehoClovekaAZnovuNacti();
}

/** Odemknutí obrazovky: PIN přihlášeného, nic se nepřepíná. */
export async function odemkniAktualni(userId: string, pin: string): Promise<void> {
  const v = await overPin(userId, pin);
  if (!v.ok) throw new Error(hlaskaPinu(v));
}

/**
 * Přihlásí dalšího člověka heslem a toho současného zaparkuje. Slouží pro
 * „Přidat účet“ i pro zaparkovaný účet bez PINu (nebo se zapomenutým PINem)
 * – `cilUserId` pak říká, koho z trezoru po přihlášení vyhodit.
 *
 * Nový člověk si při tom rovnou nastaví PIN (`novyPin`): heslo se na
 * sdíleném počítači zadává jen jednou, dál už se přepíná PINem. Když se
 * PIN nepovede uložit, přihlášení se neruší – nastaví se v Nastavení.
 */
export async function pridejUcetHeslem(
  email: string,
  heslo: string,
  profilAktualniho: ProfilProZaparkovani,
  novyPin: string,
  cilUserId?: string,
): Promise<void> {
  if (!jePlatnyPin(novyPin)) throw new Error("PIN musí mít přesně čtyři číslice.");
  const s = await aktualniSession();
  if (!s) throw new Error("Nikdo není přihlášený.");
  await odesliFrontuNeboSelz();
  const zaparkovany = await zaparkujAktualni(profilAktualniho);
  const { data, error } = await klient().auth.signInWithPassword({ email: email.trim(), password: heslo });
  if (error || !data.session) {
    if (zaparkovany) ulozZaparkovane(odeberZaparkovany(nactiZaparkovane(), zaparkovany.userId));
    throw new Error(error?.message === "Invalid login credentials" ? "Nesprávný e-mail nebo heslo." : error?.message ?? "Přihlášení se nezdařilo.");
  }
  ulozZaparkovane(odeberZaparkovany(nactiZaparkovane(), cilUserId ?? data.session.user.id));
  try {
    await nastavPin(novyPin);
  } catch (e) {
    console.warn("[prepinani] PIN se po přihlášení nepodařilo uložit", e);
  }
  vycistiProNovehoClovekaAZnovuNacti();
}

export function odeberZaparkovanyUcet(userId: string): void {
  ulozZaparkovane(odeberZaparkovany(nactiZaparkovane(), userId));
}
