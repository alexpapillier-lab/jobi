import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Button, PageHeader, Segmented } from "../components/ui";
import { StatusBadge } from "../components/tickets/StatusBadge";
import { useStatuses } from "../state/StatusesStore";
import { useAuth } from "../auth/AuthProvider";
import { useBranches, filterByBranch } from "../context/BranchContext";
import { useClenoveServisu } from "../hooks/useClenoveServisu";
import { useChatZapnuty } from "../hooks/useChatZapnuty";
import { otevriChat } from "../lib/chat";
import type { Rezervace } from "../lib/rezervace";
import {
  dnuOd,
  jeDnes,
  mapujRezervaciDnes,
  roztridDnes,
  rozpoznejRoleStavu,
  vychoziRozsah,
  type RozsahDnes,
  type ZakazkaDnes,
} from "../lib/dnes";
import { RadekSekce, SekceKarta, type TonSekce } from "./Dnes/SekceKarta";
import { useDnesData, usePridelovaniTechnika } from "./Dnes/useDnesData";
import { nactiRozsahDnes, ulozRozsahDnes } from "./Dnes/predvolby";

/**
 * Dnes – jedna obrazovka pro technika bez klikání.
 *
 * Po termínu, dnešní termíny, rezervace na dnešek, co je připravené
 * k převzetí, co čeká na díl nebo na zákazníka, co mám přidělené
 * a nepřečtené zprávy v chatu. Jak se zakázky do sekcí třídí, je
 * v `src/lib/dnes.ts` (i s testem); tady je jen vykreslení.
 *
 * Každý řádek otevře detail zakázky událostí `jobsheet:navigate`
 * (`page: "orders"`, `openTicketId`, `returnToPage: "dnes"`) – stejnou
 * cestou jako zmínka v chatu, bez importu ze Zakázek. Po zavření detailu
 * se vrací sem.
 *
 * Respektuje vybranou pobočku (filtr jako v Zakázkách). Co člen nesmí
 * vidět, nepustí databáze (RLS na zakázkách, rezervacích, objednávkách
 * i chatu); ceny se tu neukazují vůbec.
 */

type Props = {
  activeServiceId: string | null;
  /** Rezervace bez zakázky → příjem s předvyplněnými údaji (jako v Kalendáři). */
  onZalozitZakazku?: (rezervace: Rezervace) => void;
};

function otevriZakazku(ticketId: string) {
  window.dispatchEvent(new CustomEvent("jobsheet:navigate", { detail: { page: "orders", openTicketId: ticketId, returnToPage: "dnes" } }));
}

function otevriStranku(page: string, subsection?: string) {
  window.dispatchEvent(new CustomEvent("jobsheet:navigate", { detail: subsection ? { page, subsection } : { page } }));
}

const casFmt = (iso: string) => new Date(iso).toLocaleTimeString("cs-CZ", { hour: "2-digit", minute: "2-digit" });
const datumFmt = (iso: string) => new Date(iso).toLocaleDateString("cs-CZ", { day: "numeric", month: "numeric" });

/** „1 den“, „3 dny“, „5 dní“. */
function dny(n: number): string {
  if (n === 1) return "1 den";
  if (n >= 2 && n <= 4) return `${n} dny`;
  return `${n} dní`;
}

/** „před 3 dny“ / „dnes“ – kolik dní po termínu. */
function poTerminu(iso: string | null, ted: Date): string {
  if (!iso) return "";
  const d = dnuOd(iso, ted);
  if (d === 0) return `dnes v ${casFmt(iso)}`;
  if (d === 1) return "od včera";
  return `${dny(d)} po termínu`;
}

function terminDnes(iso: string | null): string {
  return iso ? `do ${casFmt(iso)}` : "";
}

function ceka(z: ZakazkaDnes, ted: Date): string {
  const d = dnuOd(z.updatedAt ?? z.createdAt, ted);
  return d === 0 ? "od dneška" : `${dny(d)}`;
}

export default function Dnes({ activeServiceId, onZalozitZakazku }: Props) {
  const { session } = useAuth();
  const mujId = session?.user?.id ?? null;
  const { statuses, loading: stavyNacitam, getByKey } = useStatuses();
  const { activeBranchId, isMulti, activeBranch } = useBranches();
  const chatZapnuty = useChatZapnuty(activeServiceId);
  const pridelovani = usePridelovaniTechnika(activeServiceId);

  const koncoveStavy = useMemo(() => statuses.filter((s) => s.isFinal).map((s) => s.key), [statuses]);
  const { zakazky: vsechny, dilNaCeste, rezervace, neprectene, nacitam, chyba, obnovit } = useDnesData({
    serviceId: activeServiceId,
    koncoveStavy,
    stavyNacteny: !stavyNacitam && statuses.length > 0,
    chatZapnuty,
  });

  // „Teď“ po minutě – dnešní termín se o půl třetí sám přesune do Po termínu.
  const [ted, setTed] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setTed(new Date()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  /* Volba Jen moje / Celý tým – z osobních voleb, i když přijde z jiného zařízení. */
  const [ulozenyRozsah, setUlozenyRozsah] = useState<RozsahDnes | null>(() => nactiRozsahDnes());
  useEffect(() => {
    const na = () => setUlozenyRozsah(nactiRozsahDnes());
    window.addEventListener("jobsheet:ui-updated", na);
    return () => window.removeEventListener("jobsheet:ui-updated", na);
  }, []);

  const zakazky = useMemo(() => filterByBranch(vsechny, activeBranchId), [vsechny, activeBranchId]);
  const koncove = useMemo(() => new Set(koncoveStavy), [koncoveStavy]);
  const pocetMojich = useMemo(
    () => (mujId ? zakazky.filter((z) => z.assignedTo === mujId && !koncove.has(z.status ?? "")).length : 0),
    [zakazky, mujId, koncove],
  );
  const rozsah = vychoziRozsah(ulozenyRozsah, pocetMojich, pridelovani);
  const zmenRozsah = useCallback((r: RozsahDnes) => {
    setUlozenyRozsah(r);
    ulozRozsahDnes(r);
  }, []);

  const rezervaceDnes = useMemo(() => rezervace.map((r) => mapujRezervaciDnes(r as unknown as Record<string, unknown>)), [rezervace]);
  const sekce = useMemo(
    () => roztridDnes({ zakazky, stavy: statuses, zakazkySDilemNaCeste: dilNaCeste, rezervace: rezervaceDnes, mujId, jenMoje: rozsah === "moje", ted }),
    [zakazky, statuses, dilNaCeste, rezervaceDnes, mujId, rozsah, ted],
  );
  const role = useMemo(() => rozpoznejRoleStavu(statuses), [statuses]);
  const nazevPripraveno = useMemo(() => {
    const k = [...role.kPrevzeti][0];
    return k ? getByKey(k)?.label ?? null : null;
  }, [role, getByKey]);

  const { jmeno } = useClenoveServisu(activeServiceId, pridelovani && rozsah === "tym");
  const celkemNeprectenych = neprectene.reduce((a, k) => a + k.pocet, 0);

  const stav = (z: ZakazkaDnes) => {
    const m = z.status ? getByKey(z.status) : undefined;
    return m ? <StatusBadge label={m.label} bg={m.bg ?? "#6b7280"} /> : null;
  };
  const kdo = (z: ZakazkaDnes) => {
    if (rozsah !== "tym" || !pridelovani || !z.assignedTo) return null;
    return z.assignedTo === mujId ? "vy" : jmeno(z.assignedTo);
  };
  const podtitulek = (z: ZakazkaDnes) => [z.customerName, kdo(z)].filter(Boolean).join(" · ");

  const radek = (z: ZakazkaDnes, poznamka: string, ton: TonSekce) => (
    <RadekSekce
      key={z.id}
      onClick={() => otevriZakazku(z.id)}
      kod={z.code}
      titulek={z.title}
      podtitulek={podtitulek(z)}
      poznamka={poznamka || undefined}
      poznamkaTon={ton}
      vpravo={stav(z)}
      title="Otevřít detail zakázky"
    />
  );

  const denText = ted.toLocaleDateString("cs-CZ", { weekday: "long", day: "numeric", month: "long" });
  const dnesText = denText.charAt(0).toUpperCase() + denText.slice(1);
  const souhrn = [
    sekce.po_terminu.length > 0 ? `${sekce.po_terminu.length} po termínu` : null,
    sekce.dnes_termin.length > 0 ? `${sekce.dnes_termin.length} dnes dokončit` : null,
    sekce.rezervace.length > 0 ? `${sekce.rezervace.length} ${sekce.rezervace.length === 1 ? "rezervace" : sekce.rezervace.length <= 4 ? "rezervace" : "rezervací"}` : null,
    sekce.k_prevzeti.length > 0 ? `${sekce.k_prevzeti.length} k převzetí` : null,
  ].filter(Boolean).join(" · ");
  const pobockaText = isMulti && activeBranch ? ` · ${activeBranch.name}` : "";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)", minWidth: 0 }}>
      <PageHeader
        title="Dnes"
        subtitle={
          <>
            {dnesText}
            {pobockaText}
            {souhrn ? ` · ${souhrn}` : nacitam ? " · načítám…" : ""}
          </>
        }
        actions={
          <>
            {pridelovani && (
              <Segmented<RozsahDnes>
                ariaLabel="Čí zakázky ukázat"
                size="sm"
                dataTour="dnes-rozsah"
                value={rozsah}
                onChange={zmenRozsah}
                options={[
                  { value: "moje", label: pocetMojich > 0 ? `Jen moje (${pocetMojich})` : "Jen moje" },
                  { value: "tym", label: "Celý tým" },
                ]}
              />
            )}
            <Button variant="ghost" size="sm" onClick={obnovit} title="Načíst znovu">
              Obnovit
            </Button>
          </>
        }
      />

      {chyba && (
        <div role="alert" style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", flexWrap: "wrap", padding: "var(--space-3) var(--space-4)", borderRadius: "var(--radius-sm)", background: "var(--danger-soft)", color: "var(--danger-text)", fontSize: "var(--text-base)", fontWeight: 600 }}>
          <span style={{ flex: 1, minWidth: 0 }}>{chyba}</span>
          <Button variant="soft" size="sm" onClick={obnovit}>Zkusit znovu</Button>
        </div>
      )}

      {/* Karty vedle sebe, na telefonu pod sebou. min(100%, …) – ani úzký
          displej nedostane kartu širší, než je sám. */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 340px), 1fr))", gap: "var(--space-4)", alignItems: "start", minWidth: 0 }}>
        <SekceKarta
          dataTour="dnes-po-terminu"
          titulek="Po termínu"
          popis="Předpokládaný termín dokončení už minul."
          pocet={sekce.po_terminu.length}
          ton="danger"
          nacitam={nacitam}
          prazdno="Nic není po termínu. Termín zadáte v detailu zakázky v poli Předpokládaný termín dokončení."
        >
          {sekce.po_terminu.map((z) => radek(z, poTerminu(z.expectedAt, ted), "danger"))}
        </SekceKarta>

        <SekceKarta
          dataTour="dnes-termin"
          titulek="Dnes dokončit"
          popis="Termín dokončení je dnes."
          pocet={sekce.dnes_termin.length}
          ton="warning"
          nacitam={nacitam}
          prazdno="Na dnešek žádný termín. Kalendář ukáže, co je naplánované na další dny."
          akce={<Button variant="ghost" size="sm" onClick={() => otevriStranku("calendar")}>Kalendář</Button>}
        >
          {sekce.dnes_termin.map((z) => radek(z, terminDnes(z.expectedAt), "warning"))}
        </SekceKarta>

        <SekceKarta
          dataTour="dnes-rezervace"
          titulek="Rezervace na dnes"
          popis="Zákazníci objednaní přes formulář na webu."
          pocet={sekce.rezervace.length}
          ton="info"
          nacitam={nacitam}
          prazdno="Na dnešek nikdo rezervaci nemá. Online rezervace zapnete v Nastavení → Zakázky → Online rezervace."
        >
          {sekce.rezervace.map((r) => {
            const plna = rezervace.find((x) => x.id === r.id);
            const maZakazku = !!r.ticketId;
            return (
              <RadekSekce
                key={r.id}
                onClick={() => {
                  if (r.ticketId) otevriZakazku(r.ticketId);
                  else if (plna && onZalozitZakazku) onZalozitZakazku(plna);
                  else otevriStranku("calendar");
                }}
                titulek={r.customerName || "Zákazník"}
                podtitulek={[r.deviceLabel, r.repairName].filter(Boolean).join(" · ")}
                poznamka={r.preferredAt ? casFmt(r.preferredAt) : undefined}
                poznamkaTon="info"
                vpravo={<span style={{ fontSize: "var(--text-sm)", fontWeight: 700, color: "var(--accent)", whiteSpace: "nowrap" }}>{maZakazku ? "Zakázka" : "Založit zakázku"}</span>}
                title={maZakazku ? "Otevřít zakázku z rezervace" : "Založit zakázku s údaji z rezervace"}
              />
            );
          })}
        </SekceKarta>

        <SekceKarta
          dataTour="dnes-k-prevzeti"
          titulek="Připraveno k převzetí"
          popis={nazevPripraveno ? `Ve stavu „${nazevPripraveno}“ – kdo si může přijít. Nahoře nejdéle čekající.` : "Hotové zakázky, pro které si zákazník může přijít."}
          pocet={sekce.k_prevzeti.length}
          ton="success"
          nacitam={nacitam}
          prazdno={
            nazevPripraveno
              ? `Nic nečeká na vyzvednutí. Hotovou zakázku přepněte do stavu „${nazevPripraveno}“ a objeví se tady.`
              : <>Servis nemá stav pro hotové zakázky. Přidejte ho v <LinkNastaveni sub="orders_statuses">Nastavení → Statusy zakázek</LinkNastaveni>.</>
          }
        >
          {sekce.k_prevzeti.map((z) => radek(z, `čeká ${ceka(z, ted)}`, "success"))}
        </SekceKarta>

        <SekceKarta
          dataTour="dnes-dil"
          titulek="Čeká na díl"
          popis="Objednaný díl ještě nedorazil, nebo je zakázka ve stavu čekání na díl."
          pocet={sekce.ceka_dil.length}
          ton="warning"
          nacitam={nacitam}
          prazdno="Na díl nic nečeká. Díl objednaný z detailu zakázky („Objednat u dodavatele“) se tu objeví sám."
        >
          {sekce.ceka_dil.map((z) => radek(z, dilNaCeste.has(z.id) ? `objednáno · ${ceka(z, ted)}` : `čeká ${ceka(z, ted)}`, "warning"))}
        </SekceKarta>

        <SekceKarta
          dataTour="dnes-zakaznik"
          titulek="Čeká na zákazníka"
          popis="Odeslaná cenová nabídka bez odpovědi, nebo stav čekání na zákazníka."
          pocet={sekce.ceka_zakaznik.length}
          ton="accent"
          nacitam={nacitam}
          prazdno="Nikdo nemá nevyřízenou nabídku. Nabídku ke schválení pošlete z detailu zakázky přes portál."
        >
          {sekce.ceka_zakaznik.map((z) => radek(z, z.quoteStatus === "sent" ? `nabídka · ${ceka(z, ted)}` : `čeká ${ceka(z, ted)}`, "accent"))}
        </SekceKarta>

        {pridelovani && (
          <SekceKarta
            dataTour="dnes-moje"
            titulek="Přidělené mně"
            popis="Všechny moje rozpracované zakázky podle termínu."
            pocet={sekce.moje.length}
            ton="accent"
            nacitam={nacitam}
            prazdno="Nemáte přidělenou žádnou rozpracovanou zakázku. V detailu zakázky si ji vezmete tlačítkem Přidělit mně."
          >
            {sekce.moje.map((z) =>
              radek(
                z,
                z.expectedAt ? (jeDnes(z.expectedAt, ted) ? `dnes ${casFmt(z.expectedAt)}` : new Date(z.expectedAt).getTime() < ted.getTime() ? poTerminu(z.expectedAt, ted) : `do ${datumFmt(z.expectedAt)}`) : "",
                z.expectedAt && new Date(z.expectedAt).getTime() < ted.getTime() ? "danger" : "accent",
              ),
            )}
          </SekceKarta>
        )}

        {chatZapnuty && (
          <SekceKarta
            dataTour="dnes-chat"
            titulek="Nepřečtené zprávy"
            popis="Chat týmu – kanály s novými zprávami."
            pocet={celkemNeprectenych}
            ton="info"
            prazdno="Všechno přečtené. Chat otevřete bublinou vpravo dole."
            akce={<Button variant="ghost" size="sm" onClick={() => otevriChat()}>Otevřít chat</Button>}
          >
            {neprectene.map((k) => (
              <RadekSekce
                key={k.kanal}
                onClick={() => otevriChat({ kanal: k.kanal })}
                titulek={k.nazev}
                podtitulek={k.kanal.startsWith("dm:") ? "Soukromá zpráva" : k.kanal.startsWith("pobocka:") ? "Pobočka" : "Celý servis"}
                vpravo={<span style={{ minWidth: 22, padding: "1px var(--space-2)", borderRadius: "var(--radius-pill)", background: "var(--danger)", color: "#fff", fontSize: "var(--text-xs)", fontWeight: 800, textAlign: "center" }}>{k.pocet > 99 ? "99+" : k.pocet}</span>}
                title="Otevřít kanál v chatu"
              />
            ))}
          </SekceKarta>
        )}
      </div>
    </div>
  );
}

function LinkNastaveni({ sub, children }: { sub: string; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={() => otevriStranku("settings", sub)}
      style={{ border: "none", background: "none", padding: 0, color: "var(--accent)", fontWeight: 700, cursor: "pointer", fontFamily: "inherit", fontSize: "inherit" }}
    >
      {children}
    </button>
  );
}
