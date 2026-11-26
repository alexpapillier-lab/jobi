import { useCallback, useEffect, useState } from "react";
import { Button } from "../../components/ui";
import { showToast } from "../../components/Toast";
import { useBranches } from "../../context/BranchContext";
import { useStatuses } from "../../state/StatusesStore";
import {
  nactiPokladny,
  nactiPolozkuZakazky,
  stavPoZaplaceni,
  zaplatit,
  zapisPohyb,
  type KZaplaceni,
  type NastaveniPokladny,
  type Pokladna,
} from "../../lib/pokladna";
import { PlatbaOkno, type VysledekPlatby } from "../Pokladna/Okna";
import { kc } from "../Pokladna/format";

/**
 * „Zaplatit“ přímo v detailu zakázky.
 *
 * Zaměstnanec nemusí do Pokladny: klepne na tlačítko, vybere Hotově / Kartou,
 * a platba se zapíše do pokladny pobočky (stejné okno a stejný zápis jako
 * v záložce K zaplacení, včetně zaokrouhlení, dýška a přepnutí stavu).
 * Pokladna se bere ta, kterou má člen vybranou na stránce Pokladna; bez
 * ní první pokladna pobočky zakázky.
 */
const klicVybrane = (serviceId: string) => `jobi_pokladna_vybrana_${serviceId}`;

export function ZaplatitZakazku({
  ticketId,
  serviceId,
  branchId,
  stav,
  nastaveni,
}: {
  ticketId: string;
  serviceId: string;
  branchId: string | null;
  /** Aktuální stav zakázky (klíč) – po zaplacení se může přepnout. */
  stav: string | null;
  nastaveni: NastaveniPokladny;
}) {
  const { activeBranchId } = useBranches();
  const { statuses, getByKey } = useStatuses();
  const [pokladny, setPokladny] = useState<Pokladna[]>([]);
  const [polozka, setPolozka] = useState<KZaplaceni | null>(null);
  const [otevreno, setOtevreno] = useState(false);

  const nacti = useCallback(async () => {
    try {
      const [p, z] = await Promise.all([nactiPokladny(serviceId), nactiPolozkuZakazky(serviceId, ticketId)]);
      setPokladny(p);
      setPolozka(z);
    } catch {
      // Bez pokladny nebo spojení se tlačítko prostě neukáže; Pokladna samotná chybu ohlásí.
      setPolozka(null);
    }
  }, [serviceId, ticketId]);

  useEffect(() => {
    setPolozka(null);
    void nacti();
  }, [nacti, stav]);

  /* Pokladny pobočky zakázky; zakázka bez pobočky (nebo servis bez poboček) → všechny. */
  const pobocka = branchId ?? activeBranchId;
  const kandidati = pokladny.filter((p) => !p.archivovana && (!pobocka || !p.branchId || p.branchId === pobocka));
  let vybranaId: string | null = null;
  try { vybranaId = localStorage.getItem(klicVybrane(serviceId)); } catch { /* bez uložení se bere první */ }
  const pokladna = kandidati.find((p) => p.id === vybranaId) ?? kandidati[0] ?? null;

  if (!polozka || !pokladna) return null;
  if (polozka.zaplacenaFakturou) {
    return <span style={{ fontSize: 13, fontWeight: 700, color: "var(--muted)" }}>Zaplaceno fakturou</span>;
  }
  const zaplaceno = polozka.celkem > 0 && polozka.zbyva <= 0;
  const cilovyStav = stavPoZaplaceni(nastaveni, statuses);

  const potvrdit = async (v: VysledekPlatby) => {
    await zaplatit({
      pokladnaId: pokladna.id,
      druh: v.zaloha ? "zaloha" : polozka.invoiceId ? "faktura" : "zakazka",
      castka: v.castka,
      zpusob: v.zpusob,
      ticketId,
      invoiceId: v.zaloha ? null : polozka.invoiceId,
      zaokrouhleni: v.zaokrouhleni,
    });
    const co = polozka.kod || polozka.nazev;
    if (v.dysko > 0) {
      try {
        await zapisPohyb({ pokladnaId: pokladna.id, druh: "prijem", castka: v.dysko, zpusob: v.zpusob, kategorie: "Dýško", popis: co });
      } catch (e) {
        showToast(`Platba zapsána, ale dýško ${kc(v.dysko)} ne: ${e instanceof Error ? e.message : "chyba"}. Zapište ho ručně v Pokladně jako příjem.`, "error");
      }
    }
    setOtevreno(false);
    const meni = !v.zaloha && cilovyStav && stav !== cilovyStav && !(stav && getByKey(stav)?.isFinal);
    if (!meni) {
      showToast(`${v.zaloha ? "Záloha" : "Zaplaceno"} ${kc(v.castka)}${v.dysko > 0 ? ` + dýško ${kc(v.dysko)}` : ""} · ${co}`, "success");
      void nacti();
      return;
    }
    const nazevStavu = getByKey(cilovyStav!)?.label ?? cilovyStav!;
    window.dispatchEvent(new CustomEvent("jobsheet:zmen-stav-zakazky", {
      detail: {
        ticketId,
        statusKey: cilovyStav,
        hotovo: (ok: boolean) => {
          if (ok) showToast(`Zaplaceno ${kc(v.castka)} · ${co} → ${nazevStavu}`, "success");
          else showToast(`Zaplaceno ${kc(v.castka)}, ale stav zakázky ${co} se nezměnil – přepněte ho ručně.`, "error");
          void nacti();
        },
      },
    }));
  };

  return (
    <>
      {zaplaceno ? (
        <Button variant="soft" onClick={() => setOtevreno(true)} title="Zakázka je zaplacená v pokladně – klepnutím přijmete další platbu (např. doplatek)">
          ✓ Zaplaceno {kc(polozka.zaplaceno)}
        </Button>
      ) : (
        <Button variant="primary" onClick={() => setOtevreno(true)} title="Zapíše platbu do pokladny">
          {polozka.zbyva > 0 ? `Zaplatit ${kc(polozka.zbyva)}` : "Zaplatit"}
        </Button>
      )}
      {otevreno && (
        <PlatbaOkno
          polozka={polozka}
          vychoziZpusob="cash"
          zaokrouhlovat={nastaveni.zaokrouhlovat}
          stavPoPlatbe={cilovyStav && !(stav && getByKey(stav)?.isFinal) && stav !== cilovyStav ? getByKey(cilovyStav)?.label ?? null : null}
          pokladna={kandidati.length > 1 ? pokladna.nazev : undefined}
          onClose={() => setOtevreno(false)}
          onPotvrdit={potvrdit}
        />
      )}
    </>
  );
}
