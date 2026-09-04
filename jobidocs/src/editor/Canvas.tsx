/**
 * Plocha s dokumentem: iframe se stejným HTML, jaké jde do PDF.
 * Editor do něj posílá výběr a příkazy, přijímá kliknutí, úpravy textu
 * a přetažení. Veškerá interakce v dokumentu se odehrává v iframu,
 * tady se jen překládá na události pro editor.
 */
import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from "react";
import type { SlotName } from "../../core/index";

export type Selection = { kind: "none" } | { kind: "block"; id: string } | { kind: "slotItem"; id: string } | { kind: "slot"; id: SlotName };

export type FitInfo = { pages: number; fontSize: number; overflow: boolean };

export type CanvasEvent =
  | { type: "select"; selection: Selection }
  | { type: "fit"; info: FitInfo }
  | { type: "moveBlock"; id: string; toIndex: number }
  | { type: "moveSlotItem"; id: string; toSlot: SlotName; index: number }
  | { type: "edit"; target: string; value: string }
  | { type: "insertBlock"; index: number }
  | { type: "addSlotItem"; slot: SlotName }
  | { type: "delete" }
  | { type: "duplicate"; id: string }
  | { type: "moveBy"; id: string; delta: number }
  | { type: "properties" }
  | { type: "pickVariable" }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "rowMove"; id: string; delta: number }
  | { type: "rowAdd"; afterId: string }
  | { type: "rowDelete"; id: string };

export type CanvasHandle = {
  insertVariable: (key: string, label: string) => void;
  startEdit: (kind: "block" | "slotItem", id: string) => void;
};

export type Zoom = "fit" | 50 | 75 | 100 | 125;

type Props = {
  html: string;
  selection: Selection;
  zoom: Zoom;
  onEvent: (ev: CanvasEvent) => void;
};

/** A4 při 96 dpi + okraj těla (8 mm) na každé straně. */
const CONTENT_WIDTH_PX = 794 + 2 * 30;

export const Canvas = forwardRef<CanvasHandle, Props>(function Canvas({ html, selection, zoom, onEvent }, ref) {
  const rootRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [scale, setScale] = useState(1);
  const [frameHeight, setFrameHeight] = useState(1200);
  const readyRef = useRef(false);
  const scrollRef = useRef(0);
  const onEventRef = useRef(onEvent);
  const selectionRef = useRef(selection);
  useEffect(() => {
    onEventRef.current = onEvent;
    selectionRef.current = selection;
  });

  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const measure = () => {
      if (zoom === "fit") setScale(Math.min(1.25, Math.max(0.3, (el.clientWidth - 16) / CONTENT_WIDTH_PX)));
      else setScale(zoom / 100);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [zoom]);

  const postToFrame = useCallback((msg: Record<string, unknown>) => {
    const win = frameRef.current?.contentWindow;
    if (!win || !readyRef.current) return;
    win.postMessage(msg, "*");
  }, []);

  const postSelection = useCallback(
    (sel: Selection, scroll = false) => postToFrame({ type: "jobidocs:select", kind: sel.kind, id: "id" in sel ? sel.id : null, scroll }),
    [postToFrame]
  );

  useEffect(() => {
    postSelection(selection);
  }, [selection, postSelection]);

  useImperativeHandle(
    ref,
    () => ({
      insertVariable: (key, label) => postToFrame({ type: "jobidocs:insertVariable", key, label }),
      startEdit: (kind, id) => postToFrame({ type: "jobidocs:edit", kind, id }),
    }),
    [postToFrame]
  );

  const syncHeight = useCallback(() => {
    const doc = frameRef.current?.contentDocument;
    if (!doc?.documentElement) return;
    const h = Math.max(doc.documentElement.scrollHeight, doc.body?.scrollHeight ?? 0);
    if (h > 0) setFrameHeight(h);
  }, []);

  useEffect(() => {
    const handler = (e: MessageEvent) => {
      const win = frameRef.current?.contentWindow;
      if (!win || e.source !== win) return;
      const m = e.data as Record<string, unknown> & { source?: string; type?: string };
      if (m?.source !== "jobidocs-doc") return;
      const emit = onEventRef.current;
      switch (m.type) {
        case "ready":
          readyRef.current = true;
          postSelection(selectionRef.current);
          syncHeight();
          if (rootRef.current) rootRef.current.scrollTop = scrollRef.current;
          break;
        case "fit":
          syncHeight();
          emit({ type: "fit", info: { pages: Number(m.pages) || 1, fontSize: Number(m.fontSize) || 10, overflow: !!m.overflow } });
          break;
        case "select": {
          const kind = m.kind as string;
          const id = m.id as string;
          if (kind === "block" && id) emit({ type: "select", selection: { kind: "block", id } });
          else if (kind === "slotItem" && id) emit({ type: "select", selection: { kind: "slotItem", id } });
          else if (kind === "slot" && id) emit({ type: "select", selection: { kind: "slot", id: id as SlotName } });
          else emit({ type: "select", selection: { kind: "none" } });
          break;
        }
        case "moveBlock":
          emit({ type: "moveBlock", id: String(m.id), toIndex: Number(m.toIndex) });
          break;
        case "moveSlotItem":
          emit({ type: "moveSlotItem", id: String(m.id), toSlot: m.toSlot as SlotName, index: Number(m.index) });
          break;
        case "edit":
          emit({ type: "edit", target: String(m.target), value: String(m.value ?? "") });
          break;
        case "insertBlock":
          emit({ type: "insertBlock", index: Number(m.index) });
          break;
        case "addSlotItem":
          emit({ type: "addSlotItem", slot: m.slot as SlotName });
          break;
        case "delete":
        case "properties":
        case "pickVariable":
        case "undo":
        case "redo":
          emit({ type: m.type });
          break;
        case "duplicate":
          emit({ type: "duplicate", id: String(m.id) });
          break;
        case "moveBy":
          emit({ type: "moveBy", id: String(m.id), delta: Number(m.delta) });
          break;
        case "rowMove":
          emit({ type: "rowMove", id: String(m.id), delta: Number(m.delta) });
          break;
        case "rowAdd":
          emit({ type: "rowAdd", afterId: String(m.afterId) });
          break;
        case "rowDelete":
          emit({ type: "rowDelete", id: String(m.id) });
          break;
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [postSelection, syncHeight]);

  // Před výměnou HTML si zapamatujeme pozici scrollu (iframe se znovu načte).
  useEffect(() => {
    readyRef.current = false;
    scrollRef.current = rootRef.current?.scrollTop ?? 0;
  }, [html]);

  return (
    <div className="cv-root" ref={rootRef}>
      <div style={{ height: frameHeight * scale, width: CONTENT_WIDTH_PX * scale, margin: "0 auto", position: "relative" }}>
        <div className="cv-scale" style={{ transform: `scale(${scale})`, width: CONTENT_WIDTH_PX, position: "absolute", left: 0, top: 0 }}>
          <iframe ref={frameRef} className="cv-frame" title="Náhled dokumentu" srcDoc={html} style={{ width: CONTENT_WIDTH_PX, height: frameHeight }} onLoad={syncHeight} />
        </div>
      </div>
    </div>
  );
});
