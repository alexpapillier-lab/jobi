import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { useChat } from "../../hooks/useChat";
import { useIsNarrow } from "../../hooks/useIsNarrow";
import {
  KANAL_SERVIS,
  UDALOST_OTEVRIT_CHAT,
  jePlatnyKlic,
  kanalZpravy,
  nahledZpravy,
  zahodNeodeslanou,
  type Kanal,
  type OtevritChatDetail,
  type Zminka,
  type ZpravaChatu,
} from "../../lib/chat";
import { jeZvukZapnuty, nastavZvuk, pozadejOPovoleni } from "../../lib/chatUpozorneni";
import { supabase } from "../../lib/supabaseClient";
import { showToast } from "../Toast";
import { MenuItem } from "../ui";
import { ChevronDownIcon, MailIcon, PinIcon, SearchIcon, XIcon } from "../icons";
import { Avatar, ChatZprava, TextSeZminkami } from "./ChatZprava";
import { ChatPsani, type Predvyplneni } from "./ChatPsani";

/**
 * Plovoucí chat týmu – bublina vpravo dole vedle „+“ a malý panel nad ní,
 * jako Messenger na webu. Aplikace pod panelem zůstává použitelná: žádné
 * zastínění, žádný `aria-modal`, zavírá se jen křížkem. Na úzké obrazovce
 * panel zabere celou obrazovku.
 *
 * Otevření odjinud: `window.dispatchEvent(new CustomEvent("jobi:chat-otevrit",
 * { detail: { kanal?, text?, zminka? } }))` – např. „Sdílet do chatu“
 * z detailu zakázky.
 */

export type ChatPlovouciProps = {
  serviceId: string | null;
  userId: string;
  profil: { nickname: string | null; avatarUrl: string | null } | null;
  /** Modul chatu zapnutý pro servis. Bez něj se nevykreslí nic. */
  zapnuto: boolean;
};

const KLIC_OTEVRENO = "jobi_chat_otevreno";

function nactiOtevreno(): boolean {
  try {
    return localStorage.getItem(KLIC_OTEVRENO) === "1";
  } catch {
    return false;
  }
}

function ulozOtevreno(v: boolean): void {
  try {
    localStorage.setItem(KLIC_OTEVRENO, v ? "1" : "0");
  } catch {
    /* soukromý režim */
  }
}

const hlavickoveTlacitko: CSSProperties = {
  border: "none",
  background: "transparent",
  color: "var(--muted)",
  borderRadius: 8,
  width: 32,
  height: 32,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  cursor: "pointer",
  padding: 0,
  flex: "0 0 auto",
};

function Odznak({ pocet, maly }: { pocet: number; maly?: boolean }) {
  if (pocet <= 0) return null;
  return (
    <span
      aria-hidden="true"
      style={{
        minWidth: maly ? 16 : 20,
        height: maly ? 16 : 20,
        padding: "0 5px",
        borderRadius: 999,
        background: "var(--danger)",
        color: "#fff",
        fontSize: maly ? 10 : 11,
        fontWeight: 800,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        lineHeight: 1,
        boxSizing: "border-box",
      }}
    >
      {pocet > 99 ? "99+" : pocet}
    </span>
  );
}

export function ChatPlovouci({ serviceId, userId, profil, zapnuto }: ChatPlovouciProps) {
  const [otevreno, setOtevrenoState] = useState<boolean>(() => nactiOtevreno());
  const setOtevreno = useCallback((v: boolean) => {
    setOtevrenoState(v);
    ulozOtevreno(v);
  }, []);

  const chat = useChat({ serviceId, userId, zapnuto, otevreno });
  // Stabilní funkce z hooku – objekt `chat` je při každém vykreslení nový,
  // do závislostí efektů patří jen to, co se opravdu mění.
  const { setAktivniKanal, hledat, clen, nactiStarsi: nactiStarsiZHooku } = chat;
  const uzky = useIsNarrow();
  const [vyberKanalu, setVyberKanalu] = useState(false);
  const [hledam, setHledam] = useState(false);
  const [dotaz, setDotaz] = useState("");
  const [vysledky, setVysledky] = useState<{ dotaz: string; zpravy: ZpravaChatu[] } | null>(null);
  const [zvuk, setZvuk] = useState(() => jeZvukZapnuty());
  const [predvyplneni, setPredvyplneni] = useState<Predvyplneni>(null);
  const [fokusPsani, setFokusPsani] = useState(false);
  const seznam = useRef<HTMLDivElement | null>(null);
  const jsemDole = useRef(true);
  const vyberRef = useRef<HTMLDivElement | null>(null);

  const jeSpravce = useMemo(() => {
    const r = clen(userId)?.role;
    return r === "owner" || r === "admin";
  }, [clen, userId]);

  const aktivni = zapnuto && !!serviceId;

  // Otevření odjinud: „Sdílet do chatu“, klik na upozornění.
  useEffect(() => {
    if (!aktivni) return;
    const na = (e: Event) => {
      const d = (e as CustomEvent<OtevritChatDetail>).detail ?? {};
      if (d.kanal && jePlatnyKlic(d.kanal)) setAktivniKanal(d.kanal);
      if (d.text || d.zminka) setPredvyplneni({ text: d.text, zminka: d.zminka });
      setHledam(false);
      setOtevreno(true);
      setFokusPsani(true);
    };
    window.addEventListener(UDALOST_OTEVRIT_CHAT, na);
    return () => window.removeEventListener(UDALOST_OTEVRIT_CHAT, na);
  }, [aktivni, setAktivniKanal, setOtevreno]);

  // O oznámení se žádá až při prvním otevření panelu – ne při načtení aplikace.
  const povoleniZadano = useRef(false);
  useEffect(() => {
    if (!otevreno || !aktivni || povoleniZadano.current) return;
    povoleniZadano.current = true;
    void pozadejOPovoleni();
  }, [otevreno, aktivni]);

  // Fokus do psaní jen jednou po otevření.
  useEffect(() => {
    if (fokusPsani) {
      const t = setTimeout(() => setFokusPsani(false), 50);
      return () => clearTimeout(t);
    }
  }, [fokusPsani]);

  // Posun dolů při nové zprávě, pokud jsem byl dole; při načtení starších držet místo.
  const predchoziPocet = useRef(0);
  const predchoziPrvni = useRef<string | null>(null);
  const vyskaPredNactenim = useRef(0);
  useEffect(() => {
    const el = seznam.current;
    if (!el) return;
    const prvni = chat.zpravy[0]?.id ?? null;
    const pribyloNahore = predchoziPrvni.current && prvni && prvni !== predchoziPrvni.current && chat.zpravy.some((z) => z.id === predchoziPrvni.current);
    if (pribyloNahore) {
      el.scrollTop += el.scrollHeight - vyskaPredNactenim.current;
    } else if (jsemDole.current || predchoziPocet.current === 0) {
      el.scrollTop = el.scrollHeight;
    }
    predchoziPocet.current = chat.zpravy.length;
    predchoziPrvni.current = prvni;
  }, [chat.zpravy]);

  useEffect(() => {
    if (otevreno && seznam.current) {
      seznam.current.scrollTop = seznam.current.scrollHeight;
      jsemDole.current = true;
    }
  }, [otevreno, chat.aktivniKanal]);

  // Zavření výběru kanálu klikem mimo.
  useEffect(() => {
    if (!vyberKanalu) return;
    const na = (e: MouseEvent) => {
      if (vyberRef.current && !vyberRef.current.contains(e.target as Node)) setVyberKanalu(false);
    };
    document.addEventListener("mousedown", na);
    return () => document.removeEventListener("mousedown", na);
  }, [vyberKanalu]);

  // Hledání s prodlevou. Stav drží jen odpověď serveru; co se ukáže,
  // se odvozuje níž (`zobrazeneVysledky`), takže se tu nic nenuluje.
  const hledanyDotaz = hledam ? dotaz.trim() : "";
  useEffect(() => {
    const d = hledanyDotaz;
    if (d.length < 2) return;
    let zivy = true;
    const t = setTimeout(() => {
      void hledat(d)
        .then((v) => {
          if (zivy) setVysledky({ dotaz: d, zpravy: v });
        })
        .catch(() => {
          if (zivy) setVysledky({ dotaz: d, zpravy: [] });
        });
    }, 250);
    return () => {
      zivy = false;
      clearTimeout(t);
    };
  }, [hledanyDotaz, hledat]);
  const zobrazeneVysledky = hledanyDotaz.length >= 2 && vysledky?.dotaz === hledanyDotaz ? vysledky.zpravy : null;

  const prevzit = useCallback(
    async (z: Zminka) => {
      if (!supabase) return;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any).from("tickets").update({ assigned_to: userId }).eq("id", z.id);
      if (error) showToast("Zakázku se nepodařilo převzít", "error");
      else showToast(`Zakázka ${z.popis} je vaše`);
    },
    [userId]
  );

  const nactiStarsi = useCallback(() => {
    if (seznam.current) vyskaPredNactenim.current = seznam.current.scrollHeight;
    void nactiStarsiZHooku();
  }, [nactiStarsiZHooku]);

  const predvyplneniPouzito = useCallback(() => setPredvyplneni(null), []);

  if (!aktivni || !serviceId) return null;

  const aktivniKanalInfo = chat.kanaly.find((k) => k.kanal === chat.aktivniKanal);
  const nazevKanalu = aktivniKanalInfo?.nazev ?? (chat.aktivniKanal === KANAL_SERVIS ? "Servis" : "Chat");
  const skupiny: Array<{ nazev: string; polozky: Kanal[] }> = [
    { nazev: "", polozky: chat.kanaly.filter((k) => k.typ === "servis") },
    { nazev: "Pobočky", polozky: chat.kanaly.filter((k) => k.typ === "pobocka") },
    { nazev: "Lidé", polozky: chat.kanaly.filter((k) => k.typ === "dm") },
  ];

  const jmenoOdesilatele = (id: string) => (id === userId ? profil?.nickname || "Já" : chat.jmeno(id) ?? "Kolega");
  const avatarOdesilatele = (id: string) => (id === userId ? profil?.avatarUrl ?? null : chat.clen(id)?.avatarUrl ?? null);

  const bublinaBottom = uzky ? "calc(var(--bottom-nav-h) + var(--safe-bottom) + 22px)" : 30;

  const bublina = (
    <button
      type="button"
      aria-label={chat.celkemNeprectenych > 0 ? `Chat, ${chat.celkemNeprectenych} nepřečtených` : "Chat"}
      aria-expanded={otevreno}
      title="Chat týmu"
      onClick={() => setOtevreno(!otevreno)}
      data-chat-bublina
      style={{
        position: "fixed",
        right: 92,
        bottom: bublinaBottom,
        width: 44,
        height: 44,
        borderRadius: "50%",
        border: "none",
        background: "var(--accent)",
        color: "var(--accent-fg, #fff)",
        boxShadow: "var(--shadow-soft)",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: "pointer",
        zIndex: 1050,
      }}
    >
      <MailIcon size={20} />
      {chat.celkemNeprectenych > 0 && (
        <span style={{ position: "absolute", top: -4, right: -4 }}>
          <Odznak pocet={chat.celkemNeprectenych} />
        </span>
      )}
    </button>
  );

  const panelStyl: CSSProperties = uzky
    ? { position: "fixed", inset: 0, zIndex: 1150, borderRadius: 0 }
    : {
        position: "fixed",
        right: 24,
        bottom: 86,
        width: 360,
        height: 520,
        maxHeight: "calc(100dvh / var(--ui-scale, 1) - 110px)",
        maxWidth: "calc(100vw - 48px)",
        zIndex: 1090,
        borderRadius: 16,
      };

  const panel = otevreno && (
    <div
      role="complementary"
      aria-label="Chat týmu"
      data-chat-panel
      style={{
        ...panelStyl,
        display: "flex",
        flexDirection: "column",
        background: "var(--panel)",
        border: "1px solid var(--border)",
        boxShadow: "var(--shadow)",
        overflow: "hidden",
        color: "var(--text)",
      }}
    >
      {/* Hlavička */}
      <div style={{ display: "flex", alignItems: "center", gap: 4, padding: "8px 8px 8px 10px", borderBottom: "1px solid var(--border)", position: "relative" }} ref={vyberRef}>
        <button
          type="button"
          aria-label={`Kanál: ${nazevKanalu}. Přepnout kanál`}
          aria-haspopup="listbox"
          aria-expanded={vyberKanalu}
          onClick={() => setVyberKanalu((v) => !v)}
          style={{ display: "flex", alignItems: "center", gap: 8, border: "none", background: "transparent", color: "var(--text)", cursor: "pointer", padding: "4px 6px", borderRadius: 10, minWidth: 0, flex: 1, textAlign: "left" }}
        >
          {aktivniKanalInfo?.typ === "dm" ? <Avatar jmeno={nazevKanalu} url={aktivniKanalInfo.avatarUrl} velikost={26} /> : <MailIcon size={18} color="var(--accent)" />}
          <span style={{ fontWeight: 900, fontSize: 15, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{nazevKanalu}</span>
          <ChevronDownIcon size={14} />
        </button>
        <button type="button" aria-label={hledam ? "Zavřít hledání" : "Hledat ve zprávách"} aria-pressed={hledam} onClick={() => { setHledam((h) => !h); setDotaz(""); }} style={{ ...hlavickoveTlacitko, color: hledam ? "var(--accent)" : hlavickoveTlacitko.color }}>
          <SearchIcon size={17} />
        </button>
        <button
          type="button"
          aria-label={zvuk ? "Vypnout zvuk upozornění" : "Zapnout zvuk upozornění"}
          aria-pressed={zvuk}
          title={zvuk ? "Zvuk zapnutý" : "Zvuk vypnutý"}
          onClick={() => {
            nastavZvuk(!zvuk);
            setZvuk(!zvuk);
          }}
          style={{ ...hlavickoveTlacitko, fontSize: 16, opacity: zvuk ? 1 : 0.55 }}
        >
          {zvuk ? "🔔" : "🔕"}
        </button>
        <button type="button" aria-label="Zavřít chat" onClick={() => setOtevreno(false)} style={hlavickoveTlacitko}>
          <XIcon size={18} />
        </button>

        {vyberKanalu && (
          <div
            role="listbox"
            aria-label="Kanály"
            style={{ position: "absolute", top: "calc(100% + 4px)", left: 8, right: 8, maxHeight: 320, overflowY: "auto", background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 12, boxShadow: "var(--shadow-soft)", padding: 6, zIndex: 3 }}
          >
            {skupiny.map((s) =>
              s.polozky.length === 0 ? null : (
                <div key={s.nazev || "servis"}>
                  {s.nazev && <div style={{ fontSize: "var(--text-xs)", color: "var(--muted)", fontWeight: 800, textTransform: "uppercase", letterSpacing: 0.4, padding: "8px 10px 2px" }}>{s.nazev}</div>}
                  {s.polozky.map((k) => (
                    <MenuItem
                      key={k.kanal}
                      role="option"
                      layout="between"
                      selected={k.kanal === chat.aktivniKanal}
                      onClick={() => {
                        chat.setAktivniKanal(k.kanal);
                        setVyberKanalu(false);
                        setHledam(false);
                      }}
                    >
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                        {k.typ === "dm" ? <Avatar jmeno={k.nazev} url={k.avatarUrl} velikost={22} /> : <MailIcon size={16} />}
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{k.nazev}</span>
                      </span>
                      <Odznak pocet={chat.neprectene[k.kanal] ?? 0} maly />
                    </MenuItem>
                  ))}
                </div>
              )
            )}
          </div>
        )}
      </div>

      {/* Hledání */}
      {hledam && (
        <div style={{ padding: 8, borderBottom: "1px solid var(--border)" }}>
          <input
            autoFocus
            className="ui-input"
            type="search"
            value={dotaz}
            onChange={(e) => setDotaz(e.target.value)}
            placeholder="Hledat ve všech kanálech…"
            aria-label="Hledat ve zprávách"
            style={{ width: "100%", boxSizing: "border-box" }}
          />
        </div>
      )}

      {/* Připnutá zpráva */}
      {!hledam && chat.pripnuta && (
        <div style={{ display: "flex", gap: 8, alignItems: "flex-start", padding: "8px 10px", borderBottom: "1px solid var(--border)", background: "var(--accent-soft)", fontSize: "var(--text-sm)" }}>
          <PinIcon size={14} color="var(--accent)" />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: "var(--text-xs)", color: "var(--muted)", fontWeight: 800 }}>Připnuto · {jmenoOdesilatele(chat.pripnuta.senderId)}</div>
            <div style={{ overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>
              <TextSeZminkami text={chat.pripnuta.text || nahledZpravy(chat.pripnuta)} mentions={chat.pripnuta.mentions} moje={false} />
            </div>
          </div>
          {jeSpravce && (
            <button type="button" aria-label="Odepnout" title="Odepnout" onClick={() => void chat.pripnout(chat.pripnuta!.id, false).catch(() => showToast("Odepnutí se nepovedlo", "error"))} style={{ ...hlavickoveTlacitko, width: 24, height: 24 }}>
              <XIcon size={14} />
            </button>
          )}
        </div>
      )}

      {/* Seznam zpráv / výsledky hledání */}
      <div
        ref={seznam}
        role="log"
        aria-live="polite"
        aria-label={hledam ? "Výsledky hledání" : `Zprávy – ${nazevKanalu}`}
        onScroll={(e) => {
          const el = e.currentTarget;
          jsemDole.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
        style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "8px 10px 12px", display: "flex", flexDirection: "column" }}
      >
        {hledam ? (
          zobrazeneVysledky === null ? (
            <div style={{ color: "var(--muted)", fontSize: "var(--text-sm)", padding: 12, textAlign: "center" }}>{hledanyDotaz.length >= 2 ? "Hledám…" : "Zadejte aspoň dva znaky."}</div>
          ) : zobrazeneVysledky.length === 0 ? (
            <div style={{ color: "var(--muted)", fontSize: "var(--text-sm)", padding: 12, textAlign: "center" }}>Nic nenalezeno.</div>
          ) : (
            zobrazeneVysledky.map((z) => {
              const kanal = kanalZpravy(z, userId);
              const nazev = chat.kanaly.find((k) => k.kanal === kanal)?.nazev ?? "Servis";
              return (
                <button
                  key={z.id}
                  type="button"
                  onClick={() => {
                    chat.setAktivniKanal(kanal);
                    setHledam(false);
                  }}
                  title={`Přejít do kanálu ${nazev}`}
                  style={{ textAlign: "left", border: "1px solid var(--border)", background: "var(--panel-2, var(--panel))", color: "var(--text)", borderRadius: 12, padding: "8px 10px", marginBottom: 6, cursor: "pointer", font: "inherit" }}
                >
                  <div style={{ fontSize: "var(--text-xs)", color: "var(--muted)", fontWeight: 800, marginBottom: 2 }}>
                    {jmenoOdesilatele(z.senderId)} · {nazev}
                  </div>
                  <div style={{ fontSize: "var(--text-sm)", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{nahledZpravy(z, 200)}</div>
                </button>
              );
            })
          )
        ) : (
          <>
            {chat.maStarsi && (
              <button type="button" onClick={nactiStarsi} disabled={chat.nacitamStarsi} className="ui-btn ui-btn--ghost ui-btn--sm" style={{ alignSelf: "center", marginBottom: 6 }}>
                {chat.nacitamStarsi ? "Načítám…" : "Načíst starší"}
              </button>
            )}
            {chat.chyba && <div style={{ color: "var(--danger)", fontSize: "var(--text-sm)", textAlign: "center", padding: 8 }}>{chat.chyba}</div>}
            {chat.nacitam && chat.zpravy.length === 0 && <div style={{ color: "var(--muted)", fontSize: "var(--text-sm)", textAlign: "center", padding: 12 }}>Načítám…</div>}
            {!chat.nacitam && chat.zpravy.length === 0 && !chat.chyba && (
              <div style={{ color: "var(--muted)", fontSize: "var(--text-sm)", textAlign: "center", padding: "24px 12px", margin: "auto 0" }}>
                Zatím žádné zprávy. Napište první – <b>#</b> zmíní zakázku, <b>@</b> kolegu.
              </div>
            )}
            {chat.zpravy.map((z, i) => {
              const predchozi = chat.zpravy[i - 1];
              const pokracovani = !!predchozi && predchozi.senderId === z.senderId && !predchozi.deletedAt && new Date(z.createdAt).getTime() - new Date(predchozi.createdAt).getTime() < 5 * 60_000;
              return (
                <ChatZprava
                  key={z.id}
                  zprava={z}
                  moje={z.senderId === userId}
                  pokracovani={pokracovani}
                  jmeno={jmenoOdesilatele(z.senderId)}
                  avatarUrl={avatarOdesilatele(z.senderId)}
                  userId={userId}
                  jeSpravce={jeSpravce}
                  onReagovat={(zp, e) => void chat.reagovat(zp, e).catch((err: Error) => showToast(err.message, "error"))}
                  onPripnout={(zp) => void chat.pripnout(zp.id, !zp.pinned).catch(() => showToast("Připnutí se nepovedlo", "error"))}
                  onSmazat={(zp) => void chat.smazat(zp.id).catch(() => showToast("Smazání se nepovedlo", "error"))}
                  onPrevzit={(m) => void prevzit(m)}
                  onZahodit={(zp) => zahodNeodeslanou(zp.id)}
                />
              );
            })}
          </>
        )}
      </div>

      {!hledam && (
        <ChatPsani
          serviceId={serviceId}
          clenove={chat.clenove.filter((c) => c.userId !== userId)}
          predvyplneni={predvyplneni}
          onPredvyplneniPouzito={predvyplneniPouzito}
          onOdeslat={(v) => {
            chat.odeslat(v);
            jsemDole.current = true;
          }}
          fokus={fokusPsani}
        />
      )}
    </div>
  );

  if (typeof document === "undefined") return null;
  return createPortal(
    <>
      {(!uzky || !otevreno) && bublina}
      {panel}
    </>,
    document.body
  );
}
