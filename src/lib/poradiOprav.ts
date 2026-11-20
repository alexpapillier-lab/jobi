/**
 * Pořadí oprav zvlášť pro model.
 *
 * Oprava může patřit k víc modelům, ale společné pořadí (order_index) znamenalo,
 * že posun u jednoho modelu přehodil opravu i u ostatních. Každá oprava proto
 * nese `modelOrder` – pozici v seznamu konkrétního modelu. Model bez vlastního
 * pořadí (nic u něj nikdo neposouval) se řadí podle společného seznamu jako dřív.
 */
import { posunVPoradi, presunKPolozce } from "./poradiSeznamu";

export type OpravaSPoradim = { id: string; modelIds?: string[]; modelOrder?: Record<string, number> };

/** Oprava bez vlastní pozice (přidaná později) jde na konec, ve společném pořadí. */
const BEZ_POZICE = 1e9;

/** Opravy modelu v jeho pořadí (společné pořadí je výchozí). */
export function poradiVModelu<T extends OpravaSPoradim>(vse: readonly T[], modelId: string): T[] {
  return vse
    .map((r, i) => ({ r, i }))
    .filter(({ r }) => r.modelIds?.includes(modelId))
    .sort((a, b) => (a.r.modelOrder?.[modelId] ?? BEZ_POZICE) - (b.r.modelOrder?.[modelId] ?? BEZ_POZICE) || a.i - b.i)
    .map(({ r }) => r);
}

/** Opravy pro víc modelů naráz (zařízení na zakázce může sedět na víc modelů): nejlepší pozice ze shodných modelů. */
export function seradPodleModelu<T extends OpravaSPoradim>(opravy: readonly T[], modelIds: readonly string[]): T[] {
  if (modelIds.length === 0) return [...opravy];
  const klic = (r: T) => Math.min(...modelIds.filter((m) => r.modelIds?.includes(m)).map((m) => r.modelOrder?.[m] ?? BEZ_POZICE), BEZ_POZICE);
  return opravy.map((r, i) => ({ r, i })).sort((a, b) => klic(a.r) - klic(b.r) || a.i - b.i).map(({ r }) => r);
}

/** Zapíše pořadí `ids` jako pořadí modelu; ostatní modely a společné pořadí zůstanou. */
export function ulozPoradiModelu<T extends OpravaSPoradim>(vse: T[], modelId: string, ids: string[]): T[] {
  const pozice = new Map(ids.map((id, i) => [id, i]));
  return vse.map((r) => (pozice.has(r.id) ? { ...r, modelOrder: { ...(r.modelOrder ?? {}), [modelId]: pozice.get(r.id)! } } : r));
}

/** Šipka: posun opravy o jedno místo v seznamu modelu (podle zobrazeného seznamu). null = není kam. */
export function posunVModelu<T extends OpravaSPoradim>(vse: T[], modelId: string, zobrazene: T[], id: string, smer: -1 | 1): T[] | null {
  const nove = posunVPoradi(poradiVModelu(vse, modelId), zobrazene, id, smer);
  return nove ? ulozPoradiModelu(vse, modelId, nove.map((r) => r.id)) : null;
}

/** Přetažení: oprava `id` těsně před/za `cilId` v seznamu modelu. null = beze změny. */
export function presunVModelu<T extends OpravaSPoradim>(vse: T[], modelId: string, id: string, cilId: string, za: boolean): T[] | null {
  const nove = presunKPolozce(poradiVModelu(vse, modelId), id, cilId, za);
  return nove ? ulozPoradiModelu(vse, modelId, nove.map((r) => r.id)) : null;
}
