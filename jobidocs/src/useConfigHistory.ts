import { useCallback, useRef, useState } from "react";

const MAX_HISTORY = 50;

export function useConfigHistory(initial: Record<string, unknown>) {
  const [config, setConfigInternal] = useState<Record<string, unknown>>(initial);
  const historyRef = useRef<Record<string, unknown>[]>([initial]);
  const indexRef = useRef(0);

  const setConfig = useCallback(
    (updater: Record<string, unknown> | ((prev: Record<string, unknown>) => Record<string, unknown>)) => {
      setConfigInternal((prev) => {
        const next = typeof updater === "function" ? updater(prev) : updater;
        const history = historyRef.current.slice(0, indexRef.current + 1);
        history.push(next);
        if (history.length > MAX_HISTORY) history.shift();
        historyRef.current = history;
        indexRef.current = history.length - 1;
        return next;
      });
    },
    [],
  );

  const replaceConfig = useCallback(
    (next: Record<string, unknown>) => {
      setConfigInternal(next);
      historyRef.current = [next];
      indexRef.current = 0;
    },
    [],
  );

  const undo = useCallback(() => {
    if (indexRef.current <= 0) return;
    indexRef.current -= 1;
    setConfigInternal(historyRef.current[indexRef.current]);
  }, []);

  const redo = useCallback(() => {
    if (indexRef.current >= historyRef.current.length - 1) return;
    indexRef.current += 1;
    setConfigInternal(historyRef.current[indexRef.current]);
  }, []);

  const canUndo = indexRef.current > 0;
  const canRedo = indexRef.current < historyRef.current.length - 1;

  return { config, setConfig, replaceConfig, undo, redo, canUndo, canRedo };
}
