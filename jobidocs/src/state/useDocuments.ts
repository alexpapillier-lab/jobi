/**
 * Stav šablon jednoho servisu: načtení, historie (zpět / znovu), uložení
 * s kontrolou verze. Jeden objekt DocumentsV2 = značka + motiv + šablony
 * všech typů dokumentů; editor i stránka Značka mění tenhle jeden objekt.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { api, type LoadedDocuments } from "../api";
import { normalizeDocuments, type DocumentsV2 } from "../../core/index";

const MAX_HISTORY = 100;

export type Draft = { at: number; docs: DocumentsV2 };

export type SaveState = { status: "idle" } | { status: "saving" } | { status: "saved"; at: number; to: "supabase" | "local" } | { status: "error"; message: string } | { status: "conflict"; version: number };

export function useDocuments(serviceId: string | null) {
  const [loaded, setLoaded] = useState<LoadedDocuments | null>(null);
  const [docs, setDocsInternal] = useState<DocumentsV2 | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [save, setSave] = useState<SaveState>({ status: "idle" });
  const historyRef = useRef<DocumentsV2[]>([]);
  const indexRef = useRef(0);
  const savedRef = useRef<string>("");
  const [, bump] = useState(0);
  const [draft, setDraft] = useState<Draft | null>(null);
  const draftKey = serviceId ? `jobidocs:draft:${serviceId}` : null;

  const reload = useCallback(async () => {
    if (!serviceId) return;
    setLoading(true);
    setLoadError(null);
    try {
      const l = await api.documents(serviceId);
      const d = normalizeDocuments(l.documents);
      setLoaded(l);
      docsRef.current = d;
      setDocsInternal(d);
      historyRef.current = [d];
      indexRef.current = 0;
      savedRef.current = JSON.stringify(d);
      setSave({ status: "idle" });
      // Rozpracovaná verze z minula (zavřená aplikace, pád) – nabídnout obnovení.
      try {
        const raw = draftKey ? localStorage.getItem(draftKey) : null;
        const parsed = raw ? (JSON.parse(raw) as Draft) : null;
        if (parsed && parsed.docs && JSON.stringify(normalizeDocuments(parsed.docs)) !== savedRef.current) setDraft({ at: parsed.at, docs: normalizeDocuments(parsed.docs) });
        else setDraft(null);
      } catch {
        setDraft(null);
      }
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [serviceId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Historie se vede mimo updater setState – ten React ve StrictMode volá
  // dvakrát a každá změna by se do historie zapsala dvojmo (Zpět by pak
  // vracelo tutéž verzi).
  const docsRef = useRef<DocumentsV2 | null>(null);
  useEffect(() => {
    docsRef.current = docs;
  }, [docs]);

  const setDocs = useCallback((updater: (prev: DocumentsV2) => DocumentsV2) => {
    const prev = docsRef.current;
    if (!prev) return;
    const next = updater(prev);
    if (next === prev) return;
    const h = historyRef.current.slice(0, indexRef.current + 1);
    h.push(next);
    if (h.length > MAX_HISTORY) h.shift();
    historyRef.current = h;
    indexRef.current = h.length - 1;
    docsRef.current = next;
    setDocsInternal(next);
    setSave((s) => (s.status === "saved" ? { status: "idle" } : s));
  }, []);

  const undo = useCallback(() => {
    if (indexRef.current <= 0) return;
    indexRef.current -= 1;
    docsRef.current = historyRef.current[indexRef.current];
    setDocsInternal(docsRef.current);
    bump((x) => x + 1);
  }, []);
  const redo = useCallback(() => {
    if (indexRef.current >= historyRef.current.length - 1) return;
    indexRef.current += 1;
    docsRef.current = historyRef.current[indexRef.current];
    setDocsInternal(docsRef.current);
    bump((x) => x + 1);
  }, []);

  const dirty = docs != null && JSON.stringify(docs) !== savedRef.current;

  // Průběžná záloha neuložené práce do localStorage (obnoví se po pádu / zavření).
  useEffect(() => {
    if (!draftKey || !docs) return;
    const t = setTimeout(() => {
      try {
        if (dirty) localStorage.setItem(draftKey, JSON.stringify({ at: Date.now(), docs } satisfies Draft));
        else localStorage.removeItem(draftKey);
      } catch {
        // plné úložiště apod. – záloha je jen pojistka
      }
    }, 800);
    return () => clearTimeout(t);
  }, [docs, dirty, draftKey]);

  const restoreDraft = useCallback(() => {
    if (!draft) return;
    setDocs(() => draft.docs);
    setDraft(null);
  }, [draft, setDocs]);

  const discardDraft = useCallback(() => {
    try {
      if (draftKey) localStorage.removeItem(draftKey);
    } catch {
      // ignore
    }
    setDraft(null);
  }, [draftKey]);

  const persist = useCallback(
    async (opts?: { force?: boolean }) => {
      if (!serviceId || !docs) return false;
      setSave({ status: "saving" });
      try {
        const r = await api.saveDocuments(serviceId, docs, opts?.force ? undefined : loaded?.version);
        const d = normalizeDocuments(r.documents);
        savedRef.current = JSON.stringify(d);
        docsRef.current = d;
        setDocsInternal(d);
        historyRef.current[indexRef.current] = d;
        setLoaded((l) => (l ? { ...l, documents: d, version: r.version, updated_at: r.updated_at, source: r.savedTo === "supabase" ? "supabase" : "local" } : l));
        setSave({ status: "saved", at: Date.now(), to: r.savedTo });
        try {
          if (draftKey) localStorage.removeItem(draftKey);
        } catch {
          // ignore
        }
        return true;
      } catch (e) {
        const err = e as Error & { status?: number; body?: { version?: number } };
        if (err.status === 409) setSave({ status: "conflict", version: err.body?.version ?? 0 });
        else setSave({ status: "error", message: err.message });
        return false;
      }
    },
    [serviceId, docs, loaded?.version, draftKey]
  );

  return {
    docs,
    setDocs,
    loaded,
    loading,
    loadError,
    reload,
    dirty,
    save,
    persist,
    undo,
    redo,
    canUndo: indexRef.current > 0,
    canRedo: indexRef.current < historyRef.current.length - 1,
    draft,
    restoreDraft,
    discardDraft,
  };
}
