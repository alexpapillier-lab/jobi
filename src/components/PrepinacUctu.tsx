import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { Button } from "./ui";
import { showToast } from "./Toast";
import {
  UDALOST_OTEVRIT_PREPINAC, UDALOST_PIN_ZMENEN, UDALOST_ZAMEK_ZMENEN, UDALOST_ZAMKNOUT, UDALOST_ZAPARKOVANE,
  jePlatnyPin, maPin, nactiZaparkovane, odeberZaparkovanyUcet, odemkniAktualni, prepniNaUcet, pridejUcetHeslem,
  zamekPoMinutach, type ZaparkovanyUcet,
} from "../lib/prepinaniUctu";

/**
 * Přepínač účtů a zámek obrazovky na sdíleném počítači.
 *
 * Jedna komponenta pro obě situace, protože vypadají stejně: seznam lidí
 * (přihlášený + zaparkovaní), klepnutí na člověka, PIN. Liší se jen tím,
 * že zámek nejde zavřít – odemkne ho jen PIN přihlášeného nebo přepnutí
 * na kolegu.
 *
 * Zámek po nečinnosti se hlídá tady, ne v App: potřebuje vědět, jestli má
 * přihlášený PIN. Bez PINu se nezamyká – zamčená obrazovka bez cesty ven
 * by byla horší než žádný zámek.
 */
type Rezim = "dialog" | "zamek";

export function PrepinacUctu({ userId, email, profil }: {
  userId: string;
  email: string | null;
  profil: { nickname: string | null; avatarUrl: string | null } | null;
}) {
  const [rezim, setRezim] = useState<Rezim | null>(null);
  const [zaparkovane, setZaparkovane] = useState<ZaparkovanyUcet[]>(() => nactiZaparkovane());
  const [mamPin, setMamPin] = useState<boolean | null>(null);
  const [vybrany, setVybrany] = useState<ZaparkovanyUcet | "ja" | null>(null);
  const [pin, setPin] = useState("");
  const [chyba, setChyba] = useState<string | null>(null);
  const [pracuje, setPracuje] = useState(false);
  const [pridavam, setPridavam] = useState(false);
  const [novyEmail, setNovyEmail] = useState("");
  const [noveHeslo, setNoveHeslo] = useState("");
  const pinRef = useRef<HTMLInputElement>(null);

  const nactiPin = useCallback(() => {
    maPin(userId).then(setMamPin).catch(() => setMamPin(null));
  }, [userId]);

  useEffect(() => {
    nactiPin();
    const naZaparkovane = () => setZaparkovane(nactiZaparkovane());
    const otevri = () => { setRezim("dialog"); setVybrany(null); setPin(""); setChyba(null); setPridavam(false); };
    const zamkni = () => {
      if (mamPin === false) {
        showToast("Nejdřív si v Nastavení → Můj profil nastavte PIN, jinak by obrazovka nešla odemknout.", "info");
        return;
      }
      setRezim("zamek"); setVybrany(null); setPin(""); setChyba(null); setPridavam(false);
    };
    window.addEventListener(UDALOST_ZAPARKOVANE, naZaparkovane);
    window.addEventListener("storage", naZaparkovane);
    window.addEventListener(UDALOST_PIN_ZMENEN, nactiPin);
    window.addEventListener(UDALOST_OTEVRIT_PREPINAC, otevri);
    window.addEventListener(UDALOST_ZAMKNOUT, zamkni);
    return () => {
      window.removeEventListener(UDALOST_ZAPARKOVANE, naZaparkovane);
      window.removeEventListener("storage", naZaparkovane);
      window.removeEventListener(UDALOST_PIN_ZMENEN, nactiPin);
      window.removeEventListener(UDALOST_OTEVRIT_PREPINAC, otevri);
      window.removeEventListener(UDALOST_ZAMKNOUT, zamkni);
    };
  }, [nactiPin, mamPin]);

  /* Zámek po nečinnosti. Časovač se natahuje při každé aktivitě; pohyb myši
     se bere nejvýš jednou za sekundu, ať se neobnovuje stokrát za vteřinu. */
  useEffect(() => {
    let minut = zamekPoMinutach();
    let casovac: number | null = null;
    let posledni = 0;
    const naplanuj = () => {
      if (casovac) window.clearTimeout(casovac);
      casovac = null;
      if (minut <= 0 || mamPin !== true) return;
      casovac = window.setTimeout(() => window.dispatchEvent(new CustomEvent(UDALOST_ZAMKNOUT)), minut * 60_000);
    };
    const aktivita = () => {
      const ted = Date.now();
      if (ted - posledni < 1000) return;
      posledni = ted;
      naplanuj();
    };
    const zmenaNastaveni = () => { minut = zamekPoMinutach(); naplanuj(); };
    naplanuj();
    for (const u of ["pointerdown", "keydown", "mousemove", "touchstart", "wheel"]) window.addEventListener(u, aktivita, { passive: true });
    window.addEventListener(UDALOST_ZAMEK_ZMENEN, zmenaNastaveni);
    return () => {
      if (casovac) window.clearTimeout(casovac);
      for (const u of ["pointerdown", "keydown", "mousemove", "touchstart", "wheel"]) window.removeEventListener(u, aktivita);
      window.removeEventListener(UDALOST_ZAMEK_ZMENEN, zmenaNastaveni);
    };
  }, [mamPin]);

  useEffect(() => {
    if (vybrany) window.setTimeout(() => pinRef.current?.focus(), 0);
  }, [vybrany]);

  const zavri = useCallback(() => {
    if (rezim === "zamek") return;
    setRezim(null);
  }, [rezim]);

  useEffect(() => {
    if (!rezim) return;
    const naKlavesu = (e: KeyboardEvent) => { if (e.key === "Escape") zavri(); };
    window.addEventListener("keydown", naKlavesu);
    return () => window.removeEventListener("keydown", naKlavesu);
  }, [rezim, zavri]);

  const potvrdPin = useCallback(async (hodnota: string) => {
    if (!vybrany || !jePlatnyPin(hodnota) || pracuje) return;
    setPracuje(true);
    setChyba(null);
    try {
      if (vybrany === "ja") {
        await odemkniAktualni(userId, hodnota);
        setRezim(null);
      } else {
        await prepniNaUcet(vybrany, hodnota, profil);
        // Stránka se znovu načítá – nic dalšího.
      }
    } catch (e) {
      setChyba(e instanceof Error ? e.message : String(e));
      setPin("");
      window.setTimeout(() => pinRef.current?.focus(), 0);
    } finally {
      setPracuje(false);
    }
  }, [vybrany, pracuje, userId, profil]);

  const naZmenuPinu = (hodnota: string) => {
    const cisla = hodnota.replace(/\D/g, "").slice(0, 4);
    setPin(cisla);
    if (cisla.length === 4) void potvrdPin(cisla);
  };

  const pridej = async (e: FormEvent) => {
    e.preventDefault();
    if (pracuje) return;
    setPracuje(true);
    setChyba(null);
    try {
      await pridejUcetHeslem(novyEmail, noveHeslo, profil);
    } catch (err) {
      setChyba(err instanceof Error ? err.message : String(err));
    } finally {
      setPracuje(false);
    }
  };

  if (!rezim) return null;

  const jmeno = profil?.nickname?.trim() || email?.split("@")[0] || "Já";
  const zamek = rezim === "zamek";

  const avatar = (nick: string | null, url: string | null, mail: string | null) => {
    const text = (nick?.trim() || mail?.split("@")[0] || "?").trim();
    return url ? (
      <img src={url} alt="" style={{ width: 40, height: 40, borderRadius: "50%", objectFit: "cover" }} />
    ) : (
      <span style={{ width: 40, height: 40, borderRadius: "50%", background: "var(--accent-soft)", color: "var(--accent)", display: "grid", placeItems: "center", fontWeight: 800 }}>
        {text.slice(0, 2).toUpperCase()}
      </span>
    );
  };

  const radek = (klic: string, nick: string | null, url: string | null, mail: string | null, popis: string, aktivni: boolean, onClick: (() => void) | null, onOdebrat: (() => void) | null) => (
    <div key={klic} style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <button
        type="button"
        onClick={onClick ?? undefined}
        disabled={!onClick}
        style={{
          flex: 1, display: "flex", alignItems: "center", gap: 12, padding: "10px 12px", borderRadius: 12,
          border: aktivni ? "2px solid var(--accent)" : "1px solid var(--border)", background: "var(--panel)",
          color: "var(--text)", cursor: onClick ? "pointer" : "default", textAlign: "left", font: "inherit",
        }}
      >
        {avatar(nick, url, mail)}
        <span style={{ display: "grid", gap: 2, minWidth: 0 }}>
          <b style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{nick?.trim() || mail?.split("@")[0] || "Účet"}</b>
          <span style={{ fontSize: 12, color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{popis}</span>
        </span>
      </button>
      {onOdebrat && (
        <button type="button" onClick={onOdebrat} aria-label="Odebrat z tohoto počítače" title="Odebrat z tohoto počítače" style={{ background: "transparent", border: "none", color: "var(--muted)", cursor: "pointer", fontSize: 18 }}>×</button>
      )}
    </div>
  );

  const obsah = (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={zamek ? "Obrazovka je zamčená" : "Přepnout účet"}
      data-prepinac-uctu={rezim}
      onClick={(e) => { if (e.target === e.currentTarget) zavri(); }}
      style={{
        position: "fixed", inset: 0, zIndex: 5000, display: "grid", placeItems: "center", padding: 16,
        background: zamek ? "var(--bg)" : "rgba(0,0,0,0.45)", backdropFilter: zamek ? undefined : "blur(4px)",
      }}
    >
      <div style={{ width: "min(420px, 100%)", background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 16, boxShadow: "var(--shadow-soft)", padding: 20, display: "grid", gap: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
          <div style={{ fontWeight: 900, fontSize: 18 }}>{zamek ? "Kdo pokračuje?" : "Přepnout účet"}</div>
          {!zamek && <Button size="sm" variant="ghost" onClick={zavri} aria-label="Zavřít">✕</Button>}
        </div>

        {!vybrany && !pridavam && (
          <div style={{ display: "grid", gap: 8 }}>
            {radek("ja", profil?.nickname ?? null, profil?.avatarUrl ?? null, email, zamek ? (email ?? "přihlášen") : "přihlášen", true, zamek ? () => setVybrany("ja") : null, null)}
            {zaparkovane.filter((u) => u.userId !== userId).map((u) =>
              radek(u.userId, u.nickname, u.avatarUrl, u.email, u.email ?? "zaparkovaný účet", false, () => setVybrany(u), zamek ? null : () => odeberZaparkovanyUcet(u.userId))
            )}
            <Button variant="soft" onClick={() => { setPridavam(true); setChyba(null); }}>Přidat účet…</Button>
            {mamPin === false && !zamek && (
              <div style={{ fontSize: 12, color: "var(--muted)" }}>Abyste se mohli k tomuto účtu vrátit, nastavte si nejdřív PIN v Nastavení → Můj profil.</div>
            )}
          </div>
        )}

        {vybrany && (
          <div style={{ display: "grid", gap: 10 }}>
            <div style={{ fontSize: 14 }}>
              PIN pro <b>{vybrany === "ja" ? jmeno : vybrany.nickname?.trim() || vybrany.email || "účet"}</b>
            </div>
            <input
              ref={pinRef}
              type="password"
              inputMode="numeric"
              pattern="[0-9]*"
              autoComplete="one-time-code"
              maxLength={4}
              value={pin}
              disabled={pracuje}
              onChange={(e) => naZmenuPinu(e.target.value)}
              aria-label="PIN"
              style={{ fontSize: 28, letterSpacing: 12, textAlign: "center", padding: "10px 12px", borderRadius: 12, border: "1px solid var(--border)", background: "var(--panel-2)", color: "var(--text)", width: "100%", boxSizing: "border-box" }}
            />
            {chyba && <div role="alert" style={{ color: "var(--danger, #c0392b)", fontSize: 13 }}>{chyba}</div>}
            <div style={{ display: "flex", gap: 8, justifyContent: "space-between" }}>
              <Button variant="ghost" size="sm" onClick={() => { setVybrany(null); setPin(""); setChyba(null); }} disabled={pracuje}>Zpět</Button>
              <span style={{ fontSize: 12, color: "var(--muted)", alignSelf: "center" }}>{pracuje ? "Ověřuji…" : "Čtyři číslice"}</span>
            </div>
          </div>
        )}

        {pridavam && (
          <form onSubmit={pridej} style={{ display: "grid", gap: 10 }}>
            <div style={{ fontSize: 13, color: "var(--muted)" }}>
              Přihlásí dalšího člověka heslem; <b>{jmeno}</b> zůstane zaparkovaný a vrátí se PINem.
            </div>
            <input type="email" required autoComplete="username" placeholder="E-mail" value={novyEmail} onChange={(e) => setNovyEmail(e.target.value)} disabled={pracuje} aria-label="E-mail" style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--panel-2)", color: "var(--text)" }} />
            <input type="password" required autoComplete="current-password" placeholder="Heslo" value={noveHeslo} onChange={(e) => setNoveHeslo(e.target.value)} disabled={pracuje} aria-label="Heslo" style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--panel-2)", color: "var(--text)" }} />
            {chyba && <div role="alert" style={{ color: "var(--danger, #c0392b)", fontSize: 13 }}>{chyba}</div>}
            <div style={{ display: "flex", gap: 8, justifyContent: "space-between" }}>
              <Button variant="ghost" size="sm" type="button" onClick={() => { setPridavam(false); setChyba(null); }} disabled={pracuje}>Zpět</Button>
              <Button variant="primary" size="sm" type="submit" disabled={pracuje || !novyEmail || !noveHeslo}>{pracuje ? "Přihlašuji…" : "Přihlásit a přepnout"}</Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );

  return createPortal(obsah, document.body);
}
