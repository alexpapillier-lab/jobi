/**
 * Rozepsaná nová zakázka (koncept): stav okna a formuláře, uložení konceptu
 * do localStorage a odznak v navigaci, předvyplnění (zákazník, rezervace
 * z webu), našeptávač a dohledání zákazníka, opravy vybrané při příjmu,
 * ověření polí, zavření / zahození a fotky z telefonu ke konceptu.
 *
 * Vyneseno z Orders.tsx beze změny obsahu včetně závislostí. Založení
 * zakázky (createTicket) zůstává v kontejneru – spojuje koncept s useOrderActions,
 * pobočkami a rezervací dílů; sem míří přes createTicketRef (⌘/Ctrl+Enter).
 */
import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase, supabaseUrl, supabaseAnonKey, supabaseFetch } from "../../../lib/supabaseClient";
import { showToast } from "../../../components/Toast";
import { normalizePhone } from "../../../lib/phone";
import type { CustomerMatch } from "../../../components/orders";
import type { DeviceRepair, DevicesData } from "../../../lib/catalogStorage";
import { poZmeneOprav, soucetOprav } from "../../../lib/cenaPriPrijmu";
import { chybiPodkladZaruky } from "../../../lib/zarizeniHistorie";
import {
  NEW_ORDER_MORE_OPEN_KEY,
  NEW_ORDER_DEVICE_MORE_OPEN_KEY,
  NEW_ORDER_CUSTOMER_MORE_OPEN_KEY,
  safeLoadDraft,
  safeSaveDraft,
  defaultDraft,
  isDraftDirty,
} from "../koncept";
import { isEmailValid, isPhoneValid, isZipValid, isIcoValid } from "../formatovani";
import type { NewOrderDraft, OrdersProps, PolozkaQrFoceni } from "../typy";

type Vstup = {
  activeServiceId: string | null;
  newOrderPrefill: OrdersProps["newOrderPrefill"];
  onNewOrderPrefillConsumed: () => void;
  /** Ceník – dohledání oprav z rezervace a párování podle názvu zařízení. */
  devicesData: DevicesData;
  session: Session | null;
  /** Přihlášený uživatel (odměny týmu: kdo opravu nabídl při příjmu). */
  mojeId: string | null;
  /** Telefon je povinný (customerPhoneRequired). */
  customerPhoneRequired: boolean;
  draftCaptureTokenRef: MutableRefObject<string | null>;
  setDraftCapturePreviewUrls: Dispatch<SetStateAction<string[]>>;
  setDraftCaptureLiveCount: Dispatch<SetStateAction<number>>;
  captureQRItems: PolozkaQrFoceni[] | null;
  setCaptureQRItems: Dispatch<SetStateAction<PolozkaQrFoceni[] | null>>;
};

export function useNovaZakazkaKoncept({
  activeServiceId,
  newOrderPrefill,
  onNewOrderPrefillConsumed,
  devicesData,
  session,
  mojeId,
  customerPhoneRequired,
  draftCaptureTokenRef,
  setDraftCapturePreviewUrls,
  setDraftCaptureLiveCount,
  captureQRItems,
  setCaptureQRItems,
}: Vstup) {
  const [isNewOpen, setIsNewOpen] = useState(false);
  const [newDraft, setNewDraft] = useState<NewOrderDraft>(() => safeLoadDraft() ?? defaultDraft());
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [shouldOpenNew, setShouldOpenNew] = useState(false);
  const [matchedCustomer, setMatchedCustomer] = useState<{
    id: string;
    name: string;
    phone?: string;
    email?: string;
    company?: string;
  } | null>(null);
  const [customerMatchDecision, setCustomerMatchDecision] = useState<"undecided" | "accepted" | "rejected">("undecided");
  const lastLookupPhoneNormRef = useRef<string | null>(null);
  const phoneLookupDebounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  /** Sekce „Další údaje“ v nové zakázce – stav se pamatuje v localStorage. */
  const [newOrderMoreOpen, setNewOrderMoreOpen] = useState<boolean>(() => {
    try {
      // Výchozí otevřené – servis při příjmu většinou vyplňuje i IMEI, heslo
      // a stav zařízení; sbalení si pamatujeme, jen když ho uživatel zavře.
      const v = localStorage.getItem(NEW_ORDER_MORE_OPEN_KEY);
      return v === null ? true : v === "1";
    } catch {
      return false;
    }
  });
  /** „Další údaje zařízení“ u každého zařízení v nové zakázce – výchozí otevřené, sbalení se pamatuje. */
  const [newOrderDeviceMoreOpen, setNewOrderDeviceMoreOpen] = useState<boolean>(() => {
    try {
      const v = localStorage.getItem(NEW_ORDER_DEVICE_MORE_OPEN_KEY);
      return v === null ? true : v === "1";
    } catch {
      return true;
    }
  });
  /** „Další údaje zákazníka“ (e-mail, firma, adresa, poznámka) v kartě Zákazník – výchozí otevřené, sbalení se pamatuje. */
  const [newOrderCustomerMoreOpen, setNewOrderCustomerMoreOpen] = useState<boolean>(() => {
    try {
      const v = localStorage.getItem(NEW_ORDER_CUSTOMER_MORE_OPEN_KEY);
      return v === null ? true : v === "1";
    } catch {
      return true;
    }
  });
  /** Které zařízení v nové zakázce je rozbalené (ostatní jsou sbalené karty). */
  const [expandedDeviceIdx, setExpandedDeviceIdx] = useState<number>(0);
  /** Rozbalený úplný seznam oprav z ceníku u zařízení (index → true). */
  const [catalogShowAll, setCatalogShowAll] = useState<Record<number, boolean>>({});
  const createTicketRef = useRef<() => void>(() => {});
  const newOrderBodyRef = useRef<HTMLDivElement | null>(null);
  const draftDirty = useMemo(() => isDraftDirty(newDraft), [newDraft]);

  const validEnoughToCreate = useMemo(() => {
    const hasDevices = newDraft.devices.length > 0 && newDraft.devices.every((d) => (d.deviceLabel || "").trim().length > 0);
    return (
      hasDevices &&
      isEmailValid(newDraft.customerEmail) &&
      isPhoneValid(newDraft.customerPhone) &&
      isZipValid(newDraft.addressZip) &&
      isIcoValid(newDraft.ico)
    );
  }, [newDraft]);

  const draftBadgeCount = useMemo(() => {
    return draftDirty && !validEnoughToCreate && !isNewOpen ? 1 : 0;
  }, [draftDirty, validEnoughToCreate, isNewOpen]);

  useEffect(() => {
    safeSaveDraft(draftDirty ? newDraft : null);
    window.dispatchEvent(new CustomEvent("jobsheet:draft-count", { detail: { count: draftBadgeCount } }));
  }, [newDraft, draftDirty, draftBadgeCount]);

  useEffect(() => {
    if (!newOrderPrefill) return;
    setShouldOpenNew(true);
    // Rezervace z webu: údaje zákazníka a zařízení rovnou do formuláře.
    // Rozepsanou zakázku nepřepisovat bez dotazu.
    // Pojistka: rezervace patří ke svému servisu, i kdyby záměr přežil přepnutí.
    const r = newOrderPrefill.rezervace && newOrderPrefill.rezervace.service_id === activeServiceId ? newOrderPrefill.rezervace : undefined;
    if (r && isDraftDirty(newDraft) && !window.confirm("Máte rozepsanou novou zakázku. Nahradit ji údaji z rezervace?")) {
      onNewOrderPrefillConsumed();
      return;
    }
    if (r) {
      setNewDraft((prev) => ({
        ...defaultDraft(),
        branchId: prev.branchId,
        customerName: r.customer_name,
        customerPhone: r.customer_phone,
        customerEmail: r.customer_email ?? "",
        devices: [{
          ...defaultDraft().devices[0],
          // Model z ceníku má přednost: podle názvu se pak nabídnou opravy z ceníku.
          deviceLabel: r.model_name || r.device_label,
          requestedRepair: r.repair_name ?? "",
          deviceNote: [r.model_name && r.model_name !== r.device_label ? `Zákazník uvedl: ${r.device_label}` : "", r.note ? `Z rezervace: ${r.note}` : ""].filter(Boolean).join(" · "),
          estimatedPrice: r.price_estimate ?? undefined,
          // Termín z rezervace + délka opravy z ceníku = předpokládané dokončení.
          expectedCompletionAt: r.preferred_at
            ? new Date(new Date(r.preferred_at).getTime() + (r.duration_min ?? 0) * 60_000).toISOString()
            : undefined,
          plannedRepairs: (() => {
            // Zákazník mohl v rezervaci vybrat víc oprav najednou.
            const ids = r.repair_ids && r.repair_ids.length > 0 ? r.repair_ids : r.repair_id ? [r.repair_id] : [];
            const vybrane = ids
              .map((id) => devicesData.repairs.find((x) => x.id === id))
              .filter((x): x is NonNullable<typeof x> => !!x)
              .map((cen) => ({ id: `${Date.now()}_${Math.random()}`, name: cen.name, type: "selected" as const, repairId: cen.id, price: cen.price, costs: cen.costs, estimatedTime: cen.estimatedTime, productIds: cen.productIds, pridalUserId: session?.user?.id ?? undefined }));
            return vybrane.length > 0 ? vybrane : undefined;
          })(),
        }],
        rezervaceId: r.id,
      }));
    }
    if (!newOrderPrefill.customerId) onNewOrderPrefillConsumed();
  // eslint-disable-next-line react-hooks/exhaustive-deps -- devicesData jen pro dohledání opravy z ceníku v okamžiku předvyplnění
  }, [newOrderPrefill, onNewOrderPrefillConsumed]);

  // Load customer detail and prefill form when newOrderPrefill.customerId is set (e.g. "Vytvořit zakázku" u zákazníka)
  useEffect(() => {
    const customerId = newOrderPrefill?.customerId;
    if (!customerId || !supabase || !activeServiceId) return;

    onNewOrderPrefillConsumed();
    (async () => {
      try {
        const { data, error } = await (supabase
          .from("customers") as any)
          .select("id,name,phone,email,company,ico,address_street,address_city,address_zip,note")
          .eq("id", customerId)
          .eq("service_id", activeServiceId)
          .single();

        if (error || !data) {
          console.error("[Orders] Error loading customer for prefill:", error);
          return;
        }

        setNewDraft((prev) => {
          const shouldPrefill = !prev.customerId;
          return {
            ...prev,
            customerId: data.id,
            customerName: shouldPrefill || !prev.customerName.trim() ? (data.name || "") : prev.customerName,
            customerPhone: shouldPrefill || !prev.customerPhone.trim() ? (data.phone || "") : prev.customerPhone,
            customerEmail: shouldPrefill || !prev.customerEmail.trim() ? (data.email || "") : prev.customerEmail,
            addressStreet: shouldPrefill || !prev.addressStreet.trim() ? (data.address_street || "") : prev.addressStreet,
            addressCity: shouldPrefill || !prev.addressCity.trim() ? (data.address_city || "") : prev.addressCity,
            addressZip: shouldPrefill || !prev.addressZip.trim() ? (data.address_zip || "") : prev.addressZip,
            company: shouldPrefill || !prev.company.trim() ? (data.company || "") : prev.company,
            ico: shouldPrefill || !prev.ico.trim() ? (data.ico || "") : prev.ico,
            customerInfo: shouldPrefill || !prev.customerInfo.trim() ? (data.note || "") : prev.customerInfo,
          };
        });
      } catch (err) {
        console.error("[Orders] Error loading customer for prefill:", err);
      }
      // Okno příjmu se otevře až s načtenými údaji zákazníka. Dřív se otevíralo
      // souběžně s načítáním a při pomalejší odpovědi zůstalo prázdné.
      setShouldOpenNew(true);
    })();
  }, [newOrderPrefill?.customerId, supabase, activeServiceId, onNewOrderPrefillConsumed]);

  useEffect(() => {
    const onReq = () => setShouldOpenNew(true);
    window.addEventListener("jobsheet:request-new-order" as any, onReq);
    return () => window.removeEventListener("jobsheet:request-new-order" as any, onReq);
     
  }, []);

  useEffect(() => {
    if (!shouldOpenNew) return;
    setShouldOpenNew(false);
    setSubmitAttempted(false);
    setIsNewOpen(true);
  }, [shouldOpenNew]);

  useEffect(() => {
    try {
      localStorage.setItem(NEW_ORDER_MORE_OPEN_KEY, newOrderMoreOpen ? "1" : "0");
    } catch {
      // ignore
    }
  }, [newOrderMoreOpen]);

  useEffect(() => {
    try {
      localStorage.setItem(NEW_ORDER_DEVICE_MORE_OPEN_KEY, newOrderDeviceMoreOpen ? "1" : "0");
    } catch {
      // ignore
    }
  }, [newOrderDeviceMoreOpen]);

  useEffect(() => {
    try {
      localStorage.setItem(NEW_ORDER_CUSTOMER_MORE_OPEN_KEY, newOrderCustomerMoreOpen ? "1" : "0");
    } catch {
      // ignore
    }
  }, [newOrderCustomerMoreOpen]);
  /**
   * Našeptávač zákazníků v nové zakázce: jméno, telefon, e-mail nebo firma.
   * Vrací i adresu a poznámku, aby výběr vyplnil celý blok bez dalšího dotazu.
   */
  const searchCustomers = useCallback(async (q: string): Promise<CustomerMatch[]> => {
    if (!supabase || !activeServiceId) return [];
    const safe = q.replace(/[,()*%\\]/g, " ").trim();
    if (safe.length < 2) return [];
    const digits = q.replace(/\D/g, "");
    const ors = [
      `name.ilike.*${safe}*`,
      `email.ilike.*${safe}*`,
      `company.ilike.*${safe}*`,
      `phone.ilike.*${safe}*`,
    ];
    if (digits.length >= 3) {
      ors.push(`phone_norm.ilike.*${digits}*`);
      ors.push(`phone.ilike.*${digits}*`);
    }
    const { data, error } = await (supabase.from("customers") as any)
      .select("id,name,phone,email,company,ico,address_street,address_city,address_zip,note")
      .eq("service_id", activeServiceId)
      .or(ors.join(","))
      .order("name", { ascending: true })
      .limit(16);
    if (error || !Array.isArray(data)) return [];
    // „Jan“ má nabídnout Jana Nováka dřív než Aramise Tochjana: nejdřív
    // shoda na začátku jména, pak na začátku slova, pak zbytek.
    const fold = (v: string) => v.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    const needle = fold(safe);
    const rank = (c: any) => {
      const name = fold(String(c.name || ""));
      if (name.startsWith(needle)) return 0;
      if (name.split(/\s+/).some((w) => w.startsWith(needle))) return 1;
      if (fold(String(c.company || "")).startsWith(needle)) return 2;
      return 3;
    };
    data.sort((a: any, b: any) => rank(a) - rank(b));
    return data.slice(0, 8).map((c: any) => ({
      id: String(c.id),
      name: c.name || "",
      phone: c.phone || null,
      email: c.email || null,
      company: c.company || null,
      city: c.address_city || null,
      // navíc pro vyplnění formuláře
      ico: c.ico || null,
      address_street: c.address_street || null,
      address_zip: c.address_zip || null,
      note: c.note || null,
    }));
  }, [supabase, activeServiceId]);

  /** Výběr zákazníka z našeptávače – vyplní celý blok a nastaví customerId. */
  const applyCustomerMatch = useCallback((m: CustomerMatch & { ico?: string | null; address_street?: string | null; address_zip?: string | null; note?: string | null }) => {
    setNewDraft((prev) => ({
      ...prev,
      customerId: m.id,
      customerName: m.name || "",
      customerPhone: m.phone || "",
      customerEmail: m.email || "",
      addressStreet: m.address_street || "",
      addressCity: m.city || "",
      addressZip: (m.address_zip || "").replace(/\D/g, ""),
      company: m.company || "",
      ico: (m.ico || "").replace(/\D/g, ""),
      customerInfo: m.note || "",
    }));
    setCustomerMatchDecision("accepted");
    setMatchedCustomer(null);
    lastLookupPhoneNormRef.current = normalizePhone(m.phone || "") ?? null;
    if (phoneLookupDebounceTimerRef.current) {
      clearTimeout(phoneLookupDebounceTimerRef.current);
      phoneLookupDebounceTimerRef.current = null;
    }
  }, []);

  // Lookup customer by phone or name
  const lookupCustomer = async (phone?: string, name?: string) => {
    if (!supabase || !activeServiceId) return;

    // Try phone lookup first (primary identifier)
    if (phone) {
      const phoneNorm = normalizePhone(phone);
      if (phoneNorm) {
        // Update lastLookupPhoneNormRef to prevent duplicate lookups
        lastLookupPhoneNormRef.current = phoneNorm;

        const { data, error } = await (supabase
          .from("customers") as any)
          .select("id,name,phone,email,company")
          .eq("service_id", activeServiceId)
          .eq("phone_norm", phoneNorm)
          .maybeSingle();

        if (!error && data) {
          // If name is also provided, check if it matches (case-insensitive)
          if (name && name.trim()) {
            const nameMatch = data.name?.trim().toLowerCase() === name.trim().toLowerCase();
            if (nameMatch) {
              // Phone + name match - high confidence
              setMatchedCustomer({
                id: data.id,
                name: data.name || "",
                phone: data.phone || undefined,
                email: data.email || undefined,
                company: data.company || undefined,
              });
              setCustomerMatchDecision("undecided");
              return;
            }
          }
          // Phone match (name may or may not match)
          setMatchedCustomer({
            id: data.id,
            name: data.name || "",
            phone: data.phone || undefined,
            email: data.email || undefined,
            company: data.company || undefined,
          });
          setCustomerMatchDecision("undecided");
          return;
        }
      } else {
        // Invalid phone norm - reset lastLookupPhoneNormRef
        lastLookupPhoneNormRef.current = null;
      }
    }

    // Vyhledání podle jména (když není telefon nebo telefon nenašel)
    if (name && name.trim().length >= 2) {
      const nameTrim = name.trim();
      const { data: nameData, error: nameError } = await (supabase
        .from("customers") as any)
        .select("id,name,phone,email,company")
        .eq("service_id", activeServiceId)
        .ilike("name", `%${nameTrim.replace(/%/g, "\\%")}%`)
        .limit(1)
        .maybeSingle();

      if (!nameError && nameData) {
        setMatchedCustomer({
          id: nameData.id,
          name: nameData.name || "",
          phone: nameData.phone || undefined,
          email: nameData.email || undefined,
          company: nameData.company || undefined,
        });
        setCustomerMatchDecision("undecided");
        return;
      }
    }

    // No match found
    setMatchedCustomer(null);
    setCustomerMatchDecision("undecided");
  };
  /** Přepne opravu z ceníku u zařízení v nové zakázce: text požadované opravy, seznam oprav i předschválenou cenu. */
  const togglePlannedRepair = useCallback((idx: number, repair: DeviceRepair) => {
    setNewDraft((p) => ({
      ...p,
      devices: p.devices.map((d, i) => {
        if (i !== idx) return d;
        const planned = d.plannedRepairs ?? [];
        const has = planned.some((r) => r.repairId === repair.id);
        const nextPlanned = has
          ? planned.filter((r) => r.repairId !== repair.id)
          : [
              ...planned,
              {
                id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                name: repair.name,
                type: "selected" as const,
                repairId: repair.id,
                price: repair.price,
                costs: repair.costs,
                estimatedTime: repair.estimatedTime,
                productIds: repair.productIds,
                // Odměny týmu: kdo opravu nabídl už při příjmu.
                pridalUserId: mojeId ?? undefined,
              },
            ];
        // Text požadované opravy: jména z ceníku oddělená čárkou, ruční text zůstává.
        const parts = (d.requestedRepair || "").split(",").map((x) => x.trim()).filter(Boolean);
        const nextParts = has ? parts.filter((x) => x !== repair.name) : parts.includes(repair.name) ? parts : [...parts, repair.name];
        // Předschválená cena (i se slevou) se přepisuje jen dokud ji uživatel nezadal ručně.
        return {
          ...d,
          ...poZmeneOprav(d, soucetOprav(planned), soucetOprav(nextPlanned)),
          plannedRepairs: nextPlanned,
          requestedRepair: nextParts.join(", "),
        };
      }),
    }));
  }, []);

  /**
   * Oprava mimo ceník už při příjmu. Jde do stejného seznamu jako opravy
   * z ceníku, takže se počítá do součtu, do slevy i do předschválené ceny –
   * dřív se na ni sleva musela dopočítat ručně, protože ji nebylo kam zapsat.
   */
  const [dalsiOprava, setDalsiOprava] = useState<Record<number, { name: string; price: string }>>({});

  const addManualPlannedRepair = useCallback((idx: number, nazev: string, cenaText: string): boolean => {
    const name = nazev.trim();
    const price = Number(cenaText.replace(/\s/g, "").replace(",", "."));
    if (!name || !Number.isFinite(price) || price < 0) return false;
    setNewDraft((p) => ({
      ...p,
      devices: p.devices.map((d, i) => {
        if (i !== idx) return d;
        const planned = d.plannedRepairs ?? [];
        const nextPlanned = [...planned, { id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, name, type: "manual" as const, price, pridalUserId: mojeId ?? undefined }];
        const parts = (d.requestedRepair || "").split(",").map((x) => x.trim()).filter(Boolean);
        return {
          ...d,
          ...poZmeneOprav(d, soucetOprav(planned), soucetOprav(nextPlanned)),
          plannedRepairs: nextPlanned,
          requestedRepair: (parts.includes(name) ? parts : [...parts, name]).join(", "),
        };
      }),
    }));
    return true;
  }, []);

  /** Příznak „nabídnuto navíc“ u opravy vybrané při příjmu (odměny týmu). */
  const nastavPlannedNabidnuto = useCallback((idx: number, id: string, nabidnuto: boolean) => {
    setNewDraft((p) => ({
      ...p,
      devices: p.devices.map((d, i) => (i !== idx ? d : { ...d, plannedRepairs: (d.plannedRepairs ?? []).map((r) => (r.id === id ? { ...r, nabidnuto } : r)) })),
    }));
  }, []);

  const removePlannedRepair = useCallback((idx: number, id: string) => {
    setNewDraft((p) => ({
      ...p,
      devices: p.devices.map((d, i) => {
        if (i !== idx) return d;
        const planned = d.plannedRepairs ?? [];
        const odebirana = planned.find((r) => r.id === id);
        if (!odebirana) return d;
        const nextPlanned = planned.filter((r) => r.id !== id);
        const parts = (d.requestedRepair || "").split(",").map((x) => x.trim()).filter(Boolean);
        return {
          ...d,
          ...poZmeneOprav(d, soucetOprav(planned), soucetOprav(nextPlanned)),
          plannedRepairs: nextPlanned,
          requestedRepair: parts.filter((x) => x !== odebirana.name).join(", "),
        };
      }),
    }));
  }, []);
  const openNewOrder = () => {
    setSubmitAttempted(false);
    setIsNewOpen(true);
  };
  const errors = useMemo(() => {
    const e: Record<string, string> = {};
    newDraft.devices.forEach((dev, i) => {
      if (!dev.deviceLabel.trim()) e[`deviceLabel_${i}`] = "Vyplňte zařízení.";
      // Záruční oprava bez data nákupu ani dokladu se u dodavatele neuplatní.
      if (chybiPodkladZaruky(dev)) e[`zaruka_${i}`] = "U záruční opravy vyplňte datum nákupu nebo doklad o koupi.";
    });
    const phoneRequired = customerPhoneRequired;
    if (phoneRequired && !newDraft.customerPhone.trim()) e.customerPhone = "Telefon je povinný.";
    else if (!isPhoneValid(newDraft.customerPhone)) e.customerPhone = "Telefon vypadá neplatně.";
    if (!isEmailValid(newDraft.customerEmail)) e.customerEmail = "E-mail vypadá neplatně.";
    if (!isZipValid(newDraft.addressZip)) e.addressZip = "PSČ musí mít 5 číslic.";
    if (!isIcoValid(newDraft.ico)) e.ico = "IČO musí mít 8 číslic.";
    return e;
  }, [newDraft, customerPhoneRequired]);

  const canCreate = Object.keys(errors).length === 0;
  const showError = (field: string) => submitAttempted && !!errors[field];
  const showDeviceError = (idx: number) => submitAttempted && !!errors[`deviceLabel_${idx}`];

  /** Krátký důvod, proč nejde vytvořit – k tlačítku v patičce. */
  const createBlockedReason = useMemo(() => {
    const keys = Object.keys(errors);
    if (keys.length === 0) return null;
    if (keys.some((k) => k.startsWith("deviceLabel_"))) return "Chybí zařízení";
    if (keys.some((k) => k.startsWith("zaruka_"))) return "Chybí podklad záruky";
    if (errors.customerPhone) return errors.customerPhone === "Telefon je povinný." ? "Chybí telefon" : "Neplatný telefon";
    if (errors.customerEmail) return "Neplatný e-mail";
    if (errors.addressZip) return "Neplatné PSČ";
    if (errors.ico) return "Neplatné IČO";
    return "Zkontrolujte vyplněné údaje";
  }, [errors]);

  /**
   * Při pokusu o vytvoření s chybami: rozbalí, co je třeba, a přesune fokus
   * do prvního chybného pole. Pořadí odpovídá pořadí polí ve formuláři.
   */
  const focusFirstInvalidField = () => {
    const deviceIdx = newDraft.devices.findIndex((_, i) => !!errors[`deviceLabel_${i}`]);
    let selector: string | null = null;
    // E-mail, PSČ a IČO leží v kartě Zákazník pod sbalitelnými „Dalšími údaji zákazníka“.
    let needsCustomerMore = false;
    if (errors.customerPhone) selector = "#new-order-phone";
    else if (errors.customerEmail) { selector = "#new-order-email"; needsCustomerMore = true; }
    else if (errors.addressZip) { selector = "#new-order-zip"; needsCustomerMore = true; }
    else if (errors.ico) { selector = "#new-order-ico"; needsCustomerMore = true; }
    else if (deviceIdx >= 0) {
      setExpandedDeviceIdx(deviceIdx);
      selector = `#new-order-device-${deviceIdx} input`;
    }
    if (!selector) return;
    if (needsCustomerMore) setNewOrderCustomerMoreOpen(true);
    const sel = selector;
    window.setTimeout(() => {
      const root = newOrderBodyRef.current ?? document;
      const el = root.querySelector<HTMLElement>(sel);
      if (el) {
        el.focus();
        el.scrollIntoView({ block: "center", behavior: "smooth" });
      }
    }, 60);
  };
  /** Zavře okno Nová zakázka; rozpracované údaje zůstávají uložené. */
  const closeNewOrder = () => {
    setIsNewOpen(false);
    setCustomerMatchDecision("undecided");
    setMatchedCustomer(null);
    lastLookupPhoneNormRef.current = null;
    if (phoneLookupDebounceTimerRef.current) {
      clearTimeout(phoneLookupDebounceTimerRef.current);
      phoneLookupDebounceTimerRef.current = null;
    }
  };

  /** Zruší rozpracovanou zakázku – zahodí koncept i přijímací fotky. */
  const discardNewOrder = () => {
    draftCaptureTokenRef.current = null;
    setDraftCapturePreviewUrls([]);
    setDraftCaptureLiveCount(0);
    setNewDraft(defaultDraft());
    safeSaveDraft(null);
    window.dispatchEvent(new CustomEvent("jobsheet:draft-count", { detail: { count: 0 } }));
    setExpandedDeviceIdx(0);
    closeNewOrder();
  };
  // Nově přidané zařízení je rozbalené; po smazání drží index v mezích.
  useEffect(() => {
    setExpandedDeviceIdx((idx) => Math.min(idx, Math.max(0, newDraft.devices.length - 1)));
  }, [newDraft.devices.length]);
  const loadDraftCapturePreviews = useCallback(async (showAddedToast: boolean = true) => {
    const draftToken = draftCaptureTokenRef.current;
    if (!draftToken || !supabase || !supabaseUrl || !supabaseAnonKey) return;
    try {
      const authToken = (await supabase.auth.getSession()).data?.session?.access_token;
      if (!authToken) return;
      const res = await supabaseFetch(`${supabaseUrl}/functions/v1/capture-list-draft`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}`, apikey: supabaseAnonKey },
        body: JSON.stringify({ token: draftToken }),
      });
      const raw = await res.text();
      const data: { urls?: string[]; error?: string } = raw ? JSON.parse(raw) : {};
      if (!res.ok) throw new Error(data.error || res.statusText);
      if (Array.isArray(data.urls)) {
        setDraftCaptureLiveCount(data.urls.length);
        setDraftCapturePreviewUrls((prev) => {
          const added = Math.max(0, data.urls!.length - prev.length);
          if (showAddedToast && added > 0) {
            const suffix = added === 1 ? "fotka" : added >= 2 && added <= 4 ? "fotky" : "fotek";
            showToast(`Načteno ${added} ${suffix} z mobilu`, "success");
          }
          return data.urls!;
        });
      }
    } catch (err) {
      console.warn("[Orders] loadDraftCapturePreviews failed", err);
    }
  }, []);

  const closeCaptureQrModal = useCallback(() => {
    setCaptureQRItems(null);
    void loadDraftCapturePreviews(true);
  }, [loadDraftCapturePreviews]);

  useEffect(() => {
    if (!captureQRItems || !draftCaptureTokenRef.current) return;
    void loadDraftCapturePreviews(false);
    const t = setInterval(() => {
      void loadDraftCapturePreviews(false);
    }, 3000);
    return () => clearInterval(t);
  }, [captureQRItems, loadDraftCapturePreviews]);

  return {
    isNewOpen,
    setIsNewOpen,
    newDraft,
    setNewDraft,
    submitAttempted,
    setSubmitAttempted,
    matchedCustomer,
    setMatchedCustomer,
    customerMatchDecision,
    setCustomerMatchDecision,
    lastLookupPhoneNormRef,
    phoneLookupDebounceTimerRef,
    newOrderMoreOpen,
    setNewOrderMoreOpen,
    newOrderDeviceMoreOpen,
    setNewOrderDeviceMoreOpen,
    newOrderCustomerMoreOpen,
    setNewOrderCustomerMoreOpen,
    expandedDeviceIdx,
    setExpandedDeviceIdx,
    catalogShowAll,
    setCatalogShowAll,
    createTicketRef,
    newOrderBodyRef,
    searchCustomers,
    applyCustomerMatch,
    lookupCustomer,
    togglePlannedRepair,
    dalsiOprava,
    setDalsiOprava,
    addManualPlannedRepair,
    nastavPlannedNabidnuto,
    removePlannedRepair,
    openNewOrder,
    errors,
    canCreate,
    showError,
    showDeviceError,
    createBlockedReason,
    focusFirstInvalidField,
    closeNewOrder,
    discardNewOrder,
    closeCaptureQrModal,
  };
}
