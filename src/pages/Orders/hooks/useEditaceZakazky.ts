/**
 * „Upravuje kolega“ – kdo má otevřený stejný detail zakázky a kdo ho právě
 * upravuje. Přes Supabase Realtime Presence, nic se neukládá do DB.
 *
 * Vlastní kanál na otevřený detail (`zakazka-editace:<ticketId>`), ne
 * společný kanál servisu z src/lib/presence.ts: ten hlásí jen „kdo má
 * otevřenou kterou zakázku“ pro bubliny v seznamu, tady se navíc posílá,
 * od kdy a jestli je detail v úpravách. `supabase.channel(topic)` vrací pro
 * stejný topic už existující kanál – proto se nový kanál zakládá až po
 * odhlášení předchozího se stejným názvem (StrictMode, rychlé přepnutí
 * zakázky tam a zpět).
 *
 * Presence může lhát (desktop bez spojení, uspaný notebook), takže se podle
 * ní nic nezakazuje – jen upozorňuje. Tvrdou pojistku dělá kontrola při
 * uložení (src/lib/editaceZamek.ts).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "../../../lib/supabaseClient";
import { devLog } from "../../../lib/devLog";
import { autorProOstatni, jeRootOwnerId, skrytyRootOwner } from "../../../lib/rootOwner";
import { autorZmen, kratkeJmeno, ostatniVDetailu, type AutorZmen, type PritomnostVDetailu, type ZaznamHistorieZmeny } from "../../../lib/editaceZamek";

/** Skryté okno (jiná aplikace, minimalizováno) se po dvou minutách z detailu odhlásí. */
const SKRYTO_ODHLASIT_PO_MS = 2 * 60 * 1000;

/** Rozběhnutá odhlášení podle topicu – nový kanál se stejným názvem na ně počká. */
const odchody = new Map<string, Promise<unknown>>();

function odhlas(channel: RealtimeChannel, topic: string) {
  if (!supabase) return;
  const p = supabase.removeChannel(channel).catch(() => undefined);
  odchody.set(topic, p);
  void p.finally(() => {
    if (odchody.get(topic) === p) odchody.delete(topic);
  });
}

type Vstup = {
  ticketId: string | null;
  userId: string | null;
  /** Přezdívka z profilu – jak mě uvidí kolegové. */
  jmeno: string;
  /** Detail je v režimu Upravit. */
  upravuje: boolean;
};

export function useEditaceZakazky({ ticketId, userId, jmeno, upravuje }: Vstup): { ostatni: PritomnostVDetailu[] } {
  const [ostatni, setOstatni] = useState<PritomnostVDetailu[]>([]);
  /** Co hlásím kolegům; `od` se mění s přepnutím do úprav a zpět. */
  const metaRef = useRef<PritomnostVDetailu | null>(null);
  /** Zakázka, ke které patří `metaRef` – „od“ se po přepnutí zakázky počítá znovu. */
  const metaZakazkaRef = useRef<string | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const prihlasenoRef = useRef(false);
  /** Okno je déle než dvě minuty skryté – nehlásit se, dokud se neukáže. */
  const skrytoRef = useRef(false);

  const posliStav = useCallback(() => {
    const ch = channelRef.current;
    const meta = metaRef.current;
    if (!ch || !meta || !prihlasenoRef.current || skrytoRef.current) return;
    // Majitel aplikace se kolegům jako „Otevřeno / Upravuje“ neukazuje.
    if (jeRootOwnerId(meta.userId)) return;
    void ch.track(meta).catch(() => undefined);
  }, []);

  // Stav, který se hlásí: přepnutí do úprav posune „od“ na teď.
  useEffect(() => {
    if (!ticketId || !userId) {
      metaRef.current = null;
      metaZakazkaRef.current = null;
      return;
    }
    const predtim = metaZakazkaRef.current === ticketId ? metaRef.current : null;
    const bezeZmeny = !!predtim && predtim.userId === userId && predtim.upravuje === upravuje;
    metaZakazkaRef.current = ticketId;
    metaRef.current = { userId, jmeno, upravuje, od: bezeZmeny ? predtim.od : new Date().toISOString() };
    posliStav();
  }, [ticketId, userId, jmeno, upravuje, posliStav]);

  // Kanál na otevřený detail: přihlásit při otevření, odhlásit při zavření.
  useEffect(() => {
    if (!supabase || !ticketId || !userId) return;
    const klient = supabase;
    const topic = `zakazka-editace:${ticketId}`;
    let zruseno = false;
    let channel: RealtimeChannel | null = null;

    void (odchody.get(topic) ?? Promise.resolve()).then(() => {
      if (zruseno) return;
      try {
        const ch = klient.channel(topic, { config: { presence: { key: userId } } });
        channel = ch;
        channelRef.current = ch;
        ch.on("presence", { event: "sync" }, () => {
          if (zruseno) return;
          // Pojistka pro starší verze, které se hlásí i za majitele aplikace.
          setOstatni(ostatniVDetailu(ch.presenceState<PritomnostVDetailu>(), userId).filter((o) => !skrytyRootOwner(o.userId, userId)));
        });
        ch.subscribe((status) => {
          if (zruseno) return;
          if (status === "SUBSCRIBED") {
            prihlasenoRef.current = true;
            posliStav();
          } else if (status === "CLOSED" || status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
            prihlasenoRef.current = false;
          }
        });
      } catch (err) {
        // Kanál se stejným názvem se ještě neodhlásil – bez upozornění, uložení hlídá kontrola verze.
        devLog("[editace] presence kanál se nepodařilo otevřít", err);
      }
    });

    return () => {
      zruseno = true;
      prihlasenoRef.current = false;
      if (channelRef.current === channel) channelRef.current = null;
      if (channel) odhlas(channel, topic);
      setOstatni([]);
    };
  }, [ticketId, userId, posliStav]);

  // Skryté okno: po dvou minutách se z detailu odhlásit, po návratu znovu přihlásit.
  useEffect(() => {
    if (!ticketId || typeof document === "undefined") return;
    let casovac: ReturnType<typeof setTimeout> | null = null;
    const zmena = () => {
      if (document.visibilityState === "hidden") {
        if (casovac) clearTimeout(casovac);
        casovac = setTimeout(() => {
          skrytoRef.current = true;
          void channelRef.current?.untrack().catch(() => undefined);
        }, SKRYTO_ODHLASIT_PO_MS);
      } else {
        if (casovac) clearTimeout(casovac);
        casovac = null;
        if (skrytoRef.current) {
          skrytoRef.current = false;
          posliStav();
        }
      }
    };
    document.addEventListener("visibilitychange", zmena);
    return () => {
      document.removeEventListener("visibilitychange", zmena);
      if (casovac) clearTimeout(casovac);
      skrytoRef.current = false;
    };
  }, [ticketId, posliStav]);

  return { ostatni };
}

/** Autor změn a jména pro konfliktní dialog. */
export type AutorKonfliktu = {
  autor: AutorZmen;
  /** Zkrácená jména přihlášených autorů („Jana N.“), neznámý člen = „kolega“. */
  jmena: string[];
};

/**
 * Kdo zakázku změnil po začátku úprav – z `ticket_history` (changed_by,
 * changes) a jména přes `clenove_servisu` (člen smí číst jen své členství,
 * profily kolegů jinak nevidí). Když cokoli selže, vrátí neznámého autora –
 * dialog se ukáže i tak, jen bez jména.
 */
export async function nactiAutoraZmen(params: {
  serviceId: string;
  ticketId: string;
  mojeId: string | null;
  /** updated_at základu úprav (čas serveru). */
  od: string | null;
  sloupce: readonly string[];
  /** Jména z presence, než dorazí seznam členů. */
  znamaJmena?: ReadonlyMap<string, string>;
}): Promise<AutorKonfliktu> {
  const { serviceId, ticketId, mojeId, od, sloupce, znamaJmena } = params;
  if (!supabase) return { autor: { typ: "neznamy" }, jmena: [] };
  try {
    let dotaz = (supabase as any)
      .from("ticket_history")
      .select("changed_by, created_at, action, details")
      .eq("ticket_id", ticketId)
      .order("created_at", { ascending: false })
      .limit(30);
    if (od) dotaz = dotaz.gt("created_at", od);
    const { data, error } = await dotaz;
    if (error || !Array.isArray(data)) return { autor: { typ: "neznamy" }, jmena: [] };
    // Změna od majitele aplikace je pro ostatní změna „systému“ (jako import).
    const zaznamy = (data as ZaznamHistorieZmeny[]).map((z) => ({ ...z, changed_by: autorProOstatni(z.changed_by, mojeId) }));
    const autor = autorZmen(zaznamy, { mojeId, od, sloupce });
    if (autor.typ !== "kolega") return { autor, jmena: [] };

    const ids = autor.autori.filter((a): a is string => !!a);
    const jmenaPodleId = new Map<string, string>(znamaJmena ?? []);
    if (ids.some((id) => !jmenaPodleId.has(id))) {
      const { data: clenove } = await (supabase as any).rpc("clenove_servisu", { p_service_id: serviceId });
      if (Array.isArray(clenove)) {
        for (const c of clenove) {
          const jm = typeof c?.nickname === "string" ? c.nickname.trim() : "";
          if (c?.user_id && jm) jmenaPodleId.set(String(c.user_id), jm);
        }
      }
    }
    // Jen přihlášení autoři; null (portál, automatika) pozná dialog z autor.autori.
    const jmena = ids.map((id) => {
      const jm = jmenaPodleId.get(id);
      return jm ? kratkeJmeno(jm) : "kolega";
    });
    return { autor, jmena: [...new Set(jmena)] };
  } catch (err) {
    devLog("[editace] autora změn se nepodařilo zjistit", err);
    return { autor: { typ: "neznamy" }, jmena: [] };
  }
}
