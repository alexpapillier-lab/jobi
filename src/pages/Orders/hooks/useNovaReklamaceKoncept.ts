/**
 * Rozepsaná nová reklamace (koncept) – obdoba useNovaZakazkaKoncept:
 * stav okna, koncept v localStorage (vlastní klíč), zdrojová zakázka
 * (dotažení celé zakázky, předvyplnění), ověření povinných polí,
 * přijímací fotky (soubory i focení přes QR ke konceptu), zavření
 * (koncept zůstává), zahození (s dotazem) a založení reklamace.
 *
 * Logika bez Reactu je v src/lib/reklamacePrijem.ts.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase, supabaseUrl, supabaseAnonKey, supabaseFetch } from "../../../lib/supabaseClient";
import { showToast } from "../../../components/Toast";
import { normalizeError } from "../../../utils/errorNormalizer";
import { popisDoOdkazu } from "../../../lib/diagnosticPhotoWatermark";
import { getHandoffOptions } from "../../../lib/handoffOptions";
import {
  NOVA_REKLAMACE_KONCEPT_KEY,
  chybyReklamace,
  duvodBlokace,
  jeKonceptRozepsany,
  konceptNaReklamaci,
  nactiKoncept,
  odpojZdroj,
  predvyplnZeZakazky,
  vychoziKoncept,
  type KonceptReklamace,
} from "../../../lib/reklamacePrijem";
import { useWarrantyClaims, type WarrantyClaimRow } from "./useWarrantyClaims";
import type { PolozkaQrFoceni, TicketEx } from "../typy";

function vychoziPrevzeti(): string {
  const moznosti = getHandoffOptions().receiveMethods;
  return moznosti.includes("Osobně") ? "Osobně" : "";
}

function nactiUlozeny(): KonceptReklamace {
  try {
    const raw = localStorage.getItem(NOVA_REKLAMACE_KONCEPT_KEY);
    if (raw) return nactiKoncept(JSON.parse(raw), vychoziPrevzeti()) ?? vychoziKoncept(vychoziPrevzeti());
  } catch {
    // poškozený koncept – začne se znovu
  }
  return vychoziKoncept(vychoziPrevzeti());
}

function ulozKoncept(k: KonceptReklamace | null) {
  try {
    if (!k) localStorage.removeItem(NOVA_REKLAMACE_KONCEPT_KEY);
    else localStorage.setItem(NOVA_REKLAMACE_KONCEPT_KEY, JSON.stringify(k));
  } catch {
    // Plné úložiště (fotky jako data URL) – koncept zůstane aspoň v paměti.
  }
}

type Vstup = {
  activeServiceId: string | null;
  serviceName: string | null;
  /** Nastavení → Zakázky → Povinná pole: telefon zákazníka. */
  customerPhoneRequired: boolean;
  /** Výchozí stav nové reklamace (Přijato). */
  statusKey: string;
  existingClaimCodes: { code: string | null }[];
  /** Dotáhne celou zakázku (seznam nečte adresu, opravy, záruku…). */
  nactiPlnouZakazku: (ticketId: string) => Promise<TicketEx | null>;
  onCreated: (claim: WarrantyClaimRow) => void | Promise<void>;
};

export function useNovaReklamaceKoncept({
  activeServiceId,
  serviceName,
  customerPhoneRequired,
  statusKey,
  existingClaimCodes,
  nactiPlnouZakazku,
  onCreated,
}: Vstup) {
  const { zalozReklamaci } = useWarrantyClaims(activeServiceId);
  const [otevreno, setOtevreno] = useState(false);
  const [koncept, setKoncept] = useState<KonceptReklamace>(() => nactiUlozeny());
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [nacitamZdroj, setNacitamZdroj] = useState(false);
  const [vytvarim, setVytvarim] = useState(false);

  // Focení přes QR ke konceptu (stejné edge funkce jako u příjmu zakázky).
  const qrTokenRef = useRef<string | null>(null);
  /** Odkaz posledního QR – další klik ukáže stejný, ať se fotky sčítají do jedné sady. */
  const qrOdkazRef = useRef<string | null>(null);
  const [qrFotky, setQrFotky] = useState<string[]>([]);
  const [qrPocet, setQrPocet] = useState(0);
  const [qrPolozky, setQrPolozky] = useState<PolozkaQrFoceni[] | null>(null);
  const [qrNacitam, setQrNacitam] = useState(false);

  const rozepsany = useMemo(() => jeKonceptRozepsany(koncept) || qrFotky.length > 0, [koncept, qrFotky.length]);

  useEffect(() => {
    ulozKoncept(jeKonceptRozepsany(koncept) ? koncept : null);
  }, [koncept]);

  const chyby = useMemo(() => chybyReklamace(koncept, { telefonPovinny: customerPhoneRequired }), [koncept, customerPhoneRequired]);
  const lzeVytvorit = Object.keys(chyby).length === 0;
  const duvod = useMemo(() => duvodBlokace(chyby), [chyby]);
  const ukazChybu = (pole: string) => submitAttempted && !!chyby[pole];

  /**
   * Výběr zdrojové zakázky: dotáhne celou a předvyplní koncept. S `odZnova`
   * se začne z prázdného konceptu (nahrazuje se rozepsaná reklamace).
   */
  const vyberZdroj = useCallback(async (t: TicketEx, odZnova = false) => {
    setNacitamZdroj(true);
    if (odZnova) setKoncept(vychoziKoncept(vychoziPrevzeti()));
    try {
      const plna = (await nactiPlnouZakazku(t.id)) ?? t;
      setKoncept((k) => predvyplnZeZakazky(k, plna));
    } finally {
      setNacitamZdroj(false);
    }
  }, [nactiPlnouZakazku]);

  /**
   * Otevře okno. Se zakázkou (nabídka „…“ v detailu) ji rovnou předvyplní;
   * rozepsanou reklamaci (k jiné zakázce nebo bez zakázky) nepřepíše bez dotazu.
   */
  const otevri = useCallback((zakazka?: TicketEx | null) => {
    setSubmitAttempted(false);
    setOtevreno(true);
    if (!zakazka || koncept.zdroj?.ticketId === zakazka.id) return;
    if (jeKonceptRozepsany(koncept)) {
      const co = koncept.zdroj?.kod ? `reklamaci k zakázce ${koncept.zdroj.kod}` : "reklamaci";
      if (!window.confirm(`Máte rozepsanou ${co}. Nahradit ji reklamací k zakázce ${zakazka.code ?? ""}?`)) return;
      void vyberZdroj(zakazka, true);
      return;
    }
    void vyberZdroj(zakazka);
  }, [koncept, vyberZdroj]);

  /** Zavře okno; rozepsané údaje zůstávají v konceptu. */
  const zavri = useCallback(() => setOtevreno(false), []);

  const vycisti = useCallback(() => {
    qrTokenRef.current = null;
    qrOdkazRef.current = null;
    setQrFotky([]);
    setQrPocet(0);
    setKoncept(vychoziKoncept(vychoziPrevzeti()));
    ulozKoncept(null);
    setSubmitAttempted(false);
  }, []);

  /** Zrušit: zahodí koncept – rozepsaný jen po potvrzení. */
  const zahod = useCallback(() => {
    if (rozepsany && !window.confirm("Zahodit rozepsanou reklamaci? Vyplněné údaje i přijímací fotky se ztratí.")) return;
    vycisti();
    setOtevreno(false);
  }, [rozepsany, vycisti]);

  /** Zahodí koncept bez dotazu (např. místo reklamace se zakládá placená oprava). */
  const zrusitBezDotazu = useCallback(() => {
    vycisti();
    setOtevreno(false);
  }, [vycisti]);

  const zrusZdroj = useCallback(() => setKoncept((k) => odpojZdroj(k)), []);
  const bezZakazky = useCallback(() => setKoncept((k) => ({ ...odpojZdroj(k), bezZakazky: true })), []);
  const zpetNaVyber = useCallback(() => setKoncept((k) => ({ ...odpojZdroj(k), bezZakazky: false })), []);

  const vytvorit = useCallback(async () => {
    setSubmitAttempted(true);
    if (!lzeVytvorit || vytvarim) return;
    setVytvarim(true);
    try {
      const claim = await zalozReklamaci({
        payload: konceptNaReklamaci(koncept),
        statusKey,
        existingClaims: existingClaimCodes,
        fotkyDataUrl: koncept.fotky,
        fotkyHotove: qrFotky,
        serviceName,
      });
      if (!claim) return; // chyba: formulář zůstává vyplněný
      vycisti();
      setOtevreno(false);
      await onCreated(claim);
    } finally {
      setVytvarim(false);
    }
  }, [lzeVytvorit, vytvarim, zalozReklamaci, koncept, statusKey, existingClaimCodes, qrFotky, serviceName, vycisti, onCreated]);

  // ⌘/Ctrl+Enter = Vytvořit reklamaci (jako u nové zakázky).
  const vytvoritRef = useRef(vytvorit);
  vytvoritRef.current = vytvorit;
  useEffect(() => {
    if (!otevreno) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Enter" || !(e.metaKey || e.ctrlKey)) return;
      e.preventDefault();
      void vytvoritRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [otevreno]);

  /** Přidá fotky ze souborů (data URL; nahrají se po založení). */
  const pridejSoubory = useCallback(async (files: File[]) => {
    if (!files.length) return;
    const precti = (f: File) =>
      new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result as string);
        r.onerror = () => reject(new Error("Načtení selhalo"));
        r.readAsDataURL(f);
      });
    try {
      const urls = await Promise.all(files.map(precti));
      setKoncept((k) => ({ ...k, fotky: [...k.fotky, ...urls] }));
    } catch {
      showToast("Nepodařilo se načíst vybrané soubory.", "error");
    }
  }, []);

  const odeberFotku = useCallback((idx: number) => {
    setKoncept((k) => ({ ...k, fotky: k.fotky.filter((_, i) => i !== idx) }));
  }, []);

  /** Fotky z telefonu ke konceptu (capture-list-draft). */
  const nactiQrFotky = useCallback(async (oznamit: boolean) => {
    const token = qrTokenRef.current;
    if (!token || !supabase || !supabaseUrl || !supabaseAnonKey) return;
    try {
      const authToken = (await supabase.auth.getSession()).data?.session?.access_token;
      if (!authToken) return;
      const res = await supabaseFetch(`${supabaseUrl}/functions/v1/capture-list-draft`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}`, apikey: supabaseAnonKey },
        body: JSON.stringify({ token }),
      });
      const raw = await res.text();
      const data: { urls?: string[]; error?: string } = raw ? JSON.parse(raw) : {};
      if (!res.ok) throw new Error(data.error || res.statusText);
      if (Array.isArray(data.urls)) {
        const urls = data.urls;
        setQrPocet(urls.length);
        setQrFotky((prev) => {
          const pridano = Math.max(0, urls.length - prev.length);
          if (oznamit && pridano > 0) showToast(`Načteno ${pridano} ${pridano === 1 ? "fotka" : pridano <= 4 ? "fotky" : "fotek"} z mobilu`, "success");
          return urls;
        });
      }
    } catch (err) {
      console.warn("[reklamace] načtení fotek z mobilu selhalo", err);
    }
  }, []);

  const vyfotitZTelefonu = useCallback(async () => {
    if (qrTokenRef.current && qrOdkazRef.current) {
      setQrPolozky([{ deviceLabel: "Přijímací fotky reklamace", url: qrOdkazRef.current }]);
      return;
    }
    if (!supabase || !supabaseUrl || !supabaseAnonKey || !activeServiceId) {
      showToast("Chybí připojení nebo aktivní služba.", "error");
      return;
    }
    setQrNacitam(true);
    try {
      const { data: refreshData, error: refreshErr } = await supabase.auth.refreshSession();
      if (refreshErr) throw new Error("Session vypršela.");
      const authToken = refreshData?.session?.access_token ?? (await supabase.auth.getSession()).data?.session?.access_token;
      if (!authToken) throw new Error("Nejste přihlášeni.");
      const res = await supabaseFetch(`${supabaseUrl}/functions/v1/capture-create-token`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}`, apikey: supabaseAnonKey },
        body: JSON.stringify({ draft: true, serviceId: activeServiceId, isBefore: true }),
      });
      const raw = await res.text();
      const data: { url?: string; token?: string; error?: string } = raw ? JSON.parse(raw) : {};
      if (!res.ok) throw new Error(data.error || res.statusText);
      if (data.token) {
        qrTokenRef.current = data.token;
        setQrFotky([]);
        setQrPocet(0);
      }
      if (data.url) {
        const odkaz = popisDoOdkazu(data.url, { servis: serviceName });
        qrOdkazRef.current = odkaz;
        setQrPolozky([{ deviceLabel: "Přijímací fotky reklamace", url: odkaz }]);
      }
    } catch (err) {
      showToast(normalizeError(err) || "Nepodařilo se vytvořit QR pro focení.", "error");
    } finally {
      setQrNacitam(false);
    }
  }, [activeServiceId, serviceName]);

  const zavriQr = useCallback(() => {
    setQrPolozky(null);
    void nactiQrFotky(true);
  }, [nactiQrFotky]);

  useEffect(() => {
    if (!qrPolozky || !qrTokenRef.current) return;
    void nactiQrFotky(false);
    const t = setInterval(() => void nactiQrFotky(false), 3000);
    return () => clearInterval(t);
  }, [qrPolozky, nactiQrFotky]);

  return {
    otevreno,
    otevri,
    zavri,
    zahod,
    zrusitBezDotazu,
    koncept,
    setKoncept,
    rozepsany,
    nacitamZdroj,
    vyberZdroj,
    zrusZdroj,
    bezZakazky,
    zpetNaVyber,
    chyby,
    lzeVytvorit,
    duvod,
    ukazChybu,
    submitAttempted,
    vytvorit,
    vytvarim,
    pridejSoubory,
    odeberFotku,
    qrFotky,
    qrPocet,
    qrPolozky,
    qrNacitam,
    qrTokenRef,
    vyfotitZTelefonu,
    zavriQr,
  };
}
