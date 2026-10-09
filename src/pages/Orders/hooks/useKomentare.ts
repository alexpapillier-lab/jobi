/**
 * Interní komentáře (chat) k zakázkám: načtení ke konkrétním zakázkám,
 * realtime obnova, přidání / úprava / připnutí, rozepsané texty a živé
 * profily autorů. Vyneseno z Orders.tsx beze změny obsahu; efekt s profily
 * autorů teď běží dřív (jen doplňuje vlastní stav).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "../../../lib/supabaseClient";
import { fetchAllPages } from "../../../lib/fetchAllPages";
import { showToast } from "../../../components/Toast";
import { reportError } from "../../../lib/reportError";
import type { TicketComment } from "../../../components/tickets";
import type { UserProfile } from "../../../hooks/useUserProfile";
import { type SupabaseTicketCommentRow, mapSupabaseCommentRow } from "../mapovani";
import { JMENO_SYSTEM, skrytyRootOwner } from "../../../lib/rootOwner";

/**
 * Komentář majitele aplikace se ostatním ukáže jako od „Systému“ – bez
 * přezdívky a fotky. Databáze to u nových komentářů dělá sama (trigger
 * v 20261009160000), tohle kryje starší řádky a profil, který by se dotáhl.
 */
function komentarProMe(row: SupabaseTicketCommentRow, mojeId: string | null): TicketComment {
  const c = mapSupabaseCommentRow(row);
  if (!skrytyRootOwner(c.author_id, mojeId)) return c;
  return { ...c, author: JMENO_SYSTEM, author_id: null, author_nickname: null, author_avatar_url: null };
}

type Vstup = {
  activeServiceId: string | null;
  session: Session | null;
  userProfile: UserProfile | null;
};

export function useKomentare({ activeServiceId, session, userProfile }: Vstup) {
  const mojeId = session?.user?.id ?? null;
  const [commentsByTicket, setCommentsByTicket] = useState<Record<string, TicketComment[]>>({});
  /** Živé profily autorů komentářů (fotka a přezdívka) – viz TicketComments. */
  const [commentAuthorProfiles, setCommentAuthorProfiles] = useState<Record<string, { nickname: string | null; avatarUrl: string | null }>>({});
  const commentsReqIdRef = useRef(0);
  // Interní komentáře (chat) k zakázkám – dřív jen v localStorage, teď sdílená
  // tabulka ticket_comments.
  //
  // Dřív se natáhly komentáře **celého servisu** a seskupily podle ticket_id.
  // Vidět je přitom vždycky jen ten jeden otevřený detail: u zátěžového servisu
  // to bylo 6 664 řádků v sedmi kolech po síti kvůli pár řádkům, které si někdo
  // přečte. Načítají se proto ke konkrétní zakázce – ze čtyřiceti osmi dotazů
  // při otevření seznamu zakázek tím ubylo sedm (6. 9. 2026, docs/ZATEZ.md).
  const nactiKomentare = useCallback(async (ticketIds: string[]) => {
    if (!activeServiceId || !supabase || ticketIds.length === 0) return;
    const myReqId = ++commentsReqIdRef.current;
    const { data, error } = await fetchAllPages<SupabaseTicketCommentRow>((from, to) =>
      (supabase!.from("ticket_comments") as any)
        .select("id,ticket_id,author,author_id,author_nickname,author_avatar_url,content,pinned,created_at")
        .eq("service_id", activeServiceId)
        .in("ticket_id", ticketIds)
        .order("created_at", { ascending: true })
        .range(from, to)
    );
    if (myReqId !== commentsReqIdRef.current) return;
    if (error) {
      console.error("[Orders] Error loading ticket comments:", error);
      return;
    }
    // Prázdné pole pro každou dotázanou zakázku: bez něj by se u zakázky, ze
    // které někdo poslední komentář smazal, ukazoval starý obsah z paměti.
    const grouped: Record<string, TicketComment[]> = {};
    for (const id of ticketIds) grouped[id] = [];
    for (const row of data) {
      const c = komentarProMe(row, mojeId);
      (grouped[c.ticketId] ??= []).push(c);
    }
    setCommentsByTicket((prev) => ({ ...prev, ...grouped }));
  }, [activeServiceId, supabase, mojeId]);

  /** Zakázky, jejichž komentáře jsou zrovna na obrazovce – kvůli realtime obnově. */
  const otevreneKomentareRef = useRef<string[]>([]);

  // Přepnutí servisu musí komentáře zahodit, jinak by v novém servisu chvíli
  // svítily cizí. (Dřív to zařizovalo hromadné načtení celého servisu.)
  useEffect(() => {
    setCommentsByTicket({});
    otevreneKomentareRef.current = [];
    return () => { commentsReqIdRef.current++; };
  }, [activeServiceId]);

  // Realtime subscription for ticket_comments – ať se nové/připnuté komentáře
  // objeví u všech kolegů na všech zařízeních, ne jen tam, kde vznikly.
  useEffect(() => {
    if (!activeServiceId || !supabase) return;
    const topic = `ticket_comments:${activeServiceId}`;
    const client = supabase;
    const channel = client
      .channel(topic)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "ticket_comments", filter: `service_id=eq.${activeServiceId}` },
        () => void nactiKomentare(otevreneKomentareRef.current)
      )
      .subscribe();
    return () => {
      if (client) client.removeChannel(channel);
    };
  }, [activeServiceId, supabase, nactiKomentare]);
  const [commentDraftByTicket, setCommentDraftByTicket] = useState<Record<string, string>>({});
  const commentsFor = (ticketId: string): TicketComment[] => {
    const all = (commentsByTicket[ticketId] ?? []).slice();

    all.sort((a, b) => {
      const ap = !!a.pinned;
      const bp = !!b.pinned;
      if (ap !== bp) return ap ? -1 : 1;
      return (a.createdAt ?? "").localeCompare(b.createdAt ?? "");
    });

    return all;
  };

  const addComment = async (ticketId: string) => {
    const text = (commentDraftByTicket[ticketId] ?? "").trim();
    if (!text || !supabase || !activeServiceId) return;

    const displayName = userProfile?.nickname?.trim() || session?.user?.email?.split("@")[0] || "Servis";
    const payload = {
      ticket_id: ticketId,
      service_id: activeServiceId,
      author: displayName,
      author_id: session?.user?.id ?? null,
      author_nickname: userProfile?.nickname?.trim() || null,
      author_avatar_url: userProfile?.avatarUrl?.trim() || null,
      content: text,
      pinned: false,
    };

    setCommentDraftByTicket((p) => ({ ...p, [ticketId]: "" }));

    const { data, error } = await (supabase.from("ticket_comments") as any)
      .insert(payload)
      .select("id,ticket_id,author,author_id,author_nickname,author_avatar_url,content,pinned,created_at")
      .single();

    if (error || !data) {
      console.error("[Orders] Error adding comment:", error);
      showToast("Nepodařilo se uložit komentář.", "error");
      setCommentDraftByTicket((p) => ({ ...p, [ticketId]: text }));
      return;
    }

    const c = mapSupabaseCommentRow(data as SupabaseTicketCommentRow);
    setCommentsByTicket((p) => ({ ...p, [ticketId]: [...(p[ticketId] ?? []), c] }));
  };

  const editComment = async (ticketId: string, commentId: string, text: string) => {
    if (!supabase) return;
    const prev = commentsByTicket[ticketId]?.find((c) => c.id === commentId);
    if (!prev || prev.text === text) return;
    setCommentsByTicket((p) => ({
      ...p,
      [ticketId]: (p[ticketId] ?? []).map((c) => (c.id === commentId ? { ...c, text } : c)),
    }));
    const { error } = await (supabase.from("ticket_comments") as any).update({ content: text }).eq("id", commentId);
    if (error) {
      setCommentsByTicket((p) => ({
        ...p,
        [ticketId]: (p[ticketId] ?? []).map((c) => (c.id === commentId ? { ...c, text: prev.text } : c)),
      }));
      reportError({ code: "orders.comment_edit_failed", error, userMessage: "Komentář se nepodařilo upravit.", source: "Orders.editComment", serviceId: activeServiceId });
    }
  };

  // Fotky a přezdívky autorů komentářů z aktuálních profilů (komentář má
  // jen snímek z doby uložení – kdo si fotku přidal později, byl bez ní).
  const commentAuthorIdsKey = useMemo(() => {
    const ids = new Set<string>();
    for (const list of Object.values(commentsByTicket)) for (const c of list) if (c.author_id) ids.add(c.author_id);
    return [...ids].sort().join(",");
  }, [commentsByTicket]);
  useEffect(() => {
    if (!supabase || !commentAuthorIdsKey) return;
    const ids = commentAuthorIdsKey.split(",");
    let cancelled = false;
    (async () => {
      const { data, error } = await (supabase.from("profiles") as any).select("id, nickname, avatar_url").in("id", ids);
      if (cancelled || error || !Array.isArray(data)) return;
      const map: Record<string, { nickname: string | null; avatarUrl: string | null }> = {};
      for (const p of data) map[p.id] = { nickname: p.nickname ?? null, avatarUrl: p.avatar_url ?? null };
      setCommentAuthorProfiles(map);
    })();
    return () => { cancelled = true; };
  }, [commentAuthorIdsKey]);

  const togglePin = async (ticketId: string, commentId: string) => {
    if (!supabase) return;
    const current = commentsByTicket[ticketId]?.find((c) => c.id === commentId);
    const nextPinned = !current?.pinned;

    setCommentsByTicket((p) => ({
      ...p,
      [ticketId]: (p[ticketId] ?? []).map((c) => (c.id === commentId ? { ...c, pinned: nextPinned } : c)),
    }));

    const { error } = await (supabase.from("ticket_comments") as any).update({ pinned: nextPinned }).eq("id", commentId);
    if (error) {
      console.error("[Orders] Error toggling comment pin:", error);
      setCommentsByTicket((p) => ({
        ...p,
        [ticketId]: (p[ticketId] ?? []).map((c) => (c.id === commentId ? { ...c, pinned: !nextPinned } : c)),
      }));
    }
  };

  const handleCommentDraftChange = useCallback((ticketId: string, value: string) => {
    setCommentDraftByTicket((p) => ({ ...p, [ticketId]: value }));
  }, []);

  return {
    commentAuthorProfiles,
    nactiKomentare,
    otevreneKomentareRef,
    commentDraftByTicket,
    commentsFor,
    addComment,
    editComment,
    togglePin,
    handleCommentDraftChange,
  };
}
