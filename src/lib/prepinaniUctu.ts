import type { Session } from "@supabase/supabase-js";
import { docasnyAuthKlient, klicRelace, supabase, vZamkuRelace } from "./supabaseClient";
import { authStorage } from "./authStorage";
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

/* ── Zámek obrazovky, který přežije obnovení stránky ─────────────────── */

/*
 * Zamčená obrazovka se dřív držela jen ve stavu Reactu: F5 (nebo zavření a
 * otevření okna) ji zrušil a aplikace naběhla přihlášená bez PINu. Teď se
 * zámek zapíše do localStorage – vidí ho všechny záložky i nové okno.
 *
 * Zámek patří k relaci člověka na tomhle počítači: záznam je mapa
 * `userId → kdy zamčeno`. Zruší ho jen ověření toho, koho se týká – jeho
 * PIN, jeho heslo, nebo přepnutí na něj PINem. Kdyby šlo o jeden společný
 * příznak, přihlášení kolegy vlastním heslem v jiné záložce (relace ve
 * sessionStorage, volba „Zapamatovat“ vypnutá) by odemklo záložku, kde je
 * přihlášený někdo jiný. Odhlášení zámek nemaže – zruší ho až přihlášení
 * heslem (AuthProvider.signIn).
 */
export const KLIC_ZAMCENO = "jobi_zamceno_v1";
/** Kdo se přihlásil heslem a ještě si nenastavil PIN (krok přežije F5). */
export const KLIC_CEKA_NA_PIN = "jobi_ceka_na_pin_v1";
/** Zámek se v této záložce změnil (jiné záložky to poznají z události `storage`). */
export const UDALOST_ZAMCENI = "jobi:zamceni-zmeneno";

function sezeni(): Uloziste | null {
  try {
    return typeof window !== "undefined" ? window.sessionStorage : null;
  } catch {
    return null;
  }
}

/** `null` = poškozený záznam. */
function nactiZamky(storage: Uloziste | null, zaloha: Uloziste | null): Record<string, string> | null {
  let raw: string | null = null;
  try { raw = storage?.getItem(KLIC_ZAMCENO) ?? null; } catch { /* ignore */ }
  if (raw == null) {
    try { raw = zaloha?.getItem(KLIC_ZAMCENO) ?? null; } catch { /* ignore */ }
  }
  if (raw == null) return {};
  try {
    const d = JSON.parse(raw) as unknown;
    return d && typeof d === "object" && !Array.isArray(d) ? (d as Record<string, string>) : null;
  } catch {
    return null;
  }
}

function zapisZamky(zamky: Record<string, string>, storage: Uloziste | null, zaloha: Uloziste | null): void {
  const prazdne = Object.keys(zamky).length === 0;
  const hodnota = JSON.stringify(zamky);
  let ulozeno = false;
  try {
    if (storage) {
      if (prazdne) storage.removeItem(KLIC_ZAMCENO);
      else storage.setItem(KLIC_ZAMCENO, hodnota);
      ulozeno = true;
    }
  } catch { /* zkusí se záloha */ }
  try {
    // Záloha v sessionStorage jen tehdy, když localStorage nejde (plný, zakázaný); jinak pryč, ať nepřebije hlavní záznam.
    if (prazdne || ulozeno) zaloha?.removeItem(KLIC_ZAMCENO);
    else zaloha?.setItem(KLIC_ZAMCENO, hodnota);
  } catch { /* ignore */ }
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(UDALOST_ZAMCENI));
}

/** Je obrazovka tohoto člověka zamčená? Poškozený záznam se bere jako zamčeno – radši PIN navíc než díra. */
export function zamcenaObrazovka(userId: string, storage: Uloziste | null = uloziste(), zaloha: Uloziste | null = sezeni()): boolean {
  const zamky = nactiZamky(storage, zaloha);
  return zamky === null || Object.prototype.hasOwnProperty.call(zamky, userId);
}

/** Zamkne obrazovku přihlášeného; když localStorage nejde zapsat, aspoň do sessionStorage. */
export function zamkniObrazovku(userId: string, storage: Uloziste | null = uloziste(), zaloha: Uloziste | null = sezeni()): void {
  const zamky = nactiZamky(storage, zaloha) ?? {};
  zapisZamky({ ...zamky, [userId]: new Date().toISOString() }, storage, zaloha);
}

/** Zruší zámek těm, kdo se právě ověřili (PIN, heslo). Poškozený záznam se zahodí celý. */
export function odemkniObrazovku(userIds: Array<string | null | undefined>, storage: Uloziste | null = uloziste(), zaloha: Uloziste | null = sezeni()): void {
  const zamky = nactiZamky(storage, zaloha);
  if (zamky === null) { zapisZamky({}, storage, zaloha); return; }
  const zbyva = { ...zamky };
  let zmena = false;
  for (const id of userIds) {
    if (id && Object.prototype.hasOwnProperty.call(zbyva, id)) { delete zbyva[id]; zmena = true; }
  }
  if (zmena) zapisZamky(zbyva, storage, zaloha);
}

export function cekaNaPin(storage: Uloziste | null = uloziste()): string | null {
  try { return storage?.getItem(KLIC_CEKA_NA_PIN) ?? null; } catch { return null; }
}

function nastavCekaNaPin(userId: string | null, storage: Uloziste | null = uloziste()): void {
  try {
    if (userId) storage?.setItem(KLIC_CEKA_NA_PIN, userId);
    else storage?.removeItem(KLIC_CEKA_NA_PIN);
  } catch { /* ignore */ }
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

type UlozenaRelace = { access_token?: unknown; refresh_token?: unknown; user?: { id?: unknown; email?: unknown } | null };

function prectiUlozenouRelaci(klic: string): UlozenaRelace | null {
  try {
    const raw = authStorage.getItem(klic);
    return raw ? (JSON.parse(raw) as UlozenaRelace) : null;
  } catch {
    return null;
  }
}

function idUlozene(r: UlozenaRelace | null): string | null {
  return r && typeof r.user?.id === "string" ? r.user.id : null;
}

/**
 * Nasadí relaci cílového člověka a toho, kdo byl přihlášený, odloží do
 * trezoru – obojí najednou pod zámkem relace supabase-js.
 *
 * PROČ TAKHLE (chyba „kolega se přihlásil a stejně to dalo toho prvního“)
 * Dřív se odchozí odložil přes `getSession()` a cíl se nasadil zvlášť –
 * u „Přidat účet“ přes `signInWithPassword` na hlavním klientovi. Jenže
 * `signInWithPassword` v supabase-js zámek relace nebere. Obnova tokenu
 * odchozího (časovač supabase-js, návrat do záložky, kterékoli
 * `refreshSession()` v aplikaci, druhá záložka), která v tu chvíli běžela,
 * zapsala svou obnovenou relaci až PO přihlášení kolegy – úložiště pak
 * drželo zase prvního člověka a po `reload()` naběhl on. A když obnova
 * proběhla mezi odložením a přepnutím, v trezoru zůstal už spotřebovaný
 * refresh token a návrat PINem pak skončil „přihlášení vypršelo“.
 *
 * Teď se cíl přihlásí v samostatném klientovi jen v paměti a sem přijde
 * hotová relace. Pod zámkem (stejným, jaký bere každá obnova, i v jiné
 * záložce) se přečte, kdo je v úložišti teď – ten se odloží s tokeny,
 * které právě platí – a zapíše se cíl. Žádná obnova se mezi to nedostane
 * a po zámku už každá čte cílovou relaci. Nakonec se ověří, že úložiště
 * opravdu drží cíl; když ne, přepnutí selže nahlas místo tichého reloadu
 * na původního člověka.
 */
async function nasadRelaci(
  cil: Session,
  odchozi: { userId: string | null; profil: ProfilProZaparkovani },
  vyhodit: Array<string | undefined> = [],
): Promise<void> {
  const klic = klicRelace();
  if (!klic) throw new Error("Supabase není k dispozici.");
  await vZamkuRelace(async () => {
    const ulozena = prectiUlozenouRelaci(klic);
    const ulozenaId = idUlozene(ulozena);
    let seznam = nactiZaparkovane();
    let zaparkovanoId: string | null = null;
    if (ulozena && ulozenaId && ulozenaId !== cil.user.id && typeof ulozena.refresh_token === "string" && typeof ulozena.access_token === "string") {
      // Jméno a fotka patří tomu, koho ukazuje aplikace; když je v úložišti někdo jiný (druhá záložka), bez nich.
      const profil = odchozi.userId === ulozenaId ? odchozi.profil : null;
      seznam = pridejZaparkovany(seznam, {
        userId: ulozenaId,
        email: typeof ulozena.user?.email === "string" ? ulozena.user.email : null,
        nickname: profil?.nickname ?? null,
        avatarUrl: profil?.avatarUrl ?? null,
        refreshToken: ulozena.refresh_token,
        accessToken: ulozena.access_token,
        zaparkovanoV: new Date().toISOString(),
      });
      zaparkovanoId = ulozenaId;
    }
    for (const id of [cil.user.id, ...vyhodit]) if (id) seznam = odeberZaparkovany(seznam, id);
    ulozZaparkovane(seznam);
    authStorage.setItem(klic, JSON.stringify(cil));
    if (idUlozene(prectiUlozenouRelaci(klic)) !== cil.user.id) {
      // Úložiště relaci nepřijalo (plné, zakázané) – odchozí zůstává přihlášený, z trezoru pryč.
      if (zaparkovanoId) ulozZaparkovane(odeberZaparkovany(nactiZaparkovane(), zaparkovanoId));
      throw new Error("Přihlášení se nepodařilo uložit do prohlížeče – zkuste to znovu.");
    }
  });
}

/** Po přepnutí se nesmí z mezipaměti ukázat data, na která nový člověk nemá právo; servis ale zůstává. */
function vycistiProNovehoCloveka(): void {
  let servis: string | null = null;
  try { servis = localStorage.getItem("jobsheet_active_service_id_v1"); } catch { /* ignore */ }
  clearOnSignOut();
  try { if (servis) localStorage.setItem("jobsheet_active_service_id_v1", servis); } catch { /* ignore */ }
}

function vycistiProNovehoClovekaAZnovuNacti(): void {
  vycistiProNovehoCloveka();
  window.location.reload();
}

/**
 * Přepne na zaparkovaný účet. PIN se ověřuje ještě pod odcházejícím
 * člověkem; teprve pak se cíl přihlásí (v odděleném klientovi) a nasadí.
 * Když je cílový token mrtvý (odhlášení jinde), odchozí zůstává, jak byl,
 * a účet se z trezoru vyhodí – dál je jen přihlášení heslem.
 */
export async function prepniNaUcet(
  cil: ZaparkovanyUcet,
  pin: string,
  profilOdchoziho: ProfilProZaparkovani,
  odchoziUserId: string | null = null,
): Promise<void> {
  const v = await overPin(cil.userId, pin);
  if (!v.ok) throw new Error(hlaskaPinu(v));
  await odesliFrontuNeboSelz();

  // Prošlý access token supabase-js obnoví refresh tokenem; platný ověří proti serveru.
  const { data, error } = await docasnyAuthKlient().setSession({ access_token: cil.accessToken, refresh_token: cil.refreshToken });
  if (error || !data.session || data.session.user.id !== cil.userId) {
    ulozZaparkovane(odeberZaparkovany(nactiZaparkovane(), cil.userId));
    throw new Error("Přihlášení tohoto účtu vypršelo – přihlaste se heslem.");
  }
  await nasadRelaci(data.session, { userId: odchoziUserId, profil: profilOdchoziho });
  // Cíl ověřil PIN. Zámek odchozího zůstává jeho (vrátí se k němu zase jen PINem).
  // F5 před tímhle řádkem ukáže zámek (PIN navíc), nikdy ne odemčenou aplikaci.
  odemkniObrazovku([cil.userId]);
  nastavCekaNaPin(null);
  vycistiProNovehoClovekaAZnovuNacti();
}

/** Odemknutí obrazovky: PIN přihlášeného, nic se nepřepíná. */
export async function odemkniAktualni(userId: string, pin: string): Promise<void> {
  const v = await overPin(userId, pin);
  if (!v.ok) throw new Error(hlaskaPinu(v));
  odemkniObrazovku([userId]);
}

/**
 * Přihlásí dalšího člověka heslem a toho současného zaparkuje. Slouží pro
 * „Přidat účet“, pro odložený účet bez PINu / se zapomenutým PINem
 * (`cilUserId` říká, koho z trezoru po přihlášení vyhodit) a na zámku i
 * pro přihlášeného, který PIN nemá nebo ho zapomněl.
 *
 * PIN patří k účtu, ne k počítači: kdo už ho má (nastavil si ho jinde),
 * jde rovnou dál. Kdo ho nemá – nebo přišel přes „Nevíte PIN?“
 * (`vzdyNovyPin`) – dostane krok „Nastavte si PIN“; ten se dokončí přes
 * `nastavPin` + `dokonciPrepnuti`. Relace je v tu chvíli už přepnutá.
 */
export async function pridejUcetHeslem(
  email: string,
  heslo: string,
  profilAktualniho: ProfilProZaparkovani,
  cilUserId?: string,
  vzdyNovyPin = false,
): Promise<{ potrebujePin: boolean }> {
  const s = await aktualniSession();
  if (!s) throw new Error("Nikdo není přihlášený.");
  await odesliFrontuNeboSelz();
  // Heslo se ověří v odděleném klientovi: hlavní klient (a s ním úložiště
  // relace) se nemění, dokud není jisté, kdo se přihlásil – viz nasadRelaci.
  const { data, error } = await docasnyAuthKlient().signInWithPassword({ email: email.trim(), password: heslo });
  if (error || !data.session) {
    throw new Error(error?.message === "Invalid login credentials" ? "Nesprávný e-mail nebo heslo." : error?.message ?? "Přihlášení se nepodařilo.");
  }
  const novy = data.session.user.id;
  await nasadRelaci(data.session, { userId: s.user.id, profil: profilAktualniho }, [cilUserId]);
  // Mezipaměť pryč hned – i kdyby se stránka znovu načetla dřív než po kroku s PINem.
  vycistiProNovehoCloveka();
  // Heslo je silnější ověření než PIN – zámek přihlášeného tím padá.
  odemkniObrazovku([novy]);
  const maUzPin = vzdyNovyPin ? false : await maPin(novy).catch(() => true);
  if (maUzPin) {
    nastavCekaNaPin(null);
    vycistiProNovehoClovekaAZnovuNacti();
    return { potrebujePin: false };
  }
  // F5 v kroku „Nastavte si PIN“ krok nezahodí – PrepinacUctu ho po načtení otevře znovu.
  nastavCekaNaPin(novy);
  return { potrebujePin: true };
}

/** Po přihlášení heslem (a případném nastavení PINu): vyčistit a znovu načíst. */
export function dokonciPrepnuti(): void {
  nastavCekaNaPin(null);
  vycistiProNovehoClovekaAZnovuNacti();
}

/** Čekající krok „Nastavte si PIN“ už neplatí (jiný člověk, PIN mezitím nastavený). */
export function zahodCekaniNaPin(): void {
  nastavCekaNaPin(null);
}

export function odeberZaparkovanyUcet(userId: string): void {
  ulozZaparkovane(odeberZaparkovany(nactiZaparkovane(), userId));
}

/**
 * Změnil se v úložišti přihlášený člověk pod rukama této záložky? (Druhá
 * záložka přepnula účet – localStorage je společný.) Záložka pak musí
 * znovu načíst, jinak by ukazovala jednoho člověka a zapisovala pod druhým.
 */
export function jinyClovekVUlozisti(novaHodnota: string | null, userId: string): boolean {
  if (!novaHodnota) return false;
  try {
    const id = (JSON.parse(novaHodnota) as UlozenaRelace | null)?.user?.id;
    return typeof id === "string" && id !== userId;
  } catch {
    return false;
  }
}

