/**
 * Realtime odběr tabulky tickets: vložení, změna, obnovení a smazání zakázky
 * se promítnou do seznamu. Řádek z databáze se slučuje s pamětí podle
 * evidence zápisů (src/lib/slouceniZakazky.ts) – běžící, odložený nebo
 * neúspěšný okamžitý zápis oprav nesmí realtime přepsat.
 *
 * Po výpadku spojení, návratu do okna nebo probuzení počítače se dotáhnou
 * zakázky změněné od poslední známé změny (src/lib/zivyOdber.ts) – realtime
 * zmeškané události znovu nepošle a seznam by zůstal pozadu až do obnovení
 * stránky (hlášení majitele 27. 10. 2026).
 */
import { useEffect, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { supabase } from "../../../lib/supabaseClient";
import { devLog } from "../../../lib/devLog";
import { showToast } from "../../../components/Toast";
import { sloucZakazkuZDb, type EvidenceZapisu } from "../../../lib/slouceniZakazky";
import { odebirejZmeny } from "../../../lib/zivyOdber";
import { mapSupabaseTicketToTicketEx } from "../mapovani";
import type { TicketEx } from "../typy";

/**
 * Rezerva při dotahování změn. `updated_at` nastavuje trigger časem začátku
 * transakce, takže řádek z delší transakce se může objevit s časem o něco
 * starším než ten, který už v seznamu je.
 */
const REZERVA_DOTAZENI_MS = 2 * 60_000;
/** Strop jednoho dotažení; větší mezera je výjimka a dotáhne se nejnovější část. */
const MAX_DOTAZENYCH = 1000;

type Vstup = {
  activeServiceId: string | null;
  /** Otevřený detail v režimu úprav – kvůli hlášce „Zakázka se změnila na pozadí“. */
  isEditing: boolean;
  detailId: string | null;
  setCloudTickets: Dispatch<SetStateAction<TicketEx[]>>;
  evidenceZapisu: () => EvidenceZapisu;
  /** Aktuální seznam mimo React – odkud dotahovat změny. */
  cloudTicketsRef: MutableRefObject<TicketEx[]>;
  /** První načtení seznamu ještě běží – dotahovat není k čemu. */
  ticketsLoading: boolean;
};

/** Od kdy dotahovat: nejnovější `updated_at` v seznamu minus rezerva. */
export function hraniceDotazeni(zakazky: readonly Pick<TicketEx, "updatedAt">[], ted = Date.now()): string {
  let max = 0;
  for (const t of zakazky) {
    const ms = t.updatedAt ? Date.parse(t.updatedAt) : NaN;
    if (Number.isFinite(ms) && ms > max) max = ms;
  }
  // Prázdný servis (nebo seznam bez časů): poslední den stačí.
  const od = max > 0 ? max - REZERVA_DOTAZENI_MS : ted - 24 * 60 * 60_000;
  return new Date(od).toISOString();
}

/**
 * Promítne řádek z databáze (realtime nebo dotažení) do seznamu: smazaný
 * vyřadí, nový zařadí podle `created_at`, existující sloučí s pamětí.
 */
export function promitniRadek(prev: TicketEx[], radek: any, evidence: EvidenceZapisu): TicketEx[] {
  const nova = mapSupabaseTicketToTicketEx(radek);
  if (radek?.deleted_at != null) {
    return prev.some((t) => t.id === nova.id) ? prev.filter((t) => t.id !== nova.id) : prev;
  }
  const existing = prev.find((t) => t.id === nova.id);
  if (existing) {
    // Provedené opravy se ukládají hned; dokud zápis běží, čeká na
    // odklad, nebo selhal a čeká na zavření detailu, drží se místní
    // verze. Jinak by změna stavu od kolegy vrátila opravy z databáze,
    // které jsou o krok pozadu, a ve skladu by zůstala rezervace na
    // opravu, kterou nikdo nevidí. Stejně se hned ukládá kontrola po
    // opravě a náhradní zařízení – ozvěna staršího zápisu by přepsala
    // kliknutí, které přišlo mezitím. Pravidlo: src/lib/slouceniZakazky.ts.
    const sloucena = sloucZakazkuZDb(existing, nova, evidence, nova.id);
    return prev.map((t) => (t.id === nova.id ? sloucena : t));
  }
  // Nová – zařadit podle created_at, nejnovější nahoře.
  return [...prev, nova].sort((a, b) => {
    const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return bTime - aTime;
  });
}

export function useRealtimeZakazek({ activeServiceId, isEditing, detailId, setCloudTickets, evidenceZapisu, cloudTicketsRef, ticketsLoading }: Vstup) {
  /* Detail a režim úprav se čtou přes ref: dřív byly v závislostech efektu
     a každé otevření detailu odběr zrušilo a přihlásilo znovu – zbytečně,
     a po dobu přihlašování mohla událost utéct. */
  const isEditingRef = useRef(isEditing);
  isEditingRef.current = isEditing;
  const detailIdRef = useRef(detailId);
  detailIdRef.current = detailId;
  const evidenceRef = useRef(evidenceZapisu);
  evidenceRef.current = evidenceZapisu;
  const nacitaRef = useRef(ticketsLoading);
  nacitaRef.current = ticketsLoading;

  useEffect(() => {
    if (!activeServiceId || !supabase) return;
    const klient = supabase;
    const serviceId = activeServiceId;
    let zruseno = false;
    let dotahuje = false;

    const topic = `tickets:${serviceId}`;
    devLog("[RT] subscribe", topic, new Date().toISOString());

    const naRadek = (payload: any) => {
      if (payload.eventType === "INSERT" || payload.eventType === "UPDATE") {
        const radek = payload.new as any;
        devLog("[RT tickets] event", payload.eventType, {
          id: radek?.id,
          service_id: radek?.service_id,
          status: radek?.status,
          updated_at: radek?.updated_at,
        });
        // Zakázka v úpravách se změnila jinde – upozornit.
        if (radek?.deleted_at == null && isEditingRef.current && detailIdRef.current === radek?.id) {
          const existing = cloudTicketsRef.current.find((t) => t.id === radek.id);
          if (existing && (radek.version ?? 0) > (existing.version ?? 0)) {
            devLog("[RT tickets] Remote update detected for edited ticket", { ticketId: radek.id });
            showToast("Zakázka se změnila na pozadí", "info");
          }
        }
        setCloudTickets((prev) => promitniRadek(prev, radek, evidenceRef.current()));
      } else if (payload.eventType === "DELETE") {
        // Hard delete - remove from list
        const deletedId = (payload.old as any)?.id || (payload.new as any)?.id;
        if (deletedId) setCloudTickets((prev) => prev.filter((t) => t.id !== deletedId));
      }
    };

    /* Dotažení zmeškaných změn: jen řádky změněné od poslední známé změny,
       včetně smazaných (ty se ze seznamu vyřadí). Celý řádek jako z realtime. */
    const dotahni = async () => {
      if (zruseno || dotahuje || nacitaRef.current) return;
      dotahuje = true;
      try {
        const od = hraniceDotazeni(cloudTicketsRef.current);
        const { data, error } = await (klient.from("tickets") as any)
          .select("*")
          .eq("service_id", serviceId)
          .gte("updated_at", od)
          .order("updated_at", { ascending: false })
          .limit(MAX_DOTAZENYCH);
        if (zruseno) return;
        if (error) {
          console.warn("[RT tickets] dotažení změn selhalo", error);
          return;
        }
        const radky: any[] = data ?? [];
        const zname = new Map(cloudTicketsRef.current.map((t) => [t.id, t.updatedAt] as const));
        const zmenene = radky.filter((r) =>
          r.deleted_at != null ? zname.has(r.id) : zname.get(r.id) !== r.updated_at
        );
        devLog("[RT tickets] dotaženo", { od, radku: radky.length, zmenenych: zmenene.length });
        if (zmenene.length === 0) return;
        setCloudTickets((prev) => {
          let dalsi = prev;
          // Od nejstarší, ať novější změna téže zakázky vyhraje.
          for (let i = zmenene.length - 1; i >= 0; i--) dalsi = promitniRadek(dalsi, zmenene[i], evidenceRef.current());
          return dalsi;
        });
      } finally {
        dotahuje = false;
      }
    };

    const odhlasit = odebirejZmeny(
      topic,
      (kanal) =>
        kanal.on(
          "postgres_changes",
          { event: "*", schema: "public", table: "tickets", filter: `service_id=eq.${serviceId}` },
          naRadek
        ),
      () => void dotahni()
    );

    return () => {
      zruseno = true;
      devLog("[RT] unsubscribe", topic, new Date().toISOString());
      odhlasit();
    };
  }, [activeServiceId, setCloudTickets, cloudTicketsRef]);
}
