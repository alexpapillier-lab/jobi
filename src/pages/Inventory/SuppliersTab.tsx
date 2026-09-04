import { useState } from "react";
import { Button, Input, Label } from "../../components/ui";
import { EditIcon, PlusIcon, TrashIcon, UserIcon } from "../../components/icons";
import { SectionHeading } from "../../components/SectionHeading";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { HLASKA_NEDOSTUPNE, type Supplier, type SupplierInput } from "../../lib/purchaseOrders";

type SupplierFormState = { name: string; email: string; phone: string; website: string; leadDays: string; note: string };

const PRAZDNY: SupplierFormState = { name: "", email: "", phone: "", website: "", leadDays: "", note: "" };

function zFormulare(s: Supplier | null | undefined): SupplierFormState {
  if (!s) return PRAZDNY;
  return {
    name: s.name,
    email: s.email ?? "",
    phone: s.phone ?? "",
    website: s.website ?? "",
    leadDays: s.leadDays === null ? "" : String(s.leadDays),
    note: s.note ?? "",
  };
}

function doVstupu(f: SupplierFormState, id?: string): SupplierInput {
  const dny = f.leadDays.trim() === "" ? null : parseInt(f.leadDays, 10);
  return {
    id,
    name: f.name.trim(),
    email: f.email.trim() || null,
    phone: f.phone.trim() || null,
    website: f.website.trim() || null,
    leadDays: dny === null || !Number.isFinite(dny) ? null : dny,
    note: f.note.trim() || null,
  };
}

/**
 * Formulář dodavatele. Používá ho záložka Dodavatelé (inline) i editor
 * produktu („Nový dodavatel…“ v dialogu). Jediné povinné pole je název.
 */
export function SupplierForm({
  initial,
  saving,
  onSave,
  onCancel,
  autoFocus = true,
}: {
  initial?: Supplier | null;
  saving?: boolean;
  /** Vrací true, když se uložení povedlo – formulář se pak zavře. */
  onSave: (input: SupplierInput) => Promise<boolean>;
  onCancel: () => void;
  autoFocus?: boolean;
}) {
  const [f, setF] = useState<SupplierFormState>(() => zFormulare(initial));
  const nastav = (k: keyof SupplierFormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setF((d) => ({ ...d, [k]: e.target.value }));
  const platny = f.name.trim().length > 0;

  const odeslat = async () => {
    if (!platny || saving) return;
    await onSave(doVstupu(f, initial?.id));
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void odeslat();
      }}
      style={{ display: "grid", gap: "var(--space-3)" }}
    >
      <div>
        <Label>Název dodavatele</Label>
        <Input
          value={f.name}
          onChange={nastav("name")}
          placeholder="např. MobilDíly s.r.o."
          autoFocus={autoFocus}
          required
          style={{ marginTop: "var(--space-1)" }}
        />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "var(--space-3)" }}>
        <div>
          <Label>E-mail</Label>
          <Input type="email" value={f.email} onChange={nastav("email")} placeholder="objednavky@dodavatel.cz" style={{ marginTop: "var(--space-1)" }} />
        </div>
        <div>
          <Label>Telefon</Label>
          <Input type="tel" value={f.phone} onChange={nastav("phone")} placeholder="+420 …" style={{ marginTop: "var(--space-1)" }} />
        </div>
        <div>
          <Label>Web</Label>
          <Input value={f.website} onChange={nastav("website")} placeholder="https://…" style={{ marginTop: "var(--space-1)" }} />
        </div>
        <div>
          <Label>Doba dodání (dny)</Label>
          <Input type="number" min={0} value={f.leadDays} onChange={nastav("leadDays")} placeholder="např. 3" style={{ marginTop: "var(--space-1)" }} />
        </div>
      </div>
      <div>
        <Label>Poznámka</Label>
        <textarea
          className="ui-input"
          value={f.note}
          onChange={nastav("note")}
          placeholder="Podmínky, minimální objednávka, kontaktní osoba…"
          style={{ marginTop: "var(--space-1)", minHeight: 56, resize: "vertical" }}
        />
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: "var(--space-2)" }}>
        <Button variant="ghost" onClick={onCancel} disabled={saving}>
          Zrušit
        </Button>
        <Button type="submit" variant="primary" disabled={!platny || saving} title={platny ? undefined : "Zadejte název dodavatele"}>
          {initial ? "Uložit změny" : "Přidat dodavatele"}
        </Button>
      </div>
    </form>
  );
}

/**
 * Záložka Dodavatelé: seznam s kontakty a počtem produktů, inline
 * přidání a úprava, smazání s potvrzením. Dodavatele, na kterého se ještě
 * odkazují produkty, smazat nejde – uživatel se dozví kolik jich je.
 */
export function SuppliersTab({
  suppliers,
  products,
  nedostupne,
  onSave,
  onDelete,
}: {
  suppliers: Supplier[];
  products: { id: string; supplierId?: string | null }[];
  nedostupne: boolean;
  onSave: (input: SupplierInput) => Promise<Supplier | null>;
  onDelete: (id: string) => Promise<boolean>;
}) {
  const [pridavam, setPridavam] = useState(false);
  const [upravovany, setUpravovany] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [keSmazani, setKeSmazani] = useState<Supplier | null>(null);

  const pocetProduktu = new Map<string, number>();
  for (const p of products) {
    if (p.supplierId) pocetProduktu.set(p.supplierId, (pocetProduktu.get(p.supplierId) ?? 0) + 1);
  }

  const ulozit = async (input: SupplierInput) => {
    setSaving(true);
    const r = await onSave(input);
    setSaving(false);
    if (r) {
      setPridavam(false);
      setUpravovany(null);
    }
    return !!r;
  };

  const radek: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: "var(--space-3)",
    padding: "var(--space-3)",
    borderRadius: "var(--radius-sm)",
    border: "1px solid var(--border)",
    background: "var(--panel-2)",
    flexWrap: "wrap",
  };

  return (
    <div className="ui-card" style={{ display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", flexWrap: "wrap" }}>
        <SectionHeading icon={<UserIcon size={16} />}>Dodavatelé</SectionHeading>
        <div style={{ marginLeft: "auto", marginBottom: "var(--space-3)" }}>
          <Button
            variant="primary"
            icon={<PlusIcon size={14} />}
            disabled={pridavam || nedostupne}
            onClick={() => {
              setUpravovany(null);
              setPridavam(true);
            }}
          >
            Nový dodavatel
          </Button>
        </div>
      </div>

      {nedostupne && (
        <div style={{ fontSize: "var(--text-sm)", color: "var(--muted)", marginBottom: "var(--space-3)" }}>{HLASKA_NEDOSTUPNE}</div>
      )}

      {pridavam && (
        <div style={{ ...radek, display: "block", marginBottom: "var(--space-3)" }}>
          <SupplierForm saving={saving} onSave={ulozit} onCancel={() => setPridavam(false)} />
        </div>
      )}

      {suppliers.length === 0 && !pridavam ? (
        <div style={{ padding: "var(--space-6) var(--space-4)", textAlign: "center", color: "var(--muted)", fontSize: "var(--text-base)" }}>
          {nedostupne
            ? "Až budou objednávky na serveru zapnuté, přidáte tu dodavatele a přiřadíte je produktům."
            : "Zatím žádný dodavatel. Přidejte prvního a přiřaďte ho produktům – objednávky se pak seskupí podle něj."}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
          {suppliers.map((s) => {
            const pocet = pocetProduktu.get(s.id) ?? 0;
            if (upravovany === s.id) {
              return (
                <div key={s.id} style={{ ...radek, display: "block" }}>
                  <SupplierForm initial={s} saving={saving} onSave={ulozit} onCancel={() => setUpravovany(null)} />
                </div>
              );
            }
            const kontakty = [s.email, s.phone, s.website].filter(Boolean) as string[];
            return (
              <div key={s.id} style={radek}>
                <div style={{ flex: "1 1 220px", minWidth: 0 }}>
                  <div style={{ fontWeight: 800, fontSize: "var(--text-base)", color: "var(--text)" }}>{s.name}</div>
                  <div style={{ fontSize: "var(--text-xs)", color: "var(--muted)", marginTop: 2, overflowWrap: "anywhere" }}>
                    {kontakty.length > 0 ? kontakty.join(" · ") : "Bez kontaktu"}
                  </div>
                  {s.note && (
                    <div style={{ fontSize: "var(--text-xs)", color: "var(--muted)", marginTop: 2, overflowWrap: "anywhere" }}>{s.note}</div>
                  )}
                </div>
                <div style={{ fontSize: "var(--text-xs)", color: "var(--muted)", whiteSpace: "nowrap" }}>
                  {s.leadDays !== null ? `Dodání ${s.leadDays} ${s.leadDays === 1 ? "den" : s.leadDays >= 2 && s.leadDays <= 4 ? "dny" : "dní"}` : "Dodání neuvedeno"}
                </div>
                <div style={{ fontSize: "var(--text-xs)", color: "var(--muted)", whiteSpace: "nowrap" }}>
                  {pocet} {pocet === 1 ? "produkt" : pocet >= 2 && pocet <= 4 ? "produkty" : "produktů"}
                </div>
                <div style={{ display: "flex", gap: "var(--space-1)" }}>
                  <Button
                    variant="ghost"
                    size="sm"
                    iconOnly
                    aria-label="Upravit dodavatele"
                    title="Upravit"
                    icon={<EditIcon size={14} />}
                    onClick={() => {
                      setPridavam(false);
                      setUpravovany(s.id);
                    }}
                  />
                  <Button
                    variant="danger"
                    size="sm"
                    iconOnly
                    aria-label="Smazat dodavatele"
                    title={pocet > 0 ? `Nejde smazat – odkazuje se na něj ${pocet} produktů` : "Smazat"}
                    icon={<TrashIcon size={14} />}
                    onClick={() => setKeSmazani(s)}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}

      <ConfirmDialog
        open={keSmazani !== null}
        title={keSmazani && (pocetProduktu.get(keSmazani.id) ?? 0) > 0 ? "Dodavatele nejde smazat" : "Smazat dodavatele?"}
        message={
          keSmazani
            ? (pocetProduktu.get(keSmazani.id) ?? 0) > 0
              ? `Na dodavatele „${keSmazani.name}“ se odkazuje ${pocetProduktu.get(keSmazani.id)} produktů. Nejdřív jim v editoru produktu nastavte jiného dodavatele, nebo dodavatele odeberte.`
              : `Dodavatel „${keSmazani.name}“ se odstraní ze seznamu. Hotové objednávky zůstanou, jen bez odkazu na něj.`
            : ""
        }
        confirmLabel={keSmazani && (pocetProduktu.get(keSmazani.id) ?? 0) > 0 ? "Rozumím" : "Smazat"}
        cancelLabel="Zrušit"
        variant={keSmazani && (pocetProduktu.get(keSmazani.id) ?? 0) > 0 ? "default" : "danger"}
        onConfirm={async () => {
          if (!keSmazani) return;
          if ((pocetProduktu.get(keSmazani.id) ?? 0) > 0) {
            setKeSmazani(null);
            return;
          }
          const ok = await onDelete(keSmazani.id);
          if (ok) setKeSmazani(null);
        }}
        onCancel={() => setKeSmazani(null)}
      />
    </div>
  );
}
