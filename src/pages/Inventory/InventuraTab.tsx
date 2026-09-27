import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Input, Label, Pill, Segmented } from "../../components/ui";
import { BoxIcon, CheckIcon, DownloadIcon, HistoryIcon, PlusIcon, SearchIcon, WarningIcon, XIcon } from "../../components/icons";
import { SectionHeading } from "../../components/SectionHeading";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { showToast } from "../../components/Toast";
import { reportError } from "../../lib/reportError";
import { neulozeneZmeny, naFrontu } from "../../lib/frontaZapisu";
import { nactiPrezdivky } from "../../lib/casNaOprave";
import type { Product, Warehouse } from "../../lib/inventoryDb";
import {
  filtrujPolozky, lzeUzavrit, najdiPodleKodu, najdiProduktPodleKodu, nazevProtokolu, ocenitRozdil, parseNapocitano,
  poctemZeCtecky, protokolCsv, prubehInventury, rozdilPolozky, souhrnInventury, zakladPolozky, bezDiakritiky,
  type FiltrPolozek, type Inventura, type PolozkaInventury, type SouhrnInventury,
} from "../../lib/inventura";
import {
  HLASKA_INVENTURA_NEDOSTUPNA, nactiInventury, nactiPolozky, pridatProdukt, sledujInventury, uzavritInventuru,
  zahajitInventuru, zapsatNapocitano, zrusitInventuru,
} from "../../lib/inventuraDb";
import { InventoryDialog } from "./InventoryDialog";

const formatKc = new Intl.NumberFormat("cs-CZ", { style: "currency", currency: "CZK", maximumFractionDigits: 0 });
const formatKcPresne = new Intl.NumberFormat("cs-CZ", { style: "currency", currency: "CZK", minimumFractionDigits: 0, maximumFractionDigits: 2 });

/** Kolik řádků se vykreslí najednou – tisíc polí naráz by stránku zpomalilo. */
const RADKU_NA_STRANKU = 200;
const PREFIX_FRONTY = "inventory_stocktake_items:";
/** Po jaké pauze v psaní se rozepsaný počet uloží sám. */
const ODKLAD_ULOZENI_MS = 1500;

function formatDatum(iso: string | null): string {
  if (!iso) return "–";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "–";
  return d.toLocaleString("cs-CZ", { day: "numeric", month: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function sklonuj(n: number, tvary: [string, string, string]) {
  const t = n === 1 ? tvary[0] : n >= 2 && n <= 4 ? tvary[1] : tvary[2];
  return `${n} ${t}`;
}

function stahnoutCsv(obsah: string, nazev: string) {
  const blob = new Blob([obsah], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nazev;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Id řádků inventury, jejichž počet čeká ve frontě neuložených změn. */
function cekajiciVeFronte(): Set<string> {
  const out = new Set<string>();
  for (const p of neulozeneZmeny()) {
    if (p.klic.startsWith(PREFIX_FRONTY)) out.add(p.id);
  }
  return out;
}

function RozdilText({ r }: { r: number | null }) {
  if (r === null) return <span style={{ color: "var(--muted)" }}>–</span>;
  if (r === 0) return <span style={{ color: "var(--success-text)", fontWeight: 700 }}>sedí</span>;
  return (
    <span style={{ color: r < 0 ? "var(--danger-text)" : "var(--info-text)", fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>
      {r > 0 ? `+${r}` : r} ks
    </span>
  );
}

function StavPill({ status }: { status: Inventura["status"] }) {
  if (status === "open") return <Pill color="var(--warning-text)" dot>Rozdělaná</Pill>;
  if (status === "closed") return <Pill color="var(--success-text)" dot>Uzavřená</Pill>;
  return <Pill color="var(--muted)" dot>Zrušená</Pill>;
}

function SouhrnDlazdice({ s }: { s: SouhrnInventury }) {
  const kpi: React.CSSProperties = {
    display: "flex", flexDirection: "column", gap: "var(--space-1)", padding: "var(--space-3) var(--space-4)",
    borderRadius: "var(--radius-md)", border: "1px solid var(--border)", background: "var(--panel)", minWidth: 0,
  };
  const popisek: React.CSSProperties = { fontSize: "var(--text-xs)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--muted)" };
  const hodnota: React.CSSProperties = { fontSize: "var(--text-lg)", fontWeight: 900, lineHeight: 1.1, fontVariantNumeric: "tabular-nums" };
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "var(--space-3)" }}>
      <div style={kpi}>
        <span style={popisek}>Spočítáno</span>
        <span style={hodnota}>{s.spocitano} / {s.polozek}</span>
      </div>
      <div style={kpi} title="Kusy, které podle evidence měly být na skladě a nejsou. Oceněno nákupní cenou.">
        <span style={popisek}>Manko</span>
        <span style={{ ...hodnota, color: s.mankoKs > 0 ? "var(--danger-text)" : "var(--text)" }}>
          {s.mankoKs} ks · {formatKc.format(s.mankoKc)}
        </span>
      </div>
      <div style={kpi} title="Kusy navíc proti evidenci. Oceněno nákupní cenou.">
        <span style={popisek}>Přebytek</span>
        <span style={{ ...hodnota, color: s.prebytekKs > 0 ? "var(--info-text)" : "var(--text)" }}>
          {s.prebytekKs} ks · {formatKc.format(s.prebytekKc)}
        </span>
      </div>
      <div style={kpi} title="Řádky s rozdílem; kolik z nich nejde ocenit, protože produkt nemá nákupní cenu.">
        <span style={popisek}>S rozdílem</span>
        <span style={hodnota}>
          {s.sRozdilem}
          {s.bezCeny > 0 && <span style={{ fontSize: "var(--text-xs)", color: "var(--warning-text)", fontWeight: 700 }}> · {s.bezCeny} bez ceny</span>}
        </span>
      </div>
    </div>
  );
}

/**
 * Záložka Inventura ve Skladu.
 *
 * Inventura se dělá po skladech: zahájení zmrazí evidovaný stav (RPC
 * `inventura_zahajit`), lidé zapisují napočítané kusy – každý řádek se
 * uloží hned a ostatním se ukáže přes realtime – a uzavření zapíše rozdíly
 * do skladu (`inventura_uzavrit`). Výpadek sítě počet neztratí: zápis jde
 * do fronty neuložených změn a dopíše se sám.
 */
export function InventuraTab({
  activeServiceId,
  warehouses,
  products,
  activeBranchId,
  branchName,
  canCount,
  canManage,
  canClose,
  onSkladZmenen,
}: {
  activeServiceId: string | null;
  /** Sklady, které uživatel vidí (už přefiltrované podle pobočky v liště). */
  warehouses: Warehouse[];
  /** Produkty skladu – kvůli přidání nalezeného dílu do inventury. */
  products: Product[];
  activeBranchId: string | null;
  /** Název pobočky skladu, když servis pobočky rozlišuje; jinak null. */
  branchName: (branchId: string | null | undefined) => string | null;
  /** can_edit_inventory nebo can_adjust_inventory_quantity. */
  canCount: boolean;
  /** can_edit_inventory – zahájit a zrušit. */
  canManage: boolean;
  /** can_edit_inventory + can_adjust_inventory_quantity – uzavřít a zapsat do skladu. */
  canClose: boolean;
  /** Po uzavření se změnil stav skladu – rodič si ho načte znovu. */
  onSkladZmenen: () => Promise<void> | void;
}) {
  const [inventury, setInventury] = useState<Inventura[]>([]);
  const [nacteno, setNacteno] = useState(false);
  const [nedostupne, setNedostupne] = useState(false);
  const [vybranaId, setVybranaId] = useState<string | null>(null);
  const [polozky, setPolozky] = useState<PolozkaInventury[]>([]);
  const [nactenoPolozky, setNactenoPolozky] = useState(false);
  const [jmena, setJmena] = useState<Record<string, string>>({});

  /* Rozepsané pole: text, který ještě není uložený. Realtime ho nepřepíše. */
  const [rozepsane, setRozepsane] = useState<Record<string, string>>({});
  const [chybyRadku, setChybyRadku] = useState<Record<string, string>>({});
  const [ukladam, setUkladam] = useState<Set<string>>(() => new Set());
  const [veFronte, setVeFronte] = useState<Set<string>>(() => cekajiciVeFronte());

  const [hledat, setHledat] = useState("");
  const [filtr, setFiltr] = useState<FiltrPolozek>("vse");
  const [kod, setKod] = useState("");
  const [zvyraznenyId, setZvyraznenyId] = useState<string | null>(null);
  const [zobrazitRadku, setZobrazitRadku] = useState(RADKU_NA_STRANKU);

  const [novySklad, setNovySklad] = useState("");
  const [novaPoznamka, setNovaPoznamka] = useState("");
  const [vcetneNulovych, setVcetneNulovych] = useState(false);
  const [zahajuji, setZahajuji] = useState(false);

  const [uzavritOtevreno, setUzavritOtevreno] = useState(false);
  const [bezeZmeny, setBezeZmeny] = useState(false);
  const [poznamkaUzavreni, setPoznamkaUzavreni] = useState("");
  const [uzaviram, setUzaviram] = useState(false);
  const [zrusitOtevreno, setZrusitOtevreno] = useState(false);

  const vybranaRef = useRef<string | null>(null);
  /* Rozepsané texty a řádky i mimo render: Enter a následný blur, nebo dvě
     rychlá pípnutí čtečky, přijdou dřív, než React stihne překreslit – ze
     stavu by četly zastaralé číslo a jeden kus by se ztratil. */
  const rozepsaneRef = useRef<Record<string, string>>({});
  const polozkyRef = useRef<PolozkaInventury[]>([]);
  /* Zápisy téhož řádku jdou po sobě (dva souběžné update nemají zaručené
     pořadí) a odpověď serveru se dosadí jen k poslednímu z nich. */
  const retezRef = useRef<Map<string, Promise<unknown>>>(new Map());
  const verzeRef = useRef<Map<string, number>>(new Map());
  const cekaRef = useRef<Map<string, number>>(new Map());
  const bufferRef = useRef<Map<string, PolozkaInventury>>(new Map());
  const flushRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hlavickaRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const poleRef = useRef<Map<string, HTMLInputElement>>(new Map());
  /* Rozepsané číslo se uloží samo i bez Enteru a opuštění pole – zavření
     aplikace uprostřed psaní by ho jinak zahodilo. */
  const odkladRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => {
    vybranaRef.current = vybranaId;
  }, [vybranaId]);
  useEffect(() => {
    polozkyRef.current = polozky;
  }, [polozky]);

  const nastavRozepsane = (id: string, text: string | undefined) => {
    const n = { ...rozepsaneRef.current };
    if (text === undefined) delete n[id];
    else n[id] = text;
    rozepsaneRef.current = n;
    setRozepsane(n);
  };

  const zmenPolozky = (fn: (prev: PolozkaInventury[]) => PolozkaInventury[]) => {
    polozkyRef.current = fn(polozkyRef.current);
    setPolozky(fn);
  };

  /* ---------- načtení ---------- */

  const aplikovatInventury = useCallback((r: Awaited<ReturnType<typeof nactiInventury>>) => {
    if (r.nedostupne) {
      setNedostupne(true);
      setNacteno(true);
      return;
    }
    if (r.error) {
      reportError({ code: "inventura.load_failed", error: new Error(r.error), userMessage: "Inventury se nepodařilo načíst.", source: "InventuraTab.prenacistInventury", serviceId: activeServiceId });
      setNacteno(true);
      return;
    }
    setNedostupne(false);
    setInventury(r.data);
    setNacteno(true);
  }, [activeServiceId]);

  const prenacistInventury = useCallback(async () => {
    if (!activeServiceId) return;
    aplikovatInventury(await nactiInventury(activeServiceId));
  }, [activeServiceId, aplikovatInventury]);

  const aplikovatPolozky = useCallback((id: string, r: Awaited<ReturnType<typeof nactiPolozky>>) => {
    if (vybranaRef.current !== id) return;
    if (r.error) {
      reportError({ code: "inventura.items_load_failed", error: new Error(r.error), userMessage: "Položky inventury se nepodařilo načíst.", source: "InventuraTab.prenacistPolozky", serviceId: activeServiceId });
      setNactenoPolozky(true);
      return;
    }
    polozkyRef.current = r.data;
    setPolozky(r.data);
    setNactenoPolozky(true);
  }, [activeServiceId]);

  const prenacistPolozky = useCallback(async (id: string) => {
    aplikovatPolozky(id, await nactiPolozky(id));
  }, [aplikovatPolozky]);

  /* Přepnutí servisu řeší rodič klíčem (`key={activeServiceId}`) – stav začne od nuly. */
  useEffect(() => {
    if (!activeServiceId) return;
    void nactiInventury(activeServiceId).then(aplikovatInventury);
  }, [activeServiceId, aplikovatInventury]);

  useEffect(() => {
    if (!vybranaId) return;
    void nactiPolozky(vybranaId).then((r) => aplikovatPolozky(vybranaId, r));
  }, [vybranaId, aplikovatPolozky]);

  /** Otevře inventuru (null = zpět na přehled) s čistým stavem řádků. */
  const otevrit = (id: string | null) => {
    vybranaRef.current = id;
    polozkyRef.current = [];
    rozepsaneRef.current = {};
    setPolozky([]);
    setNactenoPolozky(false);
    setRozepsane({});
    setChybyRadku({});
    setHledat("");
    setKod("");
    setFiltr("vse");
    setZobrazitRadku(RADKU_NA_STRANKU);
    setVybranaId(id);
  };

  /* Realtime: víc lidí počítá naráz. Řádky se sbírají a dosazují po dávkách –
     zahájení inventury pošle stovky vložení za sebou. */
  useEffect(() => {
    if (!activeServiceId || nedostupne) return;
    const flush = () => {
      flushRef.current = null;
      const zmeny = bufferRef.current;
      bufferRef.current = new Map();
      const id = vybranaRef.current;
      if (!id) return;
      // Řádek, který právě ukládám sám, dosadí odpověď na můj zápis, ne mezistav z realtime.
      const moje = [...zmeny.values()].filter((p) => p.stocktakeId === id && !(cekaRef.current.get(p.id) ?? 0));
      if (moje.length === 0) return;
      setPolozky((prev) => {
        const podleId = new Map(prev.map((p) => [p.id, p]));
        let pribylo = false;
        for (const p of moje) {
          if (!podleId.has(p.id)) pribylo = true;
          podleId.set(p.id, p);
        }
        const next = [...podleId.values()];
        if (pribylo) next.sort((a, b) => a.nazev.localeCompare(b.nazev, "cs"));
        return next;
      });
    };
    const odhlasit = sledujInventury(
      activeServiceId,
      (p) => {
        bufferRef.current.set(p.id, p);
        if (!flushRef.current) flushRef.current = setTimeout(flush, 150);
      },
      () => {
        if (hlavickaRef.current) clearTimeout(hlavickaRef.current);
        hlavickaRef.current = setTimeout(() => {
          hlavickaRef.current = null;
          void prenacistInventury();
        }, 400);
      }
    );
    return () => {
      odhlasit();
      if (flushRef.current) clearTimeout(flushRef.current);
      if (hlavickaRef.current) clearTimeout(hlavickaRef.current);
      flushRef.current = null;
      hlavickaRef.current = null;
    };
  }, [activeServiceId, nedostupne, prenacistInventury]);

  /* Odchod ze záložky: co se ještě píše, se uloží hned. */
  useEffect(() => {
    const odklady = odkladRef.current;
    return () => {
      for (const [id, t] of odklady) {
        clearTimeout(t);
        const p = polozkyRef.current.find((x) => x.id === id);
        const text = rozepsaneRef.current[id];
        if (!p || text === undefined) continue;
        const v = parseNapocitano(text);
        if (v.ok && v.hodnota !== p.napocitano) void zapsatNapocitano(p, v.hodnota, activeServiceId, "");
      }
      odklady.clear();
    };
  }, [activeServiceId]);

  /* Fronta neuložených změn: odznak „čeká na síť“ u řádku, dokud se nedopíše. */
  useEffect(() => naFrontu(() => setVeFronte(cekajiciVeFronte())), []);

  /* Jména lidí do hlaviček a sloupce „Napočítal“. */
  useEffect(() => {
    const ids = new Set<string>();
    for (const i of inventury) {
      if (i.zahajil) ids.add(i.zahajil);
      if (i.uzavrel) ids.add(i.uzavrel);
    }
    for (const p of polozky) if (p.napocital) ids.add(p.napocital);
    const chybi = [...ids].filter((id) => !(id in jmena));
    if (chybi.length === 0) return;
    let zruseno = false;
    void nactiPrezdivky(chybi).then((m) => {
      if (zruseno) return;
      setJmena((prev) => {
        const next = { ...prev };
        for (const id of chybi) next[id] = m[id] ?? "";
        return next;
      });
    });
    return () => {
      zruseno = true;
    };
  }, [inventury, polozky, jmena]);

  /* ---------- odvozené ---------- */

  const viditelneInventury = useMemo(
    () => (activeBranchId ? inventury.filter((i) => !i.branchId || i.branchId === activeBranchId) : inventury),
    [inventury, activeBranchId]
  );
  const otevrene = viditelneInventury.filter((i) => i.status === "open");
  const historie = viditelneInventury.filter((i) => i.status !== "open");
  const vybrana = vybranaId ? inventury.find((i) => i.id === vybranaId) ?? null : null;
  const skladySInventurou = new Set(otevrene.map((i) => i.warehouseId));
  const volneSklady = warehouses.filter((w) => !skladySInventurou.has(w.id));
  const zvolenySklad = volneSklady.some((w) => w.id === novySklad) ? novySklad : volneSklady[0]?.id ?? "";

  const souhrn = useMemo(() => souhrnInventury(polozky), [polozky]);
  const prubeh = useMemo(() => prubehInventury(polozky), [polozky]);
  const zobrazene = useMemo(() => filtrujPolozky(polozky, hledat, filtr), [polozky, hledat, filtr]);
  const jmeno = (id: string | null) => (id ? jmena[id] || "Kolega" : "–");

  /* Hledání bez výsledku mezi řádky: nabídnout produkty skladu, které v inventuře nejsou. */
  const kPridani = useMemo(() => {
    const q = bezDiakritiky(hledat.trim());
    if (q.length < 2 || !vybrana || vybrana.status !== "open") return [];
    const vInventure = new Set(polozky.map((p) => p.productId));
    return products
      .filter((p) => !vInventure.has(p.id))
      .filter((p) => bezDiakritiky(p.name).includes(q) || bezDiakritiky(p.sku ?? "").includes(q) || bezDiakritiky(p.supplierSku ?? "").includes(q))
      .slice(0, 6);
  }, [hledat, products, polozky, vybrana]);

  /* ---------- akce ---------- */

  const zahajit = async () => {
    if (!zvolenySklad || zahajuji) return;
    setZahajuji(true);
    const r = await zahajitInventuru(zvolenySklad, novaPoznamka, vcetneNulovych);
    setZahajuji(false);
    if (r.nedostupne) {
      setNedostupne(true);
      return;
    }
    if (r.error || !r.data) {
      reportError({ code: "inventura.start_failed", error: new Error(r.error ?? "bez id"), userMessage: r.error ? `Inventuru se nepodařilo zahájit: ${r.error}` : "Inventuru se nepodařilo zahájit.", source: "InventuraTab.zahajit", serviceId: activeServiceId });
      return;
    }
    setNovaPoznamka("");
    setVcetneNulovych(false);
    await prenacistInventury();
    otevrit(r.data);
    showToast("Inventura zahájena – zapisujte napočítané kusy.");
  };

  const ulozitRadek = useCallback(
    async (p: PolozkaInventury, hodnota: number | null): Promise<boolean> => {
      const inv = vybranaRef.current ? inventury.find((i) => i.id === vybranaRef.current) : null;
      const puvodni = polozkyRef.current.find((x) => x.id === p.id)?.napocitano ?? p.napocitano;
      const verze = (verzeRef.current.get(p.id) ?? 0) + 1;
      verzeRef.current.set(p.id, verze);
      cekaRef.current.set(p.id, (cekaRef.current.get(p.id) ?? 0) + 1);
      zmenPolozky((prev) => prev.map((x) => (x.id === p.id ? { ...x, napocitano: hodnota } : x)));
      setUkladam((s) => new Set(s).add(p.id));

      const predchozi = retezRef.current.get(p.id) ?? Promise.resolve();
      const zapis = predchozi.then(() => zapsatNapocitano(p, hodnota, activeServiceId, inv?.cislo ?? ""));
      retezRef.current.set(p.id, zapis.catch(() => undefined));
      const r = await zapis;

      const zbyva = (cekaRef.current.get(p.id) ?? 1) - 1;
      if (zbyva <= 0) cekaRef.current.delete(p.id);
      else cekaRef.current.set(p.id, zbyva);
      const posledni = verzeRef.current.get(p.id) === verze;
      if (zbyva <= 0) {
        setUkladam((s) => {
          const n = new Set(s);
          n.delete(p.id);
          return n;
        });
      }

      if (r.stav === "ulozeno") {
        if (r.polozka && posledni) {
          const cerstva = r.polozka;
          zmenPolozky((prev) => prev.map((x) => (x.id === cerstva.id ? cerstva : x)));
        }
        setChybyRadku((c) => {
          if (!(p.id in c)) return c;
          const n = { ...c };
          delete n[p.id];
          return n;
        });
        return true;
      }
      if (r.stav === "ve-fronte") {
        /* Číslo zůstává na obrazovce i v localStorage; fronta ho dopíše sama. */
        return true;
      }
      if (posledni) zmenPolozky((prev) => prev.map((x) => (x.id === p.id ? { ...x, napocitano: puvodni } : x)));
      setChybyRadku((c) => ({ ...c, [p.id]: r.zprava }));
      reportError({ code: "inventura.count_failed", error: new Error(r.zprava), userMessage: `Počet „${p.nazev}“ se nezapsal: ${r.zprava}`, source: "InventuraTab.ulozitRadek", serviceId: activeServiceId });
      return false;
    },
    [activeServiceId, inventury]
  );

  const potvrditPole = (p: PolozkaInventury) => {
    const odklad = odkladRef.current.get(p.id);
    if (odklad) {
      clearTimeout(odklad);
      odkladRef.current.delete(p.id);
    }
    const text = rozepsaneRef.current[p.id];
    if (text === undefined) return;
    const v = parseNapocitano(text);
    if (!v.ok) {
      setChybyRadku((c) => ({ ...c, [p.id]: v.chyba }));
      return;
    }
    nastavRozepsane(p.id, undefined);
    const aktualni = polozkyRef.current.find((x) => x.id === p.id) ?? p;
    if (v.hodnota === aktualni.napocitano) {
      setChybyRadku((c) => {
        if (!(p.id in c)) return c;
        const n = { ...c };
        delete n[p.id];
        return n;
      });
      return;
    }
    void ulozitRadek(aktualni, v.hodnota);
  };

  const zvyraznit = (id: string) => {
    setZvyraznenyId(id);
    window.setTimeout(() => {
      const el = poleRef.current.get(id);
      el?.scrollIntoView({ block: "center", behavior: "smooth" });
    }, 50);
    window.setTimeout(() => setZvyraznenyId((z) => (z === id ? null : z)), 2000);
  };

  /* Čtečka: kód + Enter. Známý řádek = +1 kus; díl, který v inventuře není, se přidá s 1 ks. */
  const nacistKod = async () => {
    const k = kod.trim();
    if (!k || !vybrana || vybrana.status !== "open") return;
    setKod("");
    const radek = najdiPodleKodu(polozkyRef.current, k);
    if (radek) {
      if (radek.id in rozepsaneRef.current) {
        showToast(`„${radek.nazev}“ právě někdo přepisuje ručně – dokončete zápis v řádku.`, "info");
        zvyraznit(radek.id);
        return;
      }
      const ok = await ulozitRadek(radek, poctemZeCtecky(radek));
      if (ok) zvyraznit(radek.id);
      return;
    }
    const produkt = najdiProduktPodleKodu(products, k);
    if (!produkt) {
      showToast(`Kód „${k}“ nepatří žádnému produktu ve skladu.`, "error");
      return;
    }
    const existujici = polozkyRef.current.find((p) => p.productId === produkt.id);
    if (existujici) {
      const ok = await ulozitRadek(existujici, poctemZeCtecky(existujici));
      if (ok) zvyraznit(existujici.id);
      return;
    }
    await pridatDoInventury(produkt.id, 1);
  };

  const pridatDoInventury = async (productId: string, pocet: number | null) => {
    if (!vybrana) return;
    const r = await pridatProdukt(vybrana.id, productId);
    if (r.error || !r.data) {
      reportError({ code: "inventura.add_failed", error: new Error(r.error ?? "bez id"), userMessage: r.error ? `Produkt se nepodařilo přidat: ${r.error}` : "Produkt se nepodařilo přidat.", source: "InventuraTab.pridatDoInventury", serviceId: activeServiceId });
      return;
    }
    const polozkyRes = await nactiPolozky(vybrana.id);
    if (vybranaRef.current !== vybrana.id) return;
    if (!polozkyRes.error) zmenPolozky(() => polozkyRes.data);
    const nova = polozkyRes.data.find((p) => p.id === r.data);
    if (nova && pocet !== null) await ulozitRadek(nova, pocet);
    if (nova) {
      setHledat("");
      zvyraznit(nova.id);
    }
    showToast("Produkt přidán do inventury.");
  };

  const cekajiciTetoInventury = () => {
    const ids = new Set(polozky.map((p) => p.id));
    const fronta = cekajiciVeFronte();
    return [...ids].filter((id) => fronta.has(id) || ukladam.has(id)).length + Object.keys(rozepsane).length;
  };

  const uzavrit = async () => {
    if (!vybrana || uzaviram) return;
    const cekaji = cekajiciTetoInventury();
    if (cekaji > 0) {
      showToast(`Ještě se ukládá ${sklonuj(cekaji, ["počet", "počty", "počtů"])}. Počkejte, až se všechno zapíše, pak inventuru uzavřete.`, "error");
      return;
    }
    const moznost = lzeUzavrit(vybrana, polozky, bezeZmeny);
    if (!moznost.ok) {
      showToast(moznost.duvod, "error");
      return;
    }
    setUzaviram(true);
    const r = await uzavritInventuru(vybrana.id, bezeZmeny, poznamkaUzavreni);
    setUzaviram(false);
    if (r.error) {
      reportError({ code: "inventura.close_failed", error: new Error(r.error), userMessage: `Inventuru se nepodařilo uzavřít: ${r.error}`, source: "InventuraTab.uzavrit", serviceId: activeServiceId });
      return;
    }
    setUzavritOtevreno(false);
    setBezeZmeny(false);
    setPoznamkaUzavreni("");
    showToast("Inventura uzavřena, stav skladu srovnán s napočítaným.");
    await prenacistInventury();
    await prenacistPolozky(vybrana.id);
    setFiltr("rozdily");
    await onSkladZmenen();
  };

  const zrusit = async () => {
    if (!vybrana) return;
    const r = await zrusitInventuru(vybrana.id);
    if (r.error) throw new Error(r.error);
    setZrusitOtevreno(false);
    showToast("Inventura zrušena, sklad zůstal beze změny.", "info");
    await prenacistInventury();
    otevrit(null);
  };

  const exportovat = async (inv: Inventura) => {
    let radky = polozky;
    if (inv.id !== vybranaId) {
      const r = await nactiPolozky(inv.id);
      if (r.error) {
        reportError({ code: "inventura.export_failed", error: new Error(r.error), userMessage: "Protokol se nepodařilo připravit.", source: "InventuraTab.exportovat", serviceId: activeServiceId });
        return;
      }
      radky = r.data;
    }
    const ids = new Set<string>();
    if (inv.zahajil) ids.add(inv.zahajil);
    if (inv.uzavrel) ids.add(inv.uzavrel);
    for (const p of radky) if (p.napocital) ids.add(p.napocital);
    const chybi = [...ids].filter((id) => !(id in jmena));
    const dalsi = chybi.length > 0 ? await nactiPrezdivky(chybi) : {};
    stahnoutCsv(protokolCsv(inv, radky, { ...jmena, ...dalsi }), nazevProtokolu(inv));
  };

  /* ---------- vykreslení ---------- */

  if (!activeServiceId) return null;

  if (nedostupne) {
    return (
      <div className="ui-card" style={{ color: "var(--muted)", fontSize: "var(--text-sm)" }}>
        {HLASKA_INVENTURA_NEDOSTUPNA}
      </div>
    );
  }

  const radekSeznamu: React.CSSProperties = {
    display: "flex", alignItems: "center", gap: "var(--space-3)", flexWrap: "wrap", width: "100%", textAlign: "left",
    padding: "var(--space-3)", borderRadius: "var(--radius-sm)", border: "1px solid var(--border)", background: "var(--panel-2)",
    color: "var(--text)", fontFamily: "inherit",
  };

  /* ===== detail inventury ===== */
  if (vybrana) {
    const otevrena = vybrana.status === "open";
    const s = vybrana.status === "closed" && vybrana.souhrn ? vybrana.souhrn : souhrn;
    const moznost = lzeUzavrit(vybrana, polozky, bezeZmeny);
    const rozdily = polozky.filter((p) => {
      const r = rozdilPolozky(p);
      return p.productId !== null && r !== null && r !== 0;
    });
    const pobocka = branchName(vybrana.branchId);

    return (
      <>
        <div className="ui-card" style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: "var(--space-3)", flexWrap: "wrap" }}>
            <div style={{ flex: "1 1 260px", minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", flexWrap: "wrap" }}>
                <span style={{ fontWeight: 900, fontSize: "var(--text-lg)", fontVariantNumeric: "tabular-nums" }}>{vybrana.cislo}</span>
                <StavPill status={vybrana.status} />
              </div>
              <div style={{ fontSize: "var(--text-sm)", color: "var(--muted)", marginTop: 2 }}>
                {vybrana.skladNazev || "Smazaný sklad"}
                {pobocka ? ` · ${pobocka}` : ""} · zahájil {jmeno(vybrana.zahajil)} {formatDatum(vybrana.zahajenoAt)}
                {vybrana.uzavrenoAt && ` · ${vybrana.status === "closed" ? "uzavřel" : "zrušil"} ${jmeno(vybrana.uzavrel)} ${formatDatum(vybrana.uzavrenoAt)}`}
              </div>
              {vybrana.poznamka && <div style={{ fontSize: "var(--text-sm)", marginTop: "var(--space-1)" }}>{vybrana.poznamka}</div>}
              {vybrana.status === "closed" && vybrana.nespocitaneBezeZmeny && (
                <div style={{ fontSize: "var(--text-xs)", color: "var(--muted)", marginTop: "var(--space-1)" }}>Nespočítané položky zůstaly beze změny.</div>
              )}
            </div>
            <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap", alignItems: "center" }}>
              <Button variant="ghost" onClick={() => otevrit(null)}>Zpět na přehled</Button>
              <Button variant="soft" icon={<DownloadIcon size={14} />} onClick={() => void exportovat(vybrana)} disabled={!nactenoPolozky}>
                Protokol CSV
              </Button>
              {otevrena && canManage && (
                <Button variant="ghost" icon={<XIcon size={14} />} onClick={() => setZrusitOtevreno(true)}>Zrušit inventuru</Button>
              )}
              {otevrena && (
                <Button
                  variant="primary"
                  icon={<CheckIcon size={14} />}
                  disabled={!canClose || !nactenoPolozky}
                  title={canClose ? "Ukáže rozdíly a po potvrzení srovná sklad s napočítaným." : "Uzavřít inventuru smí jen kdo má právo upravovat sklad i měnit množství."}
                  onClick={() => {
                    setBezeZmeny(false);
                    setUzavritOtevreno(true);
                  }}
                >
                  Uzavřít inventuru
                </Button>
              )}
            </div>
          </div>

          {otevrena && (
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "var(--text-sm)", marginBottom: 4 }}>
                <span style={{ fontWeight: 800 }}>Spočítáno {prubeh.hotovo} / {prubeh.celkem}</span>
                <span style={{ color: "var(--muted)", fontVariantNumeric: "tabular-nums" }}>{prubeh.procento} %</span>
              </div>
              <div
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={prubeh.celkem}
                aria-valuenow={prubeh.hotovo}
                aria-label="Průběh inventury"
                style={{ height: 8, borderRadius: 999, background: "var(--panel-2)", border: "1px solid var(--border)", overflow: "hidden" }}
              >
                <div style={{ width: `${prubeh.procento}%`, height: "100%", background: prubeh.procento === 100 ? "var(--success)" : "var(--accent)", transition: "width 0.3s" }} />
              </div>
            </div>
          )}

          <SouhrnDlazdice s={s} />

          {otevrena && !canCount && (
            <div style={{ fontSize: "var(--text-sm)", color: "var(--warning-text)", display: "flex", gap: 6, alignItems: "center" }}>
              <WarningIcon size={14} /> Nemáte právo zapisovat do skladu – inventuru vidíte jen pro čtení.
            </div>
          )}

          <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap", alignItems: "center" }}>
            <div style={{ position: "relative", flex: "1 1 220px", minWidth: 180 }}>
              <span style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--muted)", display: "inline-flex" }}>
                <SearchIcon size={14} />
              </span>
              <Input
                value={hledat}
                onChange={(e) => setHledat(e.target.value)}
                placeholder="Hledat produkt nebo kód…"
                aria-label="Hledat v inventuře"
                style={{ paddingLeft: 30 }}
              />
            </div>
            {otevrena && canCount && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void nacistKod();
                }}
                style={{ flex: "1 1 200px", minWidth: 170 }}
              >
                <Input
                  value={kod}
                  onChange={(e) => setKod(e.target.value)}
                  placeholder="Čtečka: načtěte kód (+1 ks)"
                  aria-label="Kód ze čtečky"
                  title="Kód produktu (SKU) z čtečky nebo ručně a Enter. Každé načtení přičte jeden kus; díl, který v inventuře není, se přidá."
                  autoComplete="off"
                />
              </form>
            )}
            <Segmented
              size="sm"
              ariaLabel="Filtr řádků inventury"
              value={filtr}
              onChange={(v) => {
                setFiltr(v);
                setZobrazitRadku(RADKU_NA_STRANKU);
              }}
              options={[
                { value: "vse", label: `Vše ${prubeh.celkem}` },
                { value: "nespocitane", label: `Nespočítané ${prubeh.celkem - prubeh.hotovo}` },
                { value: "rozdily", label: `Rozdíly ${rozdily.length}` },
              ]}
            />
          </div>

          {kPridani.length > 0 && canCount && (
            <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap", alignItems: "center", fontSize: "var(--text-sm)" }}>
              <span style={{ color: "var(--muted)" }}>Není v inventuře, přidat:</span>
              {kPridani.map((p) => (
                <Button key={p.id} size="sm" variant="soft" icon={<PlusIcon size={12} />} onClick={() => void pridatDoInventury(p.id, null)}>
                  {p.name}
                </Button>
              ))}
            </div>
          )}

          {!nactenoPolozky ? (
            <div style={{ padding: "var(--space-5)", textAlign: "center", color: "var(--muted)" }}>Načítám položky…</div>
          ) : polozky.length === 0 ? (
            <div style={{ padding: "var(--space-5)", textAlign: "center", color: "var(--muted)" }}>
              V inventuře nejsou žádné položky. Ve skladu nebylo nic evidováno – díly, které na regálu najdete, přidejte hledáním nebo čtečkou.
            </div>
          ) : zobrazene.length === 0 ? (
            <div style={{ padding: "var(--space-5)", textAlign: "center", color: "var(--muted)" }}>Nic neodpovídá hledání ani filtru.</div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "var(--text-sm)" }}>
                <thead>
                  <tr style={{ textAlign: "left", color: "var(--muted)", fontSize: "var(--text-xs)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                    <th style={{ padding: "6px 8px" }}>Produkt</th>
                    <th style={{ padding: "6px 8px", textAlign: "right" }} title="Evidovaný stav ve skladu při zahájení (a při počítání, pokud se mezitím změnil).">Evidováno</th>
                    <th style={{ padding: "6px 8px", textAlign: "right" }} title="Rezervováno pro zakázky – díly pořád leží na regálu, počítejte je.">Rezerv.</th>
                    <th style={{ padding: "6px 8px", width: 110 }}>Napočítáno</th>
                    <th style={{ padding: "6px 8px", textAlign: "right" }}>Rozdíl</th>
                    <th style={{ padding: "6px 8px", textAlign: "right" }}>Kč</th>
                    <th style={{ padding: "6px 8px" }}>Kdo</th>
                  </tr>
                </thead>
                <tbody>
                  {zobrazene.slice(0, zobrazitRadku).map((p) => {
                    const r = rozdilPolozky(p);
                    const kc = ocenitRozdil(p);
                    const nespocitano = p.napocitano === null;
                    const zaklad = zakladPolozky(p);
                    const text = rozepsane[p.id] ?? (p.napocitano === null ? "" : String(p.napocitano));
                    const chyba = chybyRadku[p.id];
                    const smazany = p.productId === null;
                    return (
                      <tr
                        key={p.id}
                        style={{
                          borderTop: "1px solid var(--border)",
                          background: zvyraznenyId === p.id ? "var(--accent-soft)" : nespocitano && otevrena && !smazany ? "var(--warning-soft)" : undefined,
                          boxShadow: nespocitano && otevrena && !smazany ? "inset 3px 0 0 var(--warning)" : undefined,
                          transition: "background 0.3s",
                          opacity: smazany ? 0.6 : 1,
                        }}
                      >
                        <td style={{ padding: "6px 8px", minWidth: 180 }}>
                          <div style={{ fontWeight: 700 }}>{p.nazev}{smazany && " (smazaný produkt)"}</div>
                          <div style={{ fontSize: "var(--text-xs)", color: "var(--muted)" }}>
                            {p.sku || "bez kódu"}
                            {p.pridanoRucne && " · přidáno při inventuře"}
                          </div>
                        </td>
                        <td style={{ padding: "6px 8px", textAlign: "right", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
                          {p.ocekavano}
                          {p.stavPriPocitani !== null && p.stavPriPocitani !== p.ocekavano && (
                            <div style={{ fontSize: "var(--text-xs)", color: "var(--muted)" }} title="Sklad se mezi zahájením a spočítáním pohnul (zakázka, objednávka). Rozdíl se počítá proti tomuhle číslu.">
                              při počítání {zaklad}
                            </div>
                          )}
                        </td>
                        <td style={{ padding: "6px 8px", textAlign: "right", color: p.rezervovano > 0 ? "var(--text)" : "var(--muted)", fontVariantNumeric: "tabular-nums" }}>
                          {p.rezervovano || "–"}
                        </td>
                        <td style={{ padding: "6px 8px" }}>
                          {otevrena && canCount && !smazany ? (
                            <>
                              <Input
                                ref={(el) => {
                                  if (el) poleRef.current.set(p.id, el);
                                  else poleRef.current.delete(p.id);
                                }}
                                inputMode="numeric"
                                value={text}
                                invalid={!!chyba}
                                placeholder="–"
                                aria-label={`Napočítáno: ${p.nazev}`}
                                title={chyba}
                                onChange={(e) => {
                                  nastavRozepsane(p.id, e.target.value);
                                  const stary = odkladRef.current.get(p.id);
                                  if (stary) clearTimeout(stary);
                                  odkladRef.current.set(
                                    p.id,
                                    setTimeout(() => {
                                      odkladRef.current.delete(p.id);
                                      const aktualni = polozkyRef.current.find((x) => x.id === p.id);
                                      if (aktualni) potvrditPole(aktualni);
                                    }, ODKLAD_ULOZENI_MS)
                                  );
                                }}
                                onBlur={() => potvrditPole(p)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") {
                                    e.preventDefault();
                                    potvrditPole(p);
                                    // Enter skočí na další řádek – počítá se po regálech za sebou.
                                    const i = zobrazene.findIndex((x) => x.id === p.id);
                                    const dalsi = zobrazene[i + 1];
                                    if (dalsi) poleRef.current.get(dalsi.id)?.focus();
                                  } else if (e.key === "Escape") {
                                    e.stopPropagation();
                                    nastavRozepsane(p.id, undefined);
                                  }
                                }}
                                style={{ width: 90, textAlign: "right", fontVariantNumeric: "tabular-nums" }}
                              />
                              {ukladam.has(p.id) && <div style={{ fontSize: 10, color: "var(--muted)" }}>Ukládám…</div>}
                              {veFronte.has(p.id) && !ukladam.has(p.id) && (
                                <div style={{ fontSize: 10, color: "var(--warning-text)" }} title="Spojení vypadlo. Počet se uloží sám, jakmile bude připojení.">Čeká na síť</div>
                              )}
                              {chyba && <div style={{ fontSize: 10, color: "var(--danger-text)", maxWidth: 160 }}>{chyba}</div>}
                            </>
                          ) : (
                            <span style={{ fontWeight: 800, fontVariantNumeric: "tabular-nums", color: nespocitano ? "var(--muted)" : "var(--text)" }}>
                              {nespocitano ? "nespočítáno" : p.napocitano}
                            </span>
                          )}
                        </td>
                        <td style={{ padding: "6px 8px", textAlign: "right", whiteSpace: "nowrap" }}>
                          <RozdilText r={r} />
                          {vybrana.status === "closed" && p.zapsanyRozdil !== null && r !== null && p.zapsanyRozdil !== r && (
                            <div style={{ fontSize: "var(--text-xs)", color: "var(--muted)" }} title="Sklad nejde pod nulu – zapsalo se méně.">
                              zapsáno {p.zapsanyRozdil > 0 ? `+${p.zapsanyRozdil}` : p.zapsanyRozdil}
                            </div>
                          )}
                        </td>
                        <td style={{ padding: "6px 8px", textAlign: "right", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums", color: kc === null ? "var(--muted)" : kc < 0 ? "var(--danger-text)" : kc > 0 ? "var(--info-text)" : "var(--muted)" }}>
                          {kc === null ? (r !== null && r !== 0 ? "bez ceny" : "–") : kc === 0 ? "–" : formatKcPresne.format(kc)}
                        </td>
                        <td style={{ padding: "6px 8px", fontSize: "var(--text-xs)", color: "var(--muted)", whiteSpace: "nowrap" }}>
                          {p.napocital ? (
                            <>
                              {jmeno(p.napocital)}
                              <div>{formatDatum(p.napocitanoAt)}</div>
                            </>
                          ) : "–"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {zobrazene.length > zobrazitRadku && (
                <div style={{ textAlign: "center", marginTop: "var(--space-3)" }}>
                  <Button variant="soft" onClick={() => setZobrazitRadku((n) => n + RADKU_NA_STRANKU)}>
                    Zobrazit dalších {Math.min(RADKU_NA_STRANKU, zobrazene.length - zobrazitRadku)} z {zobrazene.length - zobrazitRadku}
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>

        <InventoryDialog
          open={uzavritOtevreno}
          title={`Uzavřít inventuru ${vybrana.cislo}`}
          subtitle={`${vybrana.skladNazev} · spočítáno ${prubeh.hotovo} z ${prubeh.celkem}`}
          onClose={() => {
            if (!uzaviram) setUzavritOtevreno(false);
          }}
          width={720}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
            <SouhrnDlazdice s={souhrn} />
            {rozdily.length === 0 ? (
              <div style={{ fontSize: "var(--text-sm)", color: "var(--success-text)", fontWeight: 700 }}>
                Všechno, co je spočítané, sedí s evidencí. Uzavření sklad nezmění.
              </div>
            ) : (
              <div>
                <Label>Rozdíly, které se zapíšou do skladu</Label>
                <div style={{ maxHeight: 260, overflowY: "auto", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", marginTop: "var(--space-1)" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "var(--text-sm)" }}>
                    <tbody>
                      {rozdily.map((p) => {
                        const r = rozdilPolozky(p);
                        const kc = ocenitRozdil(p);
                        return (
                          <tr key={p.id} style={{ borderTop: "1px solid var(--border)" }}>
                            <td style={{ padding: "4px 8px" }}>{p.nazev}</td>
                            <td style={{ padding: "4px 8px", textAlign: "right", color: "var(--muted)", whiteSpace: "nowrap" }}>
                              {zakladPolozky(p)} → {p.napocitano}
                            </td>
                            <td style={{ padding: "4px 8px", textAlign: "right", whiteSpace: "nowrap" }}><RozdilText r={r} /></td>
                            <td style={{ padding: "4px 8px", textAlign: "right", whiteSpace: "nowrap", color: "var(--muted)" }}>
                              {kc === null ? "bez ceny" : formatKcPresne.format(kc)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {prubeh.celkem - prubeh.hotovo > 0 && (
              <label style={{ display: "flex", gap: "var(--space-2)", alignItems: "flex-start", fontSize: "var(--text-sm)", cursor: "pointer" }}>
                <input type="checkbox" checked={bezeZmeny} onChange={(e) => setBezeZmeny(e.target.checked)} style={{ marginTop: 3 }} />
                <span>
                  <strong>{sklonuj(prubeh.celkem - prubeh.hotovo, ["položka není spočítaná", "položky nejsou spočítané", "položek není spočítaných"])}.</strong>{" "}
                  Nechat je ve skladu beze změny (evidovaný stav se u nich nepřepíše).
                </span>
              </label>
            )}

            <div>
              <Label>Poznámka k protokolu (nepovinná)</Label>
              <textarea
                className="ui-input"
                value={poznamkaUzavreni}
                onChange={(e) => setPoznamkaUzavreni(e.target.value)}
                placeholder="Např. manko u sklíček – rozbité při montáži, nezapsané."
                style={{ marginTop: "var(--space-1)", minHeight: 56, resize: "vertical" }}
              />
            </div>

            <div style={{ fontSize: "var(--text-sm)", color: "var(--muted)", display: "flex", gap: 6, alignItems: "flex-start" }}>
              <WarningIcon size={14} />
              <span>
                Po uzavření se stav skladu srovná s napočítaným a inventura se zamkne – zpětně to nejde vrátit.
                Pohyby od spočítání (odpisy zakázek, příjem objednávek) zůstanou zachované.
              </span>
            </div>

            {!moznost.ok && <div style={{ fontSize: "var(--text-sm)", color: "var(--danger-text)", fontWeight: 700 }}>{moznost.duvod}</div>}

            <div style={{ display: "flex", justifyContent: "flex-end", gap: "var(--space-2)" }}>
              <Button variant="ghost" onClick={() => setUzavritOtevreno(false)} disabled={uzaviram}>Zpět k počítání</Button>
              <Button variant="primary" icon={<CheckIcon size={14} />} disabled={!moznost.ok || uzaviram || !canClose} onClick={() => void uzavrit()}>
                {uzaviram ? "Uzavírám…" : "Uzavřít a zapsat rozdíly"}
              </Button>
            </div>
          </div>
        </InventoryDialog>

        <ConfirmDialog
          open={zrusitOtevreno}
          title="Zrušit inventuru?"
          message={`Inventura ${vybrana.cislo} se zamkne jako zrušená a sklad zůstane beze změny. Napočítaná čísla zůstanou vidět v historii, ale do skladu se nezapíšou.`}
          confirmLabel="Zrušit inventuru"
          cancelLabel="Pokračovat v počítání"
          variant="danger"
          onConfirm={zrusit}
          onCancel={() => setZrusitOtevreno(false)}
        />
      </>
    );
  }

  /* ===== přehled: rozdělané, nová, historie ===== */
  return (
    <>
      {otevrene.length > 0 && (
        <div className="ui-card" style={{ display: "flex", flexDirection: "column" }}>
          <SectionHeading icon={<BoxIcon size={16} />}>Rozdělané inventury</SectionHeading>
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
            {otevrene.map((i) => (
              <button key={i.id} type="button" onClick={() => otevrit(i.id)} style={{ ...radekSeznamu, cursor: "pointer" }}>
                <div style={{ flex: "1 1 220px", minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", flexWrap: "wrap" }}>
                    <span style={{ fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>{i.cislo}</span>
                    <StavPill status={i.status} />
                  </div>
                  <div style={{ fontSize: "var(--text-xs)", color: "var(--muted)", marginTop: 2 }}>
                    {i.skladNazev || "Smazaný sklad"}
                    {branchName(i.branchId) ? ` · ${branchName(i.branchId)}` : ""} · zahájil {jmeno(i.zahajil)} {formatDatum(i.zahajenoAt)}
                  </div>
                </div>
                <span style={{ fontWeight: 800, color: "var(--accent)" }}>Pokračovat v počítání →</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="ui-card" style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
        <SectionHeading icon={<PlusIcon size={16} />}>Zahájit inventuru</SectionHeading>
        <div style={{ fontSize: "var(--text-sm)", color: "var(--muted)", maxWidth: 720 }}>
          Inventura se dělá po skladech. Zahájení zmrazí seznam produktů s evidovaným stavem; pak postupně zapisujete, kolik kusů
          je opravdu na regálu – klidně víc lidí naráz a víc dní. Uzavření ukáže manko a přebytek a srovná sklad s napočítaným.
        </div>
        {!canManage ? (
          <div style={{ fontSize: "var(--text-sm)", color: "var(--warning-text)", display: "flex", gap: 6, alignItems: "center" }}>
            <WarningIcon size={14} /> Zahájit inventuru smí jen kdo má právo upravovat sklad.
          </div>
        ) : volneSklady.length === 0 ? (
          <div style={{ fontSize: "var(--text-sm)", color: "var(--muted)" }}>
            {warehouses.length === 0 ? "Není žádný sklad, kde by šla inventura zahájit." : "Ve všech skladech už inventura běží."}
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "var(--space-3)", alignItems: "end" }}>
            <div>
              <Label>Sklad</Label>
              <select
                className="ui-input"
                value={zvolenySklad}
                onChange={(e) => setNovySklad(e.target.value)}
                style={{ marginTop: "var(--space-1)" }}
                aria-label="Sklad pro inventuru"
              >
                {volneSklady.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                    {branchName(w.branchId) ? ` (${branchName(w.branchId)})` : ""}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label>Poznámka (nepovinná)</Label>
              <Input
                value={novaPoznamka}
                onChange={(e) => setNovaPoznamka(e.target.value)}
                placeholder="Např. roční inventura 2026"
                style={{ marginTop: "var(--space-1)" }}
              />
            </div>
            <label style={{ display: "flex", gap: "var(--space-2)", alignItems: "center", fontSize: "var(--text-sm)", cursor: "pointer" }}>
              <input type="checkbox" checked={vcetneNulovych} onChange={(e) => setVcetneNulovych(e.target.checked)} />
              Zahrnout i produkty s nulovým stavem
            </label>
            <div>
              <Button variant="primary" icon={<CheckIcon size={14} />} disabled={!zvolenySklad || zahajuji} onClick={() => void zahajit()}>
                {zahajuji ? "Zahajuji…" : "Zahájit inventuru"}
              </Button>
            </div>
          </div>
        )}
      </div>

      <div className="ui-card" style={{ display: "flex", flexDirection: "column" }}>
        <SectionHeading icon={<HistoryIcon size={16} />}>Historie inventur</SectionHeading>
        {!nacteno ? (
          <div style={{ padding: "var(--space-4)", color: "var(--muted)", textAlign: "center" }}>Načítám…</div>
        ) : historie.length === 0 ? (
          <div style={{ padding: "var(--space-4)", color: "var(--muted)", textAlign: "center", fontSize: "var(--text-sm)" }}>
            Zatím žádná uzavřená inventura. Protokol každé uzavřené inventury (kdo, kdy, rozdíly) najdete tady.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
            {historie.map((i) => (
              <div key={i.id} style={radekSeznamu}>
                <div style={{ flex: "1 1 220px", minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", flexWrap: "wrap" }}>
                    <span style={{ fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>{i.cislo}</span>
                    <StavPill status={i.status} />
                  </div>
                  <div style={{ fontSize: "var(--text-xs)", color: "var(--muted)", marginTop: 2 }}>
                    {i.skladNazev || "Smazaný sklad"}
                    {branchName(i.branchId) ? ` · ${branchName(i.branchId)}` : ""} · {i.status === "closed" ? "uzavřel" : "zrušil"} {jmeno(i.uzavrel)} {formatDatum(i.uzavrenoAt)}
                  </div>
                </div>
                {i.status === "closed" && i.souhrn && (
                  <div style={{ fontSize: "var(--text-xs)", whiteSpace: "nowrap", textAlign: "right" }}>
                    <div style={{ color: i.souhrn.mankoKs > 0 ? "var(--danger-text)" : "var(--muted)" }}>
                      Manko {i.souhrn.mankoKs} ks · {formatKc.format(i.souhrn.mankoKc)}
                    </div>
                    <div style={{ color: i.souhrn.prebytekKs > 0 ? "var(--info-text)" : "var(--muted)" }}>
                      Přebytek {i.souhrn.prebytekKs} ks · {formatKc.format(i.souhrn.prebytekKc)}
                    </div>
                  </div>
                )}
                <div style={{ display: "flex", gap: "var(--space-2)" }}>
                  <Button size="sm" variant="soft" onClick={() => otevrit(i.id)}>Protokol</Button>
                  <Button size="sm" variant="ghost" icon={<DownloadIcon size={12} />} onClick={() => void exportovat(i)}>CSV</Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
