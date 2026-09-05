import { useEffect, useMemo, useState } from "react";
import { Button, Card, Pill } from "../../components/ui";
import { SectionHeading } from "../../components/SectionHeading";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { EditIcon, PinIcon, PlusIcon, TrashIcon, CheckIcon } from "../../components/icons";
import { showToast } from "../../components/Toast";
import { supabase } from "../../lib/supabaseClient";
import { useIsNarrow } from "../../hooks/useIsNarrow";
import { useBranches } from "../../context/BranchContext";
import { useEntitlements } from "../../hooks/useEntitlements";
import { deleteBranch, normalizeBranchCode, saveBranch, setBranchDefault, type Branch, type BranchInput } from "../../lib/branches";
import { FieldLabel, TextInput } from "../../lib/settingsUi";

type WarehouseOption = { id: string; name: string; branchId: string | null };

function emptyInput(): BranchInput {
  return {
    name: "",
    code: "",
    addressStreet: "",
    addressCity: "",
    addressZip: "",
    phone: "",
    email: "",
    openingHours: "",
    companyName: "",
    ico: "",
    dic: "",
    bankAccount: "",
    iban: "",
    defaultWarehouseId: null,
    isDefault: false,
  };
}

function toInput(b: Branch): BranchInput {
  return {
    id: b.id,
    name: b.name,
    code: b.code,
    addressStreet: b.addressStreet,
    addressCity: b.addressCity,
    addressZip: b.addressZip,
    phone: b.phone,
    email: b.email,
    openingHours: b.openingHours,
    companyName: b.companyName,
    ico: b.ico,
    dic: b.dic,
    bankAccount: b.bankAccount,
    iban: b.iban,
    defaultWarehouseId: b.defaultWarehouseId,
    isDefault: b.isDefault,
    orderIndex: b.orderIndex,
  };
}

function addressLine(b: Branch): string {
  return [b.addressStreet, [b.addressZip, b.addressCity].filter(Boolean).join(" ")].filter((s) => s && s.trim()).join(", ");
}

/**
 * Nastavení → Firma → Pobočky. Seznam poboček, editor a mazání.
 *
 * Pobočka doplní na dokumenty a do zákaznického portálu svou adresu,
 * telefon a e-mail (zbytek – název, IČO, banka – zůstává firemní),
 * vloží zkratku do čísla zakázky a slouží jako filtr napříč aplikací.
 */
export function BranchesSettings({ activeServiceId, abbreviation }: { activeServiceId: string; abbreviation: string }) {
  const narrow = useIsNarrow();
  const { branches, unavailable, loading, reload } = useBranches();
  // Kolik poboček má servis zaplaceno (nastavuje majitel v Owner panelu).
  const { quota } = useEntitlements(activeServiceId);
  const limit = quota("branches");
  const naLimitu = limit !== null && branches.length >= limit;
  const [editing, setEditing] = useState<BranchInput | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleteFor, setDeleteFor] = useState<Branch | null>(null);
  const [warehouses, setWarehouses] = useState<WarehouseOption[]>([]);

  useEffect(() => {
    if (!supabase || !activeServiceId) return;
    let cancelled = false;
    (async () => {
      const { data } = await (supabase!.from("inventory_warehouses") as any)
        .select("id, name, branch_id")
        .eq("service_id", activeServiceId)
        .order("order_index");
      if (cancelled || !Array.isArray(data)) return;
      setWarehouses(data.map((w: any) => ({ id: String(w.id), name: String(w.name), branchId: typeof w.branch_id === "string" ? w.branch_id : null })));
    })();
    return () => { cancelled = true; };
  }, [activeServiceId, branches.length]);

  const servicePrefix = useMemo(() => {
    const cleaned = abbreviation.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
    return cleaned ? cleaned.slice(0, 6) : "SRV";
  }, [abbreviation]);
  const yy = String(new Date().getFullYear()).slice(-2);

  const codePreview = (code: string) => `${servicePrefix}${normalizeBranchCode(code)}${yy}000001`;

  const submit = async () => {
    if (!editing) return;
    if (!editing.name.trim()) {
      showToast("Pobočka potřebuje název.", "error");
      return;
    }
    setSaving(true);
    const res = await saveBranch(activeServiceId, editing);
    setSaving(false);
    if (res.error) {
      showToast(res.error, "error");
      return;
    }
    showToast(editing.id ? "Pobočka uložena" : "Pobočka přidána", "success");
    setEditing(null);
    void reload();
  };

  const makeDefault = async (b: Branch) => {
    const res = await setBranchDefault(b.id);
    if (res.error) showToast(res.error, "error");
    else void reload();
  };

  const remove = async () => {
    if (!deleteFor) return;
    const res = await deleteBranch(deleteFor.id);
    if (res.error) {
      showToast(res.error, "error");
      return;
    }
    showToast("Pobočka smazána. Zakázky a sklady přešly pod výchozí pobočku.", "success");
    setDeleteFor(null);
    void reload();
  };

  if (unavailable) {
    return (
      <Card>
        <SectionHeading size="sm">Pobočky</SectionHeading>
        <div style={{ color: "var(--muted)", fontSize: "var(--text-sm)" }}>
          Pobočky zatím nejsou na serveru dostupné. Po aktualizaci databáze se tady objeví.
        </div>
      </Card>
    );
  }

  const inputStyle: React.CSSProperties = { width: "100%" };

  return (
    <>
      <Card>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div style={{ minWidth: 0 }}>
            <SectionHeading size="sm">Pobočky</SectionHeading>
            <div style={{ color: "var(--muted)", fontSize: "var(--text-sm)", marginTop: "calc(-1 * var(--space-2))" }}>
              Pobočka doplní na dokumenty a do zákaznického portálu svou adresu a telefon, vloží zkratku do čísla zakázky
              a v Zakázkách, Kalendáři, Skladu a Statistikách funguje jako filtr. Když je pobočka jiný subjekt, může mít
              vlastní název, IČO, DIČ a bankovní účet; prázdná pole se berou z údajů firmy.
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {limit !== null && (
              <span style={{ fontSize: "var(--text-sm)", color: naLimitu ? "var(--danger-text)" : "var(--muted)", fontVariantNumeric: "tabular-nums" }}>
                {branches.length} z {limit}
              </span>
            )}
            <Button
              variant="primary"
              icon={<PlusIcon size={14} />}
              onClick={() => setEditing(emptyInput())}
              disabled={naLimitu}
              title={naLimitu ? `Servis má zaplacené pobočky v počtu ${limit}. Vyšší počet vám nastaví správce Jobi.` : undefined}
            >
              Přidat pobočku
            </Button>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 16 }}>
          {loading && branches.length === 0 && <div style={{ color: "var(--muted)", fontSize: "var(--text-sm)" }}>Načítání…</div>}
          {branches.map((b) => {
            const addr = addressLine(b);
            const wh = warehouses.filter((w) => w.branchId === b.id);
            return (
              <div
                key={b.id}
                style={{
                  display: "flex",
                  alignItems: narrow ? "stretch" : "center",
                  flexDirection: narrow ? "column" : "row",
                  gap: 10,
                  padding: "10px 12px",
                  borderRadius: 10,
                  border: "1px solid var(--border)",
                  background: "var(--panel-2)",
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <span style={{ fontWeight: 700, color: "var(--text)" }}>{b.name}</span>
                    {b.isDefault && <Pill color="var(--accent)">Výchozí</Pill>}
                    {b.code && <Pill>{b.code}</Pill>}
                  </div>
                  <div style={{ color: "var(--muted)", fontSize: "var(--text-sm)", marginTop: 2, display: "flex", gap: 10, flexWrap: "wrap" }}>
                    <span>{addr || "Adresa firmy"}</span>
                    {b.phone && <span>{b.phone}</span>}
                    {b.ico && <span>IČO {b.ico}</span>}
                    {(b.bankAccount || b.iban) && <span>vlastní účet</span>}
                    {wh.length > 0 && <span>{wh.length === 1 ? "1 sklad" : `${wh.length} sklady`}</span>}
                    <span>Číslo zakázky: {codePreview(b.code)}</span>
                  </div>
                </div>
                <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                  {!b.isDefault && (
                    <Button size="sm" variant="soft" icon={<CheckIcon size={13} />} title="Nastavit jako výchozí" onClick={() => makeDefault(b)}>
                      Výchozí
                    </Button>
                  )}
                  <Button size="sm" variant="soft" icon={<EditIcon size={13} />} onClick={() => setEditing(toInput(b))}>
                    Upravit
                  </Button>
                  {!b.isDefault && (
                    <Button size="sm" variant="soft" iconOnly aria-label="Smazat pobočku" title="Smazat pobočku" icon={<TrashIcon size={13} />} onClick={() => setDeleteFor(b)} />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      {editing && (
        <Card>
          <SectionHeading size="sm" icon={<PinIcon size={16} />}>{editing.id ? "Upravit pobočku" : "Nová pobočka"}</SectionHeading>
          <div style={{ display: "grid", gap: 14 }}>
            <div style={{ display: "grid", gridTemplateColumns: narrow ? "1fr" : "2fr 1fr", gap: 14 }}>
              <div>
                <FieldLabel>Název *</FieldLabel>
                <TextInput value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} placeholder="Praha 6 – Dejvice" style={inputStyle} autoFocus />
              </div>
              <div>
                <FieldLabel>Zkratka do čísla zakázky</FieldLabel>
                <TextInput
                  value={editing.code}
                  onChange={(e) => setEditing({ ...editing, code: normalizeBranchCode(e.target.value) })}
                  placeholder="PH"
                  maxLength={3}
                  style={inputStyle}
                />
                <div style={{ color: "var(--muted)", fontSize: "var(--text-xs)", marginTop: 4 }}>
                  Jen písmena A–Z, nejvýš tři. Příklad: {codePreview(editing.code)}
                </div>
              </div>
            </div>

            <div>
              <FieldLabel>Ulice a číslo</FieldLabel>
              <TextInput value={editing.addressStreet} onChange={(e) => setEditing({ ...editing, addressStreet: e.target.value })} placeholder="Prázdné = adresa firmy" style={inputStyle} />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: narrow ? "1fr" : "2fr 1fr", gap: 14 }}>
              <div>
                <FieldLabel>Město</FieldLabel>
                <TextInput value={editing.addressCity} onChange={(e) => setEditing({ ...editing, addressCity: e.target.value })} style={inputStyle} />
              </div>
              <div>
                <FieldLabel>PSČ</FieldLabel>
                <TextInput value={editing.addressZip} onChange={(e) => setEditing({ ...editing, addressZip: e.target.value })} style={inputStyle} />
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: narrow ? "1fr" : "1fr 1fr", gap: 14 }}>
              <div>
                <FieldLabel>Telefon</FieldLabel>
                <TextInput type="tel" value={editing.phone} onChange={(e) => setEditing({ ...editing, phone: e.target.value })} placeholder="Prázdné = telefon firmy" style={inputStyle} />
              </div>
              <div>
                <FieldLabel>E-mail</FieldLabel>
                <TextInput type="email" value={editing.email} onChange={(e) => setEditing({ ...editing, email: e.target.value })} placeholder="Prázdné = e-mail firmy" style={inputStyle} />
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: narrow ? "1fr" : "1fr 1fr", gap: 14 }}>
              <div>
                <FieldLabel>Otevírací doba</FieldLabel>
                <TextInput value={editing.openingHours} onChange={(e) => setEditing({ ...editing, openingHours: e.target.value })} placeholder="Po–Pá 9–18" style={inputStyle} />
              </div>
              <div>
                <FieldLabel>Výchozí sklad</FieldLabel>
                <select
                  className="ui-input"
                  value={editing.defaultWarehouseId ?? ""}
                  onChange={(e) => setEditing({ ...editing, defaultWarehouseId: e.target.value || null })}
                  style={{ width: "100%" }}
                >
                  <option value="">Podle servisu</option>
                  {warehouses.map((w) => (
                    <option key={w.id} value={w.id}>{w.name}</option>
                  ))}
                </select>
              </div>
            </div>
            <div style={{ fontWeight: 700, fontSize: "var(--text-sm)", color: "var(--text)", marginTop: 4 }}>Vlastní subjekt pobočky</div>
            <div style={{ color: "var(--muted)", fontSize: "var(--text-xs)", marginTop: -10 }}>
              Vyplňte jen když pobočku provozuje jiná firma než hlavní. Na dokumentech, v portálu (QR platba) a na fakturách pak nahradí firemní údaje.
            </div>
            <div style={{ display: "grid", gridTemplateColumns: narrow ? "1fr" : "2fr 1fr 1fr", gap: 14 }}>
              <div>
                <FieldLabel>Název subjektu</FieldLabel>
                <TextInput value={editing.companyName} onChange={(e) => setEditing({ ...editing, companyName: e.target.value })} placeholder="Prázdné = název firmy" style={inputStyle} />
              </div>
              <div>
                <FieldLabel>IČO</FieldLabel>
                <TextInput value={editing.ico} onChange={(e) => setEditing({ ...editing, ico: e.target.value })} placeholder="Prázdné = IČO firmy" style={inputStyle} />
              </div>
              <div>
                <FieldLabel>DIČ</FieldLabel>
                <TextInput value={editing.dic} onChange={(e) => setEditing({ ...editing, dic: e.target.value })} placeholder="CZ…" style={inputStyle} />
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: narrow ? "1fr" : "1fr 1fr", gap: 14 }}>
              <div>
                <FieldLabel>Číslo účtu</FieldLabel>
                <TextInput value={editing.bankAccount} onChange={(e) => setEditing({ ...editing, bankAccount: e.target.value })} placeholder="Prázdné = účet firmy" style={inputStyle} />
              </div>
              <div>
                <FieldLabel>IBAN</FieldLabel>
                <TextInput value={editing.iban} onChange={(e) => setEditing({ ...editing, iban: e.target.value })} placeholder="CZ…" style={inputStyle} />
              </div>
            </div>
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: "var(--text-sm)", color: "var(--text)", cursor: "pointer" }}>
              <input type="checkbox" checked={editing.isDefault} onChange={(e) => setEditing({ ...editing, isDefault: e.target.checked })} />
              Výchozí pobočka (nové zakázky bez zvolené pobočky, starší klienti, API)
            </label>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <Button variant="soft" onClick={() => setEditing(null)} disabled={saving}>Zrušit</Button>
              <Button variant="primary" onClick={submit} disabled={saving}>{saving ? "Ukládám…" : "Uložit pobočku"}</Button>
            </div>
          </div>
        </Card>
      )}

      <ConfirmDialog
        open={!!deleteFor}
        title="Smazat pobočku?"
        message={deleteFor ? `Pobočka „${deleteFor.name}“ se smaže. Její zakázky, sklady a faktury přejdou pod výchozí pobočku.` : ""}
        confirmLabel="Smazat"
        variant="danger"
        onConfirm={remove}
        onCancel={() => setDeleteFor(null)}
      />
    </>
  );
}
