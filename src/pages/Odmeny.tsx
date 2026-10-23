import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { formatCurrency } from "../lib/invoiceMath";
import { GiftIcon } from "../components/icons";
import { Button } from "../components/ui";
import { showPersistentToast, showToast } from "../components/Toast";
import { useClenoveServisu } from "../hooks/useClenoveServisu";
import { useBranches } from "../context/BranchContext";
import { jeStornoStav } from "../lib/stornoStav";
import { serverNeznaPobocku, sPobockou, vetaCekajiciJinde, vetaPobockyOdmen, POPIS_STAVU_RUCNI, oznaceneOpravySPravidlem, kdyPripiseOdmenu, nadpisCekajicich, normalizujCekajiciNaZapocteni, type CekajiciOdmena, normalizujKdyOdpovedi, sloupecKdyOdmeny, vetaKdyOdmeny, type RezimOdmen, hraniceMesice, klicMesice, nazevMesice, normalizujPravidlaRucni, normalizujRucni, posunKlicMesice, zamestnanecMesice, type ClovekOdmeny, type PravidloRucni, type RucniOdmena } from "../lib/odmeny";
import { PridatOdmenuDialog } from "./Odmeny/PridatOdmenuDialog";

/**
 * Odměny týmu – kdo má za měsíc kolik za nabídnuté opravy.
 *
 * Data dává RPC odmeny_prehled (migrace 20260926190000): řádky za měsíc
 * podle data vydání zakázky (nebo podle nastavení „Kdy se odměna
 * připočítá“ – přidání opravy, dosažení stavu; migrace 20261009120000), součty na člověka, měsíční řada rok zpět a
 * vyplaceno. Pravidla se nastavují v Nastavení → Tým → Odměny za opravy.
 * Majitel a správce tu můžou u řádku změnit příjemce, řádek vyřadit a
 * zaškrtnout vyplaceno; člen vidí svoje a – při veřejném žebříčku – i
 * kolegy a zaměstnance měsíce.
 *
 * Ruční odměny (migrace 20261009100000): tlačítko „Přidat odměnu“ – podle
 * pravidla, s poznámkou, volitelně k zakázce. Zaměstnancova čeká na
 * schválení (Ke schválení nahoře u správce), správcova platí hned; do
 * součtů, žebříčku i vyplácení se počítají jen schválené.
 *
 * Čeká na vydání (migrace 20261023170000): označené opravy, které se ještě
 * nezapočetly (zakázka není vydaná / nedosáhla stavu). Bez nich člověk po
 * zaškrtnutí „Nabídnuto navíc“ nic neviděl a zadal odměnu ještě ručně.
 *
 * Rozvržení (23. 10. 2026, majitel: „není pochopitelný, kde se má co
 * schvalovat“): shora Ke schválení (jediné místo se schvalováním, u správce
 * vždy viditelné), Čeká na vydání (jen informace), Přidat ruční odměnu,
 * Započtené za měsíc (výběr měsíce, opravy, ruční) a dole Součty se
 * žebříčkem. Každý oddíl má větu, proč tam položky jsou a co s nimi.
 *
 * Pobočka (migrace 20261023190000): stránka se řídí pobočkou z horní lišty
 * jako Zakázky a Statistiky – řádky, součty, zaměstnanec měsíce, síň slávy,
 * Čeká na vydání i ruční odměny jsou za vybranou pobočku (zakázka podle
 * pobočky příjmu, ruční bez zakázky podle pobočky, ve které se přidala).
 * Vyplácení je za celý servis, v pobočce se jen ukazuje. Starší databáze
 * pobočku nezná – stránka pak ukáže čísla za všechny a řekne to.
 */

type Radek = {
  ticketId: string;
  kod: string | null;
  zakaznik: string | null;
  zarizeni: string | null;
  polozkaId: string;
  oprava: string;
  cena: number;
  pravidloId: string;
  pravidlo: string;
  komu: "pridal" | "technik";
  userId: string | null;
  jmeno: string | null;
  castka: number;
  /** Skutečné datum vydání; prázdné u nevydané zakázky (režim přidání / stav). */
  vydanoAt: string;
  /** Datum, podle kterého se odměna počítá do měsíce (podle režimu). */
  zapocteno: string;
  vyrazeno: boolean;
  prepsano: boolean;
  poznamka: string | null;
  /** Nabídnuto zákazníkovi navíc – jen s tím se odměna počítá. */
  nabidnuto: boolean;
  nabidnutoPrepsano: boolean;
};

type Mesic = { mesic: string; userId: string | null; jmeno: string; pocet: number; castka: number };
type Vyplata = { userId: string; obdobi: string; castka: number; vyplacenoAt: string };

/** Člověk v žebříčku; `pocet` = opravy + schválené ruční odměny. */
type Clovek = ClovekOdmeny & { pocetRucnich: number };

type Prehled = {
  zapnuto: boolean;
  /** Kdy se odměna připočítá – platný režim podle serveru (neplatný stav = vydání). */
  kdy: { rezim: RezimOdmen; stav: string | null; stavNazev: string | null };
  verejny: boolean;
  admin: boolean;
  ja: string | null;
  radky: Radek[];
  lide: Clovek[];
  mesice: Mesic[];
  vyplaty: Vyplata[];
  /** Ruční odměny vybraného měsíce (čekající a zamítnuté jen správci a vlastní). */
  rucni: RucniOdmena[];
  /** Vše, co čeká na schválení – správce celý servis, ostatní svoje. */
  cekajici: RucniOdmena[];
  /** Aktivní pravidla pro dialog Přidat odměnu. */
  pravidla: PravidloRucni[];
  /** Komu se ruční odměny schvalují automaticky (správce všichni, člen jen on sám). */
  autoSchvaleni: string[];
  /** Označené opravy, které se připíšou po vydání / dosažení stavu (správce vše, člen svoje). */
  cekajiciNaZapocteni: CekajiciOdmena[];
  /** Za kterou pobočku čísla opravdu jsou; null = všechny (i když databáze filtr ještě neumí). */
  pobocka: string | null;
  /** Pobočka byla vybraná, ale databáze ji nezná (bez migrace 20261023190000) – čísla jsou za všechny. */
  pobockaNeumi: boolean;
  /** Čekající ruční odměny, které ve vybrané pobočce nejsou vidět. */
  cekajiciJinde: number;
};

const kc = (n: number) => formatCurrency(Number(n) || 0, "CZK");
const datum = (iso: string) => new Date(iso).toLocaleDateString("cs-CZ", { day: "numeric", month: "numeric", year: "numeric" });
const cislo = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
/** 1 odměna, 2 odměny, 5 odměn */
const odmen = (n: number) => (n === 1 ? "odměna" : n >= 2 && n <= 4 ? "odměny" : "odměn");

function prevedPrehled(raw: unknown, pobockaNeumi = false): Prehled {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const pole = (v: unknown) => (Array.isArray(v) ? (v as Record<string, unknown>[]) : []);
  return {
    zapnuto: o.zapnuto === true,
    kdy: normalizujKdyOdpovedi(o.kdy),
    verejny: o.verejny !== false,
    admin: o.admin === true,
    ja: typeof o.ja === "string" ? o.ja : null,
    radky: pole(o.radky).map((r) => ({
      ticketId: String(r.ticketId ?? ""),
      kod: typeof r.kod === "string" ? r.kod : null,
      zakaznik: typeof r.zakaznik === "string" ? r.zakaznik : null,
      zarizeni: typeof r.zarizeni === "string" ? r.zarizeni : null,
      polozkaId: String(r.polozkaId ?? ""),
      oprava: String(r.oprava ?? ""),
      cena: cislo(r.cena),
      pravidloId: String(r.pravidloId ?? ""),
      pravidlo: String(r.pravidlo ?? ""),
      komu: r.komu === "technik" ? "technik" : "pridal",
      userId: typeof r.userId === "string" ? r.userId : null,
      jmeno: typeof r.jmeno === "string" ? r.jmeno : null,
      castka: cislo(r.castka),
      vydanoAt: String(r.vydanoAt ?? ""),
      // Starší server bez „zapocteno“ počítal podle vydání.
      zapocteno: String(r.zapocteno ?? r.vydanoAt ?? ""),
      vyrazeno: r.vyrazeno === true,
      prepsano: r.prepsano === true,
      poznamka: typeof r.poznamka === "string" ? r.poznamka : null,
      nabidnuto: r.nabidnuto === true,
      nabidnutoPrepsano: r.nabidnutoPrepsano === true,
    })),
    lide: pole(o.lide).map((l) => ({ userId: typeof l.userId === "string" ? l.userId : null, jmeno: String(l.jmeno ?? "Kolega"), pocet: cislo(l.pocet), castka: cislo(l.castka), pocetRucnich: cislo(l.pocetRucnich) })),
    mesice: pole(o.mesice).map((m) => ({ mesic: String(m.mesic ?? ""), userId: typeof m.userId === "string" ? m.userId : null, jmeno: String(m.jmeno ?? "Kolega"), pocet: cislo(m.pocet), castka: cislo(m.castka) })),
    vyplaty: pole(o.vyplaty).map((v) => ({ userId: String(v.userId ?? ""), obdobi: String(v.obdobi ?? ""), castka: cislo(v.castka), vyplacenoAt: String(v.vyplacenoAt ?? "") })),
    rucni: normalizujRucni(o.rucni),
    cekajici: normalizujRucni(o.cekajici),
    pravidla: normalizujPravidlaRucni(o.pravidla),
    autoSchvaleni: (Array.isArray(o.autoSchvaleni) ? o.autoSchvaleni : []).filter((x): x is string => typeof x === "string"),
    cekajiciNaZapocteni: normalizujCekajiciNaZapocteni(o.cekajiciNaZapocteni),
    pobocka: typeof o.pobocka === "string" ? o.pobocka : null,
    pobockaNeumi,
    cekajiciJinde: cislo(o.cekajiciJinde),
  };
}

export function Odmeny({ activeServiceId, onOpenTicket, onOtevritNastaveni }: { activeServiceId: string | null; onOpenTicket?: (ticketId: string) => void; onOtevritNastaveni?: () => void }) {
  const [mesic, setMesic] = useState(() => klicMesice(new Date()));
  const [data, setData] = useState<Prehled | null>(null);
  const [chyba, setChyba] = useState<string | null>(null);
  const [nacitam, setNacitam] = useState(false);
  const [filtrClovek, setFiltrClovek] = useState<string | "vse">("vse");
  /** Správce: ukázat i opravy podle pravidla, které nebyly nabídnuté navíc (kandidáti k označení). */
  const [ukazatNenabidnute, setUkazatNenabidnute] = useState(false);
  const { clenove } = useClenoveServisu(activeServiceId, !!data?.admin);
  const [pridavam, setPridavam] = useState(false);
  /** Předvybrané pravidlo pro dialog (procentní pravidlo z rychlého tlačítka). */
  const [pridavamPravidlo, setPridavamPravidlo] = useState<string | undefined>(undefined);
  /** Rychlé přidání: komu (správce může jinému), a které pravidlo se právě ukládá. */
  const [rychleKomu, setRychleKomu] = useState<string>("");
  const [rychleUkladam, setRychleUkladam] = useState<string | null>(null);
  /** Ruční odměna, u které správce právě píše důvod zamítnutí. */
  const [zamitam, setZamitam] = useState<{ id: string; duvod: string } | null>(null);
  /** Pobočka z horní lišty (null = všechny) – stejný filtr jako Zakázky a Statistiky. */
  const { activeBranchId, isMulti: vicePobocek, branchById } = useBranches();
  /** Při rychlém přepínání pobočky / měsíce platí jen poslední odpověď. */
  const posledniDotaz = useRef(0);

  const nacti = useCallback(async () => {
    if (!supabase || !activeServiceId) return;
    const poradi = ++posledniDotaz.current;
    setNacitam(true);
    setChyba(null);
    const h = hraniceMesice(mesic);
    const zaklad = {
      p_service_id: activeServiceId,
      p_od: h.od.toISOString(),
      p_do: h.do.toISOString(),
      p_tz: Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/Prague",
    };
    // deno-lint-ignore no-explicit-any
    const rpc = (parametry: Record<string, unknown>) => (supabase as any).rpc("odmeny_prehled", parametry);
    let { data: d, error } = await rpc(sPobockou(zaklad, activeBranchId));
    // Databáze bez migrace 20261023190000 pobočku nezná: čísla za všechny, a stránka to řekne.
    const pobockaNeumi = !!error && !!activeBranchId && serverNeznaPobocku(error);
    if (pobockaNeumi) ({ data: d, error } = await rpc(zaklad));
    if (poradi !== posledniDotaz.current) return;
    setNacitam(false);
    if (error) {
      setChyba(error.message);
      setData(null);
      return;
    }
    setData(prevedPrehled(d, pobockaNeumi));
  }, [activeServiceId, mesic, activeBranchId]);

  useEffect(() => {
    setData(null);
    setFiltrClovek("vse");
    void nacti();
  }, [nacti]);

  const tentoMesic = klicMesice(new Date());
  const vitezove = useMemo(() => zamestnanecMesice(data?.lide ?? []), [data]);
  const celkem = useMemo(() => (data?.lide ?? []).reduce((s, l) => s + l.castka, 0), [data]);
  const moje = useMemo(() => (data?.lide ?? []).find((l) => l.userId && l.userId === data?.ja) ?? null, [data]);
  const vyplaceno = useMemo(() => new Map((data?.vyplaty ?? []).filter((v) => v.obdobi === mesic).map((v) => [v.userId, v])), [data, mesic]);
  const zobrazene = useMemo(
    () => (data?.radky ?? []).filter((r) => (r.nabidnuto || ukazatNenabidnute) && (filtrClovek === "vse" || (r.userId ?? "") === filtrClovek)),
    [data, filtrClovek, ukazatNenabidnute]
  );
  const pocetNenabidnutych = useMemo(() => (data?.radky ?? []).filter((r) => !r.nabidnuto).length, [data]);
  const rucniZobrazene = useMemo(
    () => (data?.rucni ?? []).filter((r) => filtrClovek === "vse" || r.userId === filtrClovek),
    [data, filtrClovek]
  );
  const autoSchvaleni = useMemo(() => new Set(data?.autoSchvaleni ?? []), [data]);
  const mojeCeka = useMemo(() => (data?.cekajiciNaZapocteni ?? []).filter((c) => !!c.userId && c.userId === data?.ja).reduce((s, c) => s + c.castka, 0), [data]);
  const cekajiciZobrazene = useMemo(
    () => (data?.cekajiciNaZapocteni ?? []).filter((c) => filtrClovek === "vse" || (c.userId ?? "") === filtrClovek),
    [data, filtrClovek]
  );
  /** Nápověda u data v tabulce: podle čeho se odměna počítá do měsíce. */
  const titulekZapocteno = data?.kdy.rezim === "pridani"
    ? "Kdy byla oprava přidána na zakázku"
    : data?.kdy.rezim === "stav"
      ? `Kdy zakázka poprvé dosáhla stavu „${data.kdy.stavNazev ?? data.kdy.stav ?? ""}“ (nebo stavu dál)`
      : "Kdy byla zakázka vydána";

  /** Síň slávy: vítěz každého měsíce z posledních 12 (podle dat, která volající smí vidět). */
  const sinSlavy = useMemo(() => {
    const podleMesice = new Map<string, ClovekOdmeny[]>();
    for (const m of data?.mesice ?? []) {
      const l = podleMesice.get(m.mesic) ?? [];
      l.push({ userId: m.userId, jmeno: m.jmeno, pocet: m.pocet, castka: m.castka });
      podleMesice.set(m.mesic, l);
    }
    return [...podleMesice.entries()]
      .sort(([a], [b]) => (a < b ? 1 : -1))
      .map(([klic, lide]) => ({ klic, vitezove: zamestnanecMesice(lide), celkem: lide.reduce((s, l) => s + l.castka, 0) }));
  }, [data]);

  const otevriZakazku = useCallback((ticketId: string) => {
    if (onOpenTicket) { onOpenTicket(ticketId); return; }
    window.dispatchEvent(new CustomEvent("jobsheet:navigate", { detail: { page: "orders", openTicketId: ticketId, returnToPage: "odmeny" } }));
  }, [onOpenTicket]);

  // --- ruční odměny -----------------------------------------------------------
  const rozhodni = useCallback(async (r: RucniOdmena, stav: "schvaleno" | "zamitnuto", duvod?: string) => {
    if (!supabase || !data?.admin) return;
    // deno-lint-ignore no-explicit-any
    const { error } = await (supabase as any).from("odmeny_rucni")
      .update({ stav, duvod_zamitnuti: stav === "zamitnuto" ? (duvod?.trim() || null) : null })
      .eq("id", r.id);
    if (error) { showToast(`Uložení selhalo: ${error.message}`, "error"); return; }
    setZamitam(null);
    showToast(stav === "schvaleno" ? `Odměna pro ${r.jmeno} schválena.` : "Odměna zamítnuta.", "success");
    void nacti();
  }, [data, nacti]);

  const smazRucni = useCallback(async (r: RucniOdmena) => {
    if (!supabase) return;
    if (!window.confirm(`Smazat ruční odměnu „${r.pravidlo}“ (${kc(r.castka)})?`)) return;
    // deno-lint-ignore no-explicit-any
    const { data: smazane, error } = await (supabase as any).from("odmeny_rucni").delete().eq("id", r.id).select("id");
    if (error) { showToast(`Smazání selhalo: ${error.message}`, "error"); return; }
    if (!Array.isArray(smazane) || smazane.length === 0) showToast("Odměnu už nejde smazat – mezitím ji někdo schválil.", "error");
    void nacti();
  }, [nacti]);

  const zapniAutoSchvalovani = useCallback(async (userId: string, jmeno: string) => {
    if (!supabase || !activeServiceId || !data?.admin) return;
    // deno-lint-ignore no-explicit-any
    const { error } = await (supabase as any).from("odmeny_auto_schvaleni")
      .upsert({ service_id: activeServiceId, user_id: userId, nastavil: data.ja }, { onConflict: "service_id,user_id", ignoreDuplicates: true });
    if (error) { showToast(`Uložení selhalo: ${error.message}`, "error"); return; }
    showToast(`Další ruční odměny – ${jmeno} se budou schvalovat automaticky. Vypnout jde v Nastavení → Odměny za opravy.`, "success");
    void nacti();
  }, [activeServiceId, data, nacti]);

  // --- akce správce ---------------------------------------------------------
  const ulozUpravu = useCallback(async (r: Radek, zmena: { userId?: string | null; vyrazeno?: boolean; nabidnuto?: boolean | null }) => {
    if (!supabase || !activeServiceId || !data?.admin) return;
    const userId = zmena.userId === undefined ? (r.prepsano ? r.userId : null) : zmena.userId;
    const vyrazeno = zmena.vyrazeno ?? r.vyrazeno;
    const nabidnuto = zmena.nabidnuto === undefined ? (r.nabidnutoPrepsano ? r.nabidnuto : null) : zmena.nabidnuto;
    // deno-lint-ignore no-explicit-any
    const tab = (supabase as any).from("odmeny_upravy");
    const { error } = userId === null && !vyrazeno && nabidnuto === null
      ? await tab.delete().eq("ticket_id", r.ticketId).eq("polozka_id", r.polozkaId)
      : await tab.upsert({ service_id: activeServiceId, ticket_id: r.ticketId, polozka_id: r.polozkaId, user_id: userId, vyrazeno, nabidnuto, updated_by: data.ja, updated_at: new Date().toISOString() }, { onConflict: "ticket_id,polozka_id" });
    if (error) { showToast(`Uložení selhalo: ${error.message}`, "error"); return; }
    void nacti();
  }, [activeServiceId, data, nacti]);

  const prepniVyplaceno = useCallback(async (l: ClovekOdmeny) => {
    if (!supabase || !activeServiceId || !data?.admin || !l.userId) return;
    // deno-lint-ignore no-explicit-any
    const tab = (supabase as any).from("odmeny_vyplaty");
    const uz = vyplaceno.get(l.userId);
    const { error } = uz
      ? await tab.delete().eq("service_id", activeServiceId).eq("user_id", l.userId).eq("obdobi", mesic)
      : await tab.upsert({ service_id: activeServiceId, user_id: l.userId, obdobi: mesic, castka: l.castka, created_by: data.ja }, { onConflict: "service_id,user_id,obdobi" });
    if (error) { showToast(`Uložení selhalo: ${error.message}`, "error"); return; }
    void nacti();
  }, [activeServiceId, data, mesic, vyplaceno, nacti]);

  /* Ke schválení: ruční odměna k zakázce, na které je oprava se stejným
     pravidlem označená „Nabídnuto navíc“, by byla dvojí (počítá se sama).
     Výsledek patří k jedné odpovědi serveru (`pro`), po obnovení se počítá znovu. */
  const [dvojiUSchvaleni, setDvojiUSchvaleni] = useState<{ pro: Prehled | null; mapa: Map<string, string[]> }>({ pro: null, mapa: new Map() });
  useEffect(() => {
    if (!supabase || !data) return;
    const sZakazkou = data.cekajici.filter((r) => r.ticketId);
    if (sZakazkou.length === 0) return;
    let zruseno = false;
    const ids = [...new Set(sZakazkou.map((r) => r.ticketId!))];
    void (async () => {
      // deno-lint-ignore no-explicit-any
      const sb = supabase as any;
      const [{ data: t }, { data: u }] = await Promise.all([
        sb.from("tickets").select("id, status, performed_repairs").in("id", ids),
        sb.from("odmeny_upravy").select("ticket_id, polozka_id, nabidnuto, vyrazeno").in("ticket_id", ids),
      ]);
      if (zruseno) return;
      const zakazky = new Map(((t ?? []) as Record<string, unknown>[]).map((z) => [String(z.id), z]));
      const upravy = ((u ?? []) as Record<string, unknown>[]).map((x) => ({
        ticketId: String(x.ticket_id ?? ""),
        polozkaId: String(x.polozka_id ?? ""),
        nabidnuto: typeof x.nabidnuto === "boolean" ? x.nabidnuto : null,
        vyrazeno: x.vyrazeno === true,
      }));
      const mapa = new Map<string, string[]>();
      for (const r of sZakazkou) {
        const z = zakazky.get(r.ticketId!);
        if (!z || jeStornoStav(typeof z.status === "string" ? z.status : null)) continue;
        const nazvy = oznaceneOpravySPravidlem(z.performed_repairs, data.pravidla, r.pravidloId, upravy.filter((x) => x.ticketId === r.ticketId));
        if (nazvy && nazvy.length > 0) mapa.set(r.id, nazvy);
      }
      setDvojiUSchvaleni({ pro: data, mapa });
    })();
    return () => { zruseno = true; };
  }, [data]);

  // --- styly ------------------------------------------------------------------
  const border = "1px solid var(--border)";
  const dlazdice: React.CSSProperties = { flex: "1 1 200px", padding: 14, borderRadius: 14, border, background: "var(--panel)", minWidth: 0 };
  const popisek: React.CSSProperties = { fontSize: 12, color: "var(--muted)" };
  const velke: React.CSSProperties = { fontSize: 22, fontWeight: 900, color: "var(--text)", whiteSpace: "nowrap" };
  const th: React.CSSProperties = { padding: "8px 10px", borderBottom: border, fontWeight: 600, whiteSpace: "nowrap", textAlign: "left", color: "var(--muted)", fontSize: 12 };
  const td: React.CSSProperties = { padding: "8px 10px", borderBottom: border, fontSize: 13, whiteSpace: "nowrap" };
  const pole: React.CSSProperties = { padding: "8px 10px", borderRadius: 10, border, background: "var(--panel)", color: "var(--text)", fontSize: 13, fontFamily: "inherit" };
  const odkaz: React.CSSProperties = { background: "transparent", border: "none", padding: 0, color: "var(--accent)", fontWeight: 700, cursor: "pointer", fontFamily: "inherit", fontSize: 12 };

  /* Rychlé přidání jedním klikem: pravidlo v Kč, bez poznámky, do měsíce na
     stránce. Kdo se překlikne, vezme odměnu zpět z hlášky (do 10 minut smí
     autor smazat i schválenou – politika v 20261009140000). Procentní
     pravidlo potřebuje cenu, otevře se proto dialog s předvybraným pravidlem. */
  const rychlePridat = useCallback(async (p: PravidloRucni) => {
    if (!supabase || !activeServiceId || !data) return;
    if (p.typ === "procento") { setPridavamPravidlo(p.id); setPridavam(true); return; }
    const komu = data.admin && rychleKomu ? rychleKomu : null;
    setRychleUkladam(p.id);
    const zaklad = {
      p_service_id: activeServiceId, p_pravidlo_id: p.id, p_poznamka: null, p_obdobi: mesic,
      p_ticket_id: null, p_zaklad: null, p_user_id: komu,
    };
    // Odměna bez zakázky patří pobočce, ve které se přidala – jinak by v ní hned zmizela.
    // deno-lint-ignore no-explicit-any
    let { data: v, error } = await (supabase as any).rpc("odmeny_rucni_pridat", sPobockou(zaklad, activeBranchId));
    // deno-lint-ignore no-explicit-any
    if (error && activeBranchId && serverNeznaPobocku(error)) ({ data: v, error } = await (supabase as any).rpc("odmeny_rucni_pridat", zaklad));
    setRychleUkladam(null);
    if (error) { showToast(`Přidání selhalo: ${error.message}`, "error"); return; }
    const id = typeof v?.id === "string" ? v.id : null;
    const prijemce = komu && komu !== data.ja ? (clenove.find((c) => c.userId === komu)?.jmeno ?? "kolegovi") : null;
    const text = `${p.nazev} · ${formatCurrency(Number(v?.castka ?? p.hodnota))}${prijemce ? ` pro ${prijemce}` : ""} – ${v?.stav === "schvaleno" ? "přidáno" : "odesláno ke schválení"}.`;
    void nacti();
    if (!id) { showToast(text, "success"); return; }
    showPersistentToast(text, "success", {
      actionLabel: "Vzít zpět",
      onAction: () => {
        void (async () => {
          const { data: smazane, error: e2 } = await (supabase as any).from("odmeny_rucni").delete().eq("id", id).select("id");
          if (e2 || !Array.isArray(smazane) || smazane.length === 0) { showToast("Odměnu už nejde vzít zpět – smažte ji v seznamu, nebo požádejte správce.", "error"); return; }
          showToast("Odměna vzata zpět.", "success");
          void nacti();
        })();
      },
    });
  }, [activeServiceId, data, rychleKomu, mesic, clenove, nacti, activeBranchId]);

  const cekaNaSchvaleni = data?.cekajici ?? [];
  const nazevMesiceStranky = nazevMesice(mesic);
  /** Název pobočky, za kterou čísla jsou (null = všechny) – do nadpisů a dlaždice zaměstnance měsíce. */
  const nazevPobockyDat = data?.pobocka ? (branchById(data.pobocka)?.name ?? "vybraná pobočka") : null;
  const zaPobocku = nazevPobockyDat ? ` · ${nazevPobockyDat}` : "";
  const vetaPobocky = vetaPobockyOdmen({
    vicePobocek,
    nazev: activeBranchId ? (branchById(activeBranchId)?.name ?? "vybraná pobočka") : null,
    serverUmi: !data?.pobockaNeumi,
  });
  const cekajiciJinde = data ? vetaCekajiciJinde(data.cekajiciJinde) : null;
  const rucniVMesici = rucniZobrazene.filter((r) => r.stav !== "ceka");

  return (
    <div style={{ display: "grid", gap: 20, padding: "0 0 24px" }}>
      {/* ── Hlavička: co stránka je a jak odměna vzniká ─────────────────── */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div style={{ minWidth: 0, flex: "1 1 420px" }}>
          <div style={{ fontSize: 22, fontWeight: 950, color: "var(--text)", display: "flex", alignItems: "center", gap: 10 }}>
            <GiftIcon size={22} /> Odměny
            {vicePobocek && (
              <span data-testid="odmeny-nadpis-pobocka" style={{ fontSize: 15, fontWeight: 800, color: activeBranchId ? "var(--accent)" : "var(--muted)" }}>
                · {activeBranchId ? (branchById(activeBranchId)?.name ?? "vybraná pobočka") : "Všechny pobočky"}
              </span>
            )}
          </div>
          <div style={{ ...popisek, marginTop: 4, lineHeight: 1.5 }}>
            Prémie za opravy nabídnuté zákazníkovi navíc. Oprava označená na zakázce „Nabídnuto navíc“ se připíše sama
            {data ? ` ${kdyPripiseOdmenu(data.kdy.rezim, data.kdy.stavNazev)}` : ""}. Ručně se přidává jen to, co na zakázce není –
            {data?.admin ? " takovou odměnu od zaměstnance schvalujete vy." : " takovou odměnu schvaluje majitel nebo správce."}
          </div>
          {vetaPobocky && (
            <div data-testid="odmeny-pobocka" style={{ ...popisek, marginTop: 4, lineHeight: 1.5, color: data?.pobockaNeumi ? "var(--text)" : "var(--muted)" }}>
              {vetaPobocky}
            </div>
          )}
        </div>
        <Button data-tour="odmeny-pridat" size="sm" variant="primary" onClick={() => { setPridavamPravidlo(undefined); setPridavam(true); }} disabled={!data || data.pravidla.length === 0} title={data && data.pravidla.length === 0 ? "Servis nemá žádné aktivní pravidlo odměn" : "Přidat odměnu s poznámkou nebo číslem zakázky"}>+ Přidat s poznámkou</Button>
      </div>

      {chyba && <div style={{ padding: 16, borderRadius: 12, border: "1px solid rgba(239,68,68,0.3)", background: "rgba(239,68,68,0.08)", color: "var(--text)", fontSize: 13 }}>{chyba}</div>}
      {!chyba && nacitam && !data && <div style={popisek}>Načítám…</div>}

      {data && !data.zapnuto && (
        <div style={{ padding: 16, borderRadius: 12, border, background: "var(--panel)", fontSize: 13, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <span>Servis zatím nemá žádné pravidlo odměn.</span>
          {data.admin && onOtevritNastaveni && <Button size="sm" variant="primary" onClick={onOtevritNastaveni}>Nastavit pravidla</Button>}
        </div>
      )}

      {/* ── 1. Ke schválení: jediné místo, kde se něco schvaluje ───────────── */}
      {data && (data.admin || cekaNaSchvaleni.length > 0) && (
        <Sekce
          dataTour="odmeny-ke-schvaleni"
          nadpis={data.admin ? "Ke schválení" : "Čeká na schválení"}
          pocet={cekaNaSchvaleni.length}
          zvyraznit={cekaNaSchvaleni.length > 0}
          popis={data.admin
            ? "Ruční odměny od zaměstnanců. Započtou se do součtů až po schválení. Odměny za označené opravy se neschvalují – připíšou se samy."
            : "Vaše ruční odměny. Započtou se, až je majitel nebo správce schválí."}
        >
          {cekajiciJinde && <div data-testid="odmeny-cekajici-jinde" style={{ ...popisek, padding: "0 2px" }}>{cekajiciJinde}</div>}
          {cekaNaSchvaleni.length === 0 ? (
            <div style={{ ...popisek, padding: "4px 2px" }}>{cekajiciJinde ? "V téhle pobočce nic nečeká na schválení." : "Nic nečeká na schválení."}</div>
          ) : cekaNaSchvaleni.map((r) => {
            const dvoji = dvojiUSchvaleni.pro === data ? dvojiUSchvaleni.mapa.get(r.id) : undefined;
            return (
              <div key={r.id} style={{ display: "flex", gap: 10, alignItems: "flex-start", flexWrap: "wrap", padding: "10px 12px", borderRadius: 10, background: "var(--panel)", border }}>
                <div style={{ flex: "1 1 300px", minWidth: 0, fontSize: 13, display: "grid", gap: 3 }}>
                  <div>
                    <b>{r.jmeno}</b> · {r.pravidlo} · <b>{kc(r.castka)}</b>
                    {r.zaklad !== null && <span style={popisek}> (z {kc(r.zaklad)})</span>}
                    <span style={popisek}> · započte se do měsíce {nazevMesice(r.obdobi)}</span>
                  </div>
                  <div style={popisek}>
                    Proč tu je: ruční odměnu zadal(a) {r.vytvorilJmeno ?? r.jmeno}{r.createdAt ? ` ${datum(r.createdAt)}` : ""}
                    {r.ticketId && (
                      <>
                        {" · zakázka "}
                        <button type="button" onClick={() => otevriZakazku(r.ticketId!)} style={odkaz}>{r.kod ?? "otevřít"}</button>
                        {[r.zakaznik, r.zarizeni].some(Boolean) && ` ${[r.zakaznik, r.zarizeni].filter(Boolean).join(" · ")}`}
                      </>
                    )}
                  </div>
                  {r.poznamka && <div style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>„{r.poznamka}“</div>}
                  {dvoji && dvoji.length > 0 && (
                    <div role="alert" data-testid="schvaleni-dvoji" style={{ marginTop: 4, padding: "6px 8px", borderRadius: 8, background: "rgba(245,158,11,0.12)", border: "1px solid rgba(245,158,11,0.45)", lineHeight: 1.45 }}>
                      Pozor, dvojí odměna: na zakázce je {dvoji.map((n) => `„${n}“`).join(", ")} s „Nabídnuto navíc“ – za to se odměna počítá sama. Nejspíš zamítnout.
                    </div>
                  )}
                  {data.admin && !autoSchvaleni.has(r.userId) && (
                    <button type="button" onClick={() => void zapniAutoSchvalovani(r.userId, r.jmeno)} style={{ ...odkaz, justifySelf: "start", fontWeight: 500, textDecoration: "underline" }}>
                      Tomuto člověku schvalovat automaticky
                    </button>
                  )}
                </div>
                <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                  {data.admin ? (
                    zamitam?.id === r.id ? (
                      <>
                        <input value={zamitam.duvod} onChange={(e) => setZamitam({ id: r.id, duvod: e.target.value })} placeholder="Důvod (nepovinné)" aria-label="Důvod zamítnutí" style={{ ...pole, width: 180 }} autoFocus />
                        <Button size="sm" variant="danger" onClick={() => void rozhodni(r, "zamitnuto", zamitam.duvod)}>Zamítnout</Button>
                        <Button size="sm" variant="ghost" onClick={() => setZamitam(null)}>Zpět</Button>
                      </>
                    ) : (
                      <>
                        <Button size="sm" variant="primary" onClick={() => void rozhodni(r, "schvaleno")}>Schválit</Button>
                        <Button size="sm" variant="soft" onClick={() => setZamitam({ id: r.id, duvod: dvoji?.length ? "Dvojí odměna – oprava je na zakázce označená Nabídnuto navíc" : "" })}>Zamítnout</Button>
                      </>
                    )
                  ) : (
                    r.vytvoril === data.ja && <Button size="sm" variant="ghost" onClick={() => void smazRucni(r)}>Smazat</Button>
                  )}
                </div>
              </div>
            );
          })}
        </Sekce>
      )}

      {/* ── 2. Čeká na vydání: jen informace, nic se neschvaluje ─────────── */}
      {data && cekajiciZobrazene.length > 0 && (
        <Sekce
          dataTour="odmeny-ceka"
          nadpis={nadpisCekajicich(data.kdy.rezim, data.kdy.stavNazev)}
          pocet={cekajiciZobrazene.length}
          souhrn={kc(cekajiciZobrazene.reduce((s, c) => s + c.castka, 0))}
          popis={`Jen pro informaci, nic se tu neschvaluje. Označené opravy jsou zaevidované a odměna se připíše sama ${kdyPripiseOdmenu(data.kdy.rezim, data.kdy.stavNazev)} – do měsíce, kdy se to stane. Ručně je nepřidávejte, byla by dvakrát.`}
        >
          <div style={{ overflowX: "auto", border, borderRadius: 12, background: "var(--panel)" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  {["Zakázka", "Stav teď", "Oprava", "Pravidlo", ...(data.admin ? ["Komu"] : []), "Odměna"].map((h) => (
                    <th key={h} style={th}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {cekajiciZobrazene.map((c) => (
                  <tr key={`${c.ticketId}-${c.polozkaId}`}>
                    <td style={{ ...td, fontWeight: 700 }}>
                      <button type="button" onClick={() => otevriZakazku(c.ticketId)} style={{ ...odkaz, fontSize: 13 }}>{c.kod ?? "Zakázka"}</button>
                      <div style={{ ...popisek, fontWeight: 500, maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis" }}>{[c.zakaznik, c.zarizeni].filter(Boolean).join(" · ")}</div>
                    </td>
                    <td style={{ ...td, color: "var(--muted)" }}>{c.stavNazev ?? c.stav ?? "—"}</td>
                    <td style={{ ...td, maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis" }} title={c.oprava}>{c.oprava}</td>
                    <td style={{ ...td, color: "var(--muted)" }}>{c.pravidlo}</td>
                    {data.admin && <td style={td}>{c.jmeno ?? "Nepřiřazeno"}</td>}
                    <td style={{ ...td, fontWeight: 700 }}>{kc(c.castka)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Sekce>
      )}

      {/* ── 3. Přidat ruční odměnu ───────────────────────────────────────── */}
      {data && data.pravidla.length > 0 && (
        <Sekce
          dataTour="odmeny-rychle"
          nadpis="Přidat ruční odměnu"
          popis={`Jen za to, co na zakázce není (třeba sklo prodané u pultu). Opravy označené „Nabídnuto navíc“ se počítají samy. Jedním klikem se přidá do měsíce ${nazevMesiceStranky}${data.admin ? "" : " a půjde ke schválení"}.`}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            {data.admin && clenove.length > 0 && (
              <select value={rychleKomu} onChange={(e) => setRychleKomu(e.target.value)} aria-label="Komu odměnu přidat" style={{ padding: "4px 8px", borderRadius: 8, border, background: "var(--panel)", color: "var(--text)", fontFamily: "inherit", fontSize: 13 }}>
                <option value="">mně</option>
                {clenove.filter((c) => c.userId !== data.ja).map((c) => <option key={c.userId} value={c.userId}>{c.jmeno}</option>)}
              </select>
            )}
            {data.pravidla.map((p) => (
              <Button key={p.id} size="sm" variant="soft" disabled={rychleUkladam !== null} onClick={() => void rychlePridat(p)} title={p.typ === "procento" ? "Odměna v procentech – zeptá se na cenu" : "Přidá odměnu hned, bez poznámky"}>
                {rychleUkladam === p.id ? "Přidávám…" : `+ ${p.nazev} · ${p.typ === "procento" ? `${p.hodnota} %` : formatCurrency(p.hodnota)}`}
              </Button>
            ))}
          </div>
        </Sekce>
      )}

      {/* ── 4. Započtené za měsíc ─────────────────────────────────────────── */}
      {data && (
        <Sekce
          dataTour="odmeny-zapoctene"
          nadpis={`Započtené – ${nazevMesiceStranky}${zaPobocku}`}
          popis={`Co se do měsíce opravdu počítá: označené opravy (${vetaKdyOdmeny(data.kdy.rezim, data.kdy.stavNazev).replace(/^Počítá se z/, "z").replace(/\.$/, "")}) a schválené ruční odměny.`}
          vpravo={(
            <div data-tour="odmeny-mesic" style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <Button size="sm" variant="soft" onClick={() => setMesic((m) => posunKlicMesice(m, -1))} aria-label="Předchozí měsíc">‹</Button>
              <span style={{ fontWeight: 800, minWidth: 130, textAlign: "center" }}>{nazevMesiceStranky}</span>
              <Button size="sm" variant="soft" onClick={() => setMesic((m) => posunKlicMesice(m, 1))} disabled={mesic >= tentoMesic} aria-label="Další měsíc">›</Button>
              {mesic !== tentoMesic && <Button size="sm" variant="ghost" onClick={() => setMesic(tentoMesic)}>Tento měsíc</Button>}
            </div>
          )}
        >
          <div data-tour="odmeny-filtr" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <select value={filtrClovek} onChange={(e) => setFiltrClovek(e.target.value)} style={pole} aria-label="Filtr podle člověka">
              <option value="vse">Všichni ({data.radky.length})</option>
              {data.lide.map((l) => (
                <option key={l.userId ?? "nikdo"} value={l.userId ?? ""}>{l.jmeno} ({l.pocet})</option>
              ))}
            </select>
            <Button size="sm" variant="soft" onClick={() => void nacti()} disabled={nacitam}>{nacitam ? "Načítám…" : "Obnovit"}</Button>
            {data.admin && onOtevritNastaveni && <Button size="sm" variant="ghost" onClick={onOtevritNastaveni}>Pravidla</Button>}
            {data.admin && pocetNenabidnutych > 0 && (
              <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, cursor: "pointer" }} title="Opravy podle pravidla, které nebyly nabídnuté navíc (zákazník s nimi přišel, nebo jde o starší zakázku bez příznaku). Jdou označit ručně.">
                <input type="checkbox" checked={ukazatNenabidnute} onChange={(e) => setUkazatNenabidnute(e.target.checked)} />
                <span>Ukázat i nenabídnuté ({pocetNenabidnutych})</span>
              </label>
            )}
          </div>

          <div style={{ fontWeight: 700, fontSize: 13, marginTop: 4 }}>Za označené opravy <span style={{ ...popisek, fontWeight: 500 }}>– připsané automaticky{data.admin ? "; u řádku můžete změnit komu, přepnout Nabídnuto nebo řádek vyřadit" : ""}</span></div>
          <div data-tour="odmeny-radky" style={{ overflowX: "auto", border, borderRadius: 12, background: "var(--panel)" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  {["Zakázka", sloupecKdyOdmeny(data.kdy.rezim), "Oprava", "Cena", "Pravidlo", "Komu", "Odměna", ...(data.admin ? [""] : [])].map((h, i) => (
                    <th key={`${h}-${i}`} style={th}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {zobrazene.map((r) => (
                  <tr key={`${r.ticketId}-${r.polozkaId}`} style={{ opacity: r.vyrazeno || !r.nabidnuto ? 0.5 : 1 }}>
                    <td style={{ ...td, fontWeight: 700 }}>
                      <button type="button" onClick={() => otevriZakazku(r.ticketId)} style={{ ...odkaz, fontSize: 13 }}>{r.kod ?? "—"}</button>
                      <div style={{ ...popisek, fontWeight: 500, maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis" }}>{[r.zakaznik, r.zarizeni].filter(Boolean).join(" · ")}</div>
                    </td>
                    <td style={{ ...td, color: "var(--muted)" }} title={titulekZapocteno}>{r.zapocteno ? datum(r.zapocteno) : "—"}</td>
                    <td style={{ ...td, maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis" }} title={r.oprava}>{r.oprava}</td>
                    <td style={{ ...td, color: "var(--muted)" }}>{kc(r.cena)}</td>
                    <td style={{ ...td, color: "var(--muted)" }}>{r.pravidlo}</td>
                    <td style={td}>
                      {data.admin ? (
                        <select value={r.userId ?? ""} onChange={(e) => void ulozUpravu(r, { userId: e.target.value || null })} style={{ ...pole, padding: "4px 8px" }} aria-label="Komu se odměna připíše" title={r.prepsano ? "Ručně změněno" : r.komu === "technik" ? "Přidělený technik" : "Kdo opravu přidal"}>
                          <option value="">— nepřiřazeno —</option>
                          {clenove.map((c) => (
                            <option key={c.userId} value={c.userId}>{c.jmeno}</option>
                          ))}
                          {r.userId && !clenove.some((c) => c.userId === r.userId) && <option value={r.userId}>{r.jmeno ?? "Bývalý člen"}</option>}
                        </select>
                      ) : (
                        r.jmeno ?? "—"
                      )}
                      {r.prepsano && <span style={{ ...popisek, marginLeft: 6 }} title="Příjemce ručně změněn">✎</span>}
                    </td>
                    <td style={{ ...td, fontWeight: 700, textDecoration: r.vyrazeno || !r.nabidnuto ? "line-through" : undefined }}>
                      {kc(r.castka)}
                      {!r.nabidnuto && <span style={{ ...popisek, marginLeft: 6, fontWeight: 500 }}>nenabídnuto</span>}
                      {r.vyrazeno && <span style={{ ...popisek, marginLeft: 6, fontWeight: 500 }}>vyřazeno</span>}
                    </td>
                    {data.admin && (
                      <td style={{ ...td, whiteSpace: "nowrap" }}>
                        <Button size="sm" variant="ghost" onClick={() => void ulozUpravu(r, { nabidnuto: !r.nabidnuto })} title={r.nabidnuto ? "Zákazník s opravou přišel – odměna nenáleží" : "Oprava byla nabídnutá navíc – počítat odměnu"}>{r.nabidnuto ? "Nenabídnuto" : "Nabídnuto navíc"}</Button>
                        <Button size="sm" variant="ghost" onClick={() => void ulozUpravu(r, { vyrazeno: !r.vyrazeno })}>{r.vyrazeno ? "Vrátit" : "Vyřadit"}</Button>
                      </td>
                    )}
                  </tr>
                ))}
                {zobrazene.length === 0 && (
                  <tr><td colSpan={data.admin ? 8 : 7} style={{ padding: 16, textAlign: "center", color: "var(--muted)" }}>V tomto měsíci žádná označená oprava.</td></tr>
                )}
              </tbody>
            </table>
          </div>

          {rucniVMesici.length > 0 && (
            <div data-tour="odmeny-rucni" style={{ display: "grid", gap: 8 }}>
              <div style={{ fontWeight: 700, fontSize: 13, marginTop: 4 }}>Ruční odměny <span style={{ ...popisek, fontWeight: 500 }}>– schválené se počítají, zamítnuté ne{data.admin ? "; schválenou jde ještě zamítnout" : ""}</span></div>
              <div style={{ overflowX: "auto", border, borderRadius: 12, background: "var(--panel)" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr>
                      {["Kdo", "Pravidlo", "Odměna", "Poznámka", "Zakázka", "Stav", "Přidal", ""].map((h, i) => (
                        <th key={`${h}-${i}`} style={th}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rucniVMesici.map((r) => (
                      <tr key={r.id} style={{ opacity: r.stav === "schvaleno" ? 1 : 0.65 }}>
                        <td style={{ ...td, fontWeight: 700 }}>{r.jmeno}</td>
                        <td style={{ ...td, color: "var(--muted)" }}>{r.pravidlo}</td>
                        <td style={{ ...td, fontWeight: 700, textDecoration: r.stav === "zamitnuto" ? "line-through" : undefined }}>
                          {kc(r.castka)}
                          {r.zaklad !== null && <div style={{ ...popisek, fontWeight: 500 }}>z {kc(r.zaklad)}</div>}
                        </td>
                        <td style={{ ...td, whiteSpace: "normal", minWidth: 180, maxWidth: 320, overflowWrap: "anywhere" }}>{r.poznamka}</td>
                        <td style={td}>
                          {r.ticketId ? (
                            <button type="button" onClick={() => otevriZakazku(r.ticketId!)} style={{ ...odkaz, fontSize: 13 }}>{r.kod ?? "Zakázka"}</button>
                          ) : <span style={{ color: "var(--muted)" }}>—</span>}
                          {(r.zakaznik || r.zarizeni) && <div style={{ ...popisek, maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis" }}>{[r.zakaznik, r.zarizeni].filter(Boolean).join(" · ")}</div>}
                        </td>
                        <td style={td}>
                          <span style={{ fontWeight: 600, color: r.stav === "zamitnuto" ? "rgba(239,68,68,0.9)" : "var(--text)" }}>
                            {r.stav === "schvaleno" && r.automaticky ? "schváleno automaticky" : POPIS_STAVU_RUCNI[r.stav]}
                          </span>
                          {!r.automaticky && r.schvalilJmeno && <div style={popisek}>{r.schvalilJmeno}{r.schvalenoAt ? ` · ${datum(r.schvalenoAt)}` : ""}</div>}
                          {r.stav === "zamitnuto" && r.duvodZamitnuti && <div style={{ ...popisek, whiteSpace: "normal", maxWidth: 220 }}>{r.duvodZamitnuti}</div>}
                        </td>
                        <td style={{ ...td, color: "var(--muted)" }}>
                          {r.vytvorilJmeno ?? "—"}
                          {r.createdAt ? <div style={popisek}>{datum(r.createdAt)}</div> : null}
                        </td>
                        <td style={{ ...td, whiteSpace: "nowrap" }}>
                          {data.admin && r.stav === "zamitnuto" && <Button size="sm" variant="ghost" onClick={() => void rozhodni(r, "schvaleno")}>Schválit</Button>}
                          {data.admin && r.stav === "schvaleno" && zamitam?.id !== r.id && <Button size="sm" variant="ghost" onClick={() => setZamitam({ id: r.id, duvod: "" })}>Zamítnout</Button>}
                          {data.admin && <Button size="sm" variant="ghost" onClick={() => void smazRucni(r)}>Smazat</Button>}
                          {data.admin && zamitam?.id === r.id && r.stav === "schvaleno" && (
                            <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                              <input value={zamitam.duvod} onChange={(e) => setZamitam({ id: r.id, duvod: e.target.value })} placeholder="Důvod (nepovinné)" aria-label="Důvod zamítnutí" style={{ ...pole, width: 160 }} autoFocus />
                              <Button size="sm" variant="danger" onClick={() => void rozhodni(r, "zamitnuto", zamitam.duvod)}>Zamítnout</Button>
                              <Button size="sm" variant="ghost" onClick={() => setZamitam(null)}>Zpět</Button>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </Sekce>
      )}

      {/* ── 5. Součty, žebříček, síň slávy ────────────────────────────────── */}
      {data && (
        <Sekce
          dataTour="odmeny-soucty"
          nadpis={`Součty – ${nazevMesiceStranky}${zaPobocku}`}
          popis={[
            data.admin || data.verejny ? "Kliknutím na člověka v žebříčku zúžíte seznamy výš jen na jeho odměny." : "",
            // Vyplácí se člověku za celý servis – v pobočce by se zapsala jen její část.
            data.admin && nazevPobockyDat ? "Vyplacení se zaškrtává ve „Všech pobočkách“ (částka za celý servis)." : "",
          ].filter(Boolean).join(" ") || undefined}
        >
          <div data-tour="odmeny-dlazdice" style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <div style={{ ...dlazdice, borderColor: vitezove.length > 0 ? "var(--accent)" : undefined, background: vitezove.length > 0 ? "var(--accent-soft)" : "var(--panel)" }}>
              <div style={popisek}>{vitezove.length > 1 ? "Zaměstnanci měsíce" : "Zaměstnanec měsíce"}{zaPobocku}</div>
              <div style={velke}>{vitezove.length > 0 ? `🏆 ${vitezove.map((v) => v.jmeno).join(" a ")}` : "—"}</div>
              <div style={popisek}>{vitezove.length > 0 ? `${kc(vitezove[0].castka)} · ${vitezove[0].pocet} ${odmen(vitezove[0].pocet)}` : "zatím nikdo nemá odměnu"}</div>
            </div>
            <div style={dlazdice}>
              <div style={popisek}>Celkem odměn za měsíc</div>
              <div style={velke}>{kc(celkem)}</div>
              <div style={popisek}>
                {(data.lide.filter((l) => l.userId).length)} lidí · {data.radky.filter((r) => !r.vyrazeno && r.nabidnuto).length} oprav
                {data.rucni.some((r) => r.stav === "schvaleno") ? ` · ${data.rucni.filter((r) => r.stav === "schvaleno").length} ručních` : ""}
              </div>
            </div>
            <div style={dlazdice}>
              <div style={popisek}>Moje odměny</div>
              <div style={velke}>{kc(moje?.castka ?? 0)}</div>
              <div style={popisek}>
                {moje ? `${moje.pocet} ${odmen(moje.pocet)}${moje.pocetRucnich > 0 ? ` (z toho ${moje.pocetRucnich} ručně)` : ""}` : "zatím žádná odměna"}
                {moje && data.ja && vyplaceno.get(data.ja) ? ` · vyplaceno ${datum(vyplaceno.get(data.ja)!.vyplacenoAt)}` : ""}
                {mojeCeka > 0 ? ` · ${kc(mojeCeka)} čeká na připsání` : ""}
              </div>
            </div>
          </div>

          {(data.admin || data.verejny) && (
            <div data-tour="odmeny-zebricek" style={{ overflowX: "auto", border, borderRadius: 12, background: "var(--panel)" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    {["#", "Kdo", "Počet", "Odměna", "Vyplaceno"].map((h) => (
                      <th key={h} style={th}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.lide.map((l, i) => {
                    const v = l.userId ? vyplaceno.get(l.userId) : undefined;
                    const vitez = vitezove.some((x) => x.userId === l.userId && !!l.userId);
                    return (
                      <tr key={l.userId ?? "nikdo"} style={{ cursor: "pointer", background: filtrClovek === (l.userId ?? "") ? "var(--accent-soft)" : "transparent" }} onClick={() => setFiltrClovek((f) => (f === (l.userId ?? "") ? "vse" : (l.userId ?? "")))}>
                        <td style={{ ...td, color: "var(--muted)" }}>{i + 1}.</td>
                        <td style={{ ...td, fontWeight: 700 }}>{vitez ? "🏆 " : ""}{l.jmeno}{!l.userId && <span style={{ ...popisek, marginLeft: 6 }}>– nejde určit, komu</span>}</td>
                        <td style={td}>{l.pocet}{l.pocetRucnich > 0 && <span style={{ ...popisek, marginLeft: 6 }} title="Z toho ručně přidaných odměn">({l.pocetRucnich} ručně)</span>}</td>
                        <td style={{ ...td, fontWeight: 700 }}>{kc(l.castka)}</td>
                        <td style={td} onClick={(e) => e.stopPropagation()}>
                          {data.admin && l.userId && !data.pobocka ? (
                            <label style={{ display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                              <input type="checkbox" checked={!!v} onChange={() => void prepniVyplaceno(l)} />
                              <span style={popisek}>{v ? `${datum(v.vyplacenoAt)} · ${kc(v.castka)}` : "ne"}</span>
                            </label>
                          ) : (
                            <span style={{ color: v ? "var(--text)" : "var(--muted)" }} title={data.admin && data.pobocka ? "Vyplácí se za celý servis – zaškrtněte ve „Všech pobočkách“" : undefined}>{v ? datum(v.vyplacenoAt) : "ne"}</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {data.lide.length === 0 && (
                    <tr><td colSpan={5} style={{ padding: 16, textAlign: "center", color: "var(--muted)" }}>V tomto měsíci zatím žádná odměna.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          {sinSlavy.length > 0 && (data.admin || data.verejny) && (
            <div>
              <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8 }}>Síň slávy</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {sinSlavy.map((m) => (
                  <button key={m.klic} type="button" onClick={() => setMesic(m.klic)} style={{ ...pole, cursor: "pointer", textAlign: "left", minWidth: 150, borderColor: m.klic === mesic ? "var(--accent)" : "var(--border)" }}>
                    <div style={popisek}>{nazevMesice(m.klic)}</div>
                    <div style={{ fontWeight: 800 }}>{m.vitezove.length > 0 ? `🏆 ${m.vitezove.map((v) => v.jmeno).join(", ")}` : "—"}</div>
                    <div style={popisek}>{m.vitezove.length > 0 ? kc(m.vitezove[0].castka) : "bez odměn"} · celkem {kc(m.celkem)}</div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </Sekce>
      )}

      {/* Montuje se při každém otevření znovu = čistý formulář s měsícem ze stránky. */}
      {data && activeServiceId && pridavam && (
        <PridatOdmenuDialog
          open
          onClose={() => setPridavam(false)}
          onUlozeno={(stav) => {
            setPridavam(false);
            showToast(stav === "schvaleno" ? "Odměna přidána." : "Odměna odeslána ke schválení.", "success");
            void nacti();
          }}
          serviceId={activeServiceId}
          branchId={activeBranchId}
          pravidla={data.pravidla}
          vychoziMesic={mesic}
          vychoziPravidloId={pridavamPravidlo}
          admin={data.admin}
          ja={data.ja}
          clenove={clenove}
          autoSchvalovani={!!data.ja && autoSchvaleni.has(data.ja)}
        />
      )}
    </div>
  );
}

/**
 * Oddíl stránky: nadpis s počtem, věta „proč to tu je / co s tím“ a obsah.
 * Zvýrazněný oddíl (Ke schválení s položkami) má barevný rámeček.
 */
function Sekce({ dataTour, nadpis, pocet, souhrn, popis, zvyraznit, vpravo, children }: {
  dataTour: string;
  nadpis: string;
  pocet?: number;
  /** Např. součet částek vedle počtu. */
  souhrn?: string;
  popis?: string;
  zvyraznit?: boolean;
  vpravo?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section
      data-tour={dataTour}
      style={{ display: "grid", gap: 10, padding: 14, borderRadius: 14, border: `1px solid ${zvyraznit ? "var(--accent)" : "var(--border)"}`, background: zvyraznit ? "var(--accent-soft)" : "var(--panel-2, var(--panel))" }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div style={{ minWidth: 0, flex: "1 1 320px" }}>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 850, color: "var(--text)", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            {nadpis}
            {pocet !== undefined && (
              <span style={{ fontSize: 12, fontWeight: 800, padding: "1px 8px", borderRadius: 999, background: pocet > 0 && zvyraznit ? "var(--accent)" : "var(--panel)", color: pocet > 0 && zvyraznit ? "var(--accent-contrast, #fff)" : "var(--muted)", border: "1px solid var(--border)" }}>{pocet}</span>
            )}
            {souhrn && <span style={{ fontSize: 13, fontWeight: 700, color: "var(--muted)" }}>{souhrn}</span>}
          </h2>
          {popis && <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4, lineHeight: 1.5 }}>{popis}</div>}
        </div>
        {vpravo}
      </div>
      {children}
    </section>
  );
}
