import { useState, type CSSProperties } from "react";
import { EMOJI_REAKCI, formatCasZpravy, inicialy, otevriZminku, rozdelTextPodleZminek, type Zminka, type ZpravaChatu } from "../../lib/chat";
import { PinIcon, TrashIcon, XIcon } from "../icons";
import { ChatPriloha } from "./ChatPriloha";

/**
 * Jedna bublina zprávy: moje vpravo, cizí vlevo se jménem a fotkou.
 *
 * Zmínky se kreslí podle uloženého pole `mentions` (ne regexem – viz
 * lib/chat.ts). Klik na zakázku/zákazníka jde přes `otevriZminku` tamtéž.
 */

export function TextSeZminkami({ text, mentions, moje }: { text: string; mentions: Zminka[]; moje: boolean }) {
  const casti = rozdelTextPodleZminek(text, mentions);
  return (
    <>
      {casti.map((c, i) => {
        if (c.typ === "text") return <span key={i}>{c.text}</span>;
        const klikaci = c.zminka.typ !== "clen";
        const styl: CSSProperties = {
          fontWeight: 700,
          borderRadius: 6,
          padding: "0 3px",
          background: moje ? "rgba(255,255,255,0.18)" : "var(--accent-soft)",
          color: moje ? "inherit" : "var(--accent)",
          cursor: klikaci ? "pointer" : "default",
          textDecoration: "none",
        };
        if (!klikaci) return <span key={i} style={styl}>{c.text}</span>;
        return (
          <button
            key={i}
            type="button"
            onClick={() => otevriZminku(c.zminka)}
            title={c.zminka.typ === "zakazka" ? "Otevřít zakázku" : "Otevřít zákazníka"}
            style={{ ...styl, border: "none", font: "inherit", lineHeight: "inherit", background: styl.background, display: "inline" }}
          >
            {c.text}
          </button>
        );
      })}
    </>
  );
}

export function Avatar({ jmeno, url, velikost = 28 }: { jmeno: string; url: string | null; velikost?: number }) {
  if (url) {
    return <img src={url} alt="" style={{ width: velikost, height: velikost, borderRadius: "50%", objectFit: "cover", flex: "0 0 auto", border: "1px solid var(--border)" }} />;
  }
  return (
    <span
      aria-hidden="true"
      style={{
        width: velikost,
        height: velikost,
        borderRadius: "50%",
        background: "var(--accent-soft)",
        color: "var(--accent)",
        fontSize: velikost * 0.4,
        fontWeight: 800,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        flex: "0 0 auto",
      }}
    >
      {inicialy(jmeno)}
    </span>
  );
}

const ikonTlacitko: CSSProperties = {
  border: "1px solid var(--border)",
  background: "var(--panel)",
  color: "var(--muted)",
  borderRadius: 8,
  width: 26,
  height: 26,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  cursor: "pointer",
  padding: 0,
  fontSize: 14,
  lineHeight: 1,
};

export type ChatZpravaProps = {
  zprava: ZpravaChatu;
  moje: boolean;
  /** Stejný odesílatel jako předchozí zpráva – bez jména a fotky. */
  pokracovani: boolean;
  jmeno: string;
  avatarUrl: string | null;
  userId: string;
  jeSpravce: boolean;
  onReagovat: (z: ZpravaChatu, emoji: string) => void;
  onPripnout: (z: ZpravaChatu) => void;
  onSmazat: (z: ZpravaChatu) => void;
  onPrevzit: (zminka: Zminka) => void;
  onZahodit: (z: ZpravaChatu) => void;
};

export function ChatZprava({ zprava: z, moje, pokracovani, jmeno, avatarUrl, userId, jeSpravce, onReagovat, onPripnout, onSmazat, onPrevzit, onZahodit }: ChatZpravaProps) {
  const [aktivni, setAktivni] = useState(false);
  const [vyberReakce, setVyberReakce] = useState(false);
  const smazana = !!z.deletedAt;
  const cekajici = !!z.stav;
  const zakazky = z.mentions.filter((m) => m.typ === "zakazka");
  const muzuSmazat = !smazana && !cekajici && (moje || jeSpravce);
  const muzuPripnout = !smazana && !cekajici && jeSpravce;

  // Reakce seskupené podle emoji, s tím, jestli jsem mezi nimi.
  const skupiny = new Map<string, { pocet: number; moje: boolean }>();
  for (const r of z.reakce) {
    const s = skupiny.get(r.emoji) ?? { pocet: 0, moje: false };
    s.pocet += 1;
    if (r.userId === userId) s.moje = true;
    skupiny.set(r.emoji, s);
  }

  const barvaTextu = moje ? "var(--accent-fg, #fff)" : "var(--text)";
  const akceViditelne = aktivni || vyberReakce;

  return (
    <div
      onMouseEnter={() => setAktivni(true)}
      onMouseLeave={() => {
        setAktivni(false);
        setVyberReakce(false);
      }}
      onFocus={() => setAktivni(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
          setAktivni(false);
          setVyberReakce(false);
        }
      }}
      style={{ display: "flex", flexDirection: moje ? "row-reverse" : "row", alignItems: "flex-end", gap: 8, marginTop: pokracovani ? 2 : 10, position: "relative" }}
    >
      {!moje && <div style={{ width: 28, flex: "0 0 auto" }}>{!pokracovani && <Avatar jmeno={jmeno} url={avatarUrl} />}</div>}

      <div style={{ display: "flex", flexDirection: "column", alignItems: moje ? "flex-end" : "flex-start", maxWidth: "78%", minWidth: 0 }}>
        {!moje && !pokracovani && <div style={{ fontSize: "var(--text-xs)", color: "var(--muted)", fontWeight: 700, margin: "0 0 2px 4px" }}>{jmeno}</div>}

        <div
          style={{
            padding: "8px 12px",
            borderRadius: 16,
            borderBottomRightRadius: moje ? 5 : 16,
            borderBottomLeftRadius: moje ? 16 : 5,
            background: moje ? "var(--accent)" : "var(--panel-2, var(--panel))",
            color: barvaTextu,
            border: moje ? "none" : "1px solid var(--border)",
            fontSize: 14,
            lineHeight: 1.4,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            opacity: cekajici ? 0.7 : 1,
            outline: z.pinned ? "2px solid var(--warning, #f59e0b)" : "none",
            outlineOffset: 1,
          }}
        >
          {smazana ? (
            <i style={{ opacity: 0.75 }}>Zpráva smazána</i>
          ) : (
            <>
              {z.text && <TextSeZminkami text={z.text} mentions={z.mentions} moje={moje} />}
              {z.attachments.map((p) => (
                <ChatPriloha key={p.path} priloha={p} moje={moje} />
              ))}
            </>
          )}
        </div>

        {!smazana && zakazky.length > 0 && !cekajici && (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 4 }}>
            {zakazky.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => onPrevzit(m)}
                title={`Přiřadit zakázku ${m.popis} sobě`}
                style={{ border: "1px solid var(--accent)", background: "var(--accent-soft)", color: "var(--accent)", borderRadius: 999, padding: "3px 10px", fontSize: "var(--text-xs)", fontWeight: 800, cursor: "pointer" }}
              >
                Přebírám {zakazky.length > 1 ? m.popis : ""}
              </button>
            ))}
          </div>
        )}

        {skupiny.size > 0 && (
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 3 }}>
            {[...skupiny.entries()].map(([emoji, s]) => (
              <button
                key={emoji}
                type="button"
                onClick={() => onReagovat(z, emoji)}
                aria-label={`${emoji} ${s.pocet}${s.moje ? ", vaše reakce" : ""}`}
                aria-pressed={s.moje}
                style={{
                  border: `1px solid ${s.moje ? "var(--accent)" : "var(--border)"}`,
                  background: s.moje ? "var(--accent-soft)" : "var(--panel)",
                  color: "var(--text)",
                  borderRadius: 999,
                  padding: "1px 7px",
                  fontSize: 12,
                  cursor: "pointer",
                  lineHeight: 1.5,
                }}
              >
                {emoji} {s.pocet}
              </button>
            ))}
          </div>
        )}

        <div style={{ fontSize: "var(--text-xs)", color: "var(--muted)", marginTop: 2, display: "flex", gap: 6, alignItems: "center" }}>
          {cekajici ? (
            z.stav === "chyba" ? (
              <>
                <span style={{ color: "var(--danger)" }}>Neodesláno – zkusí se znovu</span>
                <button type="button" onClick={() => onZahodit(z)} style={{ border: "none", background: "none", color: "var(--danger)", cursor: "pointer", padding: 0, textDecoration: "underline", font: "inherit" }}>
                  zahodit
                </button>
              </>
            ) : (
              <span>Odesílá se…</span>
            )
          ) : (
            <>
              <span>{formatCasZpravy(z.createdAt)}</span>
              {z.editedAt && !smazana && <span>· upraveno</span>}
              {z.pinned && !smazana && <span>· připnuto</span>}
            </>
          )}
        </div>
      </div>

      {!smazana && !cekajici && (
        <div
          style={{
            display: "flex",
            gap: 4,
            alignItems: "center",
            alignSelf: "center",
            opacity: akceViditelne ? 1 : 0,
            pointerEvents: akceViditelne ? "auto" : "none",
            transition: "opacity 120ms",
            flex: "0 0 auto",
            position: "relative",
          }}
        >
          {vyberReakce ? (
            <div role="group" aria-label="Vybrat reakci" style={{ display: "flex", gap: 2, background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 999, padding: 2, boxShadow: "var(--shadow-soft)" }}>
              {EMOJI_REAKCI.map((e) => (
                <button
                  key={e}
                  type="button"
                  aria-label={`Reagovat ${e}`}
                  onClick={() => {
                    onReagovat(z, e);
                    setVyberReakce(false);
                  }}
                  style={{ ...ikonTlacitko, border: "none", background: "transparent", fontSize: 16 }}
                >
                  {e}
                </button>
              ))}
              <button type="button" aria-label="Zavřít výběr reakce" onClick={() => setVyberReakce(false)} style={{ ...ikonTlacitko, border: "none", background: "transparent" }}>
                <XIcon size={12} />
              </button>
            </div>
          ) : (
            <>
              <button type="button" aria-label="Reagovat" title="Reagovat" onClick={() => setVyberReakce(true)} style={ikonTlacitko}>
                ☺
              </button>
              {muzuPripnout && (
                <button type="button" aria-label={z.pinned ? "Odepnout zprávu" : "Připnout zprávu"} title={z.pinned ? "Odepnout" : "Připnout"} onClick={() => onPripnout(z)} style={{ ...ikonTlacitko, color: z.pinned ? "var(--accent)" : ikonTlacitko.color }}>
                  <PinIcon size={13} />
                </button>
              )}
              {muzuSmazat && (
                <button type="button" aria-label="Smazat zprávu" title="Smazat" onClick={() => onSmazat(z)} style={{ ...ikonTlacitko, color: "var(--danger)" }}>
                  <TrashIcon size={13} />
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
