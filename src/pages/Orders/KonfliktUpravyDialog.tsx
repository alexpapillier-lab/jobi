/**
 * Dialogy „upravuje kolega“ v detailu zakázky:
 *   - KonfliktUpravyDialog – při uložení se zjistilo, že zakázku mezitím
 *     změnil někdo jiný (src/lib/editaceZamek.ts). Přepsat / Načíst jeho verzi.
 *   - KolegaUpravujeDialog – kliknutí na Upravit, když už upravuje kolega.
 *     Nezakazuje: presence může lhát (desktop offline, uspaný notebook).
 *
 * Oba mají vlastní Escape (data-escape-vlastni – jinak by Escape zavřel
 * celý detail) a Enter nepouští dál: v režimu úprav by Enter v Orders
 * spustil další uložení.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Button } from "../../components/ui";
import { casHodiny, kratkeJmeno, vyctiPole, type PoleZakazky } from "../../lib/editaceZamek";
import type { AutorKonfliktu } from "./hooks/useEditaceZakazky";

function Okno({ nadpisId, onZavrit, ceka, children }: { nadpisId: string; onZavrit: () => void; ceka: boolean; children: ReactNode }) {
  const oknoRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        if (!ceka) onZavrit();
      } else if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        const aktivni = document.activeElement;
        if (!ceka && aktivni instanceof HTMLButtonElement && oknoRef.current?.contains(aktivni)) aktivni.click();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onZavrit, ceka]);

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={nadpisId}
      data-escape-vlastni
      onMouseDown={(e) => e.stopPropagation()}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 10_000, padding: 16 }}
    >
      <div
        ref={oknoRef}
        style={{ background: "var(--panel)", color: "var(--text)", borderRadius: 14, border: "1px solid var(--border)", padding: 20, width: "min(100%, 480px)", display: "grid", gap: 14, boxShadow: "0 20px 60px rgba(0,0,0,0.35)" }}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}

/** „Kolega Jana N.“, „Kolegové Jana N. a Petr“, bez jména „Někdo jiný“. */
function ktoZmenil(info: AutorKonfliktu | null): { kdo: string; cas: string; ja: boolean; vice: boolean } {
  if (!info || info.autor.typ === "neznamy") return { kdo: "Někdo jiný", cas: "", ja: false, vice: false };
  if (info.autor.typ === "ja") return { kdo: "Vy (v jiném okně nebo zařízení)", cas: casHodiny(info.autor.cas), ja: true, vice: true };
  const cas = casHodiny(info.autor.cas);
  // Bez přihlášeného autora: schválení nabídky v portálu, automatika.
  if (info.jmena.length === 0) return { kdo: "Zákazník nebo automatika", cas, ja: false, vice: false };
  const j = info.jmena;
  const seznam = j.length === 1 ? j[0] : `${j.slice(0, -1).join(", ")} a ${j[j.length - 1]}`;
  return { kdo: j.length > 1 ? `Kolegové ${seznam}` : `Kolega ${seznam}`, cas, ja: false, vice: j.length > 1 };
}

export function KonfliktUpravyDialog({
  zmeny,
  prepise,
  autor,
  onPrepsat,
  onNacist,
  onZpet,
}: {
  /** Všechno, co se od začátku úprav změnilo. */
  zmeny: readonly PoleZakazky[];
  /** Z toho to, co by uložení formuláře přepsalo. */
  prepise: readonly PoleZakazky[];
  /** Načítá se po otevření dialogu; do té doby null. */
  autor: AutorKonfliktu | null;
  onPrepsat: () => Promise<void> | void;
  onNacist: () => Promise<void> | void;
  onZpet: () => void;
}) {
  const [ceka, setCeka] = useState<null | "prepsat" | "nacist">(null);
  const { kdo, cas, ja, vice } = ktoZmenil(autor);
  const proved = async (co: "prepsat" | "nacist") => {
    setCeka(co);
    try {
      await (co === "prepsat" ? onPrepsat() : onNacist());
    } finally {
      setCeka(null);
    }
  };

  return (
    <Okno nadpisId="konflikt-upravy-nadpis" onZavrit={onZpet} ceka={!!ceka}>
      <div>
        <h2 id="konflikt-upravy-nadpis" style={{ margin: 0, fontSize: 17, fontWeight: 800 }}>
          {ja ? "Zakázku jste mezitím změnili jinde" : "Zakázku mezitím změnil někdo jiný"}
        </h2>
        <div style={{ fontSize: 14, marginTop: 8, lineHeight: 1.5 }}>
          {kdo} mezitím {vice ? "změnili" : "změnil"}: <strong>{vyctiPole(zmeny)}</strong>
          {cas ? ` (v ${cas})` : ""}.
        </div>
        {prepise.length > 0 && (
          <div role="note" style={{ fontSize: 13, marginTop: 10, padding: "8px 10px", borderRadius: 10, background: "var(--warning-soft)", color: "var(--warning-text)" }}>
            Uložením byste přepsali: {vyctiPole(prepise)}.
          </div>
        )}
        <div style={{ color: "var(--muted)", fontSize: 13, marginTop: 10, lineHeight: 1.5 }}>
          <strong>Přepsat</strong> uloží vaše úpravy formuláře; ostatní změny (stav, opravy) zůstanou, jak je {ja ? "máte" : "kolega nechal"}.{" "}
          <strong>Načíst {ja ? "novou" : "jeho"} verzi</strong> zahodí rozepsané úpravy formuláře a vyplní ho znovu z databáze.
          Neuložené provedené opravy a rozepsaná diagnostika zůstanou v obou případech.
        </div>
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, flexWrap: "wrap" }}>
        {/* Výchozí je Zpět: Enter zmáčknutý ještě „na uložení“ nesmí nic přepsat ani zahodit. */}
        <Button variant="ghost" onClick={onZpet} disabled={!!ceka} autoFocus>Zpět k úpravám</Button>
        <Button variant="soft" onClick={() => void proved("nacist")} disabled={!!ceka}>
          {ceka === "nacist" ? "Načítám…" : ja ? "Načíst novou verzi" : "Načíst jeho verzi"}
        </Button>
        <Button variant="primary" onClick={() => void proved("prepsat")} disabled={!!ceka}>
          {ceka === "prepsat" ? "Ukládám…" : "Přepsat"}
        </Button>
      </div>
    </Okno>
  );
}

export function KolegaUpravujeDialog({
  jmeno,
  od,
  onPokracovat,
  onZrusit,
}: {
  jmeno: string;
  /** Od kdy kolega upravuje (ISO). */
  od: string;
  onPokracovat: () => void;
  onZrusit: () => void;
}) {
  const cas = casHodiny(od);
  return (
    <Okno nadpisId="kolega-upravuje-nadpis" onZavrit={onZrusit} ceka={false}>
      <div>
        <h2 id="kolega-upravuje-nadpis" style={{ margin: 0, fontSize: 17, fontWeight: 800 }}>Kolega upravuje, pokračovat?</h2>
        <div style={{ fontSize: 14, marginTop: 8, lineHeight: 1.5 }}>
          {kratkeJmeno(jmeno)} má tuhle zakázku otevřenou v úpravách{cas ? ` od ${cas}` : ""}.
        </div>
        <div style={{ color: "var(--muted)", fontSize: 13, marginTop: 8, lineHeight: 1.5 }}>
          Upravovat můžete i tak. Kdo uloží druhý, uvidí, co ten první změnil, a vybere, jestli jeho změny přepíše.
        </div>
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
        <Button variant="ghost" onClick={onZrusit}>Zrušit</Button>
        <Button variant="primary" onClick={onPokracovat} autoFocus>Přesto upravit</Button>
      </div>
    </Okno>
  );
}
