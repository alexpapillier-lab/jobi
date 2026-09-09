import { useCallback, useEffect, useRef, useState, type ClipboardEvent, type CSSProperties, type KeyboardEvent } from "react";
import { nahrajPrilohu, najdiRozepsanouZminku, napovezZminky, vlozZminku, zminkyVTextu, type NapovedaZminky, type PrilohaChatu, type RozepsanaZminka, type Zminka } from "../../lib/chat";
import type { ClenServisu } from "../../hooks/useClenoveServisu";
import { showToast } from "../Toast";
import { XIcon } from "../icons";
import { Avatar } from "./ChatZprava";

/**
 * Psaní zprávy: Enter odešle, Shift+Enter nový řádek. Po `#` našeptává
 * zakázky (kód i jméno zákazníka) a zákazníky, po `@` kolegy. Výběr
 * vloží text zmínky a zapamatuje si {typ, id, popis} – to se pošle ve
 * sloupci `mentions`. Kdo zmínku z textu zase smaže, nepošle ji ani
 * v poli (viz `zminkyVTextu`).
 */

export type Predvyplneni = { text?: string; zminka?: Zminka } | null;

type Polozka = NapovedaZminky;

export type ChatPsaniProps = {
  serviceId: string;
  clenove: ClenServisu[];
  predvyplneni: Predvyplneni;
  onPredvyplneniPouzito: () => void;
  onOdeslat: (v: { text: string; mentions: Zminka[]; attachments: PrilohaChatu[] }) => void;
  /** Panel se právě otevřel – dát fokus do pole. */
  fokus: boolean;
};

export function ChatPsani({ serviceId, clenove, predvyplneni, onPredvyplneniPouzito, onOdeslat, fokus }: ChatPsaniProps) {
  const [text, setText] = useState("");
  const [mentions, setMentions] = useState<Zminka[]>([]);
  const [prilohy, setPrilohy] = useState<PrilohaChatu[]>([]);
  const [nahravam, setNahravam] = useState(0);
  const [rozepsana, setRozepsana] = useState<RozepsanaZminka | null>(null);
  const [polozky, setPolozky] = useState<Polozka[]>([]);
  const [vybrano, setVybrano] = useState(0);
  /** Poloha `#`/`@`, u které uživatel našeptávač zavřel – neotvírat znovu. */
  const potlacenoOd = useRef<number | null>(null);
  const pole = useRef<HTMLTextAreaElement | null>(null);
  const soubor = useRef<HTMLInputElement | null>(null);
  const kurzorPoVlozeni = useRef<number | null>(null);
  const hledani = useRef(0);

  // Předvyplnění z jiného místa aplikace („Sdílet do chatu“).
  useEffect(() => {
    if (!predvyplneni) return;
    if (predvyplneni.text) {
      setText((t) => (t.trim() ? `${t.replace(/\s+$/, "")}\n${predvyplneni.text}` : predvyplneni.text ?? ""));
    }
    if (predvyplneni.zminka) setMentions((m) => [...m.filter((x) => !(x.typ === predvyplneni.zminka!.typ && x.id === predvyplneni.zminka!.id)), predvyplneni.zminka!]);
    onPredvyplneniPouzito();
    // Kurzor na konec, ať se hned píše dál.
    kurzorPoVlozeni.current = -1;
  }, [predvyplneni, onPredvyplneniPouzito]);

  useEffect(() => {
    if (fokus) pole.current?.focus();
  }, [fokus]);

  useEffect(() => {
    const k = kurzorPoVlozeni.current;
    if (k === null || !pole.current) return;
    kurzorPoVlozeni.current = null;
    const p = k < 0 ? pole.current.value.length : k;
    pole.current.focus();
    pole.current.setSelectionRange(p, p);
  }, [text]);

  const zavriNapovedu = useCallback(() => {
    setRozepsana(null);
    setPolozky([]);
  }, []);

  /* Podle textu a kurzoru rozhodne, jestli je rozepsaná zmínka, a načte nabídku. */
  const prepocitejNapovedu = useCallback(
    (t: string, kurzor: number) => {
      const r = najdiRozepsanouZminku(t, kurzor);
      if (!r || potlacenoOd.current === r.od) {
        if (r === null) potlacenoOd.current = null;
        zavriNapovedu();
        return;
      }
      setRozepsana(r);
      setVybrano(0);
      if (r.znak === "@") {
        const d = r.dotaz.toLowerCase();
        setPolozky(clenove.filter((c) => c.jmeno.toLowerCase().includes(d)).slice(0, 8).map((c) => ({ typ: "clen", id: c.userId, popis: c.jmeno, detail: "" })));
        return;
      }
      // Krátká prodleva, ať se při psaní neptá databáze na každé písmeno;
      // zastaralou odpověď pozná čítač `hledani`.
      const id = ++hledani.current;
      setTimeout(() => {
        void napovezZminky(serviceId, r.dotaz)
          .then((v) => {
            if (id === hledani.current) setPolozky(v);
          })
          .catch(() => {
            if (id === hledani.current) setPolozky([]);
          });
      }, 180);
    },
    [clenove, serviceId, zavriNapovedu]
  );

  const vyber = useCallback(
    (p: Polozka) => {
      if (!rozepsana || !pole.current) return;
      const kurzor = pole.current.selectionStart ?? text.length;
      const zminka: Zminka = { typ: p.typ, id: p.id, popis: p.popis };
      const v = vlozZminku(text, rozepsana, zminka, kurzor);
      setText(v.text);
      setMentions((m) => [...m.filter((x) => !(x.typ === zminka.typ && x.id === zminka.id)), zminka]);
      kurzorPoVlozeni.current = v.kurzor;
      potlacenoOd.current = null;
      zavriNapovedu();
    },
    [rozepsana, text, zavriNapovedu]
  );

  const odesli = useCallback(() => {
    const t = text.trim();
    if ((!t && prilohy.length === 0) || nahravam > 0) return;
    onOdeslat({ text: t, mentions: zminkyVTextu(t, mentions), attachments: prilohy });
    setText("");
    setMentions([]);
    setPrilohy([]);
    zavriNapovedu();
    potlacenoOd.current = null;
  }, [text, prilohy, nahravam, mentions, onOdeslat, zavriNapovedu]);

  const naKlavesu = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    const otevreno = rozepsana !== null && polozky.length > 0;
    if (otevreno) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setVybrano((i) => (i + 1) % polozky.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setVybrano((i) => (i - 1 + polozky.length) % polozky.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        vyber(polozky[vybrano] ?? polozky[0]);
        return;
      }
    }
    if (e.key === "Escape" && rozepsana) {
      e.preventDefault();
      potlacenoOd.current = rozepsana.od;
      zavriNapovedu();
      return;
    }
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      odesli();
    }
  };

  const nahraj = useCallback(
    async (soubory: File[]) => {
      for (const f of soubory) {
        setNahravam((n) => n + 1);
        try {
          const p = await nahrajPrilohu(serviceId, f);
          setPrilohy((prev) => [...prev, p]);
        } catch (e) {
          showToast(e instanceof Error ? e.message : "Přílohu se nepodařilo nahrát", "error");
        } finally {
          setNahravam((n) => n - 1);
        }
      }
    },
    [serviceId]
  );

  const naVlozeni = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const soubory = Array.from(e.clipboardData?.files ?? []).filter((f) => f.type.startsWith("image/") || f.type === "application/pdf");
    if (soubory.length === 0) return;
    e.preventDefault();
    void nahraj(soubory);
  };

  const otevreno = rozepsana !== null && polozky.length > 0;
  const zakazky = polozky.filter((p) => p.typ === "zakazka");
  const zakaznici = polozky.filter((p) => p.typ === "zakaznik");
  const lide = polozky.filter((p) => p.typ === "clen");

  const radekPolozky = (p: Polozka) => {
    const i = polozky.indexOf(p);
    const clen = p.typ === "clen" ? clenove.find((c) => c.userId === p.id) : null;
    return (
      <button
        key={`${p.typ}:${p.id}`}
        type="button"
        role="option"
        aria-selected={i === vybrano}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => vyber(p)}
        onMouseEnter={() => setVybrano(i)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          width: "100%",
          textAlign: "left",
          border: "none",
          background: i === vybrano ? "var(--accent-soft)" : "transparent",
          color: "var(--text)",
          padding: "6px 10px",
          cursor: "pointer",
          fontSize: "var(--text-sm)",
          borderRadius: 8,
        }}
      >
        {clen ? <Avatar jmeno={clen.jmeno} url={clen.avatarUrl} velikost={22} /> : <span style={{ color: "var(--muted)", width: 22, textAlign: "center", fontWeight: 800 }}>#</span>}
        <span style={{ fontWeight: 700, whiteSpace: "nowrap" }}>{p.popis}</span>
        {p.detail && <span style={{ color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>{p.detail}</span>}
      </button>
    );
  };

  const skupina = (nazev: string, s: Polozka[]) =>
    s.length > 0 && (
      <div key={nazev}>
        <div style={{ fontSize: "var(--text-xs)", color: "var(--muted)", fontWeight: 800, textTransform: "uppercase", letterSpacing: 0.4, padding: "6px 10px 2px" }}>{nazev}</div>
        {s.map(radekPolozky)}
      </div>
    );

  return (
    <div style={{ position: "relative", borderTop: "1px solid var(--border)", padding: 8, display: "grid", gap: 6, background: "var(--panel)" }}>
      {otevreno && (
        <div
          role="listbox"
          aria-label="Návrhy zmínek"
          style={{
            position: "absolute",
            left: 8,
            right: 8,
            bottom: "calc(100% + 4px)",
            maxHeight: 260,
            overflowY: "auto",
            background: "var(--panel)",
            border: "1px solid var(--border)",
            borderRadius: 12,
            boxShadow: "var(--shadow-soft)",
            padding: 4,
            zIndex: 2,
          }}
        >
          {skupina("Zakázky", zakazky)}
          {skupina("Zákazníci", zakaznici)}
          {skupina("Lidé", lide)}
        </div>
      )}

      {(prilohy.length > 0 || nahravam > 0) && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {prilohy.map((p) => (
            <span key={p.path} style={{ display: "inline-flex", alignItems: "center", gap: 6, border: "1px solid var(--border)", borderRadius: 999, padding: "3px 6px 3px 10px", fontSize: "var(--text-xs)", color: "var(--text)", background: "var(--panel-2, var(--panel))", maxWidth: "100%" }}>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</span>
              <button type="button" aria-label={`Odebrat přílohu ${p.name}`} onClick={() => setPrilohy((prev) => prev.filter((x) => x.path !== p.path))} style={{ border: "none", background: "none", color: "var(--muted)", cursor: "pointer", padding: 2, display: "inline-flex" }}>
                <XIcon size={12} />
              </button>
            </span>
          ))}
          {nahravam > 0 && <span style={{ fontSize: "var(--text-xs)", color: "var(--muted)", alignSelf: "center" }}>Nahrává se…</span>}
        </div>
      )}

      <div style={{ display: "flex", gap: 6, alignItems: "flex-end" }}>
        <input
          ref={soubor}
          type="file"
          accept="image/*,application/pdf"
          multiple
          hidden
          onChange={(e) => {
            const s = Array.from(e.target.files ?? []);
            e.target.value = "";
            if (s.length > 0) void nahraj(s);
          }}
        />
        <button
          type="button"
          aria-label="Přiložit soubor"
          title="Přiložit obrázek nebo PDF (max 15 MB)"
          onClick={() => soubor.current?.click()}
          style={{ border: "1px solid var(--border)", background: "var(--panel)", color: "var(--muted)", borderRadius: 10, width: 36, height: 36, display: "inline-flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flex: "0 0 auto", fontSize: 18 }}
        >
          📎
        </button>
        <textarea
          ref={pole}
          value={text}
          rows={1}
          placeholder="Napište zprávu… (# zakázka, @ kolega)"
          aria-label="Text zprávy"
          aria-autocomplete="list"
          aria-expanded={otevreno}
          onChange={(e) => {
            setText(e.target.value);
            prepocitejNapovedu(e.target.value, e.target.selectionStart ?? e.target.value.length);
          }}
          onKeyDown={naKlavesu}
          onPaste={naVlozeni}
          onClick={(e) => prepocitejNapovedu(text, e.currentTarget.selectionStart ?? text.length)}
          onBlur={() => setTimeout(zavriNapovedu, 120)}
          style={{
            flex: 1,
            minWidth: 0,
            resize: "none",
            minHeight: 36,
            maxHeight: 120,
            padding: "8px 10px",
            borderRadius: 10,
            border: "1px solid var(--border)",
            background: "var(--panel-2, var(--panel))",
            color: "var(--text)",
            font: "inherit",
            fontSize: 14,
            lineHeight: 1.35,
            outline: "none",
            fieldSizing: "content",
          } as CSSProperties}
        />
        <button
          type="button"
          aria-label="Odeslat zprávu"
          title="Odeslat (Enter)"
          onClick={odesli}
          disabled={(!text.trim() && prilohy.length === 0) || nahravam > 0}
          style={{
            border: "none",
            background: "var(--accent)",
            color: "var(--accent-fg, #fff)",
            borderRadius: 10,
            width: 36,
            height: 36,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
            flex: "0 0 auto",
            opacity: (!text.trim() && prilohy.length === 0) || nahravam > 0 ? 0.5 : 1,
          }}
        >
          <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M22 2L11 13M22 2l-7 20-4-9-9-4z" />
          </svg>
        </button>
      </div>
    </div>
  );
}
