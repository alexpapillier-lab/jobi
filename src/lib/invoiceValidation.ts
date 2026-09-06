import { computeTotals, type InvoiceLineItem } from "./invoiceMath";

export type ValidationError = {
  field: string;
  message: string;
};

export type InvoiceData = {
  number?: string;
  issue_date?: string;
  due_date?: string;
  customer_name?: string;
  supplier_name?: string;
  status?: string;
  /** Druh dokladu (invoices.kind); bez hodnoty se bere jako faktura. */
  kind?: string;
};

export function validateInvoiceForSave(
  invoice: InvoiceData,
  items: InvoiceLineItem[],
): ValidationError[] {
  const errors: ValidationError[] = [];

  if (!invoice.number?.trim()) {
    errors.push({ field: "number", message: "Číslo faktury je povinné" });
  }
  if (!invoice.issue_date) {
    errors.push({ field: "issue_date", message: "Datum vystavení je povinné" });
  }
  if (!invoice.due_date) {
    errors.push({ field: "due_date", message: "Datum splatnosti je povinný" });
  }
  if (items.length === 0) {
    errors.push({ field: "items", message: "Faktura musí mít alespoň jednu položku" });
  }
  const hasValidItem = items.some((it) => it.name.trim().length > 0);
  if (!hasValidItem) {
    errors.push({ field: "items", message: "Alespoň jedna položka musí mít název" });
  }

  // Znaménko částky určuje druh dokladu: záporná faktura je ve skutečnosti
  // dobropis a kladný dobropis nedává smysl – účetnictví by je nepřijalo.
  const total = computeTotals(items).total;
  // NaN projde přes obě porovnání níž, takže by se vystavil doklad, na
  // kterém je místo částky „NaN". Bere se to jako chyba v položkách.
  if (!Number.isFinite(total)) {
    errors.push({ field: "items", message: "Některá položka má neplatné množství nebo cenu" });
  } else if (invoice.kind === "credit_note") {
    if (total > 0) errors.push({ field: "items", message: "Dobropis musí mít zápornou nebo nulovou částku" });
  } else if (total < 0) {
    errors.push({ field: "items", message: "Faktura nemůže mít zápornou částku – vystavte dobropis" });
  }

  return errors;
}

export function validateInvoiceForIssue(
  invoice: InvoiceData,
  items: InvoiceLineItem[],
): ValidationError[] {
  const errors = validateInvoiceForSave(invoice, items);

  if (!invoice.customer_name?.trim()) {
    errors.push({ field: "customer_name", message: "Odběratel je povinný pro vystavení faktury" });
  }
  if (!invoice.supplier_name?.trim()) {
    errors.push({ field: "supplier_name", message: "Dodavatel je povinný pro vystavení faktury" });
  }

  return errors;
}

export function validateInvoiceForSend(
  invoice: InvoiceData,
  items: InvoiceLineItem[],
  recipientEmail: string,
): ValidationError[] {
  const errors = validateInvoiceForIssue(invoice, items);

  if (!recipientEmail?.includes("@")) {
    errors.push({ field: "recipient", message: "Platný e-mail příjemce je povinný" });
  }
  if (invoice.status === "draft") {
    errors.push({ field: "status", message: "Faktura musí být vystavena před odesláním" });
  }

  return errors;
}
