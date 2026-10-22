/**
 * Provedené zákroky u reklamace – ukládají se samy, stejně jako provedené
 * opravy u zakázky.
 *
 * Dřív šly do databáze jen tlačítkem „Uložit zákroky“, které se ukázalo až
 * po první změně. Kdo detail zavřel (u zakázky se opravy ukládají samy),
 * o zákrok bez varování přišel – a na tisku pak chyběl. Hlášení ze servisu
 * 15. 10. 2026: „neuloží se tam ta provedená oprava“.
 *
 * Změna se zapíše po krátkém odkladu, při zavření detailu, přepnutí na jinou
 * reklamaci a před tiskem. Zápisy na stejný řádek jdou za sebou (řetěz
 * slibů) – souběžné zápisy nemají zaručené pořadí a mohl by vyhrát starší.
 * Výpadek spojení řeší updateClaim frontou neuložených změn.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type React from "react";
import { type ClaimResolutionItem, serializeClaimResolutionItems } from "../reklamaceZakroky";
import type { WarrantyClaimRow } from "./useWarrantyClaims";

const ODKLAD_MS = 800;

/** Hodnota sloupce resolution_summary ze zákroků; bezejmenné řádky se neukládají. */
export function zakrokyDoSloupce(items: ClaimResolutionItem[]): string | null {
  const vyplnene = items.filter((x) => (x.name || "").trim());
  return vyplnene.length > 0 ? serializeClaimResolutionItems(vyplnene) : null;
}

type UpdateClaim = (
  claimId: string,
  payload: { resolution_summary: string | null },
  popis?: string,
  volby?: { tiche?: boolean; klic?: string },
) => Promise<WarrantyClaimRow | null>;

type Cekajici = { claimId: string; hodnota: string | null; popis?: string };

export function useZakrokyReklamace({
  detailClaimId,
  cloudClaims,
  setCloudClaims,
  updateClaim,
}: {
  detailClaimId: string | null;
  cloudClaims: WarrantyClaimRow[];
  setCloudClaims: React.Dispatch<React.SetStateAction<WarrantyClaimRow[]>>;
  updateClaim: UpdateClaim;
}) {
  /** Zákroky na obrazovce; null = beze změny, platí to, co je v databázi. */
  const [koncept, setKoncept] = useState<ClaimResolutionItem[] | null>(null);
  const [neulozeno, setNeulozeno] = useState(false);

  const cekajiciRef = useRef<Cekajici | null>(null);
  const casovacRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retezRef = useRef<Promise<boolean>>(Promise.resolve(true));
  /** Co je po posledním vlastním zápisu v databázi (cloudClaims se dorovná až po vykreslení). */
  const zapsanoRef = useRef(new Map<string, string | null>());
  const claimsRef = useRef(cloudClaims);
  const updateRef = useRef(updateClaim);
  useLayoutEffect(() => {
    claimsRef.current = cloudClaims;
    updateRef.current = updateClaim;
  }, [cloudClaims, updateClaim]);

  /** Zapíše čekající změnu hned. Vrací false, když zápis trvale selhal (hlášku ukázal updateClaim). */
  const ulozHned = useCallback((): Promise<boolean> => {
    if (casovacRef.current) {
      clearTimeout(casovacRef.current);
      casovacRef.current = null;
    }
    const c = cekajiciRef.current;
    cekajiciRef.current = null;
    if (!c) return retezRef.current;
    const krok = retezRef.current.then(async () => {
      const vDb = zapsanoRef.current.has(c.claimId)
        ? zapsanoRef.current.get(c.claimId) ?? null
        : claimsRef.current.find((x) => x.id === c.claimId)?.resolution_summary || null;
      if (vDb === c.hodnota) return true;
      const updated = await updateRef.current(c.claimId, { resolution_summary: c.hodnota }, c.popis, { tiche: true, klic: "zakroky" });
      if (!updated) {
        // Zůstává na obrazovce i ve frontě tohoto hooku; zkusí se znovu při další změně nebo zavření.
        if (!cekajiciRef.current) cekajiciRef.current = c;
        return false;
      }
      zapsanoRef.current.set(c.claimId, c.hodnota);
      setCloudClaims((prev) => prev.map((cl) => (cl.id === c.claimId ? { ...cl, ...updated, resolution_summary: c.hodnota } : cl)));
      return true;
    });
    retezRef.current = krok.catch(() => false);
    void retezRef.current.then(() => setNeulozeno(cekajiciRef.current !== null));
    return krok;
  }, [setCloudClaims]);

  const zmenZakroky = useCallback(
    (items: ClaimResolutionItem[]) => {
      setKoncept(items);
      if (!detailClaimId) return;
      cekajiciRef.current = {
        claimId: detailClaimId,
        hodnota: zakrokyDoSloupce(items),
        popis: claimsRef.current.find((x) => x.id === detailClaimId)?.code ?? undefined,
      };
      setNeulozeno(true);
      if (casovacRef.current) clearTimeout(casovacRef.current);
      casovacRef.current = setTimeout(() => void ulozHned(), ODKLAD_MS);
    },
    [detailClaimId, ulozHned],
  );

  // Jiná reklamace nebo odchod ze stránky: rozepsané zákroky té předchozí se
  // dopíšou (čekající změna si nese vlastní id reklamace).
  useEffect(() => {
    setKoncept(null);
    zapsanoRef.current.clear();
    return () => {
      void ulozHned();
    };
  }, [detailClaimId, ulozHned]);

  return { koncept, zmenZakroky, ulozHned, neulozeno };
}
