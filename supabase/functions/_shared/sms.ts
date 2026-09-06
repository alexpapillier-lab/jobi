/**
 * SMS: text, segmenty, balíček a přiřazení příchozí zprávy k servisu.
 *
 * Tohle je jediné místo v aplikaci, kde jedno špatné číslo znamená skutečný
 * účet u Twilia. Proto to nežije v `sms-send/index.ts`, ale tady: `_shared`
 * je jediná část edge funkcí, kterou umí naimportovat i vitest, takže se
 * testuje ta samá funkce, jaká za běhu posílá zprávy – ne její opis.
 *
 * Zprávu odesílá `sms-send` (ruční zpráva z chatu) a `automations-run`
 * (automatická zpráva při změně stavu). Dokud každá počítala segmenty
 * po svém, platil zákazník za víc, než mu balíček ukazoval.
 *
 * Soubor nesmí sáhnout na `Deno` – v projektu je jen jedna deklarace
 * globálního `Deno` (v billingWebhook.test.ts) a druhá by neprošla.
 */

export const SMS_MAX_BODY_LENGTH = 1600; // Twilio: strop pro spojovanou SMS

/**
 * Základní abeceda GSM 03.38. Znak mimo ni přepne CELOU zprávu do UCS-2,
 * kde se místo 160 znaků vejde 70 – zpráva tak stojí dvakrát až třikrát
 * tolik, aniž by to bylo na textu vidět.
 */
const GSM_ZAKLAD =
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";

/** Znaky, které se v GSM posílají přes escape – zabírají dvě místa, ne jedno. */
const GSM_ROZSIRENI = "^{}\\[~]|€\f";

/**
 * Náhrady za znaky, které vypadají neškodně, ale v GSM abecedě nejsou.
 *
 * Pomlčka „–“ a české uvozovky se do šablon dostanou samy od sebe (zkopírují
 * se z Wordu nebo je doplní editor). Jediná taková pomlčka udělá z krátké
 * zprávy zprávu za dvě SMS. Text se tím nemění k nepoznání, jen se píše
 * znaky, které umí i ten nejstarší telefon.
 */
const NAHRADY: Record<string, string> = {
  "–": "-", "—": "-", "‒": "-", "‑": "-", "−": "-", "•": "-",
  "„": '"', "“": '"', "”": '"', "«": '"', "»": '"', "‟": '"',
  "‚": "'", "‘": "'", "’": "'", "‹": "'", "›": "'",
  "\u2026": "...", "\u00a0": " ", "\u202f": " ", "\u2009": " ", "\u200b": "", // ... a neviditelné mezery
  "×": "x", "→": "->",
};

/** Text bez diakritiky – „Vaše zakázka“ → „Vase zakazka“. */
export function bezDiakritiky(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    // Pár znaků, které rozklad NFD neřeší.
    .replace(/[ĐđŁłØøÆæŒœß]/g, (z) => ({ "Đ": "D", "đ": "d", "Ł": "L", "ł": "l", "Ø": "O", "ø": "o", "Æ": "AE", "æ": "ae", "Œ": "OE", "œ": "oe", "ß": "ss" }[z] ?? z))
    .normalize("NFC");
}

/**
 * Text připravený k odeslání: bez diakritiky a bez typografických znaků,
 * které by zprávu přepnuly do dražšího kódování.
 */
export function textProSms(text: string): string {
  const bezHacku = bezDiakritiky(text);
  let out = "";
  for (const znak of bezHacku) out += znak in NAHRADY ? NAHRADY[znak] : znak;
  return out;
}

/** Vejde se text do GSM abecedy, nebo poletí jako UCS-2? */
export function jeGsm7(text: string): boolean {
  for (const znak of text) {
    if (!GSM_ZAKLAD.includes(znak) && !GSM_ROZSIRENI.includes(znak)) return false;
  }
  return true;
}

/**
 * Kolik segmentů (a tedy kolik zpráv z balíčku) text spotřebuje.
 *
 * Dřív se počítalo jen podle délky, jako by šlo o GSM vždycky. Zpráva
 * s emoji nebo s pomlčkou „–“ ale letí v UCS-2 po 70 znacích: zákazník
 * zaplatil dvě SMS a z balíčku se mu odečetla jedna. Rozdíl se hromadil
 * potichu, protože na obou stranách sedělo stejné (špatné) číslo.
 */
export function segmentu(text: string): number {
  if (text.length === 0) return 1;
  if (jeGsm7(text)) {
    let septetu = 0;
    for (const znak of text) septetu += GSM_ROZSIRENI.includes(znak) ? 2 : 1;
    return septetu <= 160 ? 1 : Math.ceil(septetu / 153);
  }
  // UCS-2 se počítá na 16bitové jednotky – emoji je jedna „písmenka“, ale
  // dvě jednotky, a Twilio účtuje jednotky.
  return text.length <= 70 ? 1 : Math.ceil(text.length / 67);
}

/** Začátek aktuálního měsíce – balíček SMS se počítá po kalendářních měsících. */
export function zacatekMesice(ted: Date = new Date()): string {
  return new Date(Date.UTC(ted.getUTCFullYear(), ted.getUTCMonth(), 1)).toISOString();
}

/** E.164 pro Twilio. Česko: +420 a devět číslic (bez nuly na začátku). */
export function normalizeE164(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (!digits.length) return phone.trim().startsWith("+") ? phone.trim() : `+${phone.trim()}`;
  if (digits.length === 9 && /^[79]/.test(digits)) return `+420${digits}`;
  if (digits.length === 10 && digits.startsWith("0") && /^0[79]/.test(digits)) return `+420${digits.slice(1)}`;
  if (digits.startsWith("420") && digits.length === 12) return `+${digits}`;
  if (digits.startsWith("00420") && digits.length === 14) return `+420${digits.slice(5)}`;
  const withPlus = digits.startsWith("+") ? digits : `+${digits}`;
  return withPlus.replace(/^\+0+/, "+") || "+";
}

/**
 * E.164 pro příchozí zprávu. Je shovívavější než odchozí varianta: číslo
 * přišlo od operátora, takže se z něj nedá nic „opravit“, jen sjednotit tvar.
 */
export function normalizeE164Prichozi(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 9 && /^[5-9]/.test(digits)) return `+420${digits}`;
  if (digits.length === 10 && digits.startsWith("0") && /^0[79]/.test(digits)) return `+420${digits.slice(1)}`;
  if (digits.startsWith("420") && digits.length === 12) return `+${digits}`;
  return `+${digits}`;
}

/**
 * Sedí telefon ze zakázky na číslo, ze kterého přišla zpráva?
 *
 * Porovnává se i na posledních devět číslic: zakázka může mít číslo zapsané
 * jako „777 123 456“, „+420777123456“ i „00420777123456“ a zákazník o to
 * nezavinil. Devět číslic je celé české číslo, takže se tím nespojí dva
 * různí lidé; kratší shoda by ano.
 */
export function telefonSediZakazce(zakazka: string | null, odesilatelNorm: string): boolean {
  if (!zakazka?.trim()) return false;
  const odesilatelCislice = odesilatelNorm.replace(/\D/g, "");
  const tp = normalizeE164Prichozi(zakazka);
  const td = tp.replace(/\D/g, "");
  if (tp === odesilatelNorm || td === odesilatelCislice) return true;
  if (
    odesilatelCislice.length >= 9 && td.length >= 9 &&
    (td.endsWith(odesilatelCislice.slice(-9)) || odesilatelCislice.endsWith(td.slice(-9)))
  ) {
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Balíček SMS
// ---------------------------------------------------------------------------

/**
 * Nejmenší tvar klienta Supabase, jaký tyhle funkce potřebují.
 *
 * Není to typ z `@supabase/supabase-js` schválně: ten se sem tahá z esm.sh a
 * v testu by nešel nahradit. Takhle se do funkce dá poslat i pár řádků
 * z testu a projde se **stejná** cesta, jakou jde ostrý provoz.
 */
export interface SmsDotaz extends PromiseLike<{ data: unknown; error?: unknown }> {
  select(sloupce: string): SmsDotaz;
  eq(sloupec: string, hodnota: unknown): SmsDotaz;
  in(sloupec: string, hodnoty: readonly unknown[]): SmsDotaz;
  is(sloupec: string, hodnota: unknown): SmsDotaz;
  not(sloupec: string, operator: string, hodnota: unknown): SmsDotaz;
  gte(sloupec: string, hodnota: unknown): SmsDotaz;
  order(sloupec: string, volby: { ascending: boolean }): SmsDotaz;
  limit(kolik: number): SmsDotaz;
  maybeSingle(): PromiseLike<{ data: unknown; error?: unknown }>;
}

export interface SmsKlient {
  from(tabulka: string): SmsDotaz;
}

export type StavBalicku = {
  /** Strop na měsíc; `null` = bez omezení (jen z ruční správy nároků). */
  limit: number | null;
  /** Kolik segmentů už servis tenhle měsíc odeslal. */
  spotrebovano: number;
  /** Kolik jich chce spotřebovat teď. */
  potreba: number;
  prekroceno: boolean;
  /** Hláška pro uživatele, když je balíček vyčerpaný. */
  zprava: string | null;
};

export function zpravaOVycerpani(spotrebovano: number, limit: number): string {
  return `Balíček SMS je vyčerpaný (${spotrebovano} z ${limit} za tento měsíc). Další zprávy půjdou odeslat po přechodu na vyšší tarif nebo od příštího měsíce.`;
}

/**
 * Vejde se zpráva ještě do měsíčního balíčku?
 *
 * `quota` u nároku je strop, ne přesah: co je nad, se **neodešle**. Zákazník
 * tak nemůže dostat účet, se kterým nepočítal, a my nemusíme nic doúčtovávat.
 *
 * `quota: null` znamená bez omezení. Takový nárok smí vzniknout jen ruční
 * správou (entitlements-manage); webhook plateb píše vždycky číslo – hlídá to
 * billingWebhook.test.ts, protože jinak by šlo koupit balíček za sto zpráv a
 * odeslat jich sto tisíc.
 */
export async function zkontrolujBalicek(
  svc: SmsKlient,
  serviceId: string,
  potreba: number,
  ted: Date = new Date(),
): Promise<StavBalicku> {
  const { data: narok } = await svc
    .from("service_entitlements")
    .select("quota")
    .eq("service_id", serviceId)
    .eq("module", "sms")
    .maybeSingle();
  const quota = (narok as { quota?: unknown } | null)?.quota;
  const limit = typeof quota === "number" ? quota : null;
  if (limit === null) {
    return { limit: null, spotrebovano: 0, potreba, prekroceno: false, zprava: null };
  }

  const { data: odeslane } = await svc
    .from("sms_messages")
    .select("body, conversation_id, sms_conversations!inner(service_id)")
    .eq("direction", "outbound")
    .eq("sms_conversations.service_id", serviceId)
    .gte("sent_at", zacatekMesice(ted));
  const spotrebovano = ((odeslane as Array<{ body?: string | null }> | null) ?? []).reduce(
    (soucet, m) => soucet + segmentu(m.body ?? ""),
    0,
  );

  const prekroceno = spotrebovano + potreba > limit;
  return {
    limit,
    spotrebovano,
    potreba,
    prekroceno,
    zprava: prekroceno ? zpravaOVycerpani(spotrebovano, limit) : null,
  };
}

// ---------------------------------------------------------------------------
// Příchozí zpráva → servis
// ---------------------------------------------------------------------------

export type CisloServisu = { service_id: string; is_pool_primary?: boolean | null; twilio_number?: string };

/**
 * Ke kterému servisu příchozí zpráva patří.
 *
 * Jedno Twilio číslo obsluhuje víc servisů (kupovat každému vlastní české
 * číslo se nevyplatí), takže se podle čísla samotného servis určit nedá.
 * Pořadí vodítek je od nejjistějšího: rozepsaná konverzace → zakázka se
 * stejným telefonem → zákazník v kartotéce → primární servis čísla.
 *
 * Špatná odpověď tady znamená, že si dva servisy vidí do zpráv. Proto se
 * bere jen to, co je vážně z **jednoho** ze servisů daného čísla.
 */
export async function vyberServis(
  svc: SmsKlient,
  cisla: readonly CisloServisu[],
  odesilatelNorm: string,
): Promise<string | null> {
  if (cisla.length === 0) return null;
  if (cisla.length === 1) return cisla[0].service_id;

  const serviceIds = cisla.map((r) => r.service_id);

  const { data: konverzace } = await svc
    .from("sms_conversations")
    .select("service_id, updated_at")
    .in("service_id", serviceIds)
    .eq("customer_phone", odesilatelNorm)
    .order("updated_at", { ascending: false })
    .limit(1);
  const prvni = (konverzace as Array<{ service_id: string }> | null)?.[0];
  if (prvni && serviceIds.includes(prvni.service_id)) return prvni.service_id;

  const { data: zakazky } = await svc
    .from("tickets")
    .select("service_id, customer_phone, updated_at")
    .in("service_id", serviceIds)
    .is("deleted_at", null)
    .not("customer_phone", "is", null)
    .order("updated_at", { ascending: false })
    .limit(1000);
  for (const z of (zakazky as Array<{ service_id: string; customer_phone: string | null }> | null) ?? []) {
    if (telefonSediZakazce(z.customer_phone, odesilatelNorm) && serviceIds.includes(z.service_id)) {
      return z.service_id;
    }
  }

  const { data: zakaznici } = await svc
    .from("customers")
    .select("service_id, updated_at")
    .in("service_id", serviceIds)
    .eq("phone_norm", odesilatelNorm)
    .order("updated_at", { ascending: false })
    .limit(5);
  const zakaznik = (zakaznici as Array<{ service_id: string }> | null)?.[0];
  if (zakaznik && serviceIds.includes(zakaznik.service_id)) return zakaznik.service_id;

  const primarni = cisla.find((r) => r.is_pool_primary);
  return (primarni ?? cisla[0]).service_id;
}
