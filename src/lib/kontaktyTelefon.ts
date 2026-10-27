/**
 * Zákazníci v kontaktech telefonu (CardDAV) – přístupy a profil pro iPhone.
 *
 * Telefon se připojí na api.appjobi.com (Worker → edge funkce kontakty) se
 * jménem a heslem z RPC kontakty_pristup_vytvor. Heslo se ukáže jen jednou,
 * v databázi je jen jeho otisk. Viz supabase/migrations/20261027100000_kontakty_carddav.sql.
 */
import { supabase } from "./supabaseClient";

export const KONTAKTY_SERVER = "api.appjobi.com";
export const KONTAKTY_CESTA = "/carddav/";

export type PristupKontakty = {
  id: string;
  userId: string;
  login: string;
  nazev: string | null;
  createdAt: string;
  lastUsedAt: string | null;
};

export async function nactiPristupy(serviceId: string): Promise<PristupKontakty[]> {
  if (!supabase) return [];
  const { data, error } = await (supabase.from("kontakty_pristupy") as any)
    .select("id, user_id, login, nazev, created_at, last_used_at")
    .eq("service_id", serviceId)
    .is("revoked_at", null)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return ((data ?? []) as Record<string, any>[]).map((r) => ({
    id: String(r.id), userId: String(r.user_id), login: String(r.login), nazev: r.nazev ?? null, createdAt: String(r.created_at), lastUsedAt: r.last_used_at ?? null,
  }));
}

export async function vytvorPristup(serviceId: string, nazev: string): Promise<{ login: string; heslo: string }> {
  if (!supabase) throw new Error("Není připojení k databázi.");
  const { data, error } = await (supabase as any).rpc("kontakty_pristup_vytvor", { p_service_id: serviceId, p_nazev: nazev.trim() || null });
  if (error) throw new Error(error.message);
  return { login: String(data.login), heslo: String(data.heslo) };
}

export async function zrusPristup(id: string): Promise<void> {
  if (!supabase) throw new Error("Není připojení k databázi.");
  const { error } = await (supabase as any).rpc("kontakty_pristup_zrus", { p_id: id });
  if (error) throw new Error(error.message);
}

const xml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function uuid(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID().toUpperCase()
    : "00000000-0000-4000-8000-000000000000".replace(/0/g, () => Math.floor(Math.random() * 16).toString(16)).toUpperCase();
}

/**
 * Konfigurační profil pro iPhone (.mobileconfig) s účtem CardDAV. Otevře se
 * v Safari, v Nastavení → Profil stažen se nainstaluje; jméno a heslo jsou
 * v něm, takže se nic nepřepisuje. Profil není podepsaný – iPhone u něj
 * ukáže „Neověřeno“, to je u vlastních profilů běžné.
 */
export function profilIphone(p: { login: string; heslo: string; servis: string }): string {
  const popis = `Zákazníci ${p.servis}`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>PayloadContent</key>
  <array>
    <dict>
      <key>CardDAVAccountDescription</key><string>${xml(popis)}</string>
      <key>CardDAVHostName</key><string>${KONTAKTY_SERVER}</string>
      <key>CardDAVPort</key><integer>443</integer>
      <key>CardDAVPrincipalURL</key><string>https://${KONTAKTY_SERVER}${KONTAKTY_CESTA}</string>
      <key>CardDAVUseSSL</key><true/>
      <key>CardDAVUsername</key><string>${xml(p.login)}</string>
      <key>CardDAVPassword</key><string>${xml(p.heslo)}</string>
      <key>PayloadDescription</key><string>${xml(`Zákazníci z Jobi (${p.servis}) v Kontaktech – jen pro čtení, aktualizují se samy.`)}</string>
      <key>PayloadDisplayName</key><string>${xml(popis)}</string>
      <key>PayloadIdentifier</key><string>com.appjobi.kontakty.${xml(p.login)}.carddav</string>
      <key>PayloadType</key><string>com.apple.carddav.account</string>
      <key>PayloadUUID</key><string>${uuid()}</string>
      <key>PayloadVersion</key><integer>1</integer>
    </dict>
  </array>
  <key>PayloadDisplayName</key><string>${xml(`Jobi – ${popis}`)}</string>
  <key>PayloadIdentifier</key><string>com.appjobi.kontakty.${xml(p.login)}</string>
  <key>PayloadOrganization</key><string>Jobi</string>
  <key>PayloadRemovalDisallowed</key><false/>
  <key>PayloadType</key><string>Configuration</string>
  <key>PayloadUUID</key><string>${uuid()}</string>
  <key>PayloadVersion</key><integer>1</integer>
</dict>
</plist>
`;
}
