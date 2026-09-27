/**
 * Nastavení servisu (service_settings.config) do stavu stránky Zakázky:
 * první načtení, ruční událost jobsheet:ui-updated i realtime.
 * Vyneseno z Orders.tsx beze změny obsahu; názvy stavů zůstávají.
 */
import { useCallback, useEffect, useState } from "react";
import { supabase } from "../../../lib/supabaseClient";
import { subscribeServiceConfig } from "../../../lib/serviceSettingsSync";
import { VYCHOZI_ZAOKROUHLENI_PRACE, normalizujZaokrouhleni } from "../../../lib/usekyPrace";
import { type SablonaKontroly, normalizujSablony } from "../../../lib/kontrolniSeznamy";
import { type NahradniZarizeni, normalizujNahradni } from "../../../lib/zapujcka";
import { normalizujSlevy, type PrednastavenaSleva } from "../../../lib/prednastaveneSlevy";
import { normalizujOdmeny, type PravidloOdmeny } from "../../../lib/odmeny";
import { normalizujSkryteSekce, type SkrytelnaSekce } from "../../../lib/sekceDetailu";
import { normalizujNastaveniZasilek, type NastaveniZasilek } from "../../../lib/zasilky";

export function useNastaveniServisu(activeServiceId: string | null) {
  const [ordersShowClaimsInList, setOrdersShowClaimsInList] = useState(false);
  /** Hodinová sazba servisu (Kč/h) pro položku „Hodinová práce“; null = nenastavena. */
  const [hodinovaSazba, setHodinovaSazba] = useState<number | null>(null);
  /** Krok zaokrouhlení naměřeného času na hodinovou práci (service_settings.config.zaokrouhleni_prace). */
  const [zaokrouhleniPrace, setZaokrouhleniPrace] = useState<number>(VYCHOZI_ZAOKROUHLENI_PRACE);
  /** Šablony kontroly po opravě (service_settings.config.kontrolniSeznamy, jinak výchozí). */
  const [kontrolniSeznamy, setKontrolniSeznamy] = useState<SablonaKontroly[]>(() => normalizujSablony(undefined));
  /** Stálý seznam náhradních zařízení servisu (service_settings.config.nahradniZarizeni). */
  const [nahradniZarizeni, setNahradniZarizeni] = useState<NahradniZarizeni[]>([]);
  /** Stopky na zakázce – volitelné (service_settings.config.cas_na_oprave). */
  const [casNaOpraveZapnuto, setCasNaOpraveZapnuto] = useState(false);
  /** Přidělování technika (config.pridelovani_technika, výchozí zapnuto). Servis s jedním technikem si ho vypne. */
  const [pridelovaniTechnika, setPridelovaniTechnika] = useState(true);
  /** Přednastavené slevy (config.prednastavene_slevy) – tlačítka u ceny oprav v detailu. */
  const [prednastaveneSlevy, setPrednastaveneSlevy] = useState<PrednastavenaSleva[]>([]);
  /** Aktivní pravidla odměn (config.odmeny) – u opravy, na kterou sedí, se nabízí příznak „nabídnuto navíc“. */
  const [pravidlaOdmen, setPravidlaOdmen] = useState<PravidloOdmeny[]>([]);
  /** Sekce detailu, které si servis vypnul (config.skryte_sekce_detailu). */
  const [skryteSekce, setSkryteSekce] = useState<Set<SkrytelnaSekce>>(() => new Set());
  /** Modul Přesuny mezi pobočkami (config.zasilky): karta „Kde je zakázka“ a štítek místa v seznamu. */
  const [zasilkyZapnuty, setZasilkyZapnuty] = useState(false);
  const [nastaveniZasilek, setNastaveniZasilek] = useState<NastaveniZasilek>(() => normalizujNastaveniZasilek(undefined));
  /** Chat týmu (config.chat) – kvůli položce „Sdílet do chatu“ v detailu. */
  const [chatZapnuty, setChatZapnuty] = useState(true);
  /* Nastavení servisu do stavu stránky. Jedno místo pro první načtení,
     ruční událost i realtime – dřív to byly dvě skoro stejné kopie a na
     realtime se zapomnělo. Kvůli tomu se nově přidané náhradní zařízení
     v otevřené aplikaci v detailu zakázky vůbec neobjevilo: stránka
     Zakázky zůstává připojená a config si nikdy znovu nenačetla. */
  const pouzijConfigServisu = useCallback((config: any) => {
    setOrdersShowClaimsInList(!!config?.orders_show_claims_in_list);
    setHodinovaSazba(typeof config?.hodinova_sazba === "number" ? config.hodinova_sazba : null);
    setZaokrouhleniPrace(normalizujZaokrouhleni(config?.zaokrouhleni_prace));
    setKontrolniSeznamy(normalizujSablony(config?.kontrolniSeznamy));
    setNahradniZarizeni(normalizujNahradni(config?.nahradniZarizeni));
    setCasNaOpraveZapnuto(config?.cas_na_oprave === true);
    setPridelovaniTechnika(config?.pridelovani_technika !== false);
    setChatZapnuty(config?.chat !== false);
    setPrednastaveneSlevy(normalizujSlevy(config?.prednastavene_slevy));
    setPravidlaOdmen(normalizujOdmeny(config?.odmeny).pravidla.filter((p) => p.aktivni));
    setSkryteSekce(normalizujSkryteSekce(config?.skryte_sekce_detailu));
    setZasilkyZapnuty(config?.zasilky === true);
    setNastaveniZasilek(normalizujNastaveniZasilek(config ?? undefined));
  }, []);

  const nactiConfigServisu = useCallback(() => {
    if (!activeServiceId || !supabase) return;
    (supabase.from("service_settings") as any)
      .select("config")
      .eq("service_id", activeServiceId)
      .maybeSingle()
      .then(({ data }: any) => pouzijConfigServisu(data?.config))
      .catch(() => {});
  }, [activeServiceId, pouzijConfigServisu]);

  useEffect(() => {
    if (!activeServiceId || !supabase) {
      setOrdersShowClaimsInList(false);
      return;
    }
    nactiConfigServisu();
  }, [activeServiceId, nactiConfigServisu]);

  useEffect(() => {
    window.addEventListener("jobsheet:ui-updated" as any, nactiConfigServisu);
    return () => window.removeEventListener("jobsheet:ui-updated" as any, nactiConfigServisu);
  }, [nactiConfigServisu]);

  // Změna nastavení odjinud (jiný počítač, druhá záložka, kolega) se projeví hned.
  useEffect(() => {
    if (!activeServiceId) return;
    return subscribeServiceConfig(activeServiceId, (config) => pouzijConfigServisu(config), "orders");
  }, [activeServiceId, pouzijConfigServisu]);

  return {
    ordersShowClaimsInList,
    hodinovaSazba,
    zaokrouhleniPrace,
    kontrolniSeznamy,
    nahradniZarizeni,
    casNaOpraveZapnuto,
    pridelovaniTechnika,
    prednastaveneSlevy,
    pravidlaOdmen,
    skryteSekce,
    zasilkyZapnuty,
    nastaveniZasilek,
    chatZapnuty,
  };
}
