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

import { useEffect, useMemo, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { podepsFotky, PLATNOST_SEKUND } from "../lib/podepsaneFotky";

/** Obnovovat v polovině platnosti – vejde se to i do uspaného notebooku. */
const OBNOVA_MS = (PLATNOST_SEKUND * 1000) / 2;

export function usePodepsaneFotky(supabase: SupabaseClient | null, urls: readonly string[] | undefined | null): string[] {
  // Pole se v Orders.tsx skládá při každém vykreslení znovu (`x || []`), takže
  // závislostí nesmí být jeho identita, ale obsah – jinak by se podepisovalo
  // pořád dokola.
  const klic = (urls ?? []).join("\n");
  const puvodni = useMemo(() => (klic ? klic.split("\n") : []), [klic]);

  const [podepsane, setPodepsane] = useState<string[]>(puvodni);
  const posledniKlic = useRef(klic);

  // Změna seznamu (smazaná nebo přidaná fotka) musí být vidět hned, ne až
  // doběhne podepisování – jinak by na místě smazané fotky ještě chvíli
  // svítil starý náhled.
  if (posledniKlic.current !== klic) {
    posledniKlic.current = klic;
    setPodepsane(puvodni);
  }

  useEffect(() => {
    if (!supabase || puvodni.length === 0) return;
    let zivy = true;

    const podepis = async () => {
      const nove = await podepsFotky(supabase, puvodni);
      if (zivy) setPodepsane(nove);
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
