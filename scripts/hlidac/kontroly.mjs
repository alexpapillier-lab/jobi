/**
 * Syntetický hlídač produkce – jednotlivé kontroly.
 *
 * Projde hlavní cestu tak, jak ji projde zákazník i servis, ale bez
 * prohlížeče: přihlášení, seznam zakázek, založení a smazání zakázky,
 * zákaznický portál (čtení i akce), veřejný ceník, rezervační formulář,
 * nasazení edge funkcí, odpověď databáze a statické stránky na appjobi.com.
 *
 * PROČ BEZ PROHLÍŽEČE (a ne `e2e/hlidac.spec.ts`):
 *   - Hlídač jede každých 15 minut. Playwright by ke každému běhu potřeboval
 *     `npm ci`, stažení Chromia a vývojový server – tři minuty přípravy na
 *     dvacet sekund kontroly, a hlavně tři další věci, které se můžou samy
 *     porouchat. Falešný poplach z toho, že se nestáhl prohlížeč, je horší
 *     než žádný hlídač: po druhém takovém si člověk e-mail odfiltruje.
 *   - Porucha, kvůli které tohle vzniklo (portál vracel na každou akci 500),
 *     byla v edge funkci. HTTP dotaz ji vidí stejně dobře jako prohlížeč.
 *   - Rozbité vykreslení v prohlížeči hlídá něco jiného: `error_logs`
 *     a `alerts-check` (pády `react.render_crash` u skutečných uživatelů).
 *     Tenhle hlídač k tomu přidá aspoň to, že se hotový balíček aplikace
 *     na appjobi.com vůbec stáhne (kontrola `web`).
 *
 * BEZPEČNOSTNÍ HRANICE: hlídač pracuje výhradně v E2E testovacím servisu pod
 * účtem e2e@jobi.test. Id ostrých servisů jsou níž v `ZAKAZANE_SERVISY` a
 * `overAdresu()` odmítne odeslat požadavek, ve kterém by se objevily.
 * Zakázka hlídače nemá telefon ani e-mail, takže z ní nemůže odejít SMS ani
 * zpráva zákazníkovi ani tehdy, kdyby si servis zapnul automatizace.
 */

/** E2E testovací servis. Jediný, se kterým hlídač smí pracovat. */
export const SERVIS_ID = "882beee7-4564-4d10-8ac6-16dc19240b57";
export const SERVIS_SLUG = "e2e-servis";
export const UCET = "e2e@jobi.test";

/**
 * Ostré servisy. Hlídač se jich nesmí dotknout ani čtením – proto se
 * kontrolují sestavené adresy, ne jen konstanta výš. Překlep v id by jinak
 * hlídač poslal do zákaznických dat a nikdo by si toho nevšiml.
 */
export const ZAKAZANE_SERVISY = [
  "d9762a27-6c8d-43c4-9207-5c837e2713a0", // iSwap Repair Point
  "9a34c559-2af7-4537-9d0e-ce87e5936c4b", // MajkaPajka
];

/** Zakázky hlídače se poznají podle čísla – podle toho je maže i denní úklid. */
export const PREFIX_KODU = "HLIDAC-";

/** Nad tímhle časem odpovědi databáze už zákazník mluví o „seká to“. */
const LIMIT_DB_MS = 5_000;
/** Strop jednoho dotazu. Delší čekání nemá smysl, hlídač má být hotový rychle. */
const TIMEOUT_MS = 15_000;

/**
 * Edge funkce, kterými hlídač jinak neprochází, ale zákazník na nich závisí.
 * Kontroluje se přes OPTIONS: nenasazená funkce vrátí z brány 404, kdežto
 * nasazená odpoví na předletový dotaz 200. OPTIONS se navíc nezapočítává do
 * žádného limitu a nic nemění.
 */
const FUNKCE_KE_KONTROLE = ["api-write", "capture-upload", "sms-send", "invoice-export", "public-inventory"];

/** Statické stránky na appjobi.com, bez kterých se zákazník nikam nedostane. */
const STRANKY = [
  { url: "https://appjobi.com/z/", nazev: "stránka portálu" },
  { url: "https://appjobi.com/servis/", nazev: "webová verze aplikace" },
];

// ---------------------------------------------------------------------------
// Pomocné

class ChybaKontroly extends Error {}

/** Selhání kontroly, ne pád skriptu. Text jde do e-mailu majiteli. */
function selhani(zprava) {
  throw new ChybaKontroly(zprava);
}

function overAdresu(url) {
  const s = String(url);
  for (const zakazany of ZAKAZANE_SERVISY) {
    if (s.includes(zakazany)) {
      throw new Error(`Hlídač se pokusil sáhnout na ostrý servis ${zakazany}. Zastaveno.`);
    }
  }
  return s;
}

/** fetch s časovým stropem; síťová chyba je normální selhání kontroly. */
async function pozadavek(url, init = {}) {
  const zacatek = Date.now();
  let odpoved;
  try {
    odpoved = await fetch(overAdresu(url), { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (e) {
    const duvod = e?.name === "TimeoutError" ? `neodpovědělo do ${TIMEOUT_MS / 1000} s` : (e?.message ?? String(e));
    selhani(`${popisAdresy(url)}: ${duvod}`);
  }
  const ms = Date.now() - zacatek;
  const text = await odpoved.text();
  let telo = null;
  try {
    telo = text ? JSON.parse(text) : null;
  } catch {
    telo = null;
  }
  return { stav: odpoved.status, telo, text, ms, url: String(url) };
}

/** Adresa do hlášky bez dotazovací části – v ní bývá token portálu. */
function popisAdresy(url) {
  const s = String(url);
  const i = s.indexOf("?");
  return i === -1 ? s : s.slice(0, i);
}

function ocekavej(r, stav, co) {
  if (r.stav !== stav) {
    selhani(`${co}: čekalo se ${stav}, přišlo ${r.stav} (${(r.text ?? "").slice(0, 200)})`);
  }
  return r;
}

// ---------------------------------------------------------------------------
// Kontroly
//
// Každá má `id` shodné s KONTROLY v supabase/functions/_shared/hlidac.ts
// (hlídá to test src/lib/hlidac.test.ts) a volitelné `zavisiNa`. Když spadne
// kontrola, na které jiné závisí, ty se PŘESKOČÍ – nehlásí se jako rozbité.
// Bez toho by při nedostupném přihlášení přišlo šest hlášek o jedné poruše.

export const KONTROLY = [
  {
    id: "prihlaseni",
    async spust(stav) {
      const r = await pozadavek(`${stav.url}/auth/v1/token?grant_type=password`, {
        method: "POST",
        headers: { apikey: stav.anon, "Content-Type": "application/json" },
        body: JSON.stringify({ email: UCET, password: stav.heslo }),
      });
      ocekavej(r, 200, "přihlášení");
      if (!r.telo?.access_token) selhani("přihlášení: odpověď nemá access_token");
      stav.jwt = r.telo.access_token;
      return `přihlášen za ${r.ms} ms`;
    },
  },

  {
    id: "databaze",
    zavisiNa: "prihlaseni",
    async spust(stav) {
      // Nejlevnější možný dotaz do databáze přes PostgREST. Měří se čas, ne
      // obsah: zajímá nás, jestli databáze vůbec odpovídá a jak rychle.
      const r = await pozadavek(
        `${stav.url}/rest/v1/services?id=eq.${SERVIS_ID}&select=id,name,active`,
        { headers: hlavicky(stav) },
      );
      ocekavej(r, 200, "dotaz do databáze");
      if (!Array.isArray(r.telo) || r.telo.length !== 1) {
        selhani(`dotaz do databáze: čekal se jeden servis, přišlo ${JSON.stringify(r.telo).slice(0, 120)}`);
      }
      if (r.telo[0].active === false) selhani("testovací servis je vypnutý – hlídač nemá co kontrolovat");
      if (r.ms > LIMIT_DB_MS) selhani(`databáze odpověděla za ${r.ms} ms (strop ${LIMIT_DB_MS} ms)`);
      return `odpověď za ${r.ms} ms`;
    },
  },

  {
    id: "seznam",
    zavisiNa: "prihlaseni",
    async spust(stav) {
      const r = await pozadavek(
        `${stav.url}/rest/v1/tickets?service_id=eq.${SERVIS_ID}&select=id,code,status,created_at&order=created_at.desc&limit=20`,
        { headers: hlavicky(stav) },
      );
      ocekavej(r, 200, "seznam zakázek");
      if (!Array.isArray(r.telo)) selhani(`seznam zakázek: odpověď není seznam (${(r.text ?? "").slice(0, 160)})`);
      /*
       * Prázdný seznam je taky zpráva. Testovací servis má tisíce zakázek a
       * e2e/README.md slibuje, že se nemažou – prázdno tedy neznamená úklid
       * po testu, ale že RLS najednou nepustí nic. To je porucha, po které
       * servisu zmizí obrazovka, i když všechno vrací 200.
       */
      if (r.telo.length === 0) selhani("seznam zakázek je prázdný, přestože testovací servis zakázky má");
      return `${r.telo.length} zakázek za ${r.ms} ms`;
    },
  },

  {
    id: "zalozeni",
    zavisiNa: "prihlaseni",
    async spust(stav) {
      const kod = `${PREFIX_KODU}${new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14)}-${Math.floor(Math.random() * 10000)}`;
      const r = await pozadavek(`${stav.url}/rest/v1/tickets`, {
        method: "POST",
        headers: { ...hlavicky(stav), Prefer: "return=representation" },
        body: JSON.stringify({
          service_id: SERVIS_ID,
          code: kod,
          title: "Kontrola hlídače",
          // Žádný telefon ani e-mail. Je to jediná tvrdá pojistka proti tomu,
          // aby ze zakázky hlídače odešla SMS nebo zpráva zákazníkovi, kdyby
          // si někdo v testovacím servisu zapnul automatizaci.
          customer_name: "Hlídač provozu",
          customer_phone: null,
          customer_email: null,
          device_label: "syntetická kontrola",
          notes: "Zakázka syntetického hlídače. Vzniká a mizí každých 15 minut.",
        }),
      });
      ocekavej(r, 201, "založení zakázky");
      const zakazka = Array.isArray(r.telo) ? r.telo[0] : r.telo;
      if (!zakazka?.id) selhani(`založení zakázky: odpověď nemá id (${(r.text ?? "").slice(0, 160)})`);
      if (zakazka.customer_phone || zakazka.customer_email) {
        selhani("založená zakázka má kontakt na zákazníka – hlídač ji odmítá použít");
      }
      // Zapsat hned: úklid podle něj maže i tehdy, když další kontrola spadne.
      stav.zakazka = { id: zakazka.id, kod };
      return `${kod} za ${r.ms} ms`;
    },
  },

  {
    id: "portal_cteni",
    zavisiNa: "zalozeni",
    async spust(stav) {
      const r1 = await pozadavek(`${stav.url}/rest/v1/rpc/ensure_portal_token`, {
        method: "POST",
        headers: hlavicky(stav),
        body: JSON.stringify({ p_ticket_id: stav.zakazka.id }),
      });
      ocekavej(r1, 200, "vydání odkazu do portálu");
      const token = typeof r1.telo === "string" ? r1.telo : "";
      if (!token) selhani(`vydání odkazu do portálu: RPC nevrátilo token (${(r1.text ?? "").slice(0, 120)})`);
      stav.portalToken = token;

      // Portál se volá BEZ přihlášení, přesně jak ho otevře zákazník: token
      // v odkazu je jediné oprávnění. Kdyby se posílal i anon klíč, hlídač by
      // testoval jinou cestu, než jakou chodí lidé.
      const r2 = await pozadavek(`${stav.url}/functions/v1/portal-ticket?t=${encodeURIComponent(token)}`);
      ocekavej(r2, 200, "otevření portálu");
      if (r2.telo?.ticket?.code !== stav.zakazka.kod) {
        selhani(`otevření portálu: vrátil jinou zakázku (${JSON.stringify(r2.telo?.ticket?.code)})`);
      }
      return `portál otevřen za ${r2.ms} ms`;
    },
  },

  {
    id: "portal_akce",
    zavisiNa: "portal_cteni",
    async spust(stav) {
      /*
       * Tohle je ta kontrola, kvůli které hlídač vznikl. Nasazení přesunulo
       * pomocné funkce do `_shared` a v `portal-ticket` zůstalo volání
       * `clientIp`, které už neexistovalo: čtení portálu dál fungovalo, ale
       * KAŽDÁ akce zákazníka (schválení, zamítnutí, podpis, vyzvednutí)
       * spadla na 500. Kontrola, která jen otevře odkaz, to nepozná – a
       * `action: "neco"` taky ne, protože neznámá akce se odmítne dřív, než
       * se k té části kódu vůbec dojde. Musí to být skutečná akce.
       *
       * Schválení nabídky je z těch čtyř nejneškodnější: nic nenahrává do
       * úložiště, nikomu nic neposílá a celá zakázka za pár sekund zmizí.
       */
      const r1 = await pozadavek(`${stav.url}/rest/v1/tickets?id=eq.${stav.zakazka.id}`, {
        method: "PATCH",
        headers: { ...hlavicky(stav), Prefer: "return=representation" },
        body: JSON.stringify({
          quote_amount: 1,
          quote_items: [],
          quote_status: "sent",
          quote_sent_at: new Date().toISOString(),
        }),
      });
      ocekavej(r1, 200, "rozeslání nabídky");

      const r2 = await pozadavek(`${stav.url}/functions/v1/portal-ticket`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ t: stav.portalToken, action: "approve" }),
      });
      ocekavej(r2, 200, "schválení nabídky v portálu");
      if (r2.telo?.ticket?.quote?.status !== "approved") {
        selhani(`schválení nabídky: portál vrátil stav ${JSON.stringify(r2.telo?.ticket?.quote?.status)}`);
      }
      return `nabídka schválena za ${r2.ms} ms`;
    },
  },

  {
    id: "smazani",
    zavisiNa: "zalozeni",
    async spust(stav) {
      // Stejná cesta, jakou zakázku maže aplikace (Další akce → Smazat).
      // Natvrdo ji `authenticated` smazat nesmí – DELETE politika na tickets
      // je restriktivní a povolující žádná není. Ze seznamu ale zmizet musí.
      const r = await pozadavek(`${stav.url}/rest/v1/rpc/soft_delete_ticket`, {
        method: "POST",
        headers: hlavicky(stav),
        body: JSON.stringify({ p_ticket_id: stav.zakazka.id }),
      });
      if (r.stav !== 200 && r.stav !== 204) {
        selhani(`smazání zakázky: čekalo se 200/204, přišlo ${r.stav} (${(r.text ?? "").slice(0, 200)})`);
      }
      stav.zakazkaSmazana = true;

      // Ověřit v databázi, ne jen podle návratového kódu: RPC může skončit
      // úspěchem a nesmazat nic, přesně jako podmíněný UPDATE bez `select`.
      const r2 = await pozadavek(
        `${stav.url}/rest/v1/tickets?id=eq.${stav.zakazka.id}&select=id,deleted_at`,
        { headers: hlavicky(stav) },
      );
      ocekavej(r2, 200, "kontrola smazané zakázky");
      const radek = Array.isArray(r2.telo) ? r2.telo[0] : null;
      if (radek && !radek.deleted_at) selhani("smazání zakázky: zakázka je pořád v seznamu");
      return `smazáno za ${r.ms} ms`;
    },
  },

  {
    id: "cenik",
    async spust(stav) {
      const r = await pozadavek(`${stav.url}/functions/v1/public-catalog?service=${SERVIS_SLUG}`);
      ocekavej(r, 200, "veřejný ceník");
      /*
       * Kontroluje se TVAR odpovědi, ne kolik je v ceníku oprav.
       *
       * Napoprvé tu stálo „aspoň jedna oprava" a hlídač na tom hned spadl:
       * `api-automatizace.spec.ts` si v testovacím servisu zveřejňuje vlastní
       * značky a na konci je zase schová (`public_visible: false`), takže
       * veřejný ceník E2E servisu je chvíli plný a chvíli prázdný. To je
       * úklid po testu, ne porucha – a hlídač, který na tom hlásí poplach,
       * je za týden odfiltrovaný do koše.
       *
       * Obecně: syntetická kontrola se nesmí opírat o data, která mění někdo
       * jiný. Skutečné selhání `public-catalog` se pozná ze stavového kódu –
       * když dotaz do databáze selže, funkce schválně vrací 503, ne prázdný
       * ceník (to by zákazníkovi vyprázdnilo web).
       */
      if (r.telo?.service?.slug !== SERVIS_SLUG) {
        selhani(`veřejný ceník vrátil jiný servis (${JSON.stringify(r.telo?.service?.slug)})`);
      }
      for (const klic of ["brands", "categories", "models", "repairs"]) {
        if (!Array.isArray(r.telo?.[klic])) selhani(`veřejný ceník nemá seznam „${klic}“`);
      }
      // Marže servisu nesmí ven ani omylem – ceník je veřejný. Tohle není
      // výpadek, ale únik dat; hlídač je jediné místo, kde se to kontroluje
      // na NASAZENÉ funkci, ne na zdrojácích.
      if (r.telo.repairs.some((o) => o && "costs" in o)) {
        selhani("veřejný ceník vrací nákupní ceny (costs) – to je únik dat, ne výpadek");
      }
      return `${r.telo.repairs.length} oprav za ${r.ms} ms`;
    },
  },

  {
    id: "rezervace",
    async spust(stav) {
      // JEN nastavení formuláře (GET). Rezervace se schválně nezakládá:
      // navíc by v Kalendáři testovacího servisu každých 15 minut přibyl
      // řádek a POST má strop 10 za hodinu z jedné adresy, který by hlídač
      // dokázal vyčerpat. GET se do žádného limitu nepočítá.
      const r = await pozadavek(`${stav.url}/functions/v1/public-booking?service=${SERVIS_SLUG}`);
      ocekavej(r, 200, "rezervační formulář");
      if (!r.telo?.od || !r.telo?.do || !Array.isArray(r.telo?.dny)) {
        selhani(`rezervační formulář: nastavení je neúplné (${(r.text ?? "").slice(0, 160)})`);
      }
      return `otevírací doba ${r.telo.od}–${r.telo.do} za ${r.ms} ms`;
    },
  },

  {
    id: "edge_funkce",
    async spust(stav) {
      const spatne = [];
      for (const funkce of FUNKCE_KE_KONTROLE) {
        const r = await pozadavek(`${stav.url}/functions/v1/${funkce}`, {
          method: "OPTIONS",
          headers: { Origin: "https://appjobi.com", "Access-Control-Request-Method": "POST" },
        });
        if (r.stav !== 200) spatne.push(`${funkce} → ${r.stav}`);
      }
      if (spatne.length > 0) selhani(`nasazení edge funkcí: ${spatne.join(", ")}`);
      return `${FUNKCE_KE_KONTROLE.length} funkcí nasazeno`;
    },
  },

  {
    id: "web",
    async spust() {
      for (const stranka of STRANKY) {
        const r = await pozadavek(stranka.url);
        ocekavej(r, 200, stranka.nazev);
        if ((r.text ?? "").length < 500) {
          selhani(`${stranka.nazev}: vrátila ${r.text?.length ?? 0} B, to není hotová stránka`);
        }
      }
      // Aplikace je jeden balíček JavaScriptu. Když se nenasadí nebo se
      // nasadí prázdný, stránka vrátí 200 a zákazník uvidí bílou obrazovku.
      const index = await pozadavek("https://appjobi.com/servis/");
      const odkaz = /<script[^>]+src="([^"]+\.js)"/.exec(index.text ?? "");
      if (!odkaz) selhani("webová verze aplikace: v HTML není odkaz na balíček JavaScriptu");
      const balicek = odkaz[1].startsWith("http") ? odkaz[1] : `https://appjobi.com${odkaz[1]}`;
      const r = await pozadavek(balicek);
      ocekavej(r, 200, "balíček aplikace");
      if ((r.text ?? "").length < 10_000) {
        selhani(`balíček aplikace má jen ${r.text?.length ?? 0} B – nasadilo se něco nedopečeného`);
      }
      return `stránky i balíček (${Math.round((r.text.length / 1024))} kB) v pořádku`;
    },
  },
];

function hlavicky(stav) {
  return { apikey: stav.anon, Authorization: `Bearer ${stav.jwt}`, "Content-Type": "application/json" };
}

/**
 * Úklid. Volá se VŽDY, i po pádu uprostřed a i tehdy, když spadlo přihlášení.
 * Zakázka hlídače nesmí zůstat v seznamu; kdyby se ji nepodařilo smazat, je
 * to samostatné selhání (`uklid`), ne tichá stopa.
 */
export async function uklid(stav) {
  if (!stav.zakazka || stav.zakazkaSmazana) return null;
  if (!stav.jwt) return `zakázka ${stav.zakazka.kod} zůstala – hlídač nemá platné přihlášení`;
  for (let pokus = 1; pokus <= 3; pokus++) {
    try {
      const r = await pozadavek(`${stav.url}/rest/v1/rpc/soft_delete_ticket`, {
        method: "POST",
        headers: hlavicky(stav),
        body: JSON.stringify({ p_ticket_id: stav.zakazka.id }),
      });
      if (r.stav === 200 || r.stav === 204) {
        stav.zakazkaSmazana = true;
        return null;
      }
      if (pokus === 3) return `zakázka ${stav.zakazka.kod} zůstala v seznamu (${r.stav})`;
    } catch (e) {
      if (pokus === 3) return `zakázka ${stav.zakazka.kod} zůstala v seznamu (${e.message})`;
    }
    await new Promise((r) => setTimeout(r, 1000 * pokus));
  }
  return null;
}
