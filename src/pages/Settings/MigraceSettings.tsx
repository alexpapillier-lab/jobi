import { useState } from "react";
import { Button, Card } from "../../components/ui";
import { showToast } from "../../components/Toast";
import { supabase } from "../../lib/supabaseClient";
import { fetchAllPages } from "../../lib/fetchAllPages";
import { normalizePhone } from "../../lib/phone";
import { ImportZakazniku } from "../Customers/ImportZakazniku";
import { ImportZakazek } from "../../components/ImportZakazek";
import { ImportCeniku } from "../../components/ImportCeniku";

/**
 * Nastavení → Migrace z jiného systému: zákazníci, zakázky a ceník z CSV
 * na jednom místě, s návodem, jak data z konkurence dostat ven. Samotné
 * dialogy jsou ty, které se používají i jinde (zákazníci mají tlačítko
 * i na stránce Zákazníci).
 */
export function MigraceSettings({ activeServiceId }: { activeServiceId: string | null }) {
  const [otevreno, setOtevreno] = useState<"zakaznici" | "zakazky" | "cenik" | null>(null);
  const [telefony, setTelefony] = useState<Set<string>>(new Set());
  const [nacitam, setNacitam] = useState(false);

  /* Import zákazníků pozná duplicity podle telefonu – seznam se tahá až po
     kliknutí, ať Nastavení nečtou celý adresář při každém otevření. */
  const otevritZakazniky = async () => {
    if (!activeServiceId || !supabase) return;
    setNacitam(true);
    const r = await fetchAllPages<{ phone: string | null }>((from, to) =>
      (supabase!.from("customers") as any).select("phone").eq("service_id", activeServiceId).range(from, to),
    );
    setNacitam(false);
    if (r.error) {
      showToast("Nepodařilo se načíst stávající zákazníky", "error");
      return;
    }
    setTelefony(new Set(r.data.map((c) => normalizePhone(c.phone)).filter((p): p is string => !!p)));
    setOtevreno("zakaznici");
  };

  const krok: React.CSSProperties = { display: "grid", gap: 4 };
  const nadpis: React.CSSProperties = { fontWeight: 800, fontSize: "var(--text-sm)", color: "var(--text)" };
  const text: React.CSSProperties = { fontSize: "var(--text-sm)", color: "var(--muted)", lineHeight: 1.5 };

  return (
    <>
      <Card>
        <div style={{ marginBottom: "var(--space-3)" }}>
          <div style={{ fontWeight: 900, fontSize: "var(--text-base)", color: "var(--text)" }}>Migrace z jiného systému</div>
          <div style={text}>
            Přechod ze Zakázkového listu, MyRepair nebo z tabulky v Excelu. Všechno jde přes CSV: první řádek jsou názvy sloupců, oddělovač se pozná sám a sloupce jdou před importem přemapovat. Co už v servisu je (telefon zákazníka, číslo zakázky, název v katalogu), se přeskočí – import jde bez obav spustit víckrát.
          </div>
        </div>

        <div style={{ display: "grid", gap: "var(--space-3)" }}>
          <div style={krok}>
            <div style={nadpis}>1. Zákazníci</div>
            <div style={text}>Jméno, telefon, e-mail, firma, adresa. Duplicity se poznají podle telefonu.</div>
            <div><Button variant="soft" size="sm" onClick={() => void otevritZakazniky()} disabled={!activeServiceId || nacitam}>{nacitam ? "Načítám…" : "Importovat zákazníky"}</Button></div>
          </div>
          <div style={krok}>
            <div style={nadpis}>2. Zakázky</div>
            <div style={text}>Číslo, datum přijetí a vydání, stav, zákazník, zařízení, sériové číslo/IMEI, závada, provedené opravy s cenou. Cizí stavy se přiřadí ke stavům servisu (jde upravit); vydané zakázky dostanou datum dokončení, takže sedí ve statistikách.</div>
            <div><Button variant="soft" size="sm" onClick={() => setOtevreno("zakazky")} disabled={!activeServiceId}>Importovat zakázky</Button></div>
          </div>
          <div style={krok}>
            <div style={nadpis}>3. Ceník oprav</div>
            <div style={text}>Značka, kategorie, model, oprava, cena, náklady, čas – jeden řádek na opravu u modelu. Doplní katalog na stránce Zařízení.</div>
            <div><Button variant="soft" size="sm" onClick={() => setOtevreno("cenik")} disabled={!activeServiceId}>Importovat ceník</Button></div>
          </div>
        </div>
      </Card>

      <Card>
        <div style={{ marginBottom: "var(--space-3)" }}>
          <div style={{ fontWeight: 900, fontSize: "var(--text-base)", color: "var(--text)" }}>Jak data dostat z původního systému</div>
        </div>
        <div style={{ display: "grid", gap: "var(--space-3)" }}>
          <div style={krok}>
            <div style={nadpis}>Zakázkový list</div>
            <div style={text}>
              Zakázkový list export zakázek nemá. Připravili jsme nástroj, který se za vás přihlásí do Zakázkového listu na vašem počítači, projde všechny zakázky a reklamace a vyrobí soubory zakazky.csv, zakaznici.csv a cenik.csv přesně pro tenhle import – i s historií stavů a provedenými opravami. Přihlašovací údaje ani data nikam neodchází. Napište nám v Nastavení → Nápověda a podpora → Nahlásit chybu a nástroj vám pošleme i s návodem krok za krokem, nebo migraci spustíme s vámi. Pak stačí soubory nahrát tady v pořadí zákazníci, zakázky, ceník.
            </div>
            <div style={text}>
              Předvolba „Zakázkový list“ v importu zakázek počítá s názvy z detailu zakázky: „Přijetí zařízení do opravy“, „Zakázka vydána“, „Jméno a příjmení“, „Telefonní číslo“, „Zařízení“, „Sériové číslo“, „IMEI“, „Požadovaná oprava“, „Popis stavu zařízení“, „Položky opravy“, „Historie stavů“. Když máte soubor odjinud a sloupce se jmenují jinak, přiřaďte je ručně.
            </div>
          </div>
          <div style={krok}>
            <div style={nadpis}>MyRepair</div>
            <div style={text}>
              Export najdete v přehledu zakázek, zákazníků a v ceníku (CSV nebo Excel). Předvolba „MyRepair“ zkouší běžné názvy: „Číslo zakázky“, „Datum přijetí“, „Datum vydání“, „Stav“, „Zákazník“, „Telefon“, „Zařízení“, „Závada“, „Cena celkem“. Podobu exportu nemáme ověřenou, proto před importem zkontrolujte náhled a přiřazení sloupců.
            </div>
          </div>
          <div style={krok}>
            <div style={nadpis}>Cokoli jiného (Excel, Google Sheets)</div>
            <div style={text}>
              Uložte tabulku jako CSV (UTF-8) s hlavičkou v prvním řádku a zvolte předvolbu „Vlastní“. Provedené opravy jdou zapsat do jednoho sloupce jako „název;cena;náklady|další oprava;cena;náklady“, nebo do samostatných sloupců Oprava / Cena opravy / Náklady (jedna oprava na řádek). Datum ve tvaru 8.12.2022 09:51 nebo 2022-12-08.
            </div>
          </div>
          <div style={text}>Doporučené pořadí: nejdřív zákazníci, pak zakázky, nakonec ceník. Zakázky si zákazníka nesou jménem a telefonem, takže pořadí není povinné.</div>
        </div>
      </Card>

      <ImportZakazniku
        open={otevreno === "zakaznici"}
        onClose={() => setOtevreno(null)}
        activeServiceId={activeServiceId}
        existujiciTelefony={telefony}
        onHotovo={(v) => showToast(v.novych > 0 ? `Založeno ${v.novych} zákazníků` : "Žádný nový zákazník", v.chyb > 0 ? "error" : "success")}
      />
      <ImportZakazek
        open={otevreno === "zakazky"}
        onClose={() => setOtevreno(null)}
        activeServiceId={activeServiceId}
        onHotovo={(v) => showToast(v.novych > 0 ? `Založeno ${v.novych} zakázek` : "Žádná nová zakázka", v.chyb > 0 ? "error" : "success")}
      />
      <ImportCeniku
        open={otevreno === "cenik"}
        onClose={() => setOtevreno(null)}
        activeServiceId={activeServiceId}
        onHotovo={(v) => showToast(v.chyby.length > 0 ? "Import ceníku skončil s chybou" : `Ceník doplněn: ${v.oprav} oprav, ${v.modelu} modelů`, v.chyby.length > 0 ? "error" : "success")}
      />
    </>
  );
}
