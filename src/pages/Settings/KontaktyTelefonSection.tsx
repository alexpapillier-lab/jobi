import { useCallback, useEffect, useState } from "react";
import { Card, FieldLabel, TextInput } from "../../lib/settingsUi";
import { Button } from "../../components/ui";
import { CopyButton } from "../../components/CopyButton";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { showToast } from "../../components/Toast";
import { useAuth } from "../../auth/AuthProvider";
import { reportError } from "../../lib/reportError";
import { stahnoutSoubor } from "../../lib/stahnoutSoubor";
import { KONTAKTY_SERVER, nactiPristupy, profilIphone, vytvorPristup, zrusPristup, type PristupKontakty } from "../../lib/kontaktyTelefon";

/**
 * Nastavení → Můj profil → Zákazníci v telefonu.
 *
 * Každý si vytvoří přístup pro svůj telefon (jméno + heslo jen pro kontakty).
 * Telefon pak zákazníky servisu stahuje přes CardDAV a aktualizuje sám –
 * jen pro čtení. Vlastník a admin vidí přístupy celého týmu a můžou zrušit
 * třeba ztracený telefon (RLS kontakty_pristupy).
 */
export function KontaktyTelefonSection({ serviceId, serviceName }: { serviceId: string | null; serviceName: string }) {
  const { session } = useAuth();
  const mojeId = session?.user?.id ?? null;
  const [pristupy, setPristupy] = useState<PristupKontakty[]>([]);
  const [nazev, setNazev] = useState("");
  const [novy, setNovy] = useState<{ login: string; heslo: string } | null>(null);
  const [pracuje, setPracuje] = useState(false);
  const [zrusit, setZrusit] = useState<PristupKontakty | null>(null);

  const nacti = useCallback(async () => {
    if (!serviceId) return;
    try {
      setPristupy(await nactiPristupy(serviceId));
    } catch (error) {
      reportError({ code: "kontakty.load_failed", error, userMessage: "Přístupy pro telefon se nepodařilo načíst.", source: "KontaktyTelefonSection", serviceId });
    }
  }, [serviceId]);
  useEffect(() => { setNovy(null); void nacti(); }, [nacti]);

  if (!serviceId) return null;

  const pridat = async () => {
    if (pracuje) return;
    setPracuje(true);
    try {
      setNovy(await vytvorPristup(serviceId, nazev));
      setNazev("");
      await nacti();
    } catch (error) {
      reportError({ code: "kontakty.create_failed", error, userMessage: error instanceof Error ? error.message : "Přístup se nepodařilo vytvořit.", source: "KontaktyTelefonSection", serviceId });
    } finally {
      setPracuje(false);
    }
  };

  const radek = (popis: string, hodnota: string, kopie = true) => (
    <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, flexWrap: "wrap" }}>
      <span style={{ color: "var(--muted)", minWidth: 120 }}>{popis}</span>
      <code style={{ fontWeight: 700, fontSize: 14, background: "var(--panel-2)", padding: "2px 8px", borderRadius: 6, userSelect: "all" }}>{hodnota}</code>
      {kopie && <CopyButton value={hodnota} label={popis.toLowerCase()} />}
    </div>
  );
  const datum = (iso: string | null) => (iso ? new Date(iso).toLocaleString("cs-CZ", { day: "numeric", month: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "zatím ne");

  return (
    <Card>
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontWeight: 900, fontSize: 16, color: "var(--text)" }}>Zákazníci v telefonu</div>
        <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 4, maxWidth: 640 }}>
          Zákazníci servisu {serviceName} se objeví v Kontaktech telefonu a aktualizují se sami – i s firmou, adresou a posledními zakázkami
          v poznámce. Když zákazník volá, hned vidíte, kdo to je. Kontakty jsou jen pro čtení, upravují se v Jobi.
        </div>
      </div>

      {novy ? (
        <div style={{ display: "grid", gap: 10, padding: 14, borderRadius: 12, border: "1px solid var(--accent)", background: "var(--accent-soft)", marginBottom: 14 }}>
          <div style={{ fontWeight: 800 }}>Přístup je vytvořený. Heslo se ukáže jen teď – opište ho do telefonu, nebo stáhněte profil.</div>
          {radek("Server", KONTAKTY_SERVER)}
          {radek("Uživatel", novy.login)}
          {radek("Heslo", novy.heslo)}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Button size="sm" variant="primary" onClick={() => stahnoutSoubor(profilIphone({ ...novy, servis: serviceName }), `Jobi-kontakty-${novy.login}.mobileconfig`, "application/x-apple-aspen-config")}>
              Stáhnout profil pro iPhone
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setNovy(null)}>Hotovo</Button>
          </div>
          <div style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.5 }}>
            <b>iPhone (nejjednodušší):</b> otevřete tuhle stránku v Safari na iPhonu, stáhněte profil a v Nastavení → Profil stažen ho nainstalujte.<br />
            <b>iPhone ručně:</b> Nastavení → Kontakty → Účty → Přidat účet → Jiné → Přidat účet CardDAV → Server, Uživatel a Heslo z tabulky výš.<br />
            <b>Android:</b> nainstalujte aplikaci DAVx⁵, přidejte účet „Přihlášení pomocí URL a uživatelského jména“, URL <code>https://{KONTAKTY_SERVER}/carddav/</code>, uživatel a heslo z tabulky.
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap", marginBottom: 14 }}>
          <div style={{ flex: "1 1 220px", minWidth: 0 }}>
            <FieldLabel>Název telefonu</FieldLabel>
            <TextInput value={nazev} onChange={(e) => setNazev(e.target.value)} placeholder="např. iPhone Alex" />
          </div>
          <Button variant="primary" onClick={() => void pridat()} disabled={pracuje}>{pracuje ? "Vytvářím…" : "Přidat telefon"}</Button>
        </div>
      )}

      {pristupy.length > 0 && (
        <div style={{ display: "grid", gap: 6 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", color: "var(--muted)" }}>Připojené telefony</div>
          {pristupy.map((p) => (
            <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", borderRadius: 10, border: "1px solid var(--border)", flexWrap: "wrap" }}>
              <div style={{ flex: "1 1 200px", minWidth: 0 }}>
                <div style={{ fontWeight: 700 }}>{p.nazev || "Telefon"}{p.userId !== mojeId && <span style={{ fontSize: 12, color: "var(--muted)", fontWeight: 500 }}> · kolega</span>}</div>
                <div style={{ fontSize: 12, color: "var(--muted)" }}>{p.login} · naposledy synchronizováno {datum(p.lastUsedAt)}</div>
              </div>
              <Button size="sm" variant="ghost" onClick={() => setZrusit(p)}>Zrušit</Button>
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={!!zrusit}
        title="Zrušit přístup telefonu?"
        message={zrusit ? `Telefon „${zrusit.nazev || zrusit.login}“ přestane dostávat zákazníky a změny. Kontakty, které už v něm jsou, zůstanou, dokud účet v nastavení telefonu neodeberete.` : ""}
        confirmLabel="Zrušit přístup"
        variant="danger"
        onCancel={() => setZrusit(null)}
        onConfirm={async () => {
          const p = zrusit;
          setZrusit(null);
          if (!p) return;
          try {
            await zrusPristup(p.id);
            showToast("Přístup zrušen.", "success");
            await nacti();
          } catch (error) {
            reportError({ code: "kontakty.revoke_failed", error, userMessage: error instanceof Error ? error.message : "Zrušení se nepodařilo.", source: "KontaktyTelefonSection", serviceId });
          }
        }}
      />
    </Card>
  );
}
