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
 * (přihlášený + zaparkovaní), klepnutí na člověka, PIN na číselné
 * klávesnici. Liší se jen tím, že zámek nejde zavřít – odemkne ho jen PIN
 * přihlášeného nebo přepnutí na kolegu.
 *
 * Kdo PIN nemá (nebo ho zapomněl), přihlásí se heslem a PIN si při tom
 * povinně nastaví – heslo se na sdíleném počítači zadává jen jednou.
 *
 * Zámek po nečinnosti se hlídá tady, ne v App: potřebuje vědět, jestli má
 * přihlášený PIN. Bez PINu se nezamyká – zamčená obrazovka bez cesty ven
 * by byla horší než žádný zámek.
 */
type Rezim = "dialog" | "zamek";
type Heslem = { email: string; userId?: string; duvod?: string };

const BEZ_PINU = "Tento účet ještě nemá PIN. Přihlaste se heslem a PIN si rovnou nastavte – příště už stačí ten.";

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
  /* Přihlášení heslem: nový účet (email prázdný) nebo odložený účet bez
     PINu / se zapomenutým PINem (email daný, po přihlášení se z trezoru vyhodí). */
  const [heslem, setHeslem] = useState<Heslem | null>(null);
  const [novyEmail, setNovyEmail] = useState("");
  const [noveHeslo, setNoveHeslo] = useState("");
  const [novyPin, setNovyPin] = useState("");
  const [novyPinZnovu, setNovyPinZnovu] = useState("");
  const pinRef = useRef<HTMLInputElement>(null);

  const nactiPin = useCallback(() => {
    maPin(userId).then(setMamPin).catch(() => setMamPin(null));
  }, [userId]);

  const vynuluj = () => { setVybrany(null); setPin(""); setChyba(null); setHeslem(null); };

  useEffect(() => {
    nactiPin();
    const naZaparkovane = () => setZaparkovane(nactiZaparkovane());
    const otevri = () => { setRezim("dialog"); vynuluj(); };
    const zamkni = () => {
      // Stav PINu se po jeho uložení teprve dotahuje ze serveru; kdo klepne
      // na „Zamknout“ hned po nastavení, nesmí dostat „nejdřív nastavte PIN“.
      const rozhodni = (ma: boolean) => {
        setMamPin(ma);
        if (!ma) {
          showToast("Nejdřív si v Nastavení → Můj účet nastavte PIN, jinak by obrazovka nešla odemknout.", "info");
          return;
        }
        setRezim("zamek"); vynuluj();
      };
      if (mamPin === true) rozhodni(true);
      else maPin(userId).then(rozhodni).catch(() => showToast("Stav PINu se nepodařilo ověřit – zkuste to znovu.", "error"));
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
  }, [nactiPin, mamPin, userId]);

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

  const otevriHeslem = (cil: Heslem) => {
    setHeslem(cil);
    setNovyEmail(cil.email);
    setNoveHeslo("");
    setNovyPin("");
    setNovyPinZnovu("");
    setVybrany(null);
    setPin("");
    setChyba(null);
  };

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
      const zprava = e instanceof Error ? e.message : String(e);
      if (vybrany !== "ja" && zprava.includes("nemá nastavený PIN")) {
        otevriHeslem({ email: vybrany.email ?? "", userId: vybrany.userId, duvod: BEZ_PINU });
        return;
      }
      setChyba(zprava);
      setPin("");
      window.setTimeout(() => pinRef.current?.focus(), 0);
    } finally {
      setPracuje(false);
    }
  }, [vybrany, pracuje, userId, profil]);

  const naZmenuPinu = (hodnota: string) => {
    const cisla = hodnota.replace(/\D/g, "").slice(0, 4);
    setPin(cisla);
    setChyba(null);
    if (cisla.length === 4) void potvrdPin(cisla);
  };

  /* Zaparkovaný účet bez PINu nemá na co čekat – rovnou heslo. Když se stav
     nepodaří zjistit, zkusí se PIN a server řekne „bez_pinu“ sám. */
  const vyberZaparkovaneho = async (u: ZaparkovanyUcet) => {
    const ma = await maPin(u.userId).catch(() => true);
    if (ma) { setVybrany(u); setPin(""); setChyba(null); return; }
    otevriHeslem({ email: u.email ?? "", userId: u.userId, duvod: BEZ_PINU });
  };

  const pridej = async (e: FormEvent) => {
    e.preventDefault();
    if (pracuje || !heslem) return;
    if (!jePlatnyPin(novyPin)) { setChyba("PIN musí mít přesně čtyři číslice."); return; }
    if (novyPin !== novyPinZnovu) { setChyba("PIN se v obou polích neshoduje."); return; }
    setPracuje(true);
    setChyba(null);
    try {
      await pridejUcetHeslem(novyEmail, noveHeslo, profil, novyPin, heslem.userId);
    } catch (err) {
      setChyba(err instanceof Error ? err.message : String(err));
    } finally {
      setPracuje(false);
    }
  };

  if (!rezim) return null;

  const jmeno = profil?.nickname?.trim() || email?.split("@")[0] || "Já";
  const zamek = rezim === "zamek";
  const poleStyl = { padding: "10px 12px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--panel-2)", color: "var(--text)", font: "inherit" } as const;

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

  /* Číselná klávesnice jako na zamčeném telefonu: kulatá tlačítka, čtyři
     tečky nahoře. Skryté textové pole pod ní zůstává kvůli fyzické
     klávesnici (a čtečkám) – obojí píše do stejného PINu. */
  const klavesa = (popisek: string, onClick: () => void, aria?: string, ghost = false) => (
    <button
      key={popisek}
      type="button"
      onClick={onClick}
      disabled={pracuje}
      aria-label={aria ?? popisek}
      style={{
        width: 64, height: 64, borderRadius: "50%", border: ghost ? "none" : "1px solid var(--border)",
        background: ghost ? "transparent" : "var(--panel-2)", color: "var(--text)", fontSize: ghost ? 16 : 24, fontWeight: 600,
        cursor: "pointer", display: "grid", placeItems: "center", font: "inherit", touchAction: "manipulation",
      }}
    >
      {popisek}
    </button>
  );
  const klavesnice = (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 64px)", gap: 12, justifyContent: "center" }}>
      {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((c) => klavesa(c, () => naZmenuPinu(pin + c)))}
      <span />
      {klavesa("0", () => naZmenuPinu(pin + "0"))}
      {klavesa("⌫", () => naZmenuPinu(pin.slice(0, -1)), "Smazat poslední číslici", true)}
    </div>
  );
  const tecky = (
    <div aria-hidden="true" style={{ display: "flex", gap: 14, justifyContent: "center", padding: "4px 0" }}>
      {[0, 1, 2, 3].map((i) => (
        <span key={i} style={{ width: 14, height: 14, borderRadius: "50%", border: "2px solid var(--text)", background: i < pin.length ? "var(--text)" : "transparent", transition: "background 80ms" }} />
      ))}
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

        {!vybrany && !heslem && (
          <div style={{ display: "grid", gap: 8 }}>
            {radek("ja", profil?.nickname ?? null, profil?.avatarUrl ?? null, email, zamek ? (email ?? "přihlášen") : "přihlášen", true, zamek ? () => setVybrany("ja") : null, null)}
            {zaparkovane.filter((u) => u.userId !== userId).map((u) =>
              radek(u.userId, u.nickname, u.avatarUrl, u.email, u.email ?? "přihlášený účet", false, () => { void vyberZaparkovaneho(u); }, zamek ? null : () => odeberZaparkovanyUcet(u.userId))
            )}
            <Button variant="soft" onClick={() => otevriHeslem({ email: "" })}>Přidat účet…</Button>
            {mamPin === false && !zamek && (
              <div style={{ fontSize: 12, color: "var(--muted)" }}>Bez PINu se k vašemu účtu na tomto počítači vrátíte jen heslem – nastavte si ho v Nastavení → Můj účet.</div>
            )}
          </div>
        )}

        {vybrany && (
          <div style={{ display: "grid", gap: 12 }}>
            <div style={{ fontSize: 14, textAlign: "center" }}>
              PIN pro <b>{vybrany === "ja" ? jmeno : vybrany.nickname?.trim() || vybrany.email || "účet"}</b>
            </div>
            {tecky}
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
              style={{ position: "absolute", width: 1, height: 1, opacity: 0, overflow: "hidden", pointerEvents: "none" }}
            />
            {klavesnice}
            <div role="status" aria-live="polite" style={{ minHeight: 18, textAlign: "center", fontSize: 13, color: chyba ? "var(--danger, #c0392b)" : "var(--muted)" }}>
              {chyba ? <span role="alert">{chyba}</span> : pracuje ? "Ověřuji…" : ""}
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "space-between", alignItems: "center" }}>
              <Button variant="ghost" size="sm" onClick={() => { setVybrany(null); setPin(""); setChyba(null); }} disabled={pracuje}>Zpět</Button>
              {vybrany !== "ja" && (
                <button type="button" disabled={pracuje} onClick={() => otevriHeslem({ email: vybrany.email ?? "", userId: vybrany.userId, duvod: "Přihlaste se heslem a nastavte si nový PIN." })} style={{ background: "transparent", border: "none", color: "var(--muted)", cursor: "pointer", fontSize: 12, textDecoration: "underline", font: "inherit" }}>
                  Nevíte PIN? Přihlásit heslem
                </button>
              )}
            </div>
          </div>
        )}

        {heslem && (
          <form onSubmit={pridej} style={{ display: "grid", gap: 10 }}>
            <div style={{ fontSize: 13, color: "var(--muted)" }}>
              {heslem.duvod ?? <>Přihlásí dalšího člověka heslem; <b>{jmeno}</b> zůstane přihlášený a vrátí se PINem.</>}
            </div>
            <input type="email" required autoComplete="username" placeholder="E-mail" value={novyEmail} onChange={(e) => setNovyEmail(e.target.value)} readOnly={!!heslem.userId} disabled={pracuje} aria-label="E-mail" style={{ ...poleStyl, opacity: heslem.userId ? 0.7 : 1 }} />
            <input type="password" required autoComplete="current-password" placeholder="Heslo" value={noveHeslo} onChange={(e) => setNoveHeslo(e.target.value)} disabled={pracuje} aria-label="Heslo" autoFocus={!!heslem.userId} style={poleStyl} />
            <div style={{ fontSize: 12, color: "var(--muted)" }}>Nový PIN pro přepínání na tomto počítači – čtyři číslice, zadejte dvakrát.</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <input type="password" inputMode="numeric" pattern="[0-9]*" maxLength={4} required placeholder="PIN" value={novyPin} onChange={(e) => setNovyPin(e.target.value.replace(/\D/g, ""))} disabled={pracuje} aria-label="Nový PIN" autoComplete="new-password" style={{ ...poleStyl, textAlign: "center", letterSpacing: 8 }} />
              <input type="password" inputMode="numeric" pattern="[0-9]*" maxLength={4} required placeholder="PIN znovu" value={novyPinZnovu} onChange={(e) => setNovyPinZnovu(e.target.value.replace(/\D/g, ""))} disabled={pracuje} aria-label="Nový PIN znovu" autoComplete="new-password" style={{ ...poleStyl, textAlign: "center", letterSpacing: 8 }} />
            </div>
            {chyba && <div role="alert" style={{ color: "var(--danger, #c0392b)", fontSize: 13 }}>{chyba}</div>}
            <div style={{ display: "flex", gap: 8, justifyContent: "space-between" }}>
              <Button variant="ghost" size="sm" type="button" onClick={() => { setHeslem(null); setChyba(null); }} disabled={pracuje}>Zpět</Button>
              <Button variant="primary" size="sm" type="submit" disabled={pracuje || !novyEmail || !noveHeslo || novyPin.length !== 4 || novyPinZnovu.length !== 4}>{pracuje ? "Přihlašuji…" : "Přihlásit a přepnout"}</Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );

  return createPortal(obsah, document.body);
}
