/**
 * Podepsané odkazy na fotky pro vykreslení v aplikaci.
 *
 * Fotky zařízení a podpisy zákazníků leží v bucketu, ke kterému se nedostane
 * nikdo bez oprávnění (viz `lib/podepsaneFotky.ts`). Do `<img src>` proto
 * nesmí jít URL uložená v databázi, ale odkaz podepsaný přihlášeným
 * uživatelem – ten platí hodinu a pak přestane fungovat.
 *
 * Hook proto odkazy nejen podepíše, ale i obnovuje. Bez obnovování by
 * v otevřeném detailu zakázky (a to je okno, které technik nechává otevřené
 * celý den) přestaly fotky po hodině jít otevřít v lightboxu.
 *
 * Dokud se podpisy nenačtou, vrací se původní odkazy – aby se náhled
 * nerozblikal a aby při výpadku podepisování zůstalo chování jako dřív.
 */

import { useEffect, useMemo, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cestaFotky, podepsFotky, podepsanaZCache, PLATNOST_SEKUND } from "../lib/podepsaneFotky";

/** Obnovovat v polovině platnosti – vejde se to i do uspaného notebooku. */
const OBNOVA_MS = (PLATNOST_SEKUND * 1000) / 2;

/**
 * Za jak dlouho zkusit znovu, když se podepsat nepovedlo.
 *
 * Bez tohohle by jediný neúspěch (chvilkový výpadek sítě, právě probíhající
 * obnova přihlášení) nechal fotku nepodepsanou až do další pravidelné obnovy,
 * tedy půl hodiny. Po přepnutí bucketu by to bylo půl hodiny prázdného místa
 * v detailu zakázky.
 */
const OPAKOVANI_MS = [1500, 4000, 10_000];

/** Zůstala nějaká fotka z našeho úložiště nepodepsaná? */
function neceoZbyva(puvodni: readonly string[], nove: readonly string[]): boolean {
  return puvodni.some((u, i) => cestaFotky(u) != null && nove[i] === u);
}

export function usePodepsaneFotky(supabase: SupabaseClient | null, urls: readonly string[] | undefined | null): string[] {
  // Pole se v Orders.tsx skládá při každém vykreslení znovu (`x || []`), takže
  // závislostí nesmí být jeho identita, ale obsah – jinak by se podepisovalo
  // pořád dokola.
  const klic = (urls ?? []).join("\n");
  const puvodni = useMemo(() => (klic ? klic.split("\n") : []), [klic]);

  /* Co je už podepsané, se bere z cache rovnou při vykreslení. Seznam zakázek
     se překresluje často a náhledy se přitom odpojují a připojují znovu –
     bez tohohle by každý nový náhled začínal od uložené adresy a čekal na
     podpis, který dorazí až k náhledu, co mezitím zmizel. */
  const zCache = (seznam: readonly string[]) => seznam.map((u) => podepsanaZCache(u) ?? u);

  const [podepsane, setPodepsane] = useState<string[]>(() => zCache(puvodni));

  /* Změna seznamu (smazaná nebo přidaná fotka) musí být vidět hned, ne až
     doběhne podepisování – jinak by na místě smazané fotky ještě chvíli
     svítil starý náhled. Předchozí seznam se drží ve stavu, ne v ref: úprava
     stavu při vykreslení je podporovaná cesta, sáhnout si při vykreslení na
     ref není. */
  const [predchoziKlic, setPredchoziKlic] = useState(klic);
  if (predchoziKlic !== klic) {
    setPredchoziKlic(klic);
    setPodepsane(zCache(puvodni));
  }

  useEffect(() => {
    if (!supabase || puvodni.length === 0) return;
    let zivy = true;

    let opakovani: ReturnType<typeof setTimeout> | null = null;

    const podepis = async (pokus = 0) => {
      const nove = await podepsFotky(supabase, puvodni);
      if (!zivy) return;
      setPodepsane(nove);
      if (neceoZbyva(puvodni, nove) && pokus < OPAKOVANI_MS.length) {
        opakovani = setTimeout(() => void podepis(pokus + 1), OPAKOVANI_MS[pokus]);
      }
    };

    void podepis();
    const timer = setInterval(() => void podepis(), OBNOVA_MS);
    // Po probuzení počítače může být odkaz dávno prošlý, aniž by interval
    // stihl proběhnout. Návrat do okna je nejlevnější místo, kde to zachytit.
    const naViditelnost = () => {
      if (document.visibilityState === "visible") void podepis();
    };
    document.addEventListener("visibilitychange", naViditelnost);

    return () => {
      zivy = false;
      clearInterval(timer);
      if (opakovani) clearTimeout(opakovani);
      document.removeEventListener("visibilitychange", naViditelnost);
    };
  }, [supabase, puvodni]);

  return podepsane;
}

/** Totéž pro jediný odkaz (podpis převzetí). */
export function usePodepsanaFotka(supabase: SupabaseClient | null, url: string | null | undefined): string | null {
  const seznam = useMemo(() => (url ? [url] : []), [url]);
  const podepsane = usePodepsaneFotky(supabase, seznam);
  return podepsane[0] ?? null;
}
