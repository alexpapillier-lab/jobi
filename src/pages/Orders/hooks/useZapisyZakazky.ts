/**
 * Okamžité zápisy z detailu zakázky do databáze: provedené opravy (hned nebo
 * s odkladem), schválená nabídka, náhradní zařízení, technik, Find My,
 * kontrola po opravě a diagnostika napojené zakázky. Při trvalé chybě zpět,
 * při výpadku do fronty (lib/frontaZapisu) – nic z toho se nesmí ztratit.
 *
 * Vyneseno z Orders.tsx beze změny obsahu včetně závislostí callbacků.
 * Evidence zápisů (refs) přichází z useEvidenceZapisu, protože ji čte i
 * realtime a dotažení zakázky, které běží dřív.
 */
import { useCallback, useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { supabase } from "../../../lib/supabaseClient";
import { devLog } from "../../../lib/devLog";
import { showToast } from "../../../components/Toast";
import { ulozNaPozdeji, jeTrvalaChyba } from "../../../lib/frontaZapisu";
import { zacniZapis, ukonciZapis } from "../../../lib/slouceniZakazky";
import { vychoziNabidnuto, type PravidloOdmeny } from "../../../lib/odmeny";
import { releaseReservations, type reserveForRepair, type ReserveShortage } from "../../../lib/purchaseOrders";
import type { DevicesData } from "../../../lib/catalogStorage";
import type { PerformedRepair } from "../../../components/orders/types";
import type { KontrolaPoOpraveData } from "../../../lib/kontrolniSeznamy";
import type { ZapujckaData } from "../../../lib/zapujcka";
import type { DirtyFlags, TicketEx } from "../typy";
import type { useEvidenceZapisu } from "./useEvidenceZapisu";

type Evidence = ReturnType<typeof useEvidenceZapisu>;

type Vstup = {
  activeServiceId: string | null;
  activeServiceIdRef: MutableRefObject<string | null>;
  cloudTicketsRef: MutableRefObject<TicketEx[]>;
  setCloudTickets: Dispatch<SetStateAction<TicketEx[]>>;
  setDirtyFlags: Dispatch<SetStateAction<DirtyFlags>>;
  devicesData: DevicesData;
  reserveEntryProducts: (ticketId: string, entryId: string, productIds: string[] | undefined) => Promise<Awaited<ReturnType<typeof reserveForRepair>> | null>;
  toastReserveShortages: (shortages: ReserveShortage[]) => void;
  refreshTicketReservations: (ticketId: string) => Promise<void>;
  /** Přihlášený uživatel (odměny týmu: kdo opravu nabídl). */
  mojeId: string | null;
  pravidlaOdmen: PravidloOdmeny[];
  rozpracovaneZapisyOpravRef: Evidence["rozpracovaneZapisyOpravRef"];
  odlozeneZapisyOpravRef: Evidence["odlozeneZapisyOpravRef"];
  neulozeneOpravyRef: Evidence["neulozeneOpravyRef"];
  odlozenaKontrolaRef: Evidence["odlozenaKontrolaRef"];
  odlozenaDiagnostikaRef: Evidence["odlozenaDiagnostikaRef"];
};

export function useZapisyZakazky({
  activeServiceId,
  activeServiceIdRef,
  cloudTicketsRef,
  setCloudTickets,
  setDirtyFlags,
  devicesData,
  reserveEntryProducts,
  toastReserveShortages,
  refreshTicketReservations,
  mojeId,
  pravidlaOdmen,
  rozpracovaneZapisyOpravRef,
  odlozeneZapisyOpravRef,
  neulozeneOpravyRef,
  odlozenaKontrolaRef,
  odlozenaDiagnostikaRef,
}: Vstup) {
  /**
   * Zákazník schválil nabídku – její položky se stanou provedenými opravami.
   * Nahrazují se, ne přidávají: schválený rozpis je to, na čem se obě strany
   * dohodly, a dvojitý zápis by se objevil na faktuře.
   *
   * Zapisuje se rovnou do databáze, ne přes běžné automatické ukládání, které
   * čeká na zavření detailu. Uživatel klikl na jednu akci a dostal hlášku, že
   * je hotovo – to musí platit i když hned zavře okno.
   */
  const applyQuoteRepairs = useCallback(
    async (ticketId: string, repairsVstup: PerformedRepair[]) => {
      // Schválená položka z cenové nabídky = nabídnuto a přijato; příznak se
      // doplní jen tam, kde chybí a kde sedí pravidlo odměn.
      const pozadovana = cloudTicketsRef.current.find((t) => t.id === ticketId)?.requestedRepair;
      // Čas přidání (odměny „po přidání opravy“) jen tam, kde chybí – položka,
      // která na zakázce už byla, si svůj původní čas nechá.
      const ted = new Date().toISOString();
      const repairs = repairsVstup.map((vstup) => {
        const r = vstup.pridanoAt ? vstup : { ...vstup, pridanoAt: ted };
        if (r.nabidnuto !== undefined) return r;
        const n = vychoziNabidnuto(r.name, pozadovana, pravidlaOdmen);
        return n === undefined ? r : { ...r, nabidnuto: n };
      });
      setCloudTickets((prev) =>
        prev.map((t) => (t.id === ticketId ? { ...t, performedRepairs: repairs } : t))
      );
      if (!supabase) {
        setDirtyFlags((prev) => ({ ...prev, performedRepairs: true }));
        return;
      }
      // Stejná evidence jako u ostatních zápisů oprav: dokud zápis běží (a po
      // chybě až do zavření detailu), realtime nesmí opravy přepsat.
      zacniZapis(rozpracovaneZapisyOpravRef.current, ticketId);
      try {
        const { error } = await (supabase.from("tickets") as any)
          .update({ performed_repairs: repairs })
          .eq("id", ticketId);
        if (error) {
          // Zůstane rozpracované – uloží se při zavření detailu jako každá jiná změna.
          setDirtyFlags((prev) => ({ ...prev, performedRepairs: true }));
          neulozeneOpravyRef.current.add(ticketId);
          throw error;
        }
        neulozeneOpravyRef.current.delete(ticketId);
      } finally {
        ukonciZapis(rozpracovaneZapisyOpravRef.current, ticketId);
      }
    },
    []
  );
  /**
   * Zápis provedených oprav do databáze.
   *
   * Dřív se opravy ukládaly až při zavření detailu, ale rezervace dílů ve
   * skladu vznikaly okamžitě. Když mezitím někdo změnil stav zakázky,
   * realtime přepsal rozepsané opravy verzí z databáze: rezervace zůstaly
   * bez opravy a při Dokončeno se odečetl díl za opravu, kterou zakázka
   * neměla. Teď jde přidání a odebrání do databáze hned; úpravy ceny,
   * nákladů a času (několik volání z jednoho tlačítka Uložit) s krátkým
   * odkladem, aby se poslal jeden zápis. Při chybě zůstane příznak
   * rozpracovanosti a opravy se uloží při zavření detailu jako dřív.
   */
  /**
   * Označí zakázce běžící okamžitý zápis (opravy, kontrola, zápůjčka), aby
   * realtime ozvěna staršího zápisu nepřepsala místní stav – viz upsert výše.
   */
  /** Číslo zakázky do výpisu neuložených změn; když ho neznáme, aspoň zákazník. */
  const popisZakazky = useCallback((ticketId: string): string => {
    const t = cloudTicketsRef.current.find((x) => x.id === ticketId);
    return t?.code || t?.customerName || "zakázka";
  }, []);

  const sOkamzitymZapisem = useCallback(async <T,>(ticketId: string, zapis: () => Promise<T>): Promise<T> => {
    zacniZapis(rozpracovaneZapisyOpravRef.current, ticketId);
    try {
      return await zapis();
    } finally {
      ukonciZapis(rozpracovaneZapisyOpravRef.current, ticketId);
    }
  }, []);

  const zapisProvedeneOpravy = useCallback((ticketId: string, repairs: PerformedRepair[], hned: boolean) => {
    if (!supabase) {
      setDirtyFlags((prev) => ({ ...prev, performedRepairs: true }));
      return;
    }
    const odlozene = odlozeneZapisyOpravRef.current;
    const cekajici = odlozene.get(ticketId);
    if (cekajici) {
      clearTimeout(cekajici.casovac);
      odlozene.delete(ticketId);
    }
    const proved = () => {
      odlozene.delete(ticketId);
      zacniZapis(rozpracovaneZapisyOpravRef.current, ticketId);
      void (async () => {
        try {
          const { error } = await (supabase!.from("tickets") as any)
            .update({ performed_repairs: repairs })
            .eq("id", ticketId);
          if (error) throw error;
          // Databáze má nejnovější opravy – realtime už je smí přepisovat.
          neulozeneOpravyRef.current.delete(ticketId);
        } catch (err) {
          devLog("[opravy] zápis selhal, uloží se při zavření detailu", err);
          setDirtyFlags((prev) => ({ ...prev, performedRepairs: true }));
          // Opravy jsou teď jen v paměti; realtime je nesmí přepsat, dokud
          // se neuloží při zavření detailu (jinak zůstane rezervace bez opravy).
          neulozeneOpravyRef.current.add(ticketId);
          /* Druhá pojistka: zavření detailu zkusí zápis znovu, ale když je
             síť pryč i potom, opravy by se ztratily. Fronta je dopíše sama,
             až spojení naskočí – přežije i zavření aplikace. */
          if (!jeTrvalaChyba(err)) {
            ulozNaPozdeji({
              klic: `tickets:${ticketId}:performed_repairs`,
              tabulka: "tickets",
              id: ticketId,
              data: { performed_repairs: repairs },
              popis: `Provedené opravy · ${popisZakazky(ticketId)}`,
              serviceId: activeServiceIdRef.current,
              chyba: err,
            });
          }
        } finally {
          ukonciZapis(rozpracovaneZapisyOpravRef.current, ticketId);
        }
      })();
    };
    if (hned) proved();
    else odlozene.set(ticketId, { casovac: setTimeout(proved, 400), proved });
  }, []);

  /** Odložené zápisy oprav pošle hned – před zavřením detailu a při odchodu ze stránky. */
  const dokoncitOdlozeneZapisyOprav = useCallback(() => {
    for (const { casovac, proved } of odlozeneZapisyOpravRef.current.values()) {
      clearTimeout(casovac);
      proved();
    }
    for (const { casovac, proved } of odlozenaKontrolaRef.current.values()) {
      clearTimeout(casovac);
      proved();
    }
    for (const { casovac, proved } of odlozenaDiagnostikaRef.current.values()) {
      clearTimeout(casovac);
      proved();
    }
  }, []);

  useEffect(() => {
    // `pagehide` chytí i Safari, kde se `beforeunload` někdy nespustí, a
    // odmontování stránky Zakázky, kde by odložený zápis jinak visel.
    window.addEventListener("beforeunload", dokoncitOdlozeneZapisyOprav);
    window.addEventListener("pagehide", dokoncitOdlozeneZapisyOprav);
    return () => {
      window.removeEventListener("beforeunload", dokoncitOdlozeneZapisyOprav);
      window.removeEventListener("pagehide", dokoncitOdlozeneZapisyOprav);
      dokoncitOdlozeneZapisyOprav();
    };
  }, [dokoncitOdlozeneZapisyOprav]);

  /** Upraví provedené opravy zakázky v místním stavu i v databázi. */
  const upravProvedeneOpravy = useCallback(
    (ticketId: string, uprava: (repairs: PerformedRepair[]) => PerformedRepair[], hned: boolean) => {
      const ticket = cloudTicketsRef.current.find((t) => t.id === ticketId);
      if (!ticket) return;
      const next = uprava(ticket.performedRepairs ?? []);
      // Do ref hned, aby další volání ve stejném kliknutí stavělo na tomhle výsledku.
      cloudTicketsRef.current = cloudTicketsRef.current.map((t) => (t.id === ticketId ? { ...t, performedRepairs: next } : t));
      setCloudTickets((prev) => prev.map((t) => (t.id === ticketId ? { ...t, performedRepairs: next } : t)));
      zapisProvedeneOpravy(ticketId, next, hned);
    },
    [zapisProvedeneOpravy]
  );

  const addPerformedRepair = useCallback(
    (ticketId: string, repair: { name: string; type: "selected" | "manual" | "hourly"; repairId?: string; price?: number; costs?: number; estimatedTime?: number; productIds?: string[]; hodiny?: number; sazba?: number; technik?: string; technikUserId?: string; zMereni?: boolean }) => {
      // Ruční oprava si cenu, náklady, čas a díly nese sama; oprava z ceníku je má v ceníku.
      let repairPrice: number | undefined = repair.price;
      let repairCosts: number | undefined = repair.costs;
      let repairTime: number | undefined = repair.estimatedTime;
      let repairProductIds: string[] | undefined = repair.productIds;
      if (repair.repairId) {
        const repairData = devicesData.repairs.find((r) => r.id === repair.repairId);
        if (repairData) {
          repairPrice = repairData.price;
          repairCosts = repairData.costs;
          repairTime = repairData.estimatedTime;
          repairProductIds = repairData.productIds;
        }
      }

      const entryId = `${Date.now()}_${Math.random()}`;

      // Díly se rezervují ve skladu (DB); ze skladu se odečtou až v koncovém stavu zakázky.
      if (repairProductIds && repairProductIds.length > 0) {
        void reserveEntryProducts(ticketId, entryId, repairProductIds).then((res) => {
          if (res) toastReserveShortages(res.shortages);
        });
      }

      // Hodinová práce: cena a čas se počítají z hodin a sazby.
      if (repair.type === "hourly") {
        const hodiny = repair.hodiny ?? 0;
        const sazba = repair.sazba ?? 0;
        repairPrice = Math.round(hodiny * sazba * 100) / 100;
        repairTime = Math.round(hodiny * 60);
      }

      const newRepair: PerformedRepair = {
        id: entryId,
        name: repair.name,
        type: repair.type,
        repairId: repair.repairId,
        price: repairPrice,
        costs: repairCosts,
        estimatedTime: repairTime,
        productIds: repairProductIds,
        // Odměny týmu (lib/odmeny): kdo opravu na zakázku přidal – nabídl ji zákazníkovi.
        ...(mojeId ? { pridalUserId: mojeId } : {}),
        // …kdy (odměny v režimu „po přidání opravy“ – měsíc přidání)…
        pridanoAt: new Date().toISOString(),
        // …a jestli ji nabídl navíc (není v požadované opravě z příjmu). Kdo přidává, může to v řádku otočit.
        ...(() => {
          const n = vychoziNabidnuto(repair.name, cloudTicketsRef.current.find((t) => t.id === ticketId)?.requestedRepair, pravidlaOdmen);
          return n === undefined ? {} : { nabidnuto: n };
        })(),
        ...(repair.type === "hourly" ? { hodiny: repair.hodiny, sazba: repair.sazba, technik: repair.technik, technikUserId: repair.technikUserId, ...(repair.zMereni ? { zMereni: true } : {}) } : {}),
      };
      upravProvedeneOpravy(ticketId, (repairs) => [...repairs, newRepair], true);
    },
    [devicesData, reserveEntryProducts, toastReserveShortages, upravProvedeneOpravy, mojeId, pravidlaOdmen]
  );

  const updatePerformedRepairPrice = useCallback((ticketId: string, repairId: string, price: number) => {
    upravProvedeneOpravy(ticketId, (repairs) => repairs.map((r) => (r.id === repairId ? { ...r, price } : r)), false);
  }, [upravProvedeneOpravy]);

  const updatePerformedRepairCosts = useCallback((ticketId: string, repairId: string, costs: number) => {
    upravProvedeneOpravy(ticketId, (repairs) => repairs.map((r) => (r.id === repairId ? { ...r, costs } : r)), false);
  }, [upravProvedeneOpravy]);

  const updatePerformedRepairTime = useCallback((ticketId: string, repairId: string, estimatedTime: number) => {
    upravProvedeneOpravy(ticketId, (repairs) => repairs.map((r) => (r.id === repairId ? { ...r, estimatedTime } : r)), false);
  }, [upravProvedeneOpravy]);

  const updatePerformedRepairProducts = useCallback((ticketId: string, repairId: string, productIds: string[]) => {
    upravProvedeneOpravy(ticketId, (repairs) => repairs.map((r) => (r.id === repairId ? { ...r, productIds } : r)), false);
  }, [upravProvedeneOpravy]);

  /** Náhradní zařízení se ukládá hned – smlouva se tiskne vzápětí a data musí být v DB. */
  const ulozZapujcku = useCallback(async (ticketId: string, zapujcka: ZapujckaData | null) => {
    const puvodni = cloudTicketsRef.current.find((t) => t.id === ticketId)?.loaner;
    setCloudTickets((prev) => prev.map((t) => (t.id === ticketId ? { ...t, loaner: zapujcka ?? undefined } : t)));
    if (!supabase) return;
    const { error } = await sOkamzitymZapisem<{ error: unknown }>(ticketId, () => (supabase!.from("tickets") as any).update({ loaner: zapujcka }).eq("id", ticketId));
    if (error) {
      devLog("[zapujcka] zápis selhal", error);
      if (jeTrvalaChyba(error)) {
        // Opakování by nepomohlo (chybí právo, zakázka zmizela). Zpět na stav
        // z databáze – jinak by karta ukazovala něco, co po obnovení zmizí.
        setCloudTickets((prev) => prev.map((t) => (t.id === ticketId ? { ...t, loaner: puvodni } : t)));
        showToast("Půjčení zařízení se nepodařilo uložit", "error");
        return;
      }
      // Výpadek spojení: zadané údaje si necháme a frontu je dopíše sama.
      ulozNaPozdeji({
        klic: `tickets:${ticketId}:loaner`,
        tabulka: "tickets",
        id: ticketId,
        data: { loaner: zapujcka },
        popis: `Půjčení zařízení · ${popisZakazky(ticketId)}`,
        serviceId: activeServiceIdRef.current,
        chyba: error,
      });
      showToast("Spojení vypadlo – půjčení se uloží samo, jakmile bude připojení. Neztratí se.", "info");
    }
  }, []);

  /**
   * Kontrola po opravě se ukládá s krátkým odkladem.
   *
   * Bez něj šel do databáze zápis na každou klávesu v poznámce. Dvacet
   * požadavků na stejný řádek nemá zaručené pořadí, takže při pomalejší síti
   * mohl doběhnout jako poslední ten s kratším textem – a poznámka se
   * ořízla nebo zmizela. Odklad pošle jen poslední stav; před zavřením
   * detailu a při odchodu ze stránky se dopíše okamžitě.
   */
  /** Přidělený technik – hned do databáze, bez spojení do fronty. */
  const ulozTechnika = useCallback(async (ticketId: string, userId: string | null) => {
    const puvodni = cloudTicketsRef.current.find((t) => t.id === ticketId)?.assignedTo ?? null;
    setCloudTickets((prev) => prev.map((t) => (t.id === ticketId ? { ...t, assignedTo: userId } : t)));
    if (!supabase) return;
    const { error } = await sOkamzitymZapisem<{ error: unknown }>(ticketId, () => (supabase!.from("tickets") as any).update({ assigned_to: userId }).eq("id", ticketId));
    if (!error) return;
    devLog("[technik] zápis selhal", error);
    if (jeTrvalaChyba(error)) {
      setCloudTickets((prev) => prev.map((t) => (t.id === ticketId ? { ...t, assignedTo: puvodni } : t)));
      showToast("Technika se nepodařilo uložit", "error");
      return;
    }
    ulozNaPozdeji({
      klic: `tickets:${ticketId}:assigned_to`,
      tabulka: "tickets",
      id: ticketId,
      data: { assigned_to: userId },
      popis: "Zakázka · technik",
      serviceId: activeServiceId,
      chyba: error,
    });
    showToast("Spojení vypadlo – technik se uloží, jakmile bude připojení.", "info");
  }, [activeServiceId, sOkamzitymZapisem]);

  /**
   * Štítek Find My v detailu – přepíná se jedním klikem, hned do databáze.
   * Stejný postup jako u technika: optimisticky do paměti, při trvalé chybě
   * zpět, při výpadku do fronty.
   */
  const ulozFindMy = useCallback(async (ticketId: string, vypnuto: boolean) => {
    const puvodni = cloudTicketsRef.current.find((t) => t.id === ticketId)?.findMyOff ?? null;
    setCloudTickets((prev) => prev.map((t) => (t.id === ticketId ? { ...t, findMyOff: vypnuto } : t)));
    if (!supabase) return;
    const { error } = await sOkamzitymZapisem<{ error: unknown }>(ticketId, () => (supabase!.from("tickets") as any).update({ find_my_off: vypnuto }).eq("id", ticketId));
    if (!error) return;
    devLog("[find my] zápis selhal", error);
    if (jeTrvalaChyba(error)) {
      setCloudTickets((prev) => prev.map((t) => (t.id === ticketId ? { ...t, findMyOff: puvodni } : t)));
      showToast("Stav Find My se nepodařilo uložit", "error");
      return;
    }
    ulozNaPozdeji({
      klic: `tickets:${ticketId}:find_my_off`,
      tabulka: "tickets",
      id: ticketId,
      data: { find_my_off: vypnuto },
      popis: "Zakázka · Find My",
      serviceId: activeServiceId,
      chyba: error,
    });
    showToast("Spojení vypadlo – stav Find My se uloží, jakmile bude připojení.", "info");
  }, [activeServiceId, sOkamzitymZapisem]);

  const ulozKontrolu = useCallback(async (ticketId: string, kontrola: KontrolaPoOpraveData | null) => {
    const puvodni = cloudTicketsRef.current.find((t) => t.id === ticketId)?.testChecklist;
    setCloudTickets((prev) => prev.map((t) => (t.id === ticketId ? { ...t, testChecklist: kontrola ?? undefined } : t)));
    if (!supabase) return;
    const odlozene = odlozenaKontrolaRef.current;
    const cekajici = odlozene.get(ticketId);
    if (cekajici) clearTimeout(cekajici.casovac);
    const proved = () => {
      odlozene.delete(ticketId);
      void zapisKontrolu(ticketId, kontrola, puvodni);
    };
    odlozene.set(ticketId, { casovac: setTimeout(proved, 450), proved });
  }, []);

  const zapisKontrolu = useCallback(async (ticketId: string, kontrola: KontrolaPoOpraveData | null, puvodni: KontrolaPoOpraveData | undefined) => {
    if (!supabase) return;
    const { error } = await sOkamzitymZapisem<{ error: unknown }>(ticketId, () => (supabase!.from("tickets") as any).update({ test_checklist: kontrola }).eq("id", ticketId));
    if (error) {
      devLog("[kontrola] zápis selhal", error);
      if (jeTrvalaChyba(error)) {
        setCloudTickets((prev) => prev.map((t) => (t.id === ticketId ? { ...t, testChecklist: puvodni } : t)));
        showToast("Kontrolu se nepodařilo uložit", "error");
        return;
      }
      ulozNaPozdeji({
        klic: `tickets:${ticketId}:test_checklist`,
        tabulka: "tickets",
        id: ticketId,
        data: { test_checklist: kontrola },
        popis: `Kontrola po opravě · ${popisZakazky(ticketId)}`,
        serviceId: activeServiceIdRef.current,
        chyba: error,
      });
      showToast("Spojení vypadlo – kontrola se uloží sama, jakmile bude připojení. Neztratí se.", "info");
    }
  }, []);
  /**
   * Zápis diagnostiky zakázky mimo její vlastní detail – typicky z reklamace,
   * kde se ukazují údaje napojené zakázky.
   *
   * Dřív se změna zapsala jen do stavu v prohlížeči a u karty stálo „pro
   * uložení otevřete zakázku a klikněte na Uložit“. Kdo si toho nevšiml,
   * přišel o napsaný protokol i o nahrané fotky – ty zůstaly v úložišti,
   * ale zakázka o nich nevěděla. Text se posílá s krátkým odkladem (píše se
   * po písmenech), fotky hned.
   */
  const ulozDiagnostikuZakazky = useCallback((ticketId: string, patch: { diagnostic_text?: string; diagnostic_photos?: string[]; diagnostic_photos_before?: string[] }, hned: boolean) => {
    if (!supabase) return;
    const odlozene = odlozenaDiagnostikaRef.current;
    const cekajici = odlozene.get(ticketId);
    /* Čekající zápis se s novým sloučí, nezahodí. Patche jsou různé sloupce
       (text vs. fotky), takže zrušením čekajícího by se ztratilo posledních
       pár set milisekund psaní – a v okně by text zůstal, takže by si toho
       nikdo nevšiml až do přenačtení. */
    const spojeny = cekajici ? { ...cekajici.patch, ...patch } : patch;
    if (cekajici) clearTimeout(cekajici.casovac);
    const proved = () => {
      odlozene.delete(ticketId);
      void (async () => {
        const { error } = await sOkamzitymZapisem<{ error: unknown }>(ticketId, () =>
          (supabase!.from("tickets") as any).update(spojeny).eq("id", ticketId));
        if (!error) return;
        devLog("[diagnostika] zápis selhal", error);
        if (jeTrvalaChyba(error)) {
          showToast("Diagnostiku se nepodařilo uložit", "error");
          return;
        }
        ulozNaPozdeji({
          klic: `tickets:${ticketId}:diagnostika`,
          tabulka: "tickets",
          id: ticketId,
          data: spojeny,
          popis: `Diagnostika · ${popisZakazky(ticketId)}`,
          serviceId: activeServiceIdRef.current,
          chyba: error,
        });
      })();
    };
    if (hned) proved();
    else odlozene.set(ticketId, { casovac: setTimeout(proved, 600), proved, patch: spojeny });
  }, [popisZakazky, sOkamzitymZapisem]);

  const updatePerformedRepairFields = useCallback((ticketId: string, repairId: string, fields: Partial<PerformedRepair>) => {
    upravProvedeneOpravy(ticketId, (repairs) => repairs.map((r) => (r.id === repairId ? { ...r, ...fields } : r)), false);
  }, [upravProvedeneOpravy]);

  const removePerformedRepair = useCallback((ticketId: string, repairId: string) => {
    upravProvedeneOpravy(ticketId, (repairs) => repairs.filter((r) => r.id !== repairId), true);
    // Odebraná oprava už díly nedrží – rezervace se uvolní (tiché, když RPC chybí).
    void releaseReservations(ticketId, repairId).then((released) => {
      if (released) void refreshTicketReservations(ticketId);
    });
  }, [refreshTicketReservations, upravProvedeneOpravy]);

  return {
    applyQuoteRepairs,
    popisZakazky,
    dokoncitOdlozeneZapisyOprav,
    addPerformedRepair,
    updatePerformedRepairPrice,
    updatePerformedRepairCosts,
    updatePerformedRepairTime,
    updatePerformedRepairProducts,
    updatePerformedRepairFields,
    removePerformedRepair,
    ulozZapujcku,
    ulozTechnika,
    ulozFindMy,
    ulozKontrolu,
    ulozDiagnostikuZakazky,
  };
}
