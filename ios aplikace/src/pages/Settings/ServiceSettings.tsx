import { useState, useEffect } from "react";
import { supabase } from "../../lib/supabaseClient";
import { safeLoadCompanyData } from "../Orders";
import { Card, FieldLabel, TextInput, LanguagePicker } from "../../lib/settingsUi";

type CompanyData = {
  abbreviation: string;
  name: string;
  ico: string;
  dic: string;
  language: string;
  defaultPhonePrefix: string;
  addressStreet: string;
  addressCity: string;
  addressZip: string;
  phone: string;
  email: string;
  website: string;
};

type ServiceSettingsProps = {
  activeServiceId: string | null;
  onSave: (data: CompanyData) => Promise<void>;
};

export function ServiceSettings({ activeServiceId, onSave }: ServiceSettingsProps) {
  const [companyData, setCompanyData] = useState<CompanyData>(() => safeLoadCompanyData());
  const [serviceSettingsLoading, setServiceSettingsLoading] = useState(false);
  const [serviceSettingsError, setServiceSettingsError] = useState<string | null>(null);

  // Load service_settings from DB when activeServiceId changes
  useEffect(() => {
    if (!activeServiceId || !supabase) {
      setServiceSettingsLoading(false);
      setServiceSettingsError(null);
      return;
    }
    
    setServiceSettingsLoading(true);
    setServiceSettingsError(null);

    const loadServiceSettings = async () => {
      if (!supabase) {
        setServiceSettingsLoading(false);
        return;
      }

      try {
        const { data, error } = await (supabase
          .from("service_settings") as any)
          .select("config")
          .eq("service_id", activeServiceId)
          .single();

        if (error) {
          // If not found, it's okay - will use default/localStorage
          if (error.code === "PGRST116") {
            setServiceSettingsLoading(false);
            return;
          }
          throw error;
        }

        if (data?.config?.abbreviation) {
          // Update companyData abbreviation from DB
          setCompanyData((prev) => ({
            ...prev,
            abbreviation: data.config.abbreviation || prev.abbreviation,
          }));
        }

        setServiceSettingsLoading(false);
      } catch (err) {
        console.error("[Settings] Error loading service settings:", err);
        setServiceSettingsError(err instanceof Error ? err.message : "Neznámá chyba");
        setServiceSettingsLoading(false);
      }
    };

    loadServiceSettings();
  }, [activeServiceId]);

  return (
    <>
      <Card>
        <div style={{ fontWeight: 950, fontSize: 14, marginBottom: 12, color: "var(--text)" }}>Základní údaje</div>
        <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 16 }}>
          Základní informace o vašem servisu nebo firmě
        </div>

        <div style={{ display: "grid", gap: 16 }}>
          <div>
            <FieldLabel>Zkratka</FieldLabel>
            <TextInput
              type="text"
              value={companyData.abbreviation}
              onChange={(e: any) => setCompanyData((p) => ({ ...p, abbreviation: e.target.value }))}
              placeholder="Zkratka"
            />
          </div>

          <div>
            <FieldLabel>Název</FieldLabel>
            <TextInput
              type="text"
              value={companyData.name}
              onChange={(e: any) => setCompanyData((p) => ({ ...p, name: e.target.value }))}
              placeholder="Název servisu"
            />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <div>
              <FieldLabel>IČO</FieldLabel>
              <TextInput
                type="text"
                value={companyData.ico}
                onChange={(e: any) => setCompanyData((p) => ({ ...p, ico: e.target.value }))}
                placeholder="12345678"
              />
            </div>

            <div>
              <FieldLabel>DIČ</FieldLabel>
              <TextInput
                type="text"
                value={companyData.dic}
                onChange={(e: any) => setCompanyData((p) => ({ ...p, dic: e.target.value }))}
                placeholder="CZ12345678"
              />
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <div style={{ position: "relative" }}>
              <FieldLabel>Jazyk</FieldLabel>
              <LanguagePicker
                value={companyData.language}
                onChange={(value) => setCompanyData((p) => ({ ...p, language: value }))}
              />
            </div>

            <div>
              <FieldLabel>Výchozí tel. předvolba</FieldLabel>
              <TextInput
                type="text"
                value={companyData.defaultPhonePrefix}
                onChange={(e: any) => setCompanyData((p) => ({ ...p, defaultPhonePrefix: e.target.value }))}
                placeholder="+420"
              />
            </div>
          </div>

          <div>
            <div style={{ fontWeight: 700, fontSize: 13, color: "var(--text)", marginTop: 8, marginBottom: 8 }}>Adresa</div>
            
            <div style={{ marginBottom: 16 }}>
              <FieldLabel>Ulice</FieldLabel>
              <TextInput
                type="text"
                value={companyData.addressStreet}
                onChange={(e: any) => setCompanyData((p) => ({ ...p, addressStreet: e.target.value }))}
                placeholder="Ulice a číslo popisné"
              />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 16 }}>
              <div>
                <FieldLabel>Město</FieldLabel>
                <TextInput
                  type="text"
                  value={companyData.addressCity}
                  onChange={(e: any) => setCompanyData((p) => ({ ...p, addressCity: e.target.value }))}
                  placeholder="Město"
                />
              </div>

              <div>
                <FieldLabel>PSČ</FieldLabel>
                <TextInput
                  type="text"
                  value={companyData.addressZip}
                  onChange={(e: any) => setCompanyData((p) => ({ ...p, addressZip: e.target.value }))}
                  placeholder="123 45"
                />
              </div>
            </div>
          </div>

          {serviceSettingsError && (
            <div style={{ padding: 12, borderRadius: 8, background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", color: "rgba(239,68,68,0.9)", fontSize: 13 }}>
              Chyba při načítání: {serviceSettingsError}
            </div>
          )}

          <button
            onClick={async () => {
              try {
                await onSave(companyData);
              } catch (_err) {
                // Error is already handled in onSave
              }
            }}
            disabled={serviceSettingsLoading}
            style={{
              padding: "12px 24px",
              borderRadius: 12,
              border: "none",
              background: serviceSettingsLoading ? "var(--panel-2)" : "var(--accent)",
              color: serviceSettingsLoading ? "var(--muted)" : "var(--accent-fg)",
              fontWeight: 900,
              fontSize: 13,
              cursor: serviceSettingsLoading ? "not-allowed" : "pointer",
              transition: "var(--transition-smooth)",
              boxShadow: "var(--shadow-soft)",
            }}
            onMouseEnter={(e) => {
              if (!serviceSettingsLoading) {
                e.currentTarget.style.opacity = "0.9";
                e.currentTarget.style.transform = "translateY(-1px)";
              }
            }}
            onMouseLeave={(e) => {
              if (!serviceSettingsLoading) {
                e.currentTarget.style.opacity = "1";
                e.currentTarget.style.transform = "translateY(0)";
              }
            }}
          >
            {serviceSettingsLoading ? "Načítám..." : "Uložit základní údaje"}
          </button>
        </div>
      </Card>
    </>
  );
}

