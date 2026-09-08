import { useEffect, useState, type FormEvent } from "react";
import { Card, FieldLabel, TextInput } from "../../lib/settingsUi";
import { Button, SettingRow, SettingRows } from "../../components/ui";
import { showToast } from "../../components/Toast";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { useAuth } from "../../auth/AuthProvider";
import {
  UDALOST_OTEVRIT_PREPINAC, UDALOST_ZAMKNOUT, UDALOST_ZAPARKOVANE, ZAMEK_MOZNOSTI,
  jePlatnyPin, maPin, nactiZaparkovane, nastavPin, nastavZamekPoMinutach, odeberZaparkovanyUcet, zamekPoMinutach,
  type ZaparkovanyUcet,
} from "../../lib/prepinaniUctu";

/**
 * Nastavení → Můj profil → Sdílený počítač: PIN, zámek po nečinnosti,
 * zaparkované účty. PIN patří k účtu (server), zámek a zaparkované účty
 * k tomuhle počítači (localStorage) – u pultu se zamyká, na notebooku
 * majitele ne.
 */
export function SdilenyPocitacSection() {
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;
  const [mamPin, setMamPin] = useState<boolean | null>(null);
  const [pin, setPin] = useState("");
  const [pinZnovu, setPinZnovu] = useState("");
  const [ukladam, setUkladam] = useState(false);
  const [rusim, setRusim] = useState(false);
  const [zamek, setZamek] = useState<number>(() => zamekPoMinutach());
  const [zaparkovane, setZaparkovane] = useState<ZaparkovanyUcet[]>(() => nactiZaparkovane());

  useEffect(() => {
    if (!userId) return;
    maPin(userId).then(setMamPin).catch(() => setMamPin(null));
  }, [userId]);

  useEffect(() => {
    const obnov = () => setZaparkovane(nactiZaparkovane());
    window.addEventListener(UDALOST_ZAPARKOVANE, obnov);
    window.addEventListener("storage", obnov);
    return () => {
      window.removeEventListener(UDALOST_ZAPARKOVANE, obnov);
      window.removeEventListener("storage", obnov);
    };
  }, []);

  const ulozPin = async (e: FormEvent) => {
    e.preventDefault();
    if (!jePlatnyPin(pin)) { showToast("PIN musí mít přesně čtyři číslice.", "error"); return; }
    if (pin !== pinZnovu) { showToast("PIN se v obou polích neshoduje.", "error"); return; }
    setUkladam(true);
    try {
      await nastavPin(pin);
      setMamPin(true);
      setPin("");
      setPinZnovu("");
      showToast("PIN uložen", "success");
    } catch (err) {
      showToast(`PIN se nepodařilo uložit: ${err instanceof Error ? err.message : String(err)}`, "error");
    } finally {
      setUkladam(false);
    }
  };

  const zrusPin = async () => {
    await nastavPin(null);
    setMamPin(false);
    showToast("PIN zrušen", "success");
  };

  const pole = { width: 110, textAlign: "center" as const, letterSpacing: 6 };

  return (
    <>
      <Card>
        <div style={{ fontWeight: 900, fontSize: "var(--text-base)", marginBottom: "var(--space-2)", color: "var(--text)" }}>Sdílený počítač</div>
        <div style={{ fontSize: "var(--text-sm)", color: "var(--muted)", marginBottom: "var(--space-4)" }}>
          Když se u jednoho počítače střídá víc lidí, nemusí se odhlašovat: účty zůstanou přihlášené a přepíná se mezi nimi čtyřmístným PINem.
          Bez PINu se váš účet zaparkovat nedá – nebylo by, jak se k němu vrátit.
        </div>
        <SettingRows>
          <SettingRow
            label="Můj PIN"
            description={mamPin === null ? "Zjišťuji…" : mamPin ? "PIN je nastavený. Zadáním nového ho změníte." : "PIN není nastavený."}
            control={
              <form onSubmit={ulozPin} style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
                <TextInput type="password" inputMode="numeric" pattern="[0-9]*" maxLength={4} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} placeholder="PIN" aria-label="Nový PIN" autoComplete="new-password" style={pole} />
                <TextInput type="password" inputMode="numeric" pattern="[0-9]*" maxLength={4} value={pinZnovu} onChange={(e) => setPinZnovu(e.target.value.replace(/\D/g, ""))} placeholder="Znovu" aria-label="Nový PIN znovu" autoComplete="new-password" style={pole} />
                <Button size="sm" variant="primary" type="submit" disabled={ukladam || !userId || pin.length !== 4 || pinZnovu.length !== 4}>{ukladam ? "Ukládám…" : mamPin ? "Změnit" : "Nastavit"}</Button>
                {mamPin && <Button size="sm" variant="danger" type="button" onClick={() => setRusim(true)}>Zrušit PIN</Button>}
              </form>
            }
          />
          <SettingRow
            label="Zamknout po nečinnosti"
            description="Nastavení tohoto počítače. Po uplynutí se ukáže obrazovka s účty; odemkne ji PIN. Bez nastaveného PINu se nezamyká."
            control={
              <select aria-label="Zamknout po nečinnosti" value={zamek} onChange={(e) => { const n = Number(e.target.value); setZamek(n); nastavZamekPoMinutach(n); }}>
                {ZAMEK_MOZNOSTI.map((m) => <option key={m} value={m}>{m === 0 ? "Vypnuto" : `po ${m} min`}</option>)}
              </select>
            }
          />
          <SettingRow
            label="Přepnout nebo zamknout teď"
            description="Totéž je v nabídce pod vaším jménem v postranním panelu."
            control={
              <span style={{ display: "inline-flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
                <Button size="sm" variant="soft" onClick={() => window.dispatchEvent(new CustomEvent(UDALOST_OTEVRIT_PREPINAC))}>Přepnout účet…</Button>
                <Button size="sm" variant="soft" onClick={() => window.dispatchEvent(new CustomEvent(UDALOST_ZAMKNOUT))} disabled={mamPin !== true} title={mamPin ? undefined : "Nejdřív nastavte PIN"}>Zamknout</Button>
              </span>
            }
          />
        </SettingRows>
        {zaparkovane.filter((u) => u.userId !== userId).length > 0 && (
          <div style={{ marginTop: "var(--space-4)" }}>
            <FieldLabel>Účty zaparkované na tomto počítači</FieldLabel>
            <div style={{ display: "grid", gap: 6 }}>
              {zaparkovane.filter((u) => u.userId !== userId).map((u) => (
                <div key={u.userId} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, padding: "8px 12px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--panel)" }}>
                  <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    <b>{u.nickname?.trim() || u.email?.split("@")[0] || "Účet"}</b>
                    {u.email && <span style={{ color: "var(--muted)" }}> · {u.email}</span>}
                  </span>
                  <Button size="sm" variant="ghost" onClick={() => odeberZaparkovanyUcet(u.userId)} title="Odebrat z tohoto počítače – účet se tím neodhlásí, jen se sem bude muset přihlásit heslem.">Odebrat</Button>
                </div>
              ))}
            </div>
          </div>
        )}
      </Card>
      <ConfirmDialog
        open={rusim}
        title="Zrušit PIN?"
        message="Bez PINu se váš účet nedá zaparkovat ani odemknout – při přepínání se budete muset přihlásit heslem."
        confirmLabel="Zrušit PIN"
        variant="danger"
        onConfirm={async () => { await zrusPin(); setRusim(false); }}
        onCancel={() => setRusim(false)}
      />
    </>
  );
}
