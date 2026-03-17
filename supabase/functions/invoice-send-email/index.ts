import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("authorization") ?? req.headers.get("Authorization") ?? "";
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Missing authorization header" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!token) {
      return new Response(
        JSON.stringify({ error: "Invalid authorization header format" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false },
    });
    const { data: userRes, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userRes?.user) {
      return new Response(
        JSON.stringify({ error: "Unauthorized", detail: userErr?.message }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    const userId = userRes.user.id;

    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const svc = createClient(supabaseUrl, serviceKey);

    const body = await req.json();
    const { invoice_id, recipient, subject, body: emailBody, service_id } = body;

    if (!invoice_id || !recipient || !recipient.includes("@")) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: invoice_id, recipient (valid email)" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Verify membership
    const { data: membership } = await svc
      .from("service_memberships")
      .select("role")
      .eq("service_id", service_id)
      .eq("user_id", userId)
      .single();
    if (!membership) {
      return new Response(
        JSON.stringify({ error: "User is not a member of this service" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Load invoice
    const { data: invoice, error: invError } = await svc
      .from("invoices")
      .select("*")
      .eq("id", invoice_id)
      .single();
    if (invError || !invoice) {
      return new Response(
        JSON.stringify({ error: "Invoice not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Load items
    const { data: items } = await svc
      .from("invoice_items")
      .select("*")
      .eq("invoice_id", invoice_id)
      .order("sort_order");

    // Generate PDF via JobiDocs
    const jobiDocsUrl = Deno.env.get("JOBIDOCS_API_URL") || "http://127.0.0.1:3847";
    let pdfBase64: string | null = null;

    try {
      const variables: Record<string, string> = {};
      const inv = invoice as Record<string, any>;
      variables.inv_number = inv.number || "";
      variables.inv_vs = inv.variable_symbol || "";
      variables.inv_issue_date = inv.issue_date || "";
      variables.inv_due_date = inv.due_date || "";
      variables.inv_taxable_date = inv.taxable_date || "";
      variables.inv_supplier_name = inv.supplier_name || "";
      variables.inv_supplier_ico = inv.supplier_ico || "";
      variables.inv_supplier_dic = inv.supplier_dic || "";
      variables.inv_supplier_address = inv.supplier_address || "";
      variables.inv_supplier_email = inv.supplier_email || "";
      variables.inv_supplier_phone = inv.supplier_phone || "";
      variables.inv_supplier_bank = inv.supplier_bank_account || "";
      variables.inv_supplier_iban = inv.supplier_iban || "";
      variables.inv_supplier_swift = inv.supplier_swift || "";
      variables.inv_customer_name = inv.customer_name || "";
      variables.inv_customer_ico = inv.customer_ico || "";
      variables.inv_customer_dic = inv.customer_dic || "";
      variables.inv_customer_address = inv.customer_address || "";
      variables.inv_customer_email = inv.customer_email || "";
      variables.inv_items_json = JSON.stringify(
        ((items as any[]) || []).map((it: any) => ({
          name: it.name,
          qty: it.qty,
          unit: it.unit,
          unit_price: it.unit_price,
          vat_rate: it.vat_rate,
          line_total: it.line_total,
        })),
      );
      variables.inv_subtotal = String(inv.subtotal);
      variables.inv_vat = String(inv.vat_amount);
      variables.inv_total = String(inv.total);
      variables.inv_rounding = String(inv.rounding);
      variables.inv_currency = inv.currency || "CZK";
      variables.inv_notes = inv.notes || "";

      const companyData: Record<string, string> = {
        name: inv.supplier_name || "",
        ico: inv.supplier_ico || "",
        dic: inv.supplier_dic || "",
        addressStreet: inv.supplier_address || "",
        email: inv.supplier_email || "",
        phone: inv.supplier_phone || "",
      };

      const pdfRes = await fetch(`${jobiDocsUrl}/v1/render-pdf`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          doc_type: "faktura",
          service_id: service_id,
          company_data: companyData,
          variables,
        }),
      });

      if (pdfRes.ok) {
        const pdfBuffer = await pdfRes.arrayBuffer();
        pdfBase64 = btoa(
          Array.from(new Uint8Array(pdfBuffer))
            .map((b) => String.fromCharCode(b))
            .join(""),
        );
      }
    } catch (e) {
      console.warn("[invoice-send-email] PDF generation failed, sending without attachment:", e);
    }

    // Send email via Resend
    const resendKey = Deno.env.get("RESEND_API_KEY")?.trim();
    if (!resendKey) {
      return new Response(
        JSON.stringify({ error: "RESEND_API_KEY is not configured in Edge Function secrets" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const fromEmail = Deno.env.get("RESEND_FROM_EMAIL")?.trim() || "Jobi <onboarding@resend.dev>";
    const inv = invoice as Record<string, any>;
    const emailSubject = subject || `Faktura ${inv.number}`;
    const plainText = emailBody || `Dobrý den,\n\nv příloze zasíláme fakturu č. ${inv.number}.\n\nS pozdravem`;

    const escapeHtml = (s: string) =>
      String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    const safeNumber = escapeHtml(inv.number || "");
    const safeBody = escapeHtml(plainText).replace(/\n/g, "<br>");

    const htmlBody = [
      '<!DOCTYPE html><html><head><meta charset="utf-8"></head>',
      '<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Arial,sans-serif;background:#f9fafb">',
      '<table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;padding:24px 16px"><tr><td align="center">',
      '<table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#fff;border-radius:12px;box-shadow:0 2px 12px rgba(0,0,0,0.08);overflow:hidden"><tr><td style="padding:32px 24px">',
      `<h1 style="margin:0 0 8px;font-size:20px;font-weight:700;color:#111827">Faktura ${safeNumber}</h1>`,
      `<p style="margin:0 0 20px;font-size:14px;color:#374151;line-height:1.6">${safeBody}</p>`,
      '<table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;border-radius:8px;margin:16px 0"><tr><td style="padding:16px">',
      `<p style="margin:0 0 4px;font-size:12px;color:#6b7280">Celkem k úhradě</p>`,
      `<p style="margin:0;font-size:22px;font-weight:800;color:#111827">${escapeHtml(String(inv.total))} ${escapeHtml(inv.currency || "CZK")}</p>`,
      `<p style="margin:4px 0 0;font-size:12px;color:#6b7280">Splatnost: ${escapeHtml(inv.due_date || "—")}</p>`,
      "</td></tr></table>",
      pdfBase64 ? '<p style="margin:16px 0 0;font-size:13px;color:#6b7280">PDF faktura je v příloze tohoto e-mailu.</p>' : "",
      "</td></tr></table>",
      '<p style="text-align:center;margin-top:16px;font-size:11px;color:#9ca3af">Odesláno přes Jobi</p>',
      "</td></tr></table></body></html>",
    ].join("");

    const resendPayload: Record<string, unknown> = {
      from: fromEmail,
      to: [recipient],
      subject: emailSubject,
      text: plainText,
      html: htmlBody,
    };

    if (pdfBase64) {
      resendPayload.attachments = [
        {
          filename: `Faktura_${(inv.number || "").replace(/[^a-zA-Z0-9-]/g, "_")}.pdf`,
          content: pdfBase64,
        },
      ];
    }

    const resendRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${resendKey}` },
      body: JSON.stringify(resendPayload),
    });

    let emailSent = false;
    let emailError: string | null = null;
    let messageId: string | null = null;

    if (resendRes.ok) {
      emailSent = true;
      try {
        const resBody = await resendRes.json();
        messageId = resBody?.id || null;
      } catch {}
    } else {
      const errText = await resendRes.text();
      emailError = `Resend ${resendRes.status}: ${errText.slice(0, 300)}`;
    }

    if (emailSent) {
      // Update invoice status
      await svc
        .from("invoices")
        .update({ status: "sent", sent_at: new Date().toISOString() })
        .eq("id", invoice_id);

      // Log event
      await svc.from("invoice_events").insert({
        invoice_id,
        type: "email_sent",
        payload: { recipient, message_id: messageId, subject: emailSubject },
        created_by: userId,
      });

      return new Response(
        JSON.stringify({ ok: true, email_sent: true, message_id: messageId }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    } else {
      // Log failure
      await svc.from("invoice_events").insert({
        invoice_id,
        type: "email_failed",
        payload: { recipient, error: emailError },
        created_by: userId,
      });

      return new Response(
        JSON.stringify({ error: emailError || "Email sending failed", email_sent: false }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
