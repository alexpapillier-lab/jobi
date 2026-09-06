/**
 * Založení a smazání servisu z aplikace.
 *
 * Do teď šlo servis založit jen na obrazovce po registraci (FirstServiceSetup)
 * a smazat jen v záložce Owner, kterou vidí jediný účet – majitel aplikace.
 * Zákazník, který si chce zkusit druhou provozovnu nebo naopak skončit, na to
 * v aplikaci neměl tlačítko a musel psát podporu. Tenhle modul je společný
 * pro obě místa, aby se zakládání nechovalo pokaždé jinak.
 */
import { supabase, supabaseUrl, supabaseFetch } from "./supabaseClient";
import { mergeServiceConfig } from "./serviceSettingsSync";

/**
 * Zkratka odvozená z názvu servisu.
 *
 * Zkratka není kosmetika: je z ní číslo zakázky (E2E26000001). Když ji servis
 * nemá, generátor v useOrderActions spadne na „SRV“ a zákazník má na prvních
 * dokumentech čísla, která k jeho firmě nepatří a která pak nejdou přečíslovat.
 * Proto se odvodí hned při zakládání a majitel ji jen přepíše.
 *
 * Z víceslovného názvu vezme počáteční písmena („Auto Servis Brno“ → „ASB“),
 * z jednoslovného první tři znaky. Diakritika jde pryč, čísla zůstávají.
 */
export function odvodZkratku(nazev: string): string {
  const bezDiakritiky = nazev.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const slova = bezDiakritiky
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter(Boolean);
  if (slova.length === 0) return "SRV";
  const zkratka = slova.length > 1 ? slova.slice(0, 4).map((s) => s[0]).join("") : slova[0].slice(0, 3);
  return zkratka.slice(0, 6) || "SRV";
}

/**
 * Založí servis a vrátí jeho id.
 *
 * Zkratku dopisuje klient, ne edge funkce: `service-create` zakládá servis
 * službním klíčem a o číslování zakázek nic neví, kdežto tady je název po ruce
 * a majitel do configu smí zapisovat (RLS owner/admin). Zapisuje se na obě
 * místa – `config.abbreviation` čte generátor čísel, `config.companyData`
 * ukazuje Nastavení; kdyby zůstalo jen jedno, jedna z těch dvou obrazovek by
 * lhala.
 */
export async function zalozServis(nazev: string): Promise<string> {
  const jmeno = nazev.trim();
  if (!jmeno) throw new Error("Zadejte název servisu.");
  if (!supabase || !supabaseUrl) throw new Error("Aplikace není připojená ke cloudu.");

  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData?.session?.access_token;
  const res = await supabaseFetch(`${supabaseUrl}/functions/v1/service-create`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ name: jmeno }),
  });
  const raw = await res.text();
  // Odpověď nemusí být JSON: brána vrací při 502 HTML a `JSON.parse` by pak
  // uživateli ukázal „Unexpected token '<'“ místo srozumitelné hlášky.
  let data: { error?: string; service_id?: string } = {};
  try {
    if (raw) data = JSON.parse(raw) as typeof data;
  } catch {
    if (!res.ok) throw new Error(`Servis se nepodařilo založit (chyba ${res.status}).`);
    throw new Error("Servis se nepodařilo založit: server vrátil nesrozumitelnou odpověď.");
  }
  if (!res.ok || data?.error) throw new Error(data?.error || `Chyba ${res.status}`);
  const serviceId = data.service_id as string;

  // Zkratka je pro čísla zakázek povinná, ale servis kvůli ní nezahazujeme –
  // majitel si ji doplní v Nastavení a chyba má být vidět v logu, ne v cestě.
  const zkratka = odvodZkratku(jmeno);
  const { error } = await mergeServiceConfig(serviceId, {
    abbreviation: zkratka,
    companyData: { name: jmeno, abbreviation: zkratka },
  });
  if (error) console.error("[zalozServis] zkratka se nezapsala:", error);

  return serviceId;
}

/**
 * Smaže servis, jehož je přihlášený uživatel majitelem, i s daty a soubory.
 *
 * **V aplikaci na to schválně není tlačítko.** Rozhodnutí majitele Jobi:
 * zákazník servis smazat smí (právo na výmaz), ale nemá to mít na dvě
 * kliknutí vedle údajů firmy – zruší se tím celá firma i s doklady. Zůstává
 * to jako serverové rozhraní pro podporu a pro úklid po testech.
 *
 * Vlastní edge funkce, ne `service-manage`: ta umí smazat libovolný servis a
 * schválně ji smí volat jen majitel aplikace. Rozšířit ji o druhý způsob
 * přihlášení by znamenalo, že o osud cizích servisů rozhoduje jedno `if`
 * navíc v kódu, který má service_role klíč.
 */
export async function smazVlastniServis(serviceId: string): Promise<void> {
  if (!supabase || !supabaseUrl) throw new Error("Aplikace není připojená ke cloudu.");
  // Na desktopu vrací getSession() občas prošlý token → 401; stejný postup má
  // callServiceManage v OwnerSettings.
  const { data: refreshData } = await supabase.auth.refreshSession();
  const token =
    refreshData?.session?.access_token ?? (await supabase.auth.getSession()).data?.session?.access_token;
  if (!token) throw new Error("Nejste přihlášeni.");

  const res = await supabaseFetch(`${supabaseUrl}/functions/v1/service-delete-own`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ serviceId }),
  });
  const raw = await res.text();
  let data: { error?: string } = {};
  try {
    if (raw) data = JSON.parse(raw) as typeof data;
  } catch {
    // tělo není JSON (např. HTML od gateway)
  }
  if (!res.ok || data?.error) throw new Error(data?.error || `Chyba ${res.status}`);
}
