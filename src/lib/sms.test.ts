/**
 * SMS a e-maily: jediná část aplikace, která mluví se světem za peníze
 * zákazníka.
 *
 * Odchozí SMS se platí po segmentech, rezervační e-mail čte majitel servisu
 * ve své poště a faktura odchází zákazníkovi. Chyba tady nekončí červeným
 * proužkem v aplikaci, ale účtem u Twilia nebo fakturou, kterou zákazník
 * nikdy nedostal a aplikace tvrdí, že dostal.
 *
 * JAK SE TO TESTUJE (stejný postup jako billingWebhook.test.ts)
 * `npx vitest run` bere podle vite.config.ts jen `src/**`, a `index.ts` edge
 * funkcí se stejně naimportovat nedá – tahají `serve` z deno.land a
 * `createClient` z esm.sh. Testuje se proto ve třech vrstvách:
 *
 *  1. Co jde importovat doopravdy, se importuje doopravdy. Počítání segmentů,
 *     kontrola balíčku, výběr servisu u příchozí zprávy i šablony
 *     rezervačních e-mailů žijí v `_shared` a jsou to TYTÉŽ funkce, jaké
 *     běží v provozu. Do `zkontrolujBalicek` a `vyberServis` se posílá
 *     falešný klient Supabase – projde se skutečná cesta včetně filtrů.
 *  2. Co v `_shared` být nemůže (tělo `serve`), je přepsané jako referenční
 *     implementace. Je to zrcadlo: kdyby někdo přepsal index.ts, test o tom
 *     neví, proto se drží co nejblíž předloze.
 *  3. Místa, kde chyba stojí peníze nebo pověst, hlídá test přímo ve zdrojáku
 *     edge funkce (viz „pojistky ve zdrojácích“).
 *
 * ŽÁDNÁ SÍŤ. Nikde v tomhle souboru se nevolá `fetch` ven; poskytovatel je
 * vždycky funkce dodaná testem, která si volání jen zapíše.
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  bezDiakritiky,
  jeGsm7,
  normalizeE164,
  normalizeE164Prichozi,
  segmentu,
  telefonSediZakazce,
  textProSms,
  vyberServis,
  zacatekMesice,
  zkontrolujBalicek,
  zpravaOVycerpani,
  SMS_MAX_BODY_LENGTH,
  type SmsDotaz,
  type SmsKlient,
} from "../../supabase/functions/_shared/sms";
import { escapeHtml } from "../../supabase/functions/_shared/html";
import {
  mailServisuHtml,
  mailZakaznikoviHtml,
  predmetServisu,
  type KontaktServisu,
  type RezervaceMail,
} from "../../supabase/functions/_shared/bookingMail";

const KOREN = join(__dirname, "..", "..");
const zdroj = (cesta: string) => readFileSync(join(KOREN, cesta), "utf8");
/** Zdroják bez komentářů – ať pojistky nereagují na text v komentáři. */
const zdrojBezKomentaru = (cesta: string) =>
  zdroj(cesta).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const SERVIS = "11111111-1111-1111-1111-111111111111";
const CIZI_SERVIS = "22222222-2222-2222-2222-222222222222";

// ---------------------------------------------------------------------------
// Falešný klient Supabase
// ---------------------------------------------------------------------------

type Radek = Record<string, unknown>;

/**
 * Pár řádků místo databáze.
 *
 * Filtruje podle stejných `eq`/`in`/`gte`… jako PostgREST, takže se do
 * `zkontrolujBalicek` a `vyberServis` pošle skutečný tvar dotazu. Tečkovaný
 * sloupec (`sms_conversations.service_id` z vnitřního JOINu) se čte jako
 * poslední část názvu – v testovacích datech je servis rovnou na řádku.
 */
function falesnyKlient(data: Record<string, Radek[]>): SmsKlient & { dotazy: string[] } {
  const dotazy: string[] = [];
  const hodnota = (r: Radek, sloupec: string) => r[sloupec.includes(".") ? sloupec.split(".").pop()! : sloupec];

  const from = (tabulka: string): SmsDotaz => {
    dotazy.push(tabulka);
    const filtry: Array<(r: Radek) => boolean> = [];
    let razeni: { sloupec: string; ascending: boolean } | null = null;
    let strop: number | null = null;
    /** Stránkování jako v PostgREST – `range` je půlotevřený interval včetně obou konců. */
    let rozsah: { od: number; do: number } | null = null;

    const vysledek = (): Radek[] => {
      let radky = (data[tabulka] ?? []).filter((r) => filtry.every((f) => f(r)));
      if (razeni) {
        const { sloupec, ascending } = razeni;
        radky = [...radky].sort((a, b) => {
          const x = String(hodnota(a, sloupec) ?? "");
          const y = String(hodnota(b, sloupec) ?? "");
          return ascending ? x.localeCompare(y) : y.localeCompare(x);
        });
      }
      if (rozsah) radky = radky.slice(rozsah.od, rozsah.do + 1);
      return strop === null ? radky : radky.slice(0, strop);
    };

    const dotaz: SmsDotaz = {
      select: () => dotaz,
      eq: (c, v) => {
        filtry.push((r) => hodnota(r, c) === v);
        return dotaz;
      },
      in: (c, v) => {
        filtry.push((r) => v.includes(hodnota(r, c)));
        return dotaz;
      },
      is: (c, v) => {
        filtry.push((r) => (hodnota(r, c) ?? null) === v);
        return dotaz;
      },
      not: (c, op, v) => {
        filtry.push((r) => !(op === "is" && (hodnota(r, c) ?? null) === v));
        return dotaz;
      },
      gte: (c, v) => {
        filtry.push((r) => String(hodnota(r, c)) >= String(v));
        return dotaz;
      },
      order: (c, o) => {
        razeni = { sloupec: c, ascending: o.ascending };
        return dotaz;
      },
      limit: (n) => {
        strop = n;
        return dotaz;
      },
      range: (od, do_) => {
        rozsah = { od, do: do_ };
        return dotaz;
      },
      maybeSingle: () => Promise.resolve({ data: vysledek()[0] ?? null, error: null }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      then: (ok?: any, chyba?: any) => Promise.resolve({ data: vysledek(), error: null }).then(ok, chyba),
    };
    return dotaz;
  };

  return { from, dotazy };
}

/** Odchozí zpráva v daném měsíci – tak, jak ji do sms_messages zapíše sms-send. */
function odeslana(serviceId: string, body: string, sentAt = "2026-09-05T10:00:00.000Z"): Radek {
  return { service_id: serviceId, direction: "outbound", body, sent_at: sentAt };
}

// ---------------------------------------------------------------------------
// 1. Text zprávy a počítání segmentů (skutečný kód z _shared/sms.ts)
// ---------------------------------------------------------------------------

/**
 * Segment je jednotka, kterou účtuje Twilio i náš balíček. Bez diakritiky se
 * do jednoho vejde 160 znaků, s diakritikou (UCS-2) jen 70. Když se spleteme
 * my, zákazník zaplatí víc, než měl v balíčku – a nikde to nebude vidět,
 * protože obě čísla, naše i jeho, budou stejně špatná.
 */
describe("text zprávy a segmenty", () => {
  it("háčky a čárky se z textu odstraní", () => {
    expect(bezDiakritiky("Vaše zakázka je hotová, můžete si ji vyzvednout"))
      .toBe("Vase zakazka je hotova, muzete si ji vyzvednout");
    expect(bezDiakritiky("ŘEŽ ĎÁBLE ÚPĚL")).toBe("REZ DABLE UPEL");
  });

  it("znaky, které NFD nerozloží, mají vlastní náhradu", () => {
    expect(bezDiakritiky("Straße Łódź Ørsted")).toBe("Strasse Lodz Orsted");
  });

  it("zpráva bez diakritiky se vejde do 160 znaků na jednu SMS", () => {
    expect(segmentu("A".repeat(160))).toBe(1);
    expect(segmentu("A".repeat(161))).toBe(2);
    expect(segmentu("A".repeat(306))).toBe(2);
    expect(segmentu("A".repeat(307))).toBe(3);
  });

  it("zpráva s diakritikou se vejde jen do 70 znaků – to je ta dvojnásobná cena", () => {
    expect(jeGsm7("Vaše zakázka")).toBe(false);
    expect(segmentu("á".repeat(70))).toBe(1);
    expect(segmentu("á".repeat(71))).toBe(2);
    expect(segmentu("á".repeat(134))).toBe(2);
    expect(segmentu("á".repeat(135))).toBe(3);
  });

  it("typografická pomlčka „–“ sama o sobě zdraží celou zprávu", () => {
    // Přesně tenhle znak se do šablon dostane kopií z Wordu. Sto znaků
    // s pomlčkou = dvě SMS; sto znaků bez ní = jedna.
    const sPomlckou = "Vase zakazka " + "A".repeat(86) + " – hotovo";
    expect(sPomlckou.length).toBeLessThanOrEqual(160);
    expect(jeGsm7(sPomlckou)).toBe(false);
    expect(segmentu(sPomlckou)).toBe(2);
    // textProSms ji vymění za obyčejnou a zpráva je zase za jednu.
    expect(segmentu(textProSms(sPomlckou))).toBe(1);
  });

  it("textProSms uklidí i uvozovky, výpustku a nedělitelné mezery", () => {
    expect(textProSms("„Displej“ – 2 490 Kč…")).toBe('"Displej" - 2 490 Kc...');
    expect(jeGsm7(textProSms("„Displej“ – 2 490 Kč…"))).toBe(true);
  });

  it("emoji přepne zprávu do UCS-2 a počítá se na 16bitové jednotky", () => {
    // Emoji je jedna „písmenka“, ale dvě jednotky – a Twilio účtuje jednotky.
    const s = "Hotovo 🎉";
    expect(jeGsm7(s)).toBe(false);
    expect(segmentu(s)).toBe(1);
    expect(segmentu("🎉".repeat(36))).toBe(2); // 72 jednotek
  });

  it("znaky z rozšířené GSM tabulky zabírají dvě místa, ne jedno", () => {
    // €, [ ] { } ~ | ^ \ se posílají přes escape. 81 hranatých závorek je
    // 162 septetů, tedy dvě zprávy, i když je to jen 81 znaků.
    expect(segmentu("[".repeat(80))).toBe(1);
    expect(segmentu("[".repeat(81))).toBe(2);
    expect(jeGsm7("Cena 100€")).toBe(true);
  });

  it("prázdná zpráva stojí jeden segment, ne nula", () => {
    // Twilio účtuje i prázdnou zprávu; kdyby vyšla nula, dala by se jimi
    // obejít celá kvóta.
    expect(segmentu("")).toBe(1);
  });

  it("nejdelší povolená zpráva se pořád spočítá, ne že by přetekla", () => {
    expect(segmentu("A".repeat(SMS_MAX_BODY_LENGTH))).toBe(11);
    expect(segmentu("á".repeat(SMS_MAX_BODY_LENGTH))).toBe(24);
  });

  it("běžná zpráva o hotové zakázce vyjde po úpravě na jednu SMS", () => {
    const sablona = "Dobrý den, Vaše zakázka E2E-0042 je hotová. Cena 2 490 Kč. Těšíme se, Servis Novák";
    expect(segmentu(sablona)).toBe(2); // s diakritikou dvě
    expect(segmentu(textProSms(sablona))).toBe(1); // po úpravě jedna
  });
});

describe("telefon na E.164", () => {
  it("české číslo dostane předvolbu v každém obvyklém tvaru", () => {
    for (const vstup of ["777123456", "777 123 456", "0777123456", "+420 777 123 456", "00420777123456"]) {
      expect(normalizeE164(vstup), vstup).toBe("+420777123456");
    }
  });

  it("cizí číslo se nepřepíše na české", () => {
    expect(normalizeE164("+421905123456")).toBe("+421905123456");
    expect(normalizeE164("+15551234567")).toBe("+15551234567");
  });

  it("příchozí číslo se jen sjednotí, nic se v něm neopravuje", () => {
    expect(normalizeE164Prichozi("+420777123456")).toBe("+420777123456");
    expect(normalizeE164Prichozi("777123456")).toBe("+420777123456");
    expect(normalizeE164Prichozi("+15551234567")).toBe("+15551234567");
  });

  it("telefon ze zakázky sedí i v jiném zápisu", () => {
    expect(telefonSediZakazce("777 123 456", "+420777123456")).toBe(true);
    expect(telefonSediZakazce("+420777123456", "+420777123456")).toBe(true);
    expect(telefonSediZakazce("00420777123456", "+420777123456")).toBe(true);
  });

  it("jiný člověk se za shodu nevydává", () => {
    expect(telefonSediZakazce("777123457", "+420777123456")).toBe(false);
    expect(telefonSediZakazce("", "+420777123456")).toBe(false);
    expect(telefonSediZakazce(null, "+420777123456")).toBe(false);
    // Posledních devět číslic je celé české číslo – kratší shoda nestačí.
    expect(telefonSediZakazce("123456", "+420777123456")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 2. Balíček SMS (skutečná zkontrolujBalicek nad falešnou databází)
// ---------------------------------------------------------------------------

describe("strop balíčku SMS", () => {
  const TED = new Date("2026-09-15T12:00:00.000Z");

  const klient = (quota: number | null | undefined, zpravy: Radek[] = []) =>
    falesnyKlient({
      service_entitlements: quota === undefined ? [] : [{ service_id: SERVIS, module: "sms", quota }],
      sms_messages: zpravy,
    });

  it("pod stropem zpráva projde", async () => {
    const stav = await zkontrolujBalicek(klient(100, [odeslana(SERVIS, "A".repeat(160))]), SERVIS, 1, TED);
    expect(stav.prekroceno).toBe(false);
    expect(stav.spotrebovano).toBe(1);
    expect(stav.limit).toBe(100);
  });

  it("poslední zpráva do stropu ještě projde", async () => {
    const zpravy = Array.from({ length: 99 }, () => odeslana(SERVIS, "krátká"));
    const stav = await zkontrolujBalicek(klient(100, zpravy), SERVIS, 1, TED);
    expect(stav.spotrebovano).toBe(99);
    expect(stav.prekroceno).toBe(false);
  });

  it("zpráva, která by strop přelezla, neprojde", async () => {
    const zpravy = Array.from({ length: 100 }, () => odeslana(SERVIS, "krátká"));
    const stav = await zkontrolujBalicek(klient(100, zpravy), SERVIS, 1, TED);
    expect(stav.prekroceno).toBe(true);
    expect(stav.zprava).toContain("100 z 100");
  });

  it("dlouhá zpráva se odmítne celá, ne po částech", async () => {
    // Zbývá jeden segment, zpráva potřebuje dva. Nesmí odejít půlka.
    const zpravy = Array.from({ length: 99 }, () => odeslana(SERVIS, "krátká"));
    const stav = await zkontrolujBalicek(klient(100, zpravy), SERVIS, 2, TED);
    expect(stav.prekroceno).toBe(true);
  });

  it("do stropu se počítají segmenty, ne zprávy", async () => {
    // Tři odeslané zprávy po dvou segmentech = šest, ne tři.
    const dlouha = "A".repeat(200);
    const stav = await zkontrolujBalicek(
      klient(10, [odeslana(SERVIS, dlouha), odeslana(SERVIS, dlouha), odeslana(SERVIS, dlouha)]),
      SERVIS,
      1,
      TED,
    );
    expect(stav.spotrebovano).toBe(6);
  });

  it("zprávy s diakritikou se do stropu počítají jako dražší, jaké jsou", async () => {
    // Historické zprávy z automatizací mají diakritiku (posílaly se tak).
    // Twilio je účtoval po 70 znacích, balíček to musí vidět stejně.
    const stav = await zkontrolujBalicek(klient(100, [odeslana(SERVIS, "á".repeat(100))]), SERVIS, 1, TED);
    expect(stav.spotrebovano).toBe(2);
  });

  it("cizí servis si ze stropu neodečte ani nepřičte", async () => {
    const stav = await zkontrolujBalicek(
      klient(10, [odeslana(CIZI_SERVIS, "A".repeat(1000)), odeslana(SERVIS, "krátká")]),
      SERVIS,
      1,
      TED,
    );
    expect(stav.spotrebovano).toBe(1);
  });

  it("minulý měsíc se do stropu nepočítá", async () => {
    const stav = await zkontrolujBalicek(
      klient(10, [
        odeslana(SERVIS, "A".repeat(1000), "2026-08-31T23:59:59.000Z"),
        odeslana(SERVIS, "krátká", "2026-09-01T00:00:00.000Z"),
      ]),
      SERVIS,
      1,
      TED,
    );
    expect(stav.spotrebovano).toBe(1);
    expect(zacatekMesice(TED)).toBe("2026-09-01T00:00:00.000Z");
  });

  it("příchozí zprávy se z balíčku neplatí", async () => {
    const k = falesnyKlient({
      service_entitlements: [{ service_id: SERVIS, module: "sms", quota: 10 }],
      sms_messages: [
        { service_id: SERVIS, direction: "inbound", body: "A".repeat(1000), sent_at: "2026-09-05T10:00:00.000Z" },
      ],
    });
    const stav = await zkontrolujBalicek(k, SERVIS, 1, TED);
    expect(stav.spotrebovano).toBe(0);
  });

  it("nulový balíček nepustí ven vůbec nic", async () => {
    const stav = await zkontrolujBalicek(klient(0), SERVIS, 1, TED);
    expect(stav.prekroceno).toBe(true);
    expect(stav.zprava).toContain("0 z 0");
  });

  it("quota null znamená bez omezení – proto smí vzniknout jen ruční správou", async () => {
    const stav = await zkontrolujBalicek(klient(null, [odeslana(SERVIS, "A".repeat(100_000))]), SERVIS, 999, TED);
    expect(stav.limit).toBeNull();
    expect(stav.prekroceno).toBe(false);
  });

  it("chybějící řádek nároku se čte stejně jako bez omezení", async () => {
    // Nárok na modul se ověřuje zvlášť (has_entitlement) a bez něj se sem
    // vůbec nedojde; tenhle stav nastane jen u ručně založeného nároku.
    const stav = await zkontrolujBalicek(klient(undefined), SERVIS, 1, TED);
    expect(stav.limit).toBeNull();
    expect(stav.prekroceno).toBe(false);
  });

  it("hláška řekne, kolik z kolika je pryč a co s tím", async () => {
    expect(zpravaOVycerpani(300, 300)).toContain("300 z 300");
    expect(zpravaOVycerpani(300, 300)).toContain("vyšší tarif");
    expect(zpravaOVycerpani(300, 300)).toContain("příštího měsíce");
  });
});

// ---------------------------------------------------------------------------
// 3. Referenční implementace sms-send (zrcadlo těla serve)
// ---------------------------------------------------------------------------

type OdpovedSms = { status: number; telo: Record<string, unknown> };

type PoskytovatelSms = (telo: { From: string; To: string; Body: string }) => Promise<{
  ok: boolean;
  data: Record<string, unknown>;
}>;

type VstupSms = {
  serviceId: string;
  to: string;
  body: unknown;
  /** Vidí volající řádek service_phone_numbers? (RLS = členství v servisu) */
  cisloServisu: { twilio_number: string } | null;
  /** has_entitlement("sms") */
  narokNaModul: boolean;
  klient: SmsKlient;
  posli: PoskytovatelSms;
  /** Zápis do sms_messages; chyba = zpráva odešla, ale neuložila se. */
  ulozZpravu?: (body: string) => Promise<{ chyba: string | null }>;
};

/**
 * Zrcadlo `sms-send/index.ts` – pořadí kontrol, návratové kódy a to, kdy se
 * vůbec smí sáhnout na poskytovatele. Používá skutečné `textProSms`,
 * `segmentu` a `zkontrolujBalicek`, takže se rozejít může jen tenhle
 * doslovný opis rozhodování, ne počítání peněz.
 */
async function odesliSms(v: VstupSms): Promise<OdpovedSms> {
  if (v.body == null || typeof v.body !== "string") {
    return { status: 400, telo: { error: "Missing or invalid field: body" } };
  }
  if (v.body.length > SMS_MAX_BODY_LENGTH) {
    return { status: 400, telo: { error: "Message too long (max 1600 characters)" } };
  }
  const to = normalizeE164(v.to);
  if (!v.cisloServisu) {
    return { status: 403, telo: { error: "SMS not activated or no access to this service" } };
  }
  if (!v.narokNaModul) {
    return { status: 403, telo: { error: "Modul SMS není pro tento servis aktivní." } };
  }
  const text = textProSms(v.body);
  const potreba = segmentu(text);
  const balicek = await zkontrolujBalicek(v.klient, v.serviceId, potreba);
  if (balicek.prekroceno) {
    return {
      status: 402,
      telo: { error: balicek.zprava, quota_exceeded: true, used: balicek.spotrebovano, limit: balicek.limit },
    };
  }
  const odpoved = await v.posli({ From: v.cisloServisu.twilio_number, To: to, Body: text });
  if (!odpoved.ok) {
    if (odpoved.data?.code === 21211) {
      return { status: 400, telo: { error: "Invalid phone number" } };
    }
    return { status: 502, telo: { error: "Twilio error", detail: odpoved.data?.message } };
  }
  const ulozeni = v.ulozZpravu ? await v.ulozZpravu(text) : { chyba: null };
  if (ulozeni.chyba) {
    return { status: 500, telo: { error: "Message sent but failed to save locally" } };
  }
  return { status: 200, telo: { twilio_sid: odpoved.data?.sid ?? null } };
}

describe("sms-send: co se smí dostat k poskytovateli", () => {
  const zaklad = (prepis: Partial<VstupSms> = {}): { vstup: VstupSms; odeslano: Array<{ Body: string }> } => {
    const odeslano: Array<{ Body: string; From: string; To: string }> = [];
    const vstup: VstupSms = {
      serviceId: SERVIS,
      to: "777123456",
      body: "Vaše zakázka je hotová",
      cisloServisu: { twilio_number: "+420700000000" },
      narokNaModul: true,
      klient: falesnyKlient({ service_entitlements: [{ service_id: SERVIS, module: "sms", quota: 100 }], sms_messages: [] }),
      posli: async (t) => {
        odeslano.push(t);
        return { ok: true, data: { sid: "SM_test", status: "queued" } };
      },
      ...prepis,
    };
    return { vstup, odeslano };
  };

  it("běžná zpráva projde a odejde bez diakritiky", async () => {
    const { vstup, odeslano } = zaklad();
    const odp = await odesliSms(vstup);
    expect(odp.status).toBe(200);
    expect(odeslano).toHaveLength(1);
    expect(odeslano[0].Body).toBe("Vase zakazka je hotova");
  });

  it("bez nároku na modul se nesmí nic odeslat", async () => {
    const { vstup, odeslano } = zaklad({ narokNaModul: false });
    const odp = await odesliSms(vstup);
    expect(odp.status).toBe(403);
    expect(odeslano, "poskytovatel se nesmí vůbec zavolat").toHaveLength(0);
  });

  it("bez členství v servisu (číslo není vidět) se nesmí nic odeslat", async () => {
    const { vstup, odeslano } = zaklad({ cisloServisu: null });
    const odp = await odesliSms(vstup);
    expect(odp.status).toBe(403);
    expect(odeslano).toHaveLength(0);
  });

  it("vyčerpaný balíček vrátí 402 a zprávu neodešle", async () => {
    const zpravy = Array.from({ length: 100 }, () => odeslana(SERVIS, "krátká"));
    const { vstup, odeslano } = zaklad({
      klient: falesnyKlient({
        service_entitlements: [{ service_id: SERVIS, module: "sms", quota: 100 }],
        sms_messages: zpravy,
      }),
    });
    const odp = await odesliSms(vstup);
    expect(odp.status).toBe(402);
    expect(odp.telo.quota_exceeded).toBe(true);
    expect(odp.telo.used).toBe(100);
    expect(odp.telo.limit).toBe(100);
    expect(String(odp.telo.error)).toContain("Balíček SMS je vyčerpaný");
    expect(odeslano, "vyčerpaný balíček se nesmí protelefonovat").toHaveLength(0);
  });

  it("kontrola balíčku je dřív než odeslání, ne až po něm", async () => {
    // Kdyby se strop kontroloval po odeslání, byl by k ničemu: zpráva už je
    // pryč a zaplacená. Test to hlídá pořadím – při 402 se poskytovatel
    // nesmí zavolat vůbec.
    const { vstup, odeslano } = zaklad({
      klient: falesnyKlient({ service_entitlements: [{ service_id: SERVIS, module: "sms", quota: 0 }], sms_messages: [] }),
    });
    expect((await odesliSms(vstup)).status).toBe(402);
    expect(odeslano).toHaveLength(0);
  });

  it("příliš dlouhá zpráva se odmítne dřív, než se počítají peníze", async () => {
    const { vstup, odeslano } = zaklad({ body: "A".repeat(SMS_MAX_BODY_LENGTH + 1) });
    expect((await odesliSms(vstup)).status).toBe(400);
    expect(odeslano).toHaveLength(0);
  });

  it("chybějící text zprávy je chyba volajícího, ne prázdná SMS", async () => {
    for (const spatny of [null, undefined, 42, { text: "ahoj" }]) {
      const { vstup, odeslano } = zaklad({ body: spatny });
      expect((await odesliSms(vstup)).status, String(spatny)).toBe(400);
      expect(odeslano).toHaveLength(0);
    }
  });

  it("chyba poskytovatele se pozná, zpráva se neuloží jako odeslaná", async () => {
    let ulozeno = 0;
    const { vstup } = zaklad({
      posli: async () => ({ ok: false, data: { code: 30003, message: "Unreachable destination handset" } }),
      ulozZpravu: async () => {
        ulozeno += 1;
        return { chyba: null };
      },
    });
    const odp = await odesliSms(vstup);
    expect(odp.status).toBe(502);
    expect(ulozeno, "neodeslaná zpráva nesmí přistát v chatu").toBe(0);
  });

  it("neplatné číslo vrátí 400, ať uživatel opraví telefon a ne balíček", async () => {
    const { vstup } = zaklad({
      posli: async () => ({ ok: false, data: { code: 21211, message: "Invalid 'To' Phone Number" } }),
    });
    expect((await odesliSms(vstup)).status).toBe(400);
  });

  it("odeslaná, ale neuložená zpráva se přizná, ne zamlčí", async () => {
    // Chyba zápisu po odeslání je nepříjemná, ale zpráva už letí – uživatel
    // musí vědět, že ji v chatu neuvidí, jinak ji pošle znovu.
    const { vstup } = zaklad({ ulozZpravu: async () => ({ chyba: "conflict" }) });
    const odp = await odesliSms(vstup);
    expect(odp.status).toBe(500);
    expect(String(odp.telo.error)).toContain("Message sent but failed to save");
  });
});

// ---------------------------------------------------------------------------
// 4. Příchozí SMS: ke kterému servisu patří (skutečná vyberServis)
// ---------------------------------------------------------------------------

describe("příchozí SMS: přiřazení k servisu", () => {
  const cisla = [
    { service_id: SERVIS, is_pool_primary: false, twilio_number: "+420700000000" },
    { service_id: CIZI_SERVIS, is_pool_primary: true, twilio_number: "+420700000000" },
  ];

  it("jediný servis na čísle se nemusí hádat", async () => {
    const k = falesnyKlient({});
    const vysledek = await vyberServis(k, [cisla[0]], "+420777123456");
    expect(vysledek).toBe(SERVIS);
    expect(k.dotazy, "u jednoho servisu se nemá na co ptát").toHaveLength(0);
  });

  it("bez čísla se nic nepřiřadí", async () => {
    expect(await vyberServis(falesnyKlient({}), [], "+420777123456")).toBeNull();
  });

  it("rozepsaná konverzace rozhodne dřív než cokoli jiného", async () => {
    const k = falesnyKlient({
      sms_conversations: [{ service_id: SERVIS, customer_phone: "+420777123456", updated_at: "2026-09-01" }],
      tickets: [{ service_id: CIZI_SERVIS, customer_phone: "+420777123456", updated_at: "2026-09-09", deleted_at: null }],
    });
    expect(await vyberServis(k, cisla, "+420777123456")).toBe(SERVIS);
  });

  it("bez konverzace rozhodne zakázka se stejným telefonem", async () => {
    const k = falesnyKlient({
      sms_conversations: [],
      tickets: [
        { service_id: CIZI_SERVIS, customer_phone: "+420608111222", updated_at: "2026-09-09", deleted_at: null },
        { service_id: SERVIS, customer_phone: "777 123 456", updated_at: "2026-09-08", deleted_at: null },
      ],
    });
    expect(await vyberServis(k, cisla, "+420777123456")).toBe(SERVIS);
  });

  it("smazaná zakázka servis neurčuje", async () => {
    const k = falesnyKlient({
      sms_conversations: [],
      tickets: [{ service_id: SERVIS, customer_phone: "+420777123456", updated_at: "2026-09-09", deleted_at: "2026-09-01" }],
      customers: [{ service_id: CIZI_SERVIS, phone_norm: "+420777123456", updated_at: "2026-09-09" }],
    });
    expect(await vyberServis(k, cisla, "+420777123456")).toBe(CIZI_SERVIS);
  });

  it("zakázka cizího servisu (mimo tohle číslo) se nesmí trefit", async () => {
    // Nejhorší možná chyba: zpráva zákazníka skončí v servisu, který o něm
    // nic neví, a lidé si vidí do zpráv navzájem.
    const TRETI = "33333333-3333-3333-3333-333333333333";
    const k = falesnyKlient({
      sms_conversations: [{ service_id: TRETI, customer_phone: "+420777123456", updated_at: "2026-09-09" }],
      tickets: [{ service_id: TRETI, customer_phone: "+420777123456", updated_at: "2026-09-09", deleted_at: null }],
      customers: [{ service_id: TRETI, phone_norm: "+420777123456", updated_at: "2026-09-09" }],
    });
    const vysledek = await vyberServis(k, cisla, "+420777123456");
    expect(vysledek).not.toBe(TRETI);
    expect([SERVIS, CIZI_SERVIS]).toContain(vysledek);
  });

  it("neznámé číslo spadne na primární servis, ne na chybu", async () => {
    const k = falesnyKlient({ sms_conversations: [], tickets: [], customers: [] });
    // Nikdo takový v žádném servisu není – zpráva se přesto musí někam uložit,
    // jinak by odpověď zákazníka zmizela beze stopy.
    expect(await vyberServis(k, cisla, "+420999999999")).toBe(CIZI_SERVIS);
  });

  it("bez primárního servisu se vezme první číslo, pořád ne chyba", async () => {
    const bezPrimarniho = cisla.map((c) => ({ ...c, is_pool_primary: false }));
    const k = falesnyKlient({ sms_conversations: [], tickets: [], customers: [] });
    expect(await vyberServis(k, bezPrimarniho, "+420999999999")).toBe(SERVIS);
  });

  it("prázdné tabulky nikde nespadnou", async () => {
    const k = falesnyKlient({});
    await expect(vyberServis(k, cisla, "+420777123456")).resolves.toBe(CIZI_SERVIS);
  });

  it("zákazník v kartotéce rozhodne, když zakázka žádná není", async () => {
    const k = falesnyKlient({
      sms_conversations: [],
      tickets: [],
      customers: [{ service_id: SERVIS, phone_norm: "+420777123456", updated_at: "2026-09-09" }],
    });
    expect(await vyberServis(k, cisla, "+420777123456")).toBe(SERVIS);
  });
});

// ---------------------------------------------------------------------------
// 5. Faktura e-mailem (zrcadlo invoice-send-email)
// ---------------------------------------------------------------------------

type UdalostFaktury = { type: string; payload: Record<string, unknown> };

type VysledekFaktury = { status: number; telo: Record<string, unknown> };

/**
 * Zrcadlo konce `invoice-send-email/index.ts`.
 *
 * Zajímavá je jedna věc: co se stane, když e-mail odejde a uložení stavu
 * selže. Vrátit chybu nejde – uživatel by poslal znovu a zákazník dostal
 * fakturu dvakrát. Zamlčet to taky ne – aplikace by fakturu dál ukazovala
 * jako neodeslanou a nikdo by nevěděl proč. Řeší se to varováním v odpovědi.
 */
async function posliFakturu(v: {
  posli: () => Promise<{ ok: boolean; status?: number; id?: string; chyba?: string }>;
  ulozStav: () => Promise<{ chyba: string | null }>;
  zapisUdalost: (u: UdalostFaktury) => Promise<void>;
}): Promise<VysledekFaktury & { stavUlozen: boolean; udalosti: UdalostFaktury[] }> {
  const udalosti: UdalostFaktury[] = [];
  const zapis = async (u: UdalostFaktury) => {
    udalosti.push(u);
    await v.zapisUdalost(u);
  };

  const odpoved = await v.posli();
  if (!odpoved.ok) {
    await zapis({ type: "email_failed", payload: { error: odpoved.chyba ?? `Resend ${odpoved.status}` } });
    return { status: 500, telo: { error: odpoved.chyba ?? "Email sending failed", email_sent: false }, stavUlozen: false, udalosti };
  }

  const { chyba: chybaStavu } = await v.ulozStav();
  await zapis({ type: "email_sent", payload: { message_id: odpoved.id ?? null } });
  return {
    status: 200,
    telo: {
      ok: true,
      email_sent: true,
      message_id: odpoved.id ?? null,
      ...(chybaStavu ? { varovani: "E-mail odešel, ale stav faktury se neuložil. Zkontrolujte ji." } : {}),
    },
    stavUlozen: !chybaStavu,
    udalosti,
  };
}

describe("faktura e-mailem", () => {
  const ok = async () => ({ ok: true, id: "msg_1" });
  const nic = async () => {};

  it("po odeslání se uloží stav faktury i záznam do invoice_events", async () => {
    let ulozeno = 0;
    const v = await posliFakturu({
      posli: ok,
      ulozStav: async () => {
        ulozeno += 1;
        return { chyba: null };
      },
      zapisUdalost: nic,
    });
    expect(v.status).toBe(200);
    expect(ulozeno).toBe(1);
    expect(v.udalosti.map((u) => u.type)).toEqual(["email_sent"]);
    expect(v.telo.varovani).toBeUndefined();
  });

  it("když se stav neuloží, uživatel to musí poznat", async () => {
    // Tohle se nedávno opravovalo: chyba zápisu mizela a faktura zůstávala
    // v seznamu jako neodeslaná, i když zákazník e-mail dostal.
    const v = await posliFakturu({ posli: ok, ulozStav: async () => ({ chyba: "PGRST116" }), zapisUdalost: nic });
    expect(v.status, "e-mail už odešel, chybu vracet nesmíme").toBe(200);
    expect(v.telo.ok).toBe(true);
    expect(String(v.telo.varovani)).toContain("stav faktury se neuložil");
  });

  it("chyba poskytovatele fakturu neoznačí jako odeslanou", async () => {
    let ulozeno = 0;
    const v = await posliFakturu({
      posli: async () => ({ ok: false, status: 422, chyba: "Resend 422: domain not verified" }),
      ulozStav: async () => {
        ulozeno += 1;
        return { chyba: null };
      },
      zapisUdalost: nic,
    });
    expect(v.status).toBe(500);
    expect(v.telo.email_sent).toBe(false);
    expect(ulozeno, "neodeslaná faktura nesmí dostat stav sent").toBe(0);
    expect(v.udalosti.map((u) => u.type)).toEqual(["email_failed"]);
  });

  it("neúspěch se taky zapíše do invoice_events – ať je v historii vidět pokus", async () => {
    const v = await posliFakturu({
      posli: async () => ({ ok: false, status: 500, chyba: "Resend 500: internal" }),
      ulozStav: async () => ({ chyba: null }),
      zapisUdalost: nic,
    });
    expect(v.udalosti[0].payload.error).toContain("Resend 500");
  });
});

describe("faktura e-mailem: escapování těla", () => {
  it("text od uživatele se do HTML dostane jako text, ne jako značky", () => {
    const nebezpecny = '<script>alert(1)</script> a "uvozovky" & ampersand';
    const vysledek = escapeHtml(nebezpecny);
    expect(vysledek).not.toContain("<script");
    expect(vysledek).toContain("&lt;script&gt;");
    expect(vysledek).toContain("&quot;");
    expect(vysledek).toContain("&amp;");
  });

  it("escapuje se i apostrof – kdo příště napíše title='…', nemá být překvapený", () => {
    expect(escapeHtml("O'Brien")).toBe("O&#39;Brien");
  });

  it("ampersand se escapuje první, ať nevznikne dvojité escapování", () => {
    expect(escapeHtml("&lt;")).toBe("&amp;lt;");
  });

  it("i číslo nebo null projde bez pádu", () => {
    expect(escapeHtml(1490)).toBe("1490");
    expect(escapeHtml(null)).toBe("null");
  });
});

// ---------------------------------------------------------------------------
// 6. Rezervace z webu: e-maily ze skutečných šablon
// ---------------------------------------------------------------------------

describe("rezervace z webu: e-maily se skládají z cizího textu", () => {
  const SERVIS_KONTAKT: KontaktServisu = {
    name: "Servis Novák",
    email: "servis@example.test",
    telefon: "+420777000111",
    adresa: "Dlouhá 1, 110 00 Praha",
  };

  const rezervace = (prepis: Partial<RezervaceMail> = {}): RezervaceMail => ({
    customer_name: "Jan Novák",
    customer_phone: "+420777123456",
    customer_email: "jan@example.test",
    device_label: "iPhone 12",
    repair_name: "Výměna displeje",
    model_name: null,
    price_estimate: 2490,
    preferred_at: null,
    note: null,
    ...prepis,
  });

  const UTOK = '<img src=x onerror="alert(1)">';

  it("jméno zákazníka se do e-mailu servisu vloží jako text", () => {
    // Formulář je veřejný: tohle jméno tam napíše kdokoli z internetu a čte
    // ho majitel servisu ve své poště.
    const html = mailServisuHtml(rezervace({ customer_name: UTOK }));
    expect(html).not.toContain("<img");
    expect(html).not.toContain("onerror=\"");
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
  });

  it("žádné z polí rezervace neprojde do e-mailu servisu neošetřené", () => {
    const html = mailServisuHtml(
      rezervace({
        customer_name: UTOK,
        customer_phone: UTOK,
        customer_email: UTOK,
        device_label: UTOK,
        model_name: UTOK,
        repair_name: UTOK,
        note: UTOK,
      }),
    );
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<script");
    // Sedmkrát v tabulce (jméno, telefon, e-mail, zařízení, model, oprava, poznámka);
    // model je uvnitř řádku „Zařízení“, takže osm výskytů.
    expect(html.split("&lt;img").length - 1).toBeGreaterThanOrEqual(7);
  });

  it("potvrzení zákazníkovi je escapované stejně", () => {
    const html = mailZakaznikoviHtml(SERVIS_KONTAKT, rezervace({ customer_name: UTOK, device_label: UTOK, repair_name: UTOK }));
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });

  it("ani název a kontakt servisu nejdou do e-mailu bez ošetření", () => {
    // Název i adresa jsou z nastavení servisu – taky uživatelská data.
    const html = mailZakaznikoviHtml(
      { name: UTOK, email: UTOK, telefon: UTOK, adresa: UTOK },
      rezervace(),
    );
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });

  it("uvozovka v poznámce nerozbije značku, i kdyby se text vložil do atributu", () => {
    const html = mailServisuHtml(rezervace({ note: '" onmouseover="alert(1)' }));
    expect(html).not.toContain('onmouseover="');
    expect(html).toContain("&quot;");
  });

  it("předmět e-mailu je jen text – v předmětu se HTML nevykresluje", () => {
    // Předmět se nevkládá do HTML, takže se schválně needituje: kdyby se
    // escapoval, viděl by servis v poště „&lt;img…“ místo jména.
    expect(predmetServisu(rezervace({ customer_name: UTOK }))).toContain(UTOK);
  });

  it("chybějící údaje se vypíšou pomlčkou, ne jako „null“", () => {
    const html = mailServisuHtml(rezervace({ customer_email: null, note: null, repair_name: null }));
    expect(html).not.toContain("null");
    expect(html).toContain("—");
  });

  it("obyčejná rezervace vypadá pořád normálně", () => {
    const html = mailServisuHtml(rezervace());
    expect(html).toContain("Jan Novák");
    expect(html).toContain("iPhone 12");
    expect(html).toContain("Výměna displeje");
    expect(html).not.toContain("&lt;");
  });
});

// ---------------------------------------------------------------------------
// 7. Pojistky přímo ve zdrojácích edge funkcí
// ---------------------------------------------------------------------------

/**
 * Referenční implementace nahoře jsou zrcadla – kdyby někdo přepsal index.ts,
 * testy o tom neví. Tyhle kontroly proto sahají rovnou do zdrojáku, a to jen
 * na místa, kde chyba stojí peníze nebo pověst. Je to ošklivé (stejná
 * obezlička jako v billingWebhook.test.ts), ale levnější než měsíc, kdy
 * automatizace posílají SMS mimo zaplacený balíček.
 */
describe("pojistky ve zdrojácích edge funkcí", () => {
  const SMS_SEND = "supabase/functions/sms-send/index.ts";
  const AUTOMATIZACE = "supabase/functions/automations-run/index.ts";
  const PROVISION = "supabase/functions/sms-provision/index.ts";
  const FAKTURA = "supabase/functions/invoice-send-email/index.ts";
  const REZERVACE = "supabase/functions/public-booking/index.ts";

  it("sms-send kontroluje balíček dřív, než zavolá Twilio", () => {
    const s = zdrojBezKomentaru(SMS_SEND);
    const kontrola = s.indexOf("await zkontrolujBalicek");
    const odeslani = s.indexOf("Messages.json");
    expect(kontrola, "chybí kontrola balíčku").toBeGreaterThan(-1);
    expect(odeslani).toBeGreaterThan(-1);
    expect(kontrola, "balíček se musí kontrolovat před odesláním").toBeLessThan(odeslani);
  });

  it("sms-send ověřuje nárok na modul dřív než balíček i odeslání", () => {
    const s = zdrojBezKomentaru(SMS_SEND);
    const narok = s.indexOf('p_module: "sms"');
    expect(narok).toBeGreaterThan(-1);
    expect(narok).toBeLessThan(s.indexOf("await zkontrolujBalicek"));
    expect(narok).toBeLessThan(s.indexOf("Messages.json"));
  });

  it("sms-send vrací při vyčerpaném balíčku 402, ne obecnou chybu", () => {
    // Podle 402 pozná aplikace, že má nabídnout vyšší tarif, a ne hlásit
    // „zkuste to znovu“ – po tom by uživatel klikal až do konce směny.
    expect(zdrojBezKomentaru(SMS_SEND)).toMatch(/quota_exceeded: true[\s\S]{0,200}status: 402/);
  });

  it("automatizace berou SMS ze stejného balíčku jako chat", () => {
    // Tudy jde většina zpráv (změna stavu → SMS zákazníkovi). Dokud tu
    // kontrola nebyla, byl zaplacený balíček jen číslo na obrazovce.
    const s = zdrojBezKomentaru(AUTOMATIZACE);
    const kontrola = s.indexOf("await zkontrolujBalicek");
    const odeslani = s.indexOf("Messages.json");
    expect(kontrola, "automations-run musí kontrolovat balíček").toBeGreaterThan(-1);
    expect(kontrola).toBeLessThan(odeslani);
  });

  it("automatizace posílají text upravený pro SMS, ne surovou šablonu", () => {
    // Bez tohohle letěla česká zpráva v UCS-2 po 70 znacích – dvakrát dražší
    // než tentýž text poslaný z chatu.
    const s = zdrojBezKomentaru(AUTOMATIZACE);
    expect(s).toMatch(/textProSms\(substituteTemplate\(/);
  });

  it("obě cesty počítají segmenty jedním kódem z _shared", () => {
    for (const cesta of [SMS_SEND, AUTOMATIZACE]) {
      const s = zdrojBezKomentaru(cesta);
      expect(s, `${cesta} musí brát počítání ze _shared/sms.ts`).toMatch(/from "\.\.\/_shared\/sms\.ts"/);
      expect(s, `${cesta} nesmí mít vlastní kopii počítadla`).not.toMatch(/function segmentu\s*\(/);
    }
  });

  it("sms-provision ověří práva i nárok dřív, než koupí číslo", () => {
    // Nákup čísla je jediné místo, kde aplikace utratí peníze sama od sebe.
    const s = zdrojBezKomentaru(PROVISION);
    const role = s.indexOf('membership.role !== "owner"');
    const narok = s.indexOf('p_module: "sms"');
    const nakup = s.indexOf("const buyUrl");
    expect(role).toBeGreaterThan(-1);
    expect(narok).toBeGreaterThan(-1);
    expect(nakup).toBeGreaterThan(-1);
    expect(role).toBeLessThan(nakup);
    expect(narok).toBeLessThan(nakup);
  });

  it("faktura se označí jako odeslaná až po úspěchu poskytovatele", () => {
    const s = zdrojBezKomentaru(FAKTURA);
    const uspech = s.indexOf("if (emailSent)");
    const stav = s.indexOf('status: "sent"');
    expect(uspech).toBeGreaterThan(-1);
    expect(stav).toBeGreaterThan(uspech);
  });

  it("neuložený stav faktury se vrátí jako varování, ne mlčky", () => {
    const s = zdrojBezKomentaru(FAKTURA);
    expect(s, "chyba zápisu stavu se musí zachytit").toMatch(/error: chybaStavu/);
    expect(s, "a doputovat k uživateli").toMatch(/varovani:/);
    expect(s, "chyba zápisu nesmí zapadnout do prázdné větve").not.toMatch(/if \(chybaStavu\)\s*\{?\s*\}/);
  });

  it("po odeslaném e-mailu se nesmí vrátit chyba – zákazník by dostal fakturu dvakrát", () => {
    const s = zdrojBezKomentaru(FAKTURA);
    const zacatek = s.indexOf("if (emailSent) {");
    const uspesnaVetev = s.slice(zacatek, s.indexOf('type: "email_failed"', zacatek));
    expect(uspesnaVetev).toMatch(/status: 200/);
    expect(uspesnaVetev, "úspěšná větev nesmí vracet 5xx").not.toMatch(/status: 5\d\d/);
  });

  it("neúspěšné odeslání faktury se zapíše do invoice_events", () => {
    expect(zdrojBezKomentaru(FAKTURA)).toMatch(/type: "email_failed"/);
  });

  it("rezervace se uloží dřív, než se posílají e-maily", () => {
    // Rezervaci si zákazník myslí, že má. Spadlý poskytovatel e-mailu ji
    // nesmí shodit – v Jobi musí být, i když oznámení nedorazí.
    const s = zdrojBezKomentaru(REZERVACE);
    const zapis = s.indexOf('.from("bookings").insert(');
    const maily = s.indexOf("Promise.all([oznamServisu(");
    expect(zapis).toBeGreaterThan(-1);
    expect(maily).toBeGreaterThan(-1);
    expect(zapis, "zápis rezervace musí být před e-maily").toBeLessThan(maily);
  });

  it("odeslání e-mailu o rezervaci nikdy nevyhodí výjimku ven", () => {
    // Bez try/catch by odmítnutý Resend probublal do `Promise.all` a
    // zákazník by na webu viděl chybu u rezervace, která je uložená.
    const s = zdroj(REZERVACE);
    for (const fn of ["async function oznamServisu", "async function potvrdZakaznikovi"]) {
      const telo = s.slice(s.indexOf(fn), s.indexOf("\n}", s.indexOf(fn)));
      expect(telo, `${fn} musí chytat chyby poskytovatele`).toMatch(/try \{[\s\S]*\} catch/);
    }
  });

  it("e-maily o rezervaci se skládají jen sdílenými šablonami", () => {
    const s = zdrojBezKomentaru(REZERVACE);
    expect(s).toMatch(/from "\.\.\/_shared\/bookingMail\.ts"/);
    expect(s, "žádná druhá kopie HTML e-mailu ve zdrojáku funkce").not.toMatch(/const html = `<div/);
  });

  it("nikde v e-mailových šablonách nezůstala vlastní kopie escapování", () => {
    // Dvě kopie znamenají, že se jedna opraví a druhá ne.
    for (const cesta of [REZERVACE, FAKTURA, AUTOMATIZACE]) {
      const s = zdrojBezKomentaru(cesta);
      expect(s, `${cesta} má vlastní escapování`).not.toMatch(/replace\(\/&\/g, "&amp;"\)/);
      expect(s).toMatch(/_shared\/(html|bookingMail)\.ts/);
    }
  });
});

// ---------------------------------------------------------------------------
// 8. Nárok na modul: prošlý nárok neplatí
// ---------------------------------------------------------------------------

/** Zrcadlo SQL funkce `has_entitlement(p_service_id, p_module)`. */
function maNarok(
  radky: Array<{ service_id: string; module: string; active: boolean; valid_until: string | null }>,
  serviceId: string,
  modul: string,
  ted = new Date(),
): boolean {
  return radky.some(
    (r) =>
      r.service_id === serviceId &&
      r.module === modul &&
      r.active &&
      (r.valid_until === null || new Date(r.valid_until) > ted),
  );
}

describe("nárok na modul SMS", () => {
  const TED = new Date("2026-09-15T12:00:00.000Z");
  const narok = (prepis: Partial<{ module: string; active: boolean; valid_until: string | null }> = {}) => [
    { service_id: SERVIS, module: "sms", active: true, valid_until: null, ...prepis },
  ];

  it("platný nárok bez omezení platí", () => {
    expect(maNarok(narok(), SERVIS, "sms", TED)).toBe(true);
  });

  it("nárok do budoucna (zkušební období) platí", () => {
    expect(maNarok(narok({ valid_until: "2026-10-01T00:00:00Z" }), SERVIS, "sms", TED)).toBe(true);
  });

  it("prošlý nárok neplatí – zkušební období skončilo, SMS taky", () => {
    expect(maNarok(narok({ valid_until: "2026-09-01T00:00:00Z" }), SERVIS, "sms", TED)).toBe(false);
  });

  it("vypnutý nárok neplatí, i když je platnost neomezená", () => {
    expect(maNarok(narok({ active: false }), SERVIS, "sms", TED)).toBe(false);
  });

  it("nárok na jiný modul SMS neodemkne", () => {
    expect(maNarok(narok({ module: "invoices" }), SERVIS, "sms", TED)).toBe(false);
  });

  it("nárok cizího servisu neodemkne nic", () => {
    expect(maNarok(narok(), CIZI_SERVIS, "sms", TED)).toBe(false);
  });

  it("SQL funkce has_entitlement hlídá active i valid_until", () => {
    // Zrcadlo výš je jen zrcadlo – tohle čte skutečnou definici z migrací.
    const migrace = readdirSync(join(KOREN, "supabase/migrations"))
      .filter((f) => f.endsWith(".sql"))
      .sort()
      .filter((f) => /FUNCTION public\.has_entitlement\(p_service_id/i.test(zdroj(join("supabase/migrations", f))));
    expect(migrace.length, "definice has_entitlement se v migracích nenašla").toBeGreaterThan(0);
    const posledni = zdroj(join("supabase/migrations", migrace[migrace.length - 1]));
    const telo = posledni.slice(posledni.indexOf("FUNCTION public.has_entitlement(p_service_id"));
    expect(telo).toMatch(/e\.active/);
    expect(telo).toMatch(/valid_until IS NULL OR e\.valid_until > now\(\)/i);
  });

  it("každá cesta, která něco posílá ven, se na nárok ptá serveru", () => {
    const cesty: Array<[string, string]> = [
      ["supabase/functions/sms-send/index.ts", "sms"],
      ["supabase/functions/automations-run/index.ts", "sms"],
      ["supabase/functions/sms-provision/index.ts", "sms"],
      ["supabase/functions/invoice-send-email/index.ts", "invoices"],
    ];
    for (const [cesta, modul] of cesty) {
      const s = zdrojBezKomentaru(cesta);
      expect(s, `${cesta} se neptá na nárok`).toMatch(new RegExp(`has_entitlement[\\s\\S]{0,200}p_module: "${modul}"`));
    }
  });
});

// ---------------------------------------------------------------------------
// 9. Klient: co aplikace udělá s odpovědí edge funkce
// ---------------------------------------------------------------------------

/**
 * Zrcadlo `sendPortalSms` z src/lib/portal.ts a zpracování odpovědi v
 * SmsChat.tsx: hláška o vyčerpaném balíčku se musí uživateli ukázat celá.
 * Kdyby se zahodila, viděl by jen „Chyba 402“ a nevěděl by, že si má
 * připlatit.
 */
describe("aplikace ukáže hlášku o vyčerpaném balíčku", () => {
  it("chybová hláška serveru se přenese do výjimky, ne obecné „nepodařilo se“", () => {
    const zdrojPortal = readFileSync(join(KOREN, "src/lib/portal.ts"), "utf8");
    const fn = zdrojPortal.slice(zdrojPortal.indexOf("export async function sendPortalSms"));
    expect(fn.slice(0, fn.indexOf("\n}"))).toMatch(/throw new Error\(data\.error \?\?/);
  });

  it("chat ukáže text ze serveru, ne jen stavový kód", () => {
    const chat = readFileSync(join(KOREN, "src/components/SmsChat.tsx"), "utf8");
    expect(chat).toMatch(/const msg = \(data\.detail \?\? data\.error \?\? raw\)/);
    // A rozepsaný text se vrátí do políčka, ať o něj uživatel nepřijde.
    expect(chat).toMatch(/setInput\(body\)/);
  });

  it("žádná cesta v aplikaci neposílá SMS mimo edge funkci", () => {
    // Twilio se nikdy nesmí volat z prohlížeče – byl by v něm token.
    const soubory = ["src/components/SmsChat.tsx", "src/lib/portal.ts", "src/pages/Orders/hooks/useAutomations.ts"];
    for (const cesta of soubory) {
      const s = readFileSync(join(KOREN, cesta), "utf8");
      expect(s, `${cesta} nesmí volat Twilio napřímo`).not.toContain("api.twilio.com");
    }
  });
});

// ---------------------------------------------------------------------------
// 10. Nic z tohohle souboru nesmí na síť
// ---------------------------------------------------------------------------

describe("testy samy neodešlou ani jednu zprávu", () => {
  it("v testech se nevolá fetch", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    await zkontrolujBalicek(falesnyKlient({}), SERVIS, 1);
    await vyberServis(falesnyKlient({}), [{ service_id: SERVIS }], "+420777123456");
    mailServisuHtml({
      customer_name: "Jan", customer_phone: "+420777123456", customer_email: null,
      device_label: "iPhone", repair_name: null, model_name: null,
      price_estimate: null, preferred_at: null, note: null,
    });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
