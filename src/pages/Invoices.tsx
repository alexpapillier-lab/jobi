import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { Button, Input, Label } from "../components/ui";
import { XIcon } from "../components/icons";
import { typedSupabase } from "../lib/typedSupabase";
import { useAuth } from "../auth/AuthProvider";
import { supabase } from "../lib/supabaseClient";
import { showToast } from "../components/Toast";
import { reportError, reportSilent } from "../lib/reportError";
import { safeLoadCompanyData } from "../lib/companyData";
import { computeTotals, emptyLineItem, type InvoiceLineItem } from "../lib/invoiceMath";
import { useServiceVat, sazbaProNovouPolozku } from "../hooks/useServiceVat";
import { generateInvoiceNumber, invoiceNumberToVS } from "../lib/invoiceNumbering";
import { invoiceDocumentData } from "../lib/documentData";
import { printDocument, exportDocument, isJobiDocsRunning, renderPdf, formatJobiDocsErrorForUser } from "../lib/jobidocs";
import { isWeb } from "../lib/platform";
import { printDocumentInBrowser, buildDocumentPreviewUrlForWeb } from "../lib/webPrint";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { validateInvoiceForIssue, validateInvoiceForSave } from "../lib/invoiceValidation";
import { InvoiceList } from "./Invoices/InvoiceList";
import { InvoiceEditor, type InvoiceCustomerMatch } from "./Invoices/InvoiceEditor";
import { InvoiceDetail } from "./Invoices/InvoiceDetail";
import {
  STATUS_LABELS,
  addDaysIso,
  todayIso,
  type EditorLineItem,
  type Invoice,
  type InvoiceEvent,
  type InvoiceItem,
  type InvoiceStatus,
  type ListFilter,
} from "./Invoices/types";

type View = "list" | "editor";

type ConfirmState = {
  title: string;
  message: string;
  confirmLabel?: string;
  variant?: "default" | "danger";
  onConfirm: () => void;
};

type Props = {
  activeServiceId: string | null;
  prefillFromTicket?: {
    ticketId: string;
    customerId?: string;
    customerName?: string;
    customerEmail?: string;
    customerPhone?: string;
    customerIco?: string;
    customerDic?: string;
    customerAddress?: string;
    items?: InvoiceLineItem[];
  } | null;
  onPrefillConsumed?: () => void;
  /** When set, open this invoice in the editor (e.g. from Zakázky "Přejít na fakturu"). */
  openInvoiceId?: string | null;
  onOpenInvoiceIdConsumed?: () => void;
  /** When user wants to go to the linked order from invoice detail. */
  onOpenTicket?: (ticketId: string) => void;
};

/** Validátor bere `undefined`, databáze vrací `null` – sjednocení. */
function toValidationData(inv: Partial<Invoice>) {
  return {
    number: inv.number ?? undefined,
    issue_date: inv.issue_date ?? undefined,
    due_date: inv.due_date ?? undefined,
    customer_name: inv.customer_name ?? undefined,
    supplier_name: inv.supplier_name ?? undefined,
    status: inv.status ?? undefined,
  };
}

/** Otisk editoru pro zjištění neuložených změn. */
function snapshot(inv: Partial<Invoice>, items: EditorLineItem[]): string {
  return JSON.stringify([inv, items]);
}

/**
 * Stránka Faktury: drží data a akce, vykreslování má ve třech částech –
 * seznam (InvoiceList), editor (InvoiceEditor) a boční detail
 * (InvoiceDetail). Modální okna pro e-mail a náhled PDF zůstávají tady,
 * protože pracují se stejnými akcemi jako detail.
 */
export default function Invoices({ activeServiceId, prefillFromTicket, onPrefillConsumed, openInvoiceId, onOpenInvoiceIdConsumed, onOpenTicket }: Props) {
  const dph = useServiceVat(activeServiceId);
  /** Sazba pro nové položky – neplátce DPH má 0. */
  const sazbaNoveVPolozky = sazbaProNovouPolozku(dph);
  const { session } = useAuth();
  const [view, setView] = useState<View>("list");
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Filtr seznamu
  const [filter, setFilter] = useState<ListFilter>("all");
  const [filterSearch, setFilterSearch] = useState("");

  // Editor
  const [editorInvoice, setEditorInvoice] = useState<Partial<Invoice>>({});
  const [editorItems, setEditorItems] = useState<EditorLineItem[]>([emptyLineItem(sazbaNoveVPolozky)]);
  const [editorBaseline, setEditorBaseline] = useState("");
  const [saving, setSaving] = useState(false);

  // Detail
  const [detailInvoice, setDetailInvoice] = useState<Invoice | null>(null);
  const [detailItems, setDetailItems] = useState<InvoiceItem[]>([]);
  const [detailEvents, setDetailEvents] = useState<InvoiceEvent[]>([]);
  const [showDetail, setShowDetail] = useState(false);

  // Odeslání e-mailem
  const [sendModalOpen, setSendModalOpen] = useState(false);
  const [sendEmail, setSendEmail] = useState("");
  const [sendSubject, setSendSubject] = useState("");
  const [sendBody, setSendBody] = useState("");
  const [sending, setSending] = useState(false);

  const [confirm, setConfirm] = useState<ConfirmState | null>(null);

  // Náhled PDF
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const previewUrlRef = useRef<string | null>(null);
  previewUrlRef.current = previewUrl;

  const companyData = useMemo(() => safeLoadCompanyData(), []);

  // ─── Načtení ───────────────────────────────────────────────

  const loadInvoices = useCallback(async () => {
    if (!activeServiceId) return;
    setLoading(true);
    try {
      const { data, error } = await typedSupabase
        .from("invoices")
        .select("*")
        .eq("service_id", activeServiceId)
        .is("deleted_at", null)
        .order("created_at", { ascending: false });
      if (error) throw error;
      setInvoices(data || []);
    } catch (err) {
      reportSilent({ code: "invoices.load_failed", error: err, source: "Invoices.loadInvoices" });
    } finally {
      setLoading(false);
    }
  }, [activeServiceId]);

  useEffect(() => {
    loadInvoices();
  }, [loadInvoices]);

  // Faktury po splatnosti se označí automaticky.
  useEffect(() => {
    if (!activeServiceId || invoices.length === 0) return;
    const today = todayIso();
    const overdueIds = invoices.filter((i) => ["issued", "sent"].includes(i.status) && i.due_date < today).map((i) => i.id);
    if (overdueIds.length === 0) return;
    (async () => {
      try {
        await typedSupabase.from("invoices").update({ status: "overdue" }).in("id", overdueIds);
        loadInvoices();
      } catch (e) {
        // Když selže, uživatel uvidí zastaralý stav a nepozná proč – proto se to zaloguje.
        reportSilent({ code: "invoices.mark_overdue_failed", error: e, source: "Invoices.markOverdue" });
      }
    })();
  }, [invoices, activeServiceId, loadInvoices]);

  // ─── Otevření editoru / detailu ────────────────────────────

  const openNewInvoice = useCallback(
    async (prefill?: Props["prefillFromTicket"]) => {
      if (!activeServiceId) return;
      const number = await generateInvoiceNumber(activeServiceId);
      const today = todayIso();
      const cd = safeLoadCompanyData();

      const inv: Partial<Invoice> = {
        number,
        variable_symbol: invoiceNumberToVS(number),
        status: "draft",
        issue_date: today,
        due_date: addDaysIso(today, 14),
        taxable_date: today,
        currency: "CZK",
        supplier_name: cd.name,
        supplier_ico: cd.ico,
        supplier_dic: cd.dic,
        supplier_address: [cd.addressStreet, cd.addressCity, cd.addressZip].filter(Boolean).join(", "),
        supplier_email: cd.email,
        supplier_phone: cd.phone,
        supplier_bank_account: cd.bankAccount,
        supplier_iban: cd.iban,
        supplier_swift: cd.swift,
        customer_name: prefill?.customerName || "",
        customer_email: prefill?.customerEmail || "",
        customer_phone: prefill?.customerPhone || "",
        customer_ico: prefill?.customerIco || "",
        customer_dic: prefill?.customerDic || "",
        customer_address: prefill?.customerAddress || "",
        ticket_id: prefill?.ticketId || null,
        customer_id: prefill?.customerId || null,
      };
      const items: EditorLineItem[] = prefill?.items?.length ? prefill.items.map((i) => ({ ...i })) : [emptyLineItem(sazbaNoveVPolozky)];
      setEditorInvoice(inv);
      setEditorItems(items);
      setEditorBaseline(snapshot(inv, items));
      setEditingId(null);
      setShowDetail(false);
      setView("editor");
    },
    [activeServiceId, sazbaNoveVPolozky],
  );

  const openEditInvoice = useCallback(
    async (inv: Invoice) => {
      const { data: rows } = await typedSupabase.from("invoice_items").select("*").eq("invoice_id", inv.id).order("sort_order", { ascending: true });
      const items: EditorLineItem[] = rows?.length
        ? rows.map((it) => ({ id: it.id, name: it.name, qty: it.qty, unit: it.unit, unit_price: it.unit_price, vat_rate: it.vat_rate }))
        : [emptyLineItem(sazbaNoveVPolozky)];
      setEditorInvoice(inv);
      setEditorItems(items);
      setEditorBaseline(snapshot(inv, items));
      setEditingId(inv.id);
      setShowDetail(false);
      setView("editor");
    },
    [sazbaNoveVPolozky],
  );

  const openDetail = useCallback(async (inv: Invoice) => {
    setDetailInvoice(inv);
    setShowDetail(true);
    const [itemsRes, eventsRes] = await Promise.all([
      typedSupabase.from("invoice_items").select("*").eq("invoice_id", inv.id).order("sort_order"),
      typedSupabase.from("invoice_events").select("*").eq("invoice_id", inv.id).order("created_at", { ascending: false }),
    ]);
    setDetailItems(itemsRes.data || []);
    setDetailEvents(eventsRes.data || []);
  }, []);

  // Předvyplnění ze zakázky
  useEffect(() => {
    if (!prefillFromTicket || !activeServiceId) return;
    openNewInvoice(prefillFromTicket);
    onPrefillConsumed?.();
    // openNewInvoice se mění s aktivním servisem; spouštět jen při novém prefillu.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefillFromTicket, activeServiceId]);

  // Otevření konkrétní faktury (např. ze zakázky „Přejít na fakturu“)
  useEffect(() => {
    if (!openInvoiceId || !onOpenInvoiceIdConsumed) return;
    let cancelled = false;
    (async () => {
      try {
        const { data: inv, error } = await typedSupabase.from("invoices").select("*").eq("id", openInvoiceId).single();
        if (cancelled || error || !inv) {
          onOpenInvoiceIdConsumed();
          return;
        }
        if (inv.status === "draft") await openEditInvoice(inv);
        else await openDetail(inv);
      } catch (e) {
        reportSilent({ code: "invoices.open_by_id_failed", error: e, source: "Invoices.openInvoiceId" });
      }
      onOpenInvoiceIdConsumed();
    })();
    return () => {
      cancelled = true;
    };
  }, [openInvoiceId, onOpenInvoiceIdConsumed, openEditInvoice, openDetail]);

  // ─── Události ──────────────────────────────────────────────

  const logEvent = useCallback(
    async (invoiceId: string, type: string, payload: Record<string, unknown>) => {
      try {
        await typedSupabase.from("invoice_events").insert({
          invoice_id: invoiceId,
          type,
          payload: payload as never,
          created_by: session?.user?.id || null,
        });
      } catch (e) {
        // Selhání nebrání práci, ale bez logu by chyběl záznam a nikdo by nevěděl, že se nezapisuje.
        reportSilent({ code: "invoices.log_event_failed", error: e, source: "Invoices.logEvent" });
      }
    },
    [session],
  );

  // ─── Uložení z editoru ─────────────────────────────────────

  const editorTotals = useMemo(() => computeTotals(editorItems), [editorItems]);
  const editorDirty = snapshot(editorInvoice, editorItems) !== editorBaseline;

  /**
   * Uloží editor. `issue` navíc přepne koncept na „vystaveno“ – s přísnější
   * validací (odběratel a dodavatel jsou povinní).
   */
  const persistEditor = useCallback(
    async (issue: boolean) => {
      if (!activeServiceId || saving) return;

      const validation = issue ? validateInvoiceForIssue : validateInvoiceForSave;
      const errors = validation(toValidationData(editorInvoice), editorItems);
      if (errors.length > 0) {
        showToast(errors[0].message, "error");
        return;
      }

      setSaving(true);
      try {
        const totals = computeTotals(editorItems);
        const wasDraft = (editorInvoice.status || "draft") === "draft";
        const nextStatus = issue && wasDraft ? "issued" : editorInvoice.status || "draft";
        const { id: _id, created_at: _c, updated_at: _u, deleted_at: _d, ...rest } = editorInvoice;
        const payload = {
          ...rest,
          service_id: activeServiceId,
          status: nextStatus,
          subtotal: totals.subtotal,
          vat_amount: totals.vat_amount,
          total: totals.total_rounded,
          rounding: totals.rounding,
        };

        let invoiceId: string;
        if (editingId) {
          const { error } = await typedSupabase.from("invoices").update(payload).eq("id", editingId);
          if (error) throw error;
          invoiceId = editingId;
          await typedSupabase.from("invoice_items").delete().eq("invoice_id", invoiceId);
        } else {
          const { data, error } = await typedSupabase
            .from("invoices")
            .insert(payload as never)
            .select("id")
            .single();
          if (error) throw error;
          invoiceId = data!.id;
        }

        const itemsPayload = editorItems.map((it, idx) => ({
          invoice_id: invoiceId,
          sort_order: idx,
          name: it.name,
          qty: it.qty,
          unit: it.unit,
          unit_price: it.unit_price,
          vat_rate: it.vat_rate,
          line_total: Math.round(it.qty * it.unit_price * 100) / 100,
        }));
        if (itemsPayload.length > 0) {
          const { error: itemsErr } = await typedSupabase.from("invoice_items").insert(itemsPayload);
          if (itemsErr) throw itemsErr;
        }

        await logEvent(invoiceId, editingId ? "updated" : "created", {
          number: editorInvoice.number,
          total: totals.total_rounded,
          items_count: editorItems.length,
        });
        if (issue && wasDraft) {
          await logEvent(invoiceId, "status_changed", { from: "draft", to: "issued" });
        }

        showToast(issue && wasDraft ? `Faktura ${editorInvoice.number} vystavena` : editingId ? "Faktura uložena" : "Koncept uložen", "success");
        setEditorBaseline(snapshot(editorInvoice, editorItems));
        setView("list");
        await loadInvoices();

        // Po vystavení se otevře detail – odtud se tiskne a posílá.
        if (issue) {
          const { data: saved } = await typedSupabase.from("invoices").select("*").eq("id", invoiceId).single();
          if (saved) openDetail(saved);
        }
      } catch (err) {
        reportError({
          code: "invoices.save_failed",
          error: err,
          userMessage: "Fakturu se nepodařilo uložit: " + (err instanceof Error ? err.message : String(err)),
          source: "Invoices.persistEditor",
        });
      } finally {
        setSaving(false);
      }
    },
    [activeServiceId, saving, editorInvoice, editorItems, editingId, logEvent, loadInvoices, openDetail],
  );

  const saveDraft = useCallback(() => persistEditor(false), [persistEditor]);
  const issueFromEditor = useCallback(() => persistEditor(true), [persistEditor]);

  /** Odchod z editoru; s neuloženými změnami se nejdřív zeptá. */
  const leaveEditor = useCallback(() => {
    if (!editorDirty) {
      setView("list");
      return;
    }
    setConfirm({
      title: "Neuložené změny",
      message: "Ve faktuře máte neuložené změny. Chcete odejít bez uložení?",
      confirmLabel: "Odejít bez uložení",
      variant: "danger",
      onConfirm: () => setView("list"),
    });
  }, [editorDirty]);

  // ─── Našeptávač odběratele ─────────────────────────────────

  const searchCustomers = useCallback(
    async (q: string): Promise<InvoiceCustomerMatch[]> => {
      if (!activeServiceId) return [];
      const safe = q.replace(/[,()*%\\]/g, " ").trim();
      if (safe.length < 2) return [];
      const digits = q.replace(/\D/g, "");
      const ors = [`name.ilike.*${safe}*`, `email.ilike.*${safe}*`, `company.ilike.*${safe}*`, `phone.ilike.*${safe}*`, `ico.ilike.*${safe}*`];
      if (digits.length >= 3) {
        ors.push(`phone_norm.ilike.*${digits}*`);
        ors.push(`phone.ilike.*${digits}*`);
      }
      try {
        const { data, error } = await typedSupabase
          .from("customers")
          .select("id,name,phone,email,company,ico,dic,address_street,address_city,address_zip")
          .eq("service_id", activeServiceId)
          .or(ors.join(","))
          .order("name", { ascending: true })
          .limit(16);
        if (error || !data) return [];
        const fold = (v: string) => v.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
        const needle = fold(safe);
        const rank = (c: { name: string; company: string | null }) => {
          const name = fold(c.name || "");
          if (name.startsWith(needle)) return 0;
          if (name.split(/\s+/).some((w) => w.startsWith(needle))) return 1;
          if (fold(c.company || "").startsWith(needle)) return 2;
          return 3;
        };
        return [...data]
          .sort((a, b) => rank(a) - rank(b))
          .map((c) => ({
            id: c.id,
            name: c.name,
            phone: c.phone,
            email: c.email,
            company: c.company,
            city: c.address_city,
            ico: c.ico,
            dic: c.dic,
            address: [c.address_street, [c.address_zip, c.address_city].filter(Boolean).join(" ")].filter(Boolean).join(", "),
          }));
      } catch (e) {
        reportSilent({ code: "invoices.customer_search_failed", error: e, source: "Invoices.searchCustomers" });
        return [];
      }
    },
    [activeServiceId],
  );

  // ─── Akce nad fakturou ─────────────────────────────────────

  const updateStatus = useCallback(
    async (inv: Invoice, newStatus: InvoiceStatus) => {
      try {
        const updates: Partial<Invoice> = { status: newStatus };
        if (newStatus === "paid") updates.paid_at = new Date().toISOString();
        if (newStatus === "sent") updates.sent_at = new Date().toISOString();
        const { error } = await typedSupabase.from("invoices").update(updates).eq("id", inv.id);
        if (error) throw error;
        await logEvent(inv.id, "status_changed", { from: inv.status, to: newStatus });
        showToast(`Stav změněn na: ${STATUS_LABELS[newStatus]}`, "success");
        loadInvoices();
        if (showDetail && detailInvoice?.id === inv.id) {
          openDetail({ ...inv, ...updates });
        }
      } catch (err) {
        reportError({
          code: "invoices.update_status_failed",
          error: err,
          userMessage: "Stav se nepodařilo změnit: " + (err instanceof Error ? err.message : String(err)),
          source: "Invoices.updateStatus",
        });
      }
    },
    [logEvent, loadInvoices, showDetail, detailInvoice, openDetail],
  );

  /** Vystavení z detailu – stejná validace jako v editoru. */
  const issueFromDetail = useCallback(
    (inv: Invoice) => {
      const errors = validateInvoiceForIssue(toValidationData(inv), detailItems);
      if (errors.length > 0) {
        showToast(errors[0].message, "error");
        return;
      }
      updateStatus(inv, "issued");
    },
    [detailItems, updateStatus],
  );

  const deleteInvoice = useCallback(
    async (inv: Invoice) => {
      try {
        const { error } = await typedSupabase.from("invoices").update({ deleted_at: new Date().toISOString() }).eq("id", inv.id);
        if (error) throw error;
        await logEvent(inv.id, "deleted", {});
        showToast("Koncept smazán", "success");
        loadInvoices();
        if (showDetail && detailInvoice?.id === inv.id) setShowDetail(false);
      } catch (err) {
        reportError({
          code: "invoices.delete_invoice_failed",
          error: err,
          userMessage: "Fakturu se nepodařilo smazat: " + (err instanceof Error ? err.message : String(err)),
          source: "Invoices.deleteInvoice",
        });
      }
    },
    [logEvent, loadInvoices, showDetail, detailInvoice],
  );

  /** Vytvoří koncept se stejným obsahem a otevře ho v editoru. */
  const duplicateInvoice = useCallback(
    async (inv: Invoice) => {
      if (!activeServiceId) return;
      try {
        const number = await generateInvoiceNumber(activeServiceId);
        const today = todayIso();

        const { data: items } = await typedSupabase.from("invoice_items").select("*").eq("invoice_id", inv.id).order("sort_order");

        const newInv = {
          service_id: activeServiceId,
          number,
          variable_symbol: invoiceNumberToVS(number),
          status: "draft",
          issue_date: today,
          due_date: addDaysIso(today, 14),
          taxable_date: today,
          currency: inv.currency,
          subtotal: inv.subtotal,
          vat_amount: inv.vat_amount,
          total: inv.total,
          rounding: inv.rounding,
          supplier_name: inv.supplier_name,
          supplier_ico: inv.supplier_ico,
          supplier_dic: inv.supplier_dic,
          supplier_address: inv.supplier_address,
          supplier_email: inv.supplier_email,
          supplier_phone: inv.supplier_phone,
          supplier_bank_account: inv.supplier_bank_account,
          supplier_iban: inv.supplier_iban,
          supplier_swift: inv.supplier_swift,
          customer_name: inv.customer_name,
          customer_ico: inv.customer_ico,
          customer_dic: inv.customer_dic,
          customer_address: inv.customer_address,
          customer_email: inv.customer_email,
          customer_phone: inv.customer_phone,
          customer_id: inv.customer_id,
          notes: inv.notes,
        };

        const { data: created, error } = await typedSupabase
          .from("invoices")
          .insert(newInv as never)
          .select("*")
          .single();
        if (error) throw error;

        if (items && items.length > 0) {
          const newItems = items.map((it, idx) => ({
            invoice_id: created!.id,
            sort_order: idx,
            name: it.name,
            qty: it.qty,
            unit: it.unit,
            unit_price: it.unit_price,
            vat_rate: it.vat_rate,
            line_total: it.line_total,
          }));
          const { error: itemsErr } = await typedSupabase.from("invoice_items").insert(newItems);
          if (itemsErr) throw itemsErr;
        }

        await logEvent(created!.id, "created", { duplicated_from: inv.id, number });
        showToast(`Vytvořen koncept ${number}`, "success");
        loadInvoices();
        await openEditInvoice(created as Invoice);
      } catch (err) {
        reportError({
          code: "invoices.duplicate_failed",
          error: err,
          userMessage: "Fakturu se nepodařilo duplikovat: " + (err instanceof Error ? err.message : String(err)),
          source: "Invoices.duplicateInvoice",
        });
      }
    },
    [activeServiceId, logEvent, loadInvoices, openEditInvoice],
  );

  // ─── Tisk, PDF, náhled ─────────────────────────────────────

  const loadItemsFor = useCallback(async (inv: Invoice) => {
    const { data } = await typedSupabase.from("invoice_items").select("*").eq("invoice_id", inv.id).order("sort_order");
    return data || [];
  }, []);

  const handlePrint = useCallback(
    async (inv: Invoice) => {
      if (isWeb()) {
        try {
          const items = await loadItemsFor(inv);
          await printDocumentInBrowser("faktura", activeServiceId, invoiceDocumentData(inv, items, safeLoadCompanyData(), dph.vatPayer));
        } catch (err) {
          reportError({
            code: "invoices.handle_print_failed",
            error: err,
            userMessage: "Chyba tisku: " + (err instanceof Error ? err.message : String(err)),
            source: "Invoices.handlePrint",
          });
        }
        return;
      }
      const running = await isJobiDocsRunning();
      if (!running) {
        reportError({
          code: "invoices.running_failed",
          error: undefined,
          userMessage: "JobiDocs není spuštěn. Spusťte JobiDocs pro tisk.",
          source: "Invoices.running",
        });
        return;
      }
      try {
        const items = await loadItemsFor(inv);
        const result = await printDocument("faktura", activeServiceId!, invoiceDocumentData(inv, items, safeLoadCompanyData(), dph.vatPayer));
        if (result.ok) {
          showToast("Tisk odeslán", "success");
        } else {
          reportError({
            code: "invoices.print_failed",
            error: result.error,
            userMessage: "Chyba tisku: " + formatJobiDocsErrorForUser(result.error),
            source: "Invoices.printOrExport",
          });
        }
      } catch (err) {
        reportError({
          code: "invoices.result_failed",
          error: err,
          userMessage: "Chyba tisku: " + (err instanceof Error ? err.message : String(err)),
          source: "Invoices.printOrExport",
        });
      }
    },
    [activeServiceId, dph.vatPayer, loadItemsFor],
  );

  const handleExport = useCallback(
    async (inv: Invoice) => {
      if (isWeb()) {
        try {
          const items = await loadItemsFor(inv);
          showToast("V tiskovém dialogu zvolte cíl „Uložit jako PDF“.", "info");
          await printDocumentInBrowser("faktura", activeServiceId, invoiceDocumentData(inv, items, safeLoadCompanyData(), dph.vatPayer));
        } catch (err) {
          reportError({
            code: "invoices.handle_export_failed",
            error: err,
            userMessage: "Chyba exportu: " + (err instanceof Error ? err.message : String(err)),
            source: "Invoices.handleExport",
          });
        }
        return;
      }
      const running = await isJobiDocsRunning();
      if (!running) {
        reportError({
          code: "invoices.running_failed",
          error: undefined,
          userMessage: "JobiDocs není spuštěn. Spusťte JobiDocs pro export PDF.",
          source: "Invoices.running",
        });
        return;
      }
      try {
        const items = await loadItemsFor(inv);
        const filename = `Faktura_${inv.number.replace(/[^a-zA-Z0-9-]/g, "_")}.pdf`;
        let downloadDir = "";
        try {
          const { desktopDir, downloadDir: dl } = await import("@tauri-apps/api/path");
          downloadDir = await dl().catch(() => desktopDir());
        } catch {
          downloadDir = "/tmp";
        }
        const targetPath = `${downloadDir}/${filename}`;
        const result = await exportDocument("faktura", activeServiceId!, invoiceDocumentData(inv, items, safeLoadCompanyData(), dph.vatPayer), targetPath);
        if (result.ok) {
          showToast(`PDF uložen: ${filename}`, "success");
        } else {
          reportError({
            code: "invoices.export_failed",
            error: result.error,
            userMessage: "Chyba exportu: " + formatJobiDocsErrorForUser(result.error),
            source: "Invoices.printOrExport",
          });
        }
      } catch (err) {
        reportError({
          code: "invoices.result_failed",
          error: err,
          userMessage: "Chyba exportu: " + (err instanceof Error ? err.message : String(err)),
          source: "Invoices.printOrExport",
        });
      }
    },
    [activeServiceId, dph.vatPayer, loadItemsFor],
  );

  const showPreview = useCallback((url: string) => {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    setPreviewUrl(url);
  }, []);

  const closePreview = useCallback(() => {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    setPreviewUrl(null);
  }, []);

  const handlePreview = useCallback(
    async (inv: Invoice) => {
      if (isWeb()) {
        try {
          const items = await loadItemsFor(inv);
          const url = await buildDocumentPreviewUrlForWeb("faktura", activeServiceId, invoiceDocumentData(inv, items, safeLoadCompanyData(), dph.vatPayer));
          showPreview(url);
        } catch (err) {
          reportError({
            code: "invoices.url_failed",
            error: err,
            userMessage: "Chyba náhledu: " + (err instanceof Error ? err.message : String(err)),
            source: "Invoices.previewInvoice",
          });
        }
        return;
      }
      const running = await isJobiDocsRunning();
      if (!running) {
        reportError({
          code: "invoices.running_failed",
          error: undefined,
          userMessage: "JobiDocs není spuštěn. Spusťte JobiDocs pro náhled.",
          source: "Invoices.running",
        });
        return;
      }
      try {
        const items = await loadItemsFor(inv);
        const result = await renderPdf("faktura", activeServiceId!, invoiceDocumentData(inv, items, safeLoadCompanyData(), dph.vatPayer));
        if (result.ok && result.data) {
          const blob = new Blob([result.data], { type: "application/pdf" });
          showPreview(URL.createObjectURL(blob));
        } else {
          reportError({
            code: "invoices.preview_failed",
            error: result.error,
            userMessage: "Chyba náhledu: " + formatJobiDocsErrorForUser(result.error),
            source: "Invoices.previewInvoice",
          });
        }
      } catch (err) {
        reportError({
          code: "invoices.url_failed",
          error: err,
          userMessage: "Chyba náhledu: " + (err instanceof Error ? err.message : String(err)),
          source: "Invoices.previewInvoice",
        });
      }
    },
    [activeServiceId, dph.vatPayer, loadItemsFor, showPreview],
  );

  // ─── E-mail ────────────────────────────────────────────────

  const openSendModal = useCallback(
    (inv: Invoice) => {
      setSendEmail(inv.customer_email || "");
      setSendSubject(`Faktura ${inv.number}`);
      setSendBody(`Dobrý den,\n\nv příloze zasíláme fakturu č. ${inv.number}.\n\nS pozdravem\n${companyData.name || "Váš servis"}`);
      setDetailInvoice(inv);
      setSendModalOpen(true);
    },
    [companyData],
  );

  const handleSendEmail = useCallback(async () => {
    if (!detailInvoice || !supabase || sending) return;
    setSending(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData?.session?.access_token;
      const { data, error } = await supabase.functions.invoke("invoice-send-email", {
        ...(accessToken ? { headers: { Authorization: `Bearer ${accessToken}` } } : {}),
        body: {
          invoice_id: detailInvoice.id,
          recipient: sendEmail,
          subject: sendSubject,
          body: sendBody,
          service_id: activeServiceId,
        },
      });
      if (error) throw error;
      const fnError = (data as { error?: string } | null)?.error;
      if (fnError) throw new Error(fnError);
      showToast("Faktura odeslána e-mailem", "success");
      setSendModalOpen(false);
      await logEvent(detailInvoice.id, "sent", { recipient: sendEmail });
      if (detailInvoice.status === "issued") {
        await updateStatus(detailInvoice, "sent");
      } else {
        loadInvoices();
        if (showDetail) openDetail(detailInvoice);
      }
    } catch (err) {
      reportError({
        code: "invoices.send_email_failed",
        error: err,
        userMessage: "Chyba odesílání: " + (err instanceof Error ? err.message : String(err)),
        source: "Invoices.handleSendEmail",
      });
    } finally {
      setSending(false);
    }
  }, [detailInvoice, sending, sendEmail, sendSubject, sendBody, activeServiceId, logEvent, updateStatus, loadInvoices, showDetail, openDetail]);

  // ─── Vykreslení ────────────────────────────────────────────

  if (!activeServiceId) {
    return (
      <div style={{ padding: "var(--space-8)", textAlign: "center", color: "var(--muted)", fontSize: "var(--text-base)" }}>
        Vyberte servis pro zobrazení faktur.
      </div>
    );
  }

  const confirmDialog = (
    <ConfirmDialog
      open={!!confirm}
      title={confirm?.title || "Potvrzení"}
      message={confirm?.message || ""}
      confirmLabel={confirm?.confirmLabel}
      onConfirm={() => {
        confirm?.onConfirm();
        setConfirm(null);
      }}
      onCancel={() => setConfirm(null)}
      variant={confirm?.variant || "danger"}
    />
  );

  if (view === "editor") {
    return (
      <>
        <InvoiceEditor
          vatRate={sazbaNoveVPolozky}
          invoice={editorInvoice}
          setInvoice={setEditorInvoice}
          items={editorItems}
          setItems={setEditorItems}
          totals={editorTotals}
          saving={saving}
          isNew={!editingId}
          dirty={editorDirty}
          searchCustomers={searchCustomers}
          onSave={saveDraft}
          onIssue={issueFromEditor}
          onCancel={leaveEditor}
        />
        {confirmDialog}
      </>
    );
  }

  return (
    <>
      <InvoiceList
        invoices={invoices}
        loading={loading}
        filter={filter}
        onFilterChange={setFilter}
        search={filterSearch}
        onSearchChange={setFilterSearch}
        onNew={() => openNewInvoice()}
        onOpen={openDetail}
      />

      {showDetail && detailInvoice && (
        <InvoiceDetail
          invoice={detailInvoice}
          items={detailItems}
          events={detailEvents}
          onClose={() => setShowDetail(false)}
          onEdit={() => openEditInvoice(detailInvoice)}
          onPrint={() => handlePrint(detailInvoice)}
          onExport={() => handleExport(detailInvoice)}
          onPreview={() => handlePreview(detailInvoice)}
          onSend={() => openSendModal(detailInvoice)}
          onIssue={() => issueFromDetail(detailInvoice)}
          onMarkPaid={() => updateStatus(detailInvoice, "paid")}
          onDuplicate={() => duplicateInvoice(detailInvoice)}
          onCancelInvoice={() =>
            setConfirm({
              title: "Stornovat fakturu",
              message: `Faktura ${detailInvoice.number} bude označena jako stornovaná. Tuto akci nelze vrátit.`,
              confirmLabel: "Stornovat",
              variant: "danger",
              onConfirm: () => updateStatus(detailInvoice, "cancelled"),
            })
          }
          onDelete={() =>
            setConfirm({
              title: "Smazat koncept",
              message: `Opravdu chcete smazat koncept ${detailInvoice.number}?`,
              confirmLabel: "Smazat",
              variant: "danger",
              onConfirm: () => deleteInvoice(detailInvoice),
            })
          }
          onOpenTicket={
            detailInvoice.ticket_id && onOpenTicket
              ? () => {
                  setShowDetail(false);
                  onOpenTicket(detailInvoice.ticket_id!);
                }
              : undefined
          }
        />
      )}

      {/* Odeslání e-mailem. Portál do body: <main> má transform kvůli plynulému
          posouvání, což z něj dělá vztažný rámec pro position: fixed. */}
      {sendModalOpen &&
        createPortal(
          <div
            style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999, padding: "var(--space-3)" }}
            onClick={() => !sending && setSendModalOpen(false)}
          >
            <div
              role="dialog"
              aria-labelledby="invoice-send-title"
              onClick={(e) => e.stopPropagation()}
              style={{
                background: "var(--panel)",
                borderRadius: "var(--radius-md)",
                border: "1px solid var(--border)",
                padding: "var(--space-6)",
                width: 460,
                maxWidth: "92vw",
                boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
              }}
            >
              <h3 id="invoice-send-title" style={{ margin: "0 0 var(--space-4)", fontSize: "var(--text-lg)", fontWeight: 800, color: "var(--text)" }}>
                Odeslat fakturu e-mailem
              </h3>
              <Label>E-mail příjemce</Label>
              <div style={{ marginTop: 4, marginBottom: "var(--space-3)" }}>
                <Input type="email" value={sendEmail} onChange={(e) => setSendEmail(e.target.value)} placeholder="jmeno@firma.cz" autoFocus />
              </div>
              <Label>Předmět</Label>
              <div style={{ marginTop: 4, marginBottom: "var(--space-3)" }}>
                <Input value={sendSubject} onChange={(e) => setSendSubject(e.target.value)} />
              </div>
              <Label>Text zprávy</Label>
              <textarea
                value={sendBody}
                onChange={(e) => setSendBody(e.target.value)}
                rows={5}
                style={{
                  width: "100%",
                  marginTop: 4,
                  padding: "10px var(--space-3)",
                  borderRadius: "var(--radius-sm)",
                  border: "1px solid var(--border)",
                  background: "var(--panel)",
                  color: "var(--text)",
                  outline: "none",
                  resize: "vertical",
                  fontSize: "var(--text-base)",
                  fontFamily: "inherit",
                }}
              />
              <div style={{ display: "flex", gap: "var(--space-2)", marginTop: "var(--space-4)", justifyContent: "flex-end" }}>
                <Button variant="ghost" onClick={() => setSendModalOpen(false)} disabled={sending}>
                  Zrušit
                </Button>
                <Button variant="primary" onClick={handleSendEmail} disabled={sending || !sendEmail.includes("@")}>
                  {sending ? "Odesílám…" : "Odeslat"}
                </Button>
              </div>
            </div>
          </div>,
          document.body,
        )}

      {/* Náhled PDF */}
      {previewUrl &&
        createPortal(
          <div
            style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999, padding: "var(--space-3)" }}
            onClick={closePreview}
          >
            <div
              role="dialog"
              aria-label="Náhled PDF"
              onClick={(e) => e.stopPropagation()}
              style={{
                background: "var(--panel)",
                borderRadius: "var(--radius-md)",
                width: "100%",
                height: "85dvh",
                maxWidth: 900,
                display: "flex",
                flexDirection: "column",
                overflow: "hidden",
                boxShadow: "0 20px 60px rgba(0,0,0,0.4)",
              }}
            >
              <div style={{ padding: "var(--space-3) var(--space-5)", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
                <h3 style={{ margin: 0, fontSize: "var(--text-lg)", fontWeight: 800, color: "var(--text)" }}>Náhled PDF</h3>
                <Button variant="ghost" iconOnly aria-label="Zavřít náhled" title="Zavřít" icon={<XIcon size={16} />} onClick={closePreview} />
              </div>
              <iframe src={previewUrl} style={{ flex: 1, border: "none", width: "100%" }} title="Náhled PDF" />
            </div>
          </div>,
          document.body,
        )}

      {confirmDialog}
    </>
  );
}
