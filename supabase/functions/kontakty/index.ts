/**
 * Adresář zákazníků pro telefon (CardDAV, jen pro čtení).
 *
 * Telefon mluví s api.appjobi.com/carddav (Cloudflare Worker jobi-api). Worker
 * sem každý požadavek přepošle jako POST s hlavičkami X-Dav-Method, X-Dav-Path
 * a X-Dav-Depth (brána Supabase metody PROPFIND/REPORT nepouští) a odpověď
 * vrátí telefonu beze změny.
 *
 * Přihlášení: Basic s jménem a heslem z Jobi (Nastavení → Můj profil →
 * Zákazníci v telefonu), ne s heslem k účtu. Ověřuje RPC kontakty_karty.
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { odpovezDav, prihlaseni, vizitky, type KartaZakaznika, type Vizitka } from "../_shared/kontakty.ts";

/* Telefon při synchronizaci pošle několik požadavků po sobě – data stačí
   načíst jednou za chvíli (na přístup, v rámci jedné instance funkce). */
const CACHE_MS = 60_000;
const cache = new Map<string, { at: number; servis: string; karty: Vizitka[] }>();

const neprihlasen = () =>
  new Response("Unauthorized", { status: 401, headers: { "WWW-Authenticate": 'Basic realm="Jobi kontakty", charset="UTF-8"' } });

serve(async (req) => {
  const metoda = (req.headers.get("X-Dav-Method") || req.method).toUpperCase();
  const cesta = req.headers.get("X-Dav-Path") || new URL(req.url).pathname;
  const depth = req.headers.get("X-Dav-Depth") ?? "0";
  if (metoda === "OPTIONS") {
    const o = odpovezDav({ metoda, cesta, depth, telo: "", karty: [], nazevAdresare: "" });
    return new Response(o.body, { status: o.status, headers: o.headers });
  }

  const p = prihlaseni(req.headers.get("X-Dav-Authorization") || req.headers.get("Authorization"));
  if (!p) return neprihlasen();

  const klic = `${p.login}:${p.heslo}`;
  let zaznam = cache.get(klic);
  if (!zaznam || Date.now() - zaznam.at > CACHE_MS) {
    const svc = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data, error } = await svc.rpc("kontakty_karty", { p_login: p.login, p_heslo: p.heslo });
    if (error) {
      console.error("[kontakty]", error.message);
      return new Response("Chyba serveru", { status: 500 });
    }
    if (!data) {
      cache.delete(klic);
      return neprihlasen();
    }
    const servis = String((data as { servis?: string }).servis ?? "Jobi");
    zaznam = { at: Date.now(), servis, karty: vizitky(((data as { karty?: KartaZakaznika[] }).karty ?? []), servis) };
    cache.set(klic, zaznam);
    if (cache.size > 200) cache.delete(cache.keys().next().value!);
  }

  const telo = ["PROPFIND", "REPORT"].includes(metoda) ? await req.text() : "";
  const o = odpovezDav({ metoda, cesta, depth, telo, karty: zaznam.karty, nazevAdresare: `Zákazníci ${zaznam.servis}` });
  return new Response(metoda === "HEAD" ? null : o.body, { status: o.status, headers: o.headers });
});
