import { useState, useEffect, useCallback, useMemo } from "react";
import { typedSupabase } from "../lib/typedSupabase";
import { useAuth } from "../auth/AuthProvider";
import { supabase } from "../lib/supabaseClient";
import { showToast } from "../components/Toast";
import { FieldLabel, TextInput } from "../lib/settingsUi";
import { safeLoadCompanyData } from "../lib/companyData";
import { computeTotals, formatCurrency, emptyLineItem, type InvoiceLineItem } from "../lib/invoiceMath";
import { generateInvoiceNumber, invoiceNumberToVS } from "../lib/invoiceNumbering";
import { invoiceToJobiDocsVariables, companyDataToJobiDocsPayload } from "../lib/invoiceToJobiDocs";
import { printDocumentViaJobiDocs, exportDocumentViaJobiDocs, isJobiDocsRunning, renderPdfViaJobiDocs, formatJobiDocsErrorForUser } from "../lib/jobidocs";
import type { Database } from "../types/supabase";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { validateInvoiceForSave } from "../lib/invoiceValidation";

type Invoice = Database["public"]["Tables"]["invoices"]["Row"];
type InvoiceItem = Database["public"]["Tables"]["invoice_items"]["Row"];
type InvoiceEvent = Database["public"]["Tables"]["invoice_events"]["Row"];

type InvoiceStatus = "draft" | "issued" | "sent" | "paid" | "overdue" | "cancelled";

const STATUS_LABELS: Record<InvoiceStatus, string> = {
  draft: "Koncept",
  issued: "Vystaveno",
  sent: "Odesláno",
  paid: "Zaplaceno",
  overdue: "Po splatnosti",
  cancelled: "Stornováno",
};

const STATUS_COLORS: Record<InvoiceStatus, { bg: string; fg: string }> = {
  draft: { bg: "rgba(107,114,128,0.15)", fg: "var(--muted)" },
  issued: { bg: "rgba(37,99,235,0.15)", fg: "#2563eb" },
  sent: { bg: "rgba(139,92,246,0.15)", fg: "#8b5cf6" },
  paid: { bg: "rgba(34,197,94,0.15)", fg: "#22c55e" },
  overdue: { bg: "rgba(239,68,68,0.15)", fg: "#ef4444" },
  cancelled: { bg: "rgba(107,114,128,0.10)", fg: "#9ca3af" },
};

type View = "list" | "editor";

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

export default function Invoices({ activeServiceId, prefillFromTicket, onPrefillConsumed, openInvoiceId, onOpenInvoiceIdConsumed, onOpenTicket }: Props) {
  const { session } = useAuth();
  const [view, setView] = useState<View>("list");
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Filters
  const [filterStatus, setFilterStatus] = useState<InvoiceStatus | "all">("all");
  const [filterSearch, setFilterSearch] = useState("");

  // Editor state
  const [editorInvoice, setEditorInvoice] = useState<Partial<Invoice>>({});
  const [editorItems, setEditorItems] = useState<(InvoiceLineItem & { id?: string })[]>([emptyLineItem()]);
  const [saving, setSaving] = useState(false);

  // Detail/events
  const [detailInvoice, setDetailInvoice] = useState<Invoice | null>(null);
  const [detailItems, setDetailItems] = useState<InvoiceItem[]>([]);
  const [detailEvents, setDetailEvents] = useState<InvoiceEvent[]>([]);
  const [showDetail, setShowDetail] = useState(false);

  // Send email modal
  const [sendModalOpen, setSendModalOpen] = useState(false);
  const [sendEmail, setSendEmail] = useState("");
  const [sendSubject, setSendSubject] = useState("");
  const [sendBody, setSendBody] = useState("");
  const [sending, setSending] = useState(false);

  // Confirm dialog
  const [confirmDialog, setConfirmDialog] = useState<{ message: string; onConfirm: () => void } | null>(null);

  // PDF preview
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const companyData = useMemo(() => safeLoadCompanyData(), []);

  // Load invoices
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
      console.error("Failed to load invoices:", err);
    } finally {
      setLoading(false);
    }
  }, [activeServiceId]);

  useEffect(() => {
    loadInvoices();
  }, [loadInvoices]);

  // Auto-detect overdue invoices
  useEffect(() => {
    if (!activeServiceId || invoices.length === 0) return;
    const today = new Date().toISOString().split("T")[0];
    const overdueIds = invoices
      .filter((i) => ["issued", "sent"].includes(i.status) && i.due_date < today)
      .map((i) => i.id);
    if (overdueIds.length === 0) return;
    (async () => {
      try {
        await typedSupabase
          .from("invoices")
          .update({ status: "overdue" })
          .in("id", overdueIds);
        loadInvoices();
      } catch {}
    })();
  }, [invoices, activeServiceId]);

  // Handle prefill from ticket
  useEffect(() => {
    if (!prefillFromTicket || !activeServiceId) return;
    openNewInvoice(prefillFromTicket);
    onPrefillConsumed?.();
  }, [prefillFromTicket, activeServiceId]);

  // Handle open existing invoice by id (e.g. from Zakázky "Přejít na fakturu")
  useEffect(() => {
    if (!openInvoiceId || !onOpenInvoiceIdConsumed) return;
    let cancelled = false;
    (async () => {
      try {
        const { data: inv, error } = await typedSupabase
          .from("invoices")
          .select("*")
          .eq("id", openInvoiceId)
          .single();
        if (cancelled || error || !inv) {
          onOpenInvoiceIdConsumed();
          return;
        }
        await openEditInvoice(inv as Invoice);
      } catch {
        // ignore
      }
      onOpenInvoiceIdConsumed();
    })();
    return () => { cancelled = true; };
  }, [openInvoiceId, onOpenInvoiceIdConsumed]);

  const openNewInvoice = useCallback(async (prefill?: Props["prefillFromTicket"]) => {
    const number = await generateInvoiceNumber(activeServiceId!);
    const today = new Date().toISOString().split("T")[0];
    const due = new Date(Date.now() + 14 * 86400000).toISOString().split("T")[0];
    const cd = safeLoadCompanyData();

    const inv: Partial<Invoice> = {
      number,
      variable_symbol: invoiceNumberToVS(number),
      status: "draft",
      issue_date: today,
      due_date: due,
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
    setEditorInvoice(inv);
    setEditorItems(prefill?.items?.length ? prefill.items.map(i => ({ ...i })) : [emptyLineItem()]);
    setEditingId(null);
    setView("editor");
  }, [activeServiceId]);

  const openEditInvoice = useCallback(async (inv: Invoice) => {
    const { data: items } = await typedSupabase
      .from("invoice_items")
      .select("*")
      .eq("invoice_id", inv.id)
      .order("sort_order", { ascending: true });
    setEditorInvoice(inv);
    setEditorItems(
      items?.length
        ? items.map((it) => ({
            id: it.id,
            name: it.name,
            qty: it.qty,
            unit: it.unit,
            unit_price: it.unit_price,
            vat_rate: it.vat_rate,
          }))
        : [emptyLineItem()],
    );
    setEditingId(inv.id);
    setView("editor");
  }, []);

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

  // Save invoice
  const saveInvoice = useCallback(async () => {
    if (!activeServiceId || saving) return;

    const validationErrors = validateInvoiceForSave(editorInvoice as any, editorItems);
    if (validationErrors.length > 0) {
      showToast(validationErrors[0].message, "error");
      return;
    }

    setSaving(true);
    try {
      const totals = computeTotals(editorItems);
      const payload: any = {
        ...editorInvoice,
        service_id: activeServiceId,
        subtotal: totals.subtotal,
        vat_amount: totals.vat_amount,
        total: totals.total_rounded,
        rounding: totals.rounding,
      };
      delete payload.id;
      delete payload.created_at;
      delete payload.updated_at;
      delete payload.deleted_at;

      let invoiceId: string;

      if (editingId) {
        const { error } = await typedSupabase.from("invoices").update(payload).eq("id", editingId);
        if (error) throw error;
        invoiceId = editingId;
        await typedSupabase.from("invoice_items").delete().eq("invoice_id", invoiceId);
      } else {
        const { data, error } = await typedSupabase
          .from("invoices")
          .insert(payload)
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

      showToast(editingId ? "Faktura uložena" : "Faktura vytvořena", "success");
      setView("list");
      loadInvoices();
    } catch (err: any) {
      showToast("Chyba: " + (err?.message || err), "error");
    } finally {
      setSaving(false);
    }
  }, [activeServiceId, saving, editorInvoice, editorItems, editingId, loadInvoices]);

  const logEvent = useCallback(async (invoiceId: string, type: string, payload: Record<string, any>) => {
    try {
      await typedSupabase.from("invoice_events").insert({
        invoice_id: invoiceId,
        type,
        payload: payload as any,
        created_by: session?.user?.id || null,
      });
    } catch {}
  }, [session]);

  const updateStatus = useCallback(async (inv: Invoice, newStatus: InvoiceStatus) => {
    try {
      const updates: any = { status: newStatus };
      if (newStatus === "paid") updates.paid_at = new Date().toISOString();
      if (newStatus === "sent") updates.sent_at = new Date().toISOString();
      await typedSupabase.from("invoices").update(updates).eq("id", inv.id);
      await logEvent(inv.id, "status_changed", { from: inv.status, to: newStatus });
      showToast(`Stav změněn na: ${STATUS_LABELS[newStatus]}`, "success");
      loadInvoices();
      if (showDetail && detailInvoice?.id === inv.id) {
        openDetail({ ...inv, ...updates });
      }
    } catch (err: any) {
      showToast("Chyba: " + (err?.message || err), "error");
    }
  }, [logEvent, loadInvoices, showDetail, detailInvoice, openDetail]);

  const deleteInvoice = useCallback(async (inv: Invoice) => {
    try {
      await typedSupabase.from("invoices").update({ deleted_at: new Date().toISOString() }).eq("id", inv.id);
      await logEvent(inv.id, "deleted", {});
      showToast("Faktura smazána", "success");
      loadInvoices();
      if (showDetail && detailInvoice?.id === inv.id) setShowDetail(false);
    } catch (err: any) {
      showToast("Chyba: " + (err?.message || err), "error");
    }
  }, [logEvent, loadInvoices, showDetail, detailInvoice]);

  const duplicateInvoice = useCallback(async (inv: Invoice) => {
    try {
      const number = await generateInvoiceNumber(activeServiceId!);
      const today = new Date().toISOString().split("T")[0];
      const due = new Date(Date.now() + 14 * 86400000).toISOString().split("T")[0];

      const { data: items } = await typedSupabase
        .from("invoice_items")
        .select("*")
        .eq("invoice_id", inv.id)
        .order("sort_order");

      const newInv: any = {
        service_id: activeServiceId,
        number,
        variable_symbol: invoiceNumberToVS(number),
        status: "draft",
        issue_date: today,
        due_date: due,
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
        .insert(newInv)
        .select("id")
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
        await typedSupabase.from("invoice_items").insert(newItems);
      }

      await logEvent(created!.id, "created", { duplicated_from: inv.id, number });
      showToast(`Faktura duplikována jako ${number}`, "success");
      loadInvoices();
    } catch (err: any) {
      showToast("Chyba: " + (err?.message || err), "error");
    }
  }, [activeServiceId, logEvent, loadInvoices]);

  // PDF actions
  const handlePrint = useCallback(async (inv: Invoice) => {
    const running = await isJobiDocsRunning();
    if (!running) {
      showToast("JobiDocs není spuštěn. Spusťte JobiDocs pro tisk.", "error");
      return;
    }
    try {
      const { data: items } = await typedSupabase.from("invoice_items").select("*").eq("invoice_id", inv.id).order("sort_order");
      const vars = invoiceToJobiDocsVariables(inv, items || []);
      const cd = safeLoadCompanyData();
      const result = await printDocumentViaJobiDocs("faktura", activeServiceId!, companyDataToJobiDocsPayload(cd), {}, { variables: vars });
      if (result.ok) {
        showToast("Tisk odeslán", "success");
      } else {
        showToast("Chyba tisku: " + formatJobiDocsErrorForUser(result.error), "error");
      }
    } catch (err: any) {
      showToast("Chyba: " + (err?.message || err), "error");
    }
  }, [activeServiceId]);

  const handleExport = useCallback(async (inv: Invoice) => {
    const running = await isJobiDocsRunning();
    if (!running) {
      showToast("JobiDocs není spuštěn. Spusťte JobiDocs pro export PDF.", "error");
      return;
    }
    try {
      const { data: items } = await typedSupabase.from("invoice_items").select("*").eq("invoice_id", inv.id).order("sort_order");
      const vars = invoiceToJobiDocsVariables(inv, items || []);
      const cd = safeLoadCompanyData();
      const filename = `Faktura_${inv.number.replace(/[^a-zA-Z0-9-]/g, "_")}.pdf`;
      let downloadDir = "";
      try {
        const { desktopDir, downloadDir: dl } = await import("@tauri-apps/api/path");
        downloadDir = await dl().catch(() => desktopDir());
      } catch {
        downloadDir = "/tmp";
      }
      const targetPath = `${downloadDir}/${filename}`;
      const result = await exportDocumentViaJobiDocs("faktura", activeServiceId!, companyDataToJobiDocsPayload(cd), {}, targetPath, { variables: vars });
      if (result.ok) {
        showToast(`PDF uložen: ${filename}`, "success");
      } else {
        showToast("Chyba exportu: " + formatJobiDocsErrorForUser(result.error), "error");
      }
    } catch (err: any) {
      showToast("Chyba: " + (err?.message || err), "error");
    }
  }, [activeServiceId]);

  // PDF preview
  const handlePreview = useCallback(async (inv: Invoice) => {
    const running = await isJobiDocsRunning();
    if (!running) {
      showToast("JobiDocs není spuštěn. Spusťte JobiDocs pro náhled.", "error");
      return;
    }
    try {
      const { data: items } = await typedSupabase.from("invoice_items").select("*").eq("invoice_id", inv.id).order("sort_order");
      const vars = invoiceToJobiDocsVariables(inv, items || []);
      const cd = safeLoadCompanyData();
      const result = await renderPdfViaJobiDocs("faktura", activeServiceId!, companyDataToJobiDocsPayload(cd), {}, { variables: vars });
      if (result.ok && result.data) {
        const blob = new Blob([result.data], { type: "application/pdf" });
        const url = URL.createObjectURL(blob);
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        setPreviewUrl(url);
      } else {
        showToast("Chyba náhledu: " + formatJobiDocsErrorForUser(result.error), "error");
      }
    } catch (err: any) {
      showToast("Chyba: " + (err?.message || err), "error");
    }
  }, [activeServiceId, previewUrl]);

  // Send email
  const openSendModal = useCallback((inv: Invoice) => {
    setSendEmail(inv.customer_email || "");
    setSendSubject(`Faktura ${inv.number}`);
    setSendBody(`Dobrý den,\n\nv příloze zasíláme fakturu č. ${inv.number}.\n\nS pozdravem,\n${companyData.name || "Váš servis"}`);
    setDetailInvoice(inv);
    setSendModalOpen(true);
  }, [companyData]);

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
      if ((data as any)?.error) throw new Error((data as any).error);
      showToast("Faktura odeslána e-mailem", "success");
      setSendModalOpen(false);
      await updateStatus(detailInvoice, "sent");
      loadInvoices();
    } catch (err: any) {
      showToast("Chyba odesílání: " + (err?.message || err), "error");
    } finally {
      setSending(false);
    }
  }, [detailInvoice, sending, sendEmail, sendSubject, sendBody, activeServiceId, updateStatus, loadInvoices]);

  // Computed totals for editor
  const editorTotals = useMemo(() => computeTotals(editorItems), [editorItems]);

  // Filtered invoices
  const filteredInvoices = useMemo(() => {
    let list = invoices;
    if (filterStatus !== "all") {
      list = list.filter((i) => i.status === filterStatus);
    }
    if (filterSearch.trim()) {
      const q = filterSearch.toLowerCase();
      list = list.filter(
        (i) =>
          (i.number || "").toLowerCase().includes(q) ||
          (i.customer_name || "").toLowerCase().includes(q) ||
          (i.variable_symbol || "").toLowerCase().includes(q),
      );
    }
    return list;
  }, [invoices, filterStatus, filterSearch]);

  // Summary stats
  const stats = useMemo(() => {
    const total = invoices.reduce((s, i) => s + (i.status !== "cancelled" ? i.total : 0), 0);
    const paid = invoices.filter((i) => i.status === "paid").reduce((s, i) => s + i.total, 0);
    const unpaid = invoices.filter((i) => ["issued", "sent", "overdue"].includes(i.status)).reduce((s, i) => s + i.total, 0);
    const overdue = invoices.filter((i) => i.status === "overdue").length;

    // Monthly revenue (last 6 months)
    const monthly: { label: string; total: number; paid: number }[] = [];
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const label = d.toLocaleDateString("cs-CZ", { month: "short", year: "2-digit" });
      const year = d.getFullYear();
      const month = d.getMonth();
      const monthInvoices = invoices.filter((inv) => {
        if (inv.status === "cancelled") return false;
        const id = new Date(inv.issue_date);
        return id.getFullYear() === year && id.getMonth() === month;
      });
      monthly.push({
        label,
        total: monthInvoices.reduce((s, inv) => s + inv.total, 0),
        paid: monthInvoices.filter((inv) => inv.status === "paid").reduce((s, inv) => s + inv.total, 0),
      });
    }

    return { total, paid, unpaid, count: invoices.length, overdue, monthly };
  }, [invoices]);

  if (!activeServiceId) {
    return (
      <div style={{ padding: 40, textAlign: "center", color: "var(--muted)" }}>
        Vyberte servis pro zobrazení faktur.
      </div>
    );
  }

  if (view === "editor") {
    return (
      <InvoiceEditor
        invoice={editorInvoice}
        setInvoice={setEditorInvoice}
        items={editorItems}
        setItems={setEditorItems}
        totals={editorTotals}
        saving={saving}
        isNew={!editingId}
        onSave={saveInvoice}
        onCancel={() => setView("list")}
        serviceId={activeServiceId}
      />
    );
  }

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      {/* Header */}
      <div style={{ padding: "20px 24px 0", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
          <h1 style={{ margin: 0, fontSize: 24, fontWeight: 800, color: "var(--text)" }}>Faktury</h1>
          <button
            onClick={() => openNewInvoice()}
            style={{
              padding: "10px 20px",
              borderRadius: 12,
              border: "none",
              background: "var(--accent)",
              color: "#fff",
              fontWeight: 700,
              fontSize: 14,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Nová faktura
          </button>
        </div>

        {/* Stats */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12, marginBottom: 16 }}>
          <StatCard label="Celkem" value={formatCurrency(stats.total)} />
          <StatCard label="Zaplaceno" value={formatCurrency(stats.paid)} color="#22c55e" />
          <StatCard label="Nezaplaceno" value={formatCurrency(stats.unpaid)} color="#ef4444" />
          <StatCard label="Počet faktur" value={String(stats.count)} />
          {stats.overdue > 0 && <StatCard label="Po splatnosti" value={String(stats.overdue)} color="#ef4444" />}
        </div>

        {/* Monthly revenue chart */}
        {stats.monthly.some((m) => m.total > 0) && (
          <MonthlyChart data={stats.monthly} />
        )}

        {/* Filters */}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
          <input
            type="text"
            placeholder="Hledat číslo, zákazník..."
            value={filterSearch}
            onChange={(e) => setFilterSearch(e.target.value)}
            style={{
              flex: 1,
              minWidth: 180,
              padding: "8px 12px",
              borderRadius: 10,
              border: "1px solid var(--border)",
              background: "var(--panel)",
              color: "var(--text)",
              outline: "none",
              fontSize: 13,
            }}
          />
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value as any)}
            style={{
              padding: "8px 12px",
              borderRadius: 10,
              border: "1px solid var(--border)",
              background: "var(--panel)",
              color: "var(--text)",
              fontSize: 13,
              cursor: "pointer",
            }}
          >
            <option value="all">Všechny stavy</option>
            {(Object.keys(STATUS_LABELS) as InvoiceStatus[]).map((s) => (
              <option key={s} value={s}>{STATUS_LABELS[s]}</option>
            ))}
          </select>
        </div>
      </div>

      {/* List */}
      <div style={{ flex: 1, overflow: "auto", padding: "0 24px 24px" }}>
        {loading ? (
          <div style={{ textAlign: "center", padding: 40, color: "var(--muted)" }}>Načítám...</div>
        ) : filteredInvoices.length === 0 ? (
          <div style={{ textAlign: "center", padding: 40, color: "var(--muted)" }}>
            {invoices.length === 0 ? "Zatím žádné faktury." : "Žádné faktury nevyhovují filtru."}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {filteredInvoices.map((inv) => (
              <InvoiceRow
                key={inv.id}
                invoice={inv}
                onOpen={() => openDetail(inv)}
                onEdit={() => openEditInvoice(inv)}
                onPrint={() => handlePrint(inv)}
                onExport={() => handleExport(inv)}
                onPreview={() => handlePreview(inv)}
                onSend={() => openSendModal(inv)}
                onDuplicate={() => duplicateInvoice(inv)}
                onStatusChange={(s) => updateStatus(inv, s)}
                onDelete={() => setConfirmDialog({ message: `Opravdu smazat fakturu ${inv.number}?`, onConfirm: () => deleteInvoice(inv) })}
              />
            ))}
          </div>
        )}
      </div>

      {/* Detail slide-over */}
      {showDetail && detailInvoice && (
        <DetailPanel
          invoice={detailInvoice}
          items={detailItems}
          events={detailEvents}
          onClose={() => setShowDetail(false)}
          onEdit={() => { setShowDetail(false); openEditInvoice(detailInvoice); }}
          onPrint={() => handlePrint(detailInvoice)}
          onExport={() => handleExport(detailInvoice)}
          onSend={() => { setShowDetail(false); openSendModal(detailInvoice); }}
          onStatusChange={(s) => updateStatus(detailInvoice, s)}
          onOpenTicket={detailInvoice.ticket_id && onOpenTicket ? () => { setShowDetail(false); onOpenTicket(detailInvoice.ticket_id!); } : undefined}
        />
      )}

      {/* Send email modal */}
      {sendModalOpen && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999 }}>
          <div style={{ background: "var(--panel)", borderRadius: 16, padding: 24, width: 440, maxWidth: "90vw", boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}>
            <h3 style={{ margin: "0 0 16px", fontSize: 18, fontWeight: 700, color: "var(--text)" }}>Odeslat fakturu e-mailem</h3>
            <FieldLabel>E-mail příjemce</FieldLabel>
            <TextInput value={sendEmail} onChange={(e) => setSendEmail(e.target.value)} placeholder="email@example.com" />
            <FieldLabel>Předmět</FieldLabel>
            <TextInput value={sendSubject} onChange={(e) => setSendSubject(e.target.value)} />
            <FieldLabel>Text zprávy</FieldLabel>
            <textarea
              value={sendBody}
              onChange={(e) => setSendBody(e.target.value)}
              rows={5}
              style={{
                width: "100%",
                padding: "10px 12px",
                borderRadius: 12,
                border: "1px solid var(--border)",
                background: "var(--panel)",
                color: "var(--text)",
                outline: "none",
                resize: "vertical",
                fontSize: 13,
                fontFamily: "inherit",
              }}
            />
            <div style={{ display: "flex", gap: 8, marginTop: 16, justifyContent: "flex-end" }}>
              <button onClick={() => setSendModalOpen(false)} style={btnSecondary}>Zrušit</button>
              <button onClick={handleSendEmail} disabled={sending || !sendEmail.includes("@")} style={{ ...btnPrimary, opacity: sending ? 0.6 : 1 }}>
                {sending ? "Odesílám..." : "Odeslat"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* PDF Preview modal */}
      {previewUrl && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999 }}>
          <div style={{ background: "var(--panel)", borderRadius: 16, width: "80vw", height: "85vh", maxWidth: 900, display: "flex", flexDirection: "column", overflow: "hidden", boxShadow: "0 20px 60px rgba(0,0,0,0.4)" }}>
            <div style={{ padding: "12px 20px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "var(--text)" }}>Náhled PDF</h3>
              <button onClick={() => { URL.revokeObjectURL(previewUrl); setPreviewUrl(null); }} style={{ background: "none", border: "none", fontSize: 20, color: "var(--muted)", cursor: "pointer" }}>✕</button>
            </div>
            <iframe src={previewUrl} style={{ flex: 1, border: "none", width: "100%" }} title="PDF Preview" />
          </div>
        </div>
      )}

      <ConfirmDialog
        open={!!confirmDialog}
        title="Potvrzení"
        message={confirmDialog?.message || ""}
        onConfirm={() => { confirmDialog?.onConfirm(); setConfirmDialog(null); }}
        onCancel={() => setConfirmDialog(null)}
        variant="danger"
      />
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────────

function StatCard({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{
      background: "var(--panel)",
      border: "1px solid var(--border)",
      borderRadius: 14,
      padding: "14px 16px",
      backdropFilter: "var(--blur)",
    }}>
      <div style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 800, color: color || "var(--text)", fontVariantNumeric: "tabular-nums" }}>{value}</div>
    </div>
  );
}

function MonthlyChart({ data }: { data: { label: string; total: number; paid: number }[] }) {
  const maxVal = Math.max(...data.map((d) => d.total), 1);
  return (
    <div style={{
      background: "var(--panel)",
      border: "1px solid var(--border)",
      borderRadius: 14,
      padding: "16px 20px",
      marginBottom: 12,
    }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 12 }}>Měsíční přehled</div>
      <div style={{ display: "flex", gap: 6, alignItems: "flex-end", height: 80 }}>
        {data.map((m, i) => (
          <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
            <div style={{ width: "100%", display: "flex", flexDirection: "column", justifyContent: "flex-end", height: 60, gap: 1 }}>
              <div
                style={{
                  width: "100%",
                  borderRadius: "4px 4px 0 0",
                  background: "rgba(37,99,235,0.2)",
                  height: `${Math.max((m.total / maxVal) * 60, 2)}px`,
                  position: "relative",
                }}
                title={`Celkem: ${formatCurrency(m.total)}`}
              >
                <div
                  style={{
                    width: "100%",
                    borderRadius: "4px 4px 0 0",
                    background: "#22c55e",
                    height: `${m.total > 0 ? Math.max((m.paid / m.total) * 100, 0) : 0}%`,
                    position: "absolute",
                    bottom: 0,
                    opacity: 0.7,
                  }}
                  title={`Zaplaceno: ${formatCurrency(m.paid)}`}
                />
              </div>
            </div>
            <div style={{ fontSize: 9, color: "var(--muted)", whiteSpace: "nowrap" }}>{m.label}</div>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 16, marginTop: 8, fontSize: 10, color: "var(--muted)" }}>
        <span><span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 2, background: "rgba(37,99,235,0.3)", marginRight: 4 }} />Celkem</span>
        <span><span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 2, background: "#22c55e", opacity: 0.7, marginRight: 4 }} />Zaplaceno</span>
      </div>
    </div>
  );
}

function CustomerPicker({
  serviceId,
  onSelect,
}: {
  serviceId: string;
  onSelect: (customer: { id: string; name: string; email?: string; phone?: string; ico?: string; dic?: string; address?: string }) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<any[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (query.length < 2) { setResults([]); return; }
    const timeout = setTimeout(async () => {
      try {
        const { data } = await typedSupabase
          .from("customers")
          .select("id, name, email, phone, ico, dic, address_street, address_city, address_zip")
          .eq("service_id", serviceId)
          .or(`name.ilike.%${query}%,email.ilike.%${query}%,ico.ilike.%${query}%,phone.ilike.%${query}%`)
          .limit(8);
        setResults(data || []);
        setOpen(true);
      } catch {}
    }, 300);
    return () => clearTimeout(timeout);
  }, [query, serviceId]);

  return (
    <div style={{ position: "relative", marginBottom: 8 }}>
      <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 3 }}>Vyhledat zákazníka</div>
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Začněte psát jméno, IČO, e-mail..."
        onFocus={() => results.length > 0 && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 200)}
        style={{
          width: "100%",
          padding: "8px 10px",
          borderRadius: 10,
          border: "1px solid var(--border)",
          background: "var(--panel)",
          color: "var(--text)",
          fontSize: 13,
          outline: "none",
        }}
      />
      {open && results.length > 0 && (
        <div style={{
          position: "absolute",
          top: "100%",
          left: 0,
          right: 0,
          marginTop: 4,
          background: "var(--panel)",
          border: "1px solid var(--border)",
          borderRadius: 12,
          boxShadow: "0 8px 30px rgba(0,0,0,0.15)",
          maxHeight: 240,
          overflow: "auto",
          zIndex: 50,
        }}>
          {results.map((c) => (
            <button
              key={c.id}
              onMouseDown={(e) => {
                e.preventDefault();
                onSelect({
                  id: c.id,
                  name: c.name || "",
                  email: c.email || undefined,
                  phone: c.phone || undefined,
                  ico: c.ico || undefined,
                  dic: c.dic || undefined,
                  address: [c.address_street, c.address_city, c.address_zip].filter(Boolean).join(", ") || undefined,
                });
                setQuery("");
                setOpen(false);
              }}
              style={{
                display: "block",
                width: "100%",
                padding: "10px 14px",
                border: "none",
                background: "transparent",
                textAlign: "left",
                cursor: "pointer",
                borderBottom: "1px solid var(--border)",
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>{c.name}</div>
              <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>
                {[c.email, c.ico ? `IČO: ${c.ico}` : null, c.phone].filter(Boolean).join(" · ")}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const s = status as InvoiceStatus;
  const c = STATUS_COLORS[s] || STATUS_COLORS.draft;
  return (
    <span style={{
      display: "inline-block",
      padding: "3px 10px",
      borderRadius: 8,
      fontSize: 11,
      fontWeight: 700,
      background: c.bg,
      color: c.fg,
      textTransform: "uppercase",
      letterSpacing: "0.03em",
    }}>
      {STATUS_LABELS[s] || status}
    </span>
  );
}

function InvoiceRow({
  invoice: inv,
  onOpen,
  onEdit,
  onPrint,
  onExport,
  onPreview,
  onSend,
  onDuplicate,
  onStatusChange,
  onDelete,
}: {
  invoice: Invoice;
  onOpen: () => void;
  onEdit: () => void;
  onPrint: () => void;
  onExport: () => void;
  onPreview: () => void;
  onSend: () => void;
  onDuplicate: () => void;
  onStatusChange: (s: InvoiceStatus) => void;
  onDelete: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div
      style={{
        position: "relative",
        zIndex: menuOpen ? 200 : undefined,
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "12px 16px",
        background: "var(--panel)",
        border: "1px solid var(--border)",
        borderRadius: 14,
        cursor: "pointer",
        transition: "var(--transition-smooth)",
      }}
      onClick={onOpen}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 2 }}>
          <span style={{ fontWeight: 700, fontSize: 14, color: "var(--text)" }}>{inv.number}</span>
          <StatusBadge status={inv.status} />
        </div>
        <div style={{ fontSize: 12, color: "var(--muted)", display: "flex", gap: 12, flexWrap: "wrap" }}>
          {inv.customer_name && <span>{inv.customer_name}</span>}
          <span>{new Date(inv.issue_date).toLocaleDateString("cs-CZ")}</span>
          <span>Splatnost: {new Date(inv.due_date).toLocaleDateString("cs-CZ")}</span>
        </div>
      </div>
      <div style={{ fontWeight: 800, fontSize: 15, color: "var(--text)", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
        {formatCurrency(inv.total, inv.currency)}
      </div>
      <div style={{ position: "relative" }} onClick={(e) => e.stopPropagation()}>
        <button
          onClick={() => setMenuOpen(!menuOpen)}
          style={{
            padding: "6px 8px",
            borderRadius: 8,
            border: "1px solid var(--border)",
            background: "transparent",
            color: "var(--muted)",
            cursor: "pointer",
            fontSize: 16,
            lineHeight: 1,
          }}
        >
          ⋯
        </button>
        {menuOpen && (
          <div
            style={{
              position: "absolute",
              right: 0,
              top: "100%",
              marginTop: 4,
              background: "var(--panel)",
              border: "1px solid var(--border)",
              borderRadius: 12,
              boxShadow: "0 8px 30px rgba(0,0,0,0.15)",
              minWidth: 170,
              zIndex: 100,
              overflow: "hidden",
            }}
            onMouseLeave={() => setMenuOpen(false)}
          >
            <MenuBtn onClick={() => { setMenuOpen(false); onEdit(); }}>Upravit</MenuBtn>
            <MenuBtn onClick={() => { setMenuOpen(false); onPreview(); }}>Náhled PDF</MenuBtn>
            <MenuBtn onClick={() => { setMenuOpen(false); onPrint(); }}>Tisk</MenuBtn>
            <MenuBtn onClick={() => { setMenuOpen(false); onExport(); }}>Export PDF</MenuBtn>
            <MenuBtn onClick={() => { setMenuOpen(false); onSend(); }}>Odeslat e-mailem</MenuBtn>
            <MenuBtn onClick={() => { setMenuOpen(false); onDuplicate(); }}>Duplikovat</MenuBtn>
            <div style={{ height: 1, background: "var(--border)" }} />
            {inv.status === "draft" && <MenuBtn onClick={() => { setMenuOpen(false); onStatusChange("issued"); }}>Vystavit</MenuBtn>}
            {["issued", "sent", "overdue"].includes(inv.status) && <MenuBtn onClick={() => { setMenuOpen(false); onStatusChange("paid"); }}>Označit zaplaceno</MenuBtn>}
            {inv.status !== "cancelled" && inv.status !== "paid" && (
              <MenuBtn onClick={() => { setMenuOpen(false); onStatusChange("cancelled"); }} danger>Stornovat</MenuBtn>
            )}
            <MenuBtn onClick={() => { setMenuOpen(false); onDelete(); }} danger>Smazat</MenuBtn>
          </div>
        )}
      </div>
    </div>
  );
}

function MenuBtn({ onClick, children, danger }: { onClick: () => void; children: React.ReactNode; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "block",
        width: "100%",
        padding: "9px 14px",
        border: "none",
        background: "transparent",
        color: danger ? "#ef4444" : "var(--text)",
        fontSize: 13,
        textAlign: "left",
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}

// ─── Detail Panel ──────────────────────────────────────────

function DetailPanel({
  invoice: inv,
  items,
  events,
  onClose,
  onEdit,
  onPrint,
  onExport,
  onSend,
  onStatusChange,
  onOpenTicket,
}: {
  invoice: Invoice;
  items: InvoiceItem[];
  events: InvoiceEvent[];
  onClose: () => void;
  onEdit: () => void;
  onPrint: () => void;
  onExport: () => void;
  onSend: () => void;
  onStatusChange: (s: InvoiceStatus) => void;
  onOpenTicket?: () => void;
}) {
  return (
    <div style={{ position: "fixed", inset: 0, display: "flex", zIndex: 9990 }}>
      <div style={{ flex: 1, background: "rgba(0,0,0,0.4)" }} onClick={onClose} />
      <div style={{
        width: 480,
        maxWidth: "90vw",
        background: "var(--panel)",
        borderLeft: "1px solid var(--border)",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}>
        <div style={{ padding: "20px 24px 12px", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
            <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: "var(--text)" }}>{inv.number}</h2>
            <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 20, color: "var(--muted)", cursor: "pointer" }}>✕</button>
          </div>
          <StatusBadge status={inv.status} />
          <div style={{ display: "flex", gap: 6, marginTop: 12, flexWrap: "wrap" }}>
            {onOpenTicket && <SmallBtn onClick={onOpenTicket}>Přejít na zakázku</SmallBtn>}
            <SmallBtn onClick={onEdit}>Upravit</SmallBtn>
            <SmallBtn onClick={onPrint}>Tisk</SmallBtn>
            <SmallBtn onClick={onExport}>Export PDF</SmallBtn>
            <SmallBtn onClick={onSend}>Odeslat</SmallBtn>
            {inv.status === "draft" && <SmallBtn onClick={() => onStatusChange("issued")}>Vystavit</SmallBtn>}
            {["issued", "sent", "overdue"].includes(inv.status) && <SmallBtn onClick={() => onStatusChange("paid")}>Zaplaceno</SmallBtn>}
          </div>
        </div>
        <div style={{ flex: 1, overflow: "auto", padding: "16px 24px" }}>
          <DetailSection title="Odběratel">
            <DetailRow label="Název" value={inv.customer_name} />
            <DetailRow label="IČO" value={inv.customer_ico} />
            <DetailRow label="DIČ" value={inv.customer_dic} />
            <DetailRow label="Adresa" value={inv.customer_address} />
            <DetailRow label="E-mail" value={inv.customer_email} />
          </DetailSection>
          <DetailSection title="Data">
            <DetailRow label="Datum vystavení" value={inv.issue_date ? new Date(inv.issue_date).toLocaleDateString("cs-CZ") : ""} />
            <DetailRow label="Datum splatnosti" value={inv.due_date ? new Date(inv.due_date).toLocaleDateString("cs-CZ") : ""} />
            <DetailRow label="DUZP" value={inv.taxable_date ? new Date(inv.taxable_date).toLocaleDateString("cs-CZ") : ""} />
            <DetailRow label="VS" value={inv.variable_symbol} />
          </DetailSection>
          <DetailSection title="Položky">
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ borderBottom: "2px solid var(--border)" }}>
                  <th style={{ textAlign: "left", padding: "6px 0", color: "var(--muted)", fontWeight: 600 }}>Položka</th>
                  <th style={{ textAlign: "right", padding: "6px 4px", color: "var(--muted)", fontWeight: 600 }}>Množství</th>
                  <th style={{ textAlign: "right", padding: "6px 4px", color: "var(--muted)", fontWeight: 600 }}>Cena/j.</th>
                  <th style={{ textAlign: "right", padding: "6px 4px", color: "var(--muted)", fontWeight: 600 }}>DPH</th>
                  <th style={{ textAlign: "right", padding: "6px 0", color: "var(--muted)", fontWeight: 600 }}>Celkem</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it) => (
                  <tr key={it.id} style={{ borderBottom: "1px solid var(--border)" }}>
                    <td style={{ padding: "6px 0", color: "var(--text)" }}>{it.name}</td>
                    <td style={{ textAlign: "right", padding: "6px 4px", color: "var(--text)", fontVariantNumeric: "tabular-nums" }}>{it.qty} {it.unit}</td>
                    <td style={{ textAlign: "right", padding: "6px 4px", color: "var(--text)", fontVariantNumeric: "tabular-nums" }}>{formatCurrency(it.unit_price)}</td>
                    <td style={{ textAlign: "right", padding: "6px 4px", color: "var(--muted)", fontVariantNumeric: "tabular-nums" }}>{it.vat_rate}%</td>
                    <td style={{ textAlign: "right", padding: "6px 0", fontWeight: 600, color: "var(--text)", fontVariantNumeric: "tabular-nums" }}>{formatCurrency(it.line_total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </DetailSection>
          <DetailSection title="Souhrn">
            <DetailRow label="Základ" value={formatCurrency(inv.subtotal, inv.currency)} />
            <DetailRow label="DPH" value={formatCurrency(inv.vat_amount, inv.currency)} />
            {inv.rounding !== 0 && <DetailRow label="Zaokrouhlení" value={formatCurrency(inv.rounding, inv.currency)} />}
            <div style={{ borderTop: "2px solid var(--border)", marginTop: 6, paddingTop: 6, display: "flex", justifyContent: "space-between" }}>
              <span style={{ fontWeight: 800, color: "var(--text)" }}>Celkem</span>
              <span style={{ fontWeight: 800, fontSize: 16, color: "var(--text)" }}>{formatCurrency(inv.total, inv.currency)}</span>
            </div>
          </DetailSection>
          {inv.notes && (
            <DetailSection title="Poznámky">
              <p style={{ margin: 0, fontSize: 13, color: "var(--text)", whiteSpace: "pre-wrap" }}>{inv.notes}</p>
            </DetailSection>
          )}
          <DetailSection title="Historie">
            {events.length === 0 ? (
              <p style={{ margin: 0, fontSize: 12, color: "var(--muted)" }}>Žádné události.</p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {events.map((ev) => (
                  <div key={ev.id} style={{ fontSize: 12, color: "var(--muted)", display: "flex", gap: 8 }}>
                    <span style={{ fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{new Date(ev.created_at).toLocaleString("cs-CZ")}</span>
                    <span style={{ color: "var(--text)", fontWeight: 600 }}>{ev.type}</span>
                  </div>
                ))}
              </div>
            )}
          </DetailSection>
        </div>
      </div>
    </div>
  );
}

function SmallBtn({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "5px 12px",
        borderRadius: 8,
        border: "1px solid var(--border)",
        background: "var(--panel-2)",
        color: "var(--text)",
        fontSize: 12,
        fontWeight: 600,
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}

function DetailSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>{title}</div>
      {children}
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "3px 0" }}>
      <span style={{ color: "var(--muted)" }}>{label}</span>
      <span style={{ color: "var(--text)", fontWeight: 500, textAlign: "right" }}>{value}</span>
    </div>
  );
}

// ─── Invoice Editor ──────────────────────────────────────────

function InvoiceEditor({
  invoice,
  setInvoice,
  items,
  setItems,
  totals,
  saving,
  isNew,
  onSave,
  onCancel,
  serviceId,
}: {
  invoice: Partial<Invoice>;
  setInvoice: (i: Partial<Invoice>) => void;
  items: (InvoiceLineItem & { id?: string })[];
  setItems: (items: (InvoiceLineItem & { id?: string })[]) => void;
  totals: ReturnType<typeof computeTotals>;
  saving: boolean;
  isNew: boolean;
  onSave: () => void;
  onCancel: () => void;
  serviceId: string;
}) {
  const updateField = (field: string, value: any) => {
    setInvoice({ ...invoice, [field]: value });
  };

  const updateItem = (index: number, field: keyof InvoiceLineItem, value: any) => {
    const next = [...items];
    (next[index] as any)[field] = value;
    setItems(next);
  };

  const addItem = () => {
    setItems([...items, emptyLineItem()]);
  };

  const removeItem = (index: number) => {
    if (items.length <= 1) return;
    setItems(items.filter((_, i) => i !== index));
  };

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      {/* Header */}
      <div style={{ padding: "16px 24px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button onClick={onCancel} style={{ background: "none", border: "none", fontSize: 18, color: "var(--muted)", cursor: "pointer" }}>←</button>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: "var(--text)" }}>
            {isNew ? "Nová faktura" : `Upravit ${invoice.number || ""}`}
          </h2>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={onCancel} style={btnSecondary}>Zrušit</button>
          <button onClick={onSave} disabled={saving} style={{ ...btnPrimary, opacity: saving ? 0.6 : 1 }}>
            {saving ? "Ukládám..." : "Uložit"}
          </button>
        </div>
      </div>

      {/* Editor body */}
      <div style={{ flex: 1, overflow: "auto", padding: "20px 24px 40px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: 24 }}>
          {/* Left: Supplier + meta */}
          <div>
            <EditorSection title="Faktura">
              <EditorRow>
                <EditorField label="Číslo faktury" value={invoice.number || ""} onChange={(v) => updateField("number", v)} />
                <EditorField label="Variabilní symbol" value={invoice.variable_symbol || ""} onChange={(v) => updateField("variable_symbol", v)} />
              </EditorRow>
              <EditorRow>
                <EditorField label="Datum vystavení" type="date" value={invoice.issue_date || ""} onChange={(v) => updateField("issue_date", v)} />
                <EditorField label="Datum splatnosti" type="date" value={invoice.due_date || ""} onChange={(v) => updateField("due_date", v)} />
              </EditorRow>
              <EditorRow>
                <EditorField label="DUZP" type="date" value={invoice.taxable_date || ""} onChange={(v) => updateField("taxable_date", v)} />
                <EditorField label="Měna" value={invoice.currency || "CZK"} onChange={(v) => updateField("currency", v)} />
              </EditorRow>
            </EditorSection>

            <EditorCollapsibleSection
              title="Dodavatel"
              summary={invoice.supplier_name || "Údaje z nastavení servisu"}
              defaultOpen={false}
            >
              <div style={{ paddingTop: 12 }}>
                <EditorField label="Název" value={invoice.supplier_name || ""} onChange={(v) => updateField("supplier_name", v)} />
                <EditorRow>
                  <EditorField label="IČO" value={invoice.supplier_ico || ""} onChange={(v) => updateField("supplier_ico", v)} />
                  <EditorField label="DIČ" value={invoice.supplier_dic || ""} onChange={(v) => updateField("supplier_dic", v)} />
                </EditorRow>
                <EditorField label="Adresa" value={invoice.supplier_address || ""} onChange={(v) => updateField("supplier_address", v)} />
                <EditorRow>
                  <EditorField label="E-mail" value={invoice.supplier_email || ""} onChange={(v) => updateField("supplier_email", v)} />
                  <EditorField label="Telefon" value={invoice.supplier_phone || ""} onChange={(v) => updateField("supplier_phone", v)} />
                </EditorRow>
                <EditorField label="Číslo účtu" value={invoice.supplier_bank_account || ""} onChange={(v) => updateField("supplier_bank_account", v)} />
                <EditorRow>
                  <EditorField label="IBAN" value={invoice.supplier_iban || ""} onChange={(v) => updateField("supplier_iban", v)} />
                  <EditorField label="SWIFT" value={invoice.supplier_swift || ""} onChange={(v) => updateField("supplier_swift", v)} />
                </EditorRow>
              </div>
            </EditorCollapsibleSection>
          </div>

          {/* Right: Customer */}
          <div>
            <EditorSection title="Odběratel">
              <CustomerPicker
                serviceId={serviceId}
                onSelect={(c) => {
                  setInvoice({
                    ...invoice,
                    customer_id: c.id,
                    customer_name: c.name,
                    customer_email: c.email || invoice.customer_email || "",
                    customer_phone: c.phone || invoice.customer_phone || "",
                    customer_ico: c.ico || invoice.customer_ico || "",
                    customer_dic: c.dic || invoice.customer_dic || "",
                    customer_address: c.address || invoice.customer_address || "",
                  });
                }}
              />
              <EditorField label="Název" value={invoice.customer_name || ""} onChange={(v) => updateField("customer_name", v)} />
              <EditorRow>
                <EditorField label="IČO" value={invoice.customer_ico || ""} onChange={(v) => updateField("customer_ico", v)} />
                <EditorField label="DIČ" value={invoice.customer_dic || ""} onChange={(v) => updateField("customer_dic", v)} />
              </EditorRow>
              <EditorField label="Adresa" value={invoice.customer_address || ""} onChange={(v) => updateField("customer_address", v)} />
              <EditorRow>
                <EditorField label="E-mail" value={invoice.customer_email || ""} onChange={(v) => updateField("customer_email", v)} />
                <EditorField label="Telefon" value={invoice.customer_phone || ""} onChange={(v) => updateField("customer_phone", v)} />
              </EditorRow>
            </EditorSection>

            <EditorSection title="Poznámky">
              <textarea
                value={invoice.notes || ""}
                onChange={(e) => updateField("notes", e.target.value)}
                rows={3}
                placeholder="Poznámky na faktuře..."
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  borderRadius: 12,
                  border: "1px solid var(--border)",
                  background: "var(--panel)",
                  color: "var(--text)",
                  outline: "none",
                  resize: "vertical",
                  fontSize: 13,
                  fontFamily: "inherit",
                }}
              />
              <div style={{ marginTop: 8 }}>
                <FieldLabel>Interní poznámka</FieldLabel>
                <textarea
                  value={invoice.internal_note || ""}
                  onChange={(e) => updateField("internal_note", e.target.value)}
                  rows={2}
                  placeholder="Interní poznámka (nebude na faktuře)..."
                  style={{
                    width: "100%",
                    padding: "10px 12px",
                    borderRadius: 12,
                    border: "1px solid var(--border)",
                    background: "var(--panel)",
                    color: "var(--text)",
                    outline: "none",
                    resize: "vertical",
                    fontSize: 13,
                    fontFamily: "inherit",
                  }}
                />
              </div>
            </EditorSection>
          </div>
        </div>

        {/* Items table */}
        <EditorSection title="Položky">
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: "2px solid var(--border)" }}>
                <th style={thStyle}>Název</th>
                <th style={{ ...thStyle, width: 70, textAlign: "right" }}>Množství</th>
                <th style={{ ...thStyle, width: 60, textAlign: "center" }}>Jednotka</th>
                <th style={{ ...thStyle, width: 100, textAlign: "right" }}>Cena/j.</th>
                <th style={{ ...thStyle, width: 70, textAlign: "right" }}>DPH %</th>
                <th style={{ ...thStyle, width: 100, textAlign: "right" }}>Celkem</th>
                <th style={{ ...thStyle, width: 36 }} />
              </tr>
            </thead>
            <tbody>
              {items.map((item, idx) => {
                const lineTotal = Math.round(item.qty * item.unit_price * 100) / 100;
                return (
                  <tr key={idx} style={{ borderBottom: "1px solid var(--border)" }}>
                    <td style={tdStyle}>
                      <input
                        value={item.name}
                        onChange={(e) => updateItem(idx, "name", e.target.value)}
                        placeholder="Název položky"
                        style={cellInput}
                      />
                    </td>
                    <td style={tdStyle}>
                      <input
                        type="number"
                        value={item.qty}
                        onChange={(e) => updateItem(idx, "qty", parseFloat(e.target.value) || 0)}
                        style={{ ...cellInput, textAlign: "right" }}
                        step="0.001"
                        min="0"
                      />
                    </td>
                    <td style={tdStyle}>
                      <input
                        value={item.unit}
                        onChange={(e) => updateItem(idx, "unit", e.target.value)}
                        style={{ ...cellInput, textAlign: "center" }}
                      />
                    </td>
                    <td style={tdStyle}>
                      <input
                        type="number"
                        value={item.unit_price}
                        onChange={(e) => updateItem(idx, "unit_price", parseFloat(e.target.value) || 0)}
                        style={{ ...cellInput, textAlign: "right" }}
                        step="0.01"
                        min="0"
                      />
                    </td>
                    <td style={tdStyle}>
                      <select
                        value={item.vat_rate}
                        onChange={(e) => updateItem(idx, "vat_rate", parseFloat(e.target.value))}
                        style={{ ...cellInput, textAlign: "right", cursor: "pointer" }}
                      >
                        <option value="0">0%</option>
                        <option value="12">12%</option>
                        <option value="21">21%</option>
                      </select>
                    </td>
                    <td style={{ ...tdStyle, textAlign: "right", fontWeight: 600, fontVariantNumeric: "tabular-nums", fontSize: 13 }}>
                      {formatCurrency(lineTotal)}
                    </td>
                    <td style={tdStyle}>
                      <button
                        onClick={() => removeItem(idx)}
                        disabled={items.length <= 1}
                        style={{
                          background: "none",
                          border: "none",
                          color: items.length <= 1 ? "var(--border)" : "#ef4444",
                          cursor: items.length <= 1 ? "default" : "pointer",
                          fontSize: 16,
                          padding: "2px 4px",
                        }}
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <button onClick={addItem} style={{ ...btnSecondary, marginTop: 8 }}>
            + Přidat položku
          </button>
        </EditorSection>

        {/* Totals */}
        <div style={{ maxWidth: 300, marginLeft: "auto", marginTop: 8 }}>
          <TotalRow label="Základ" value={formatCurrency(totals.subtotal)} />
          {totals.vat_breakdown.map((v) => (
            <TotalRow key={v.rate} label={`DPH ${v.rate}%`} value={formatCurrency(v.vat)} />
          ))}
          {totals.rounding !== 0 && <TotalRow label="Zaokrouhlení" value={formatCurrency(totals.rounding)} />}
          <div style={{ borderTop: "2px solid var(--border)", marginTop: 6, paddingTop: 6, display: "flex", justifyContent: "space-between" }}>
            <span style={{ fontWeight: 800, fontSize: 15, color: "var(--text)" }}>Celkem</span>
            <span style={{ fontWeight: 800, fontSize: 18, color: "var(--text)" }}>{formatCurrency(totals.total_rounded)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function EditorSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 10, paddingBottom: 6, borderBottom: "1px solid var(--border)" }}>{title}</div>
      {children}
    </div>
  );
}

function EditorCollapsibleSection({
  title,
  summary,
  defaultOpen,
  children,
}: {
  title: string;
  summary?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen ?? false);
  return (
    <div style={{ marginBottom: 20, border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden", background: "var(--panel-2)" }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          padding: "12px 16px",
          border: "none",
          background: "transparent",
          color: "var(--text)",
          cursor: "pointer",
          textAlign: "left",
          fontSize: 13,
        }}
      >
        <span style={{ fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>{title}</span>
        {summary && !open && (
          <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--muted)", fontSize: 12 }}>{summary}</span>
        )}
        <span style={{ flexShrink: 0, color: "var(--muted)", transform: open ? "rotate(180deg)" : "none", transition: "transform 0.2s" }}>▼</span>
      </button>
      {open && (
        <div style={{ padding: "0 16px 16px", borderTop: "1px solid var(--border)" }}>
          {children}
        </div>
      )}
    </div>
  );
}

function EditorRow({ children }: { children: React.ReactNode }) {
  return <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>{children}</div>;
}

function EditorField({ label, value, onChange, type = "text" }: { label: string; value: string; onChange: (v: string) => void; type?: string }) {
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 3 }}>{label}</div>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          width: "100%",
          padding: "8px 10px",
          borderRadius: 10,
          border: "1px solid var(--border)",
          background: "var(--panel)",
          color: "var(--text)",
          fontSize: 13,
          outline: "none",
        }}
      />
    </div>
  );
}

function TotalRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", fontSize: 13 }}>
      <span style={{ color: "var(--muted)" }}>{label}</span>
      <span style={{ color: "var(--text)", fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{value}</span>
    </div>
  );
}

// ─── Shared styles ──────────────────────────────────────────

const btnPrimary: React.CSSProperties = {
  padding: "8px 18px",
  borderRadius: 10,
  border: "none",
  background: "var(--accent)",
  color: "#fff",
  fontWeight: 700,
  fontSize: 13,
  cursor: "pointer",
};

const btnSecondary: React.CSSProperties = {
  padding: "8px 18px",
  borderRadius: 10,
  border: "1px solid var(--border)",
  background: "transparent",
  color: "var(--text)",
  fontWeight: 600,
  fontSize: 13,
  cursor: "pointer",
};

const thStyle: React.CSSProperties = {
  textAlign: "left",
  padding: "8px 6px",
  fontSize: 11,
  fontWeight: 700,
  color: "var(--muted)",
  textTransform: "uppercase",
  letterSpacing: "0.03em",
};

const tdStyle: React.CSSProperties = {
  padding: "4px 6px",
};

const cellInput: React.CSSProperties = {
  width: "100%",
  padding: "7px 8px",
  borderRadius: 8,
  border: "1px solid var(--border)",
  background: "var(--panel-2)",
  color: "var(--text)",
  fontSize: 13,
  outline: "none",
};
