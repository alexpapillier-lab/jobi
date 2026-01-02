import React, { useState, useMemo } from "react";
import { normalizePhone } from "../lib/phone";

type NavKey = "orders" | "customers" | "settings" | "inventory" | "devices" | "statistics" | "guide";

interface GuideProps {
  onNavigate: (page: NavKey) => void;
}

// Mock data pro demo
const mockCustomers = [
  { id: "1", name: "Jan Novák", phone: "+420123456789", email: "jan@example.com", company: "Novák s.r.o." },
  { id: "2", name: "Marie Svobodová", phone: "+420987654321", email: "marie@example.com", company: "Svobodová a spol." },
  { id: "3", name: "Petr Dvořák", phone: "+420555123456", email: "petr@example.com", company: "" },
];

const mockTickets = [
  { id: "1", customerName: "Jan Novák", device: "iPhone 13", problem: "Rozbitý displej", status: "accepted", statusLabel: "Přijato" },
  { id: "2", customerName: "Marie Svobodová", device: "Samsung Galaxy", problem: "Nabíjení nefunguje", status: "in_progress", statusLabel: "V opravě" },
  { id: "3", customerName: "Petr Dvořák", device: "iPad Pro", problem: "Pomalý systém", status: "done", statusLabel: "Hotovo" },
];

const mockStatuses = [
  { key: "accepted", label: "Přijato", bg: "#3B82F6", fg: "#FFFFFF" },
  { key: "in_progress", label: "V opravě", bg: "#F59E0B", fg: "#FFFFFF" },
  { key: "done", label: "Hotovo", bg: "#10B981", fg: "#FFFFFF" },
];

export default function Guide({ onNavigate }: GuideProps) {
  // Demo states
  const [demoNewOrderOpen, setDemoNewOrderOpen] = useState(false);
  const [demoNewOrderData, setDemoNewOrderData] = useState({
    customerName: "",
    customerPhone: "",
    customerEmail: "",
    device: "",
    problem: "",
    status: "accepted",
  });
  const [demoMatchedCustomer, setDemoMatchedCustomer] = useState<typeof mockCustomers[0] | null>(null);
  const [demoCustomerMatchDecision, setDemoCustomerMatchDecision] = useState<"undecided" | "accepted" | "rejected">("undecided");
  const [demoSelectedTicket, setDemoSelectedTicket] = useState<string | null>(null);
  const [demoCustomerListOpen, setDemoCustomerListOpen] = useState(false);
  const [demoSelectedCustomer, setDemoSelectedCustomer] = useState<string | null>(null);
  const [demoEditCustomerOpen, setDemoEditCustomerOpen] = useState(false);
  const [demoEditCustomerData, setDemoEditCustomerData] = useState({
    name: "",
    phone: "",
    email: "",
    company: "",
  });

  // Demo customer lookup
  const handleDemoPhoneChange = (phone: string) => {
    setDemoNewOrderData(prev => ({ ...prev, customerPhone: phone }));
    
    const phoneNorm = normalizePhone(phone);
    if (phoneNorm && demoCustomerMatchDecision === "undecided") {
      const matched = mockCustomers.find(c => normalizePhone(c.phone) === phoneNorm);
      if (matched) {
        setDemoMatchedCustomer(matched);
        setDemoCustomerMatchDecision("undecided");
      } else {
        setDemoMatchedCustomer(null);
      }
    } else {
      setDemoMatchedCustomer(null);
    }
  };

  const handleDemoAcceptCustomer = () => {
    if (demoMatchedCustomer) {
      setDemoNewOrderData(prev => ({
        ...prev,
        customerName: demoMatchedCustomer.name,
        customerPhone: demoMatchedCustomer.phone,
        customerEmail: demoMatchedCustomer.email || "",
      }));
      setDemoCustomerMatchDecision("accepted");
      setDemoMatchedCustomer(null);
    }
  };

  const handleDemoRejectCustomer = () => {
    setDemoCustomerMatchDecision("rejected");
    setDemoMatchedCustomer(null);
  };

  const handleDemoCreateTicket = () => {
    alert(`Demo: Zakázka vytvořena!\n\nZákazník: ${demoNewOrderData.customerName}\nZařízení: ${demoNewOrderData.device}\nProblém: ${demoNewOrderData.problem}`);
    setDemoNewOrderOpen(false);
    setDemoNewOrderData({
      customerName: "",
      customerPhone: "",
      customerEmail: "",
      device: "",
      problem: "",
      status: "accepted",
    });
    setDemoMatchedCustomer(null);
    setDemoCustomerMatchDecision("undecided");
  };

  const handleDemoEditCustomer = (customerId: string) => {
    const customer = mockCustomers.find(c => c.id === customerId);
    if (customer) {
      setDemoEditCustomerData({
        name: customer.name,
        phone: customer.phone,
        email: customer.email,
        company: customer.company,
      });
      setDemoEditCustomerOpen(true);
    }
  };

  const handleDemoSaveCustomer = () => {
    alert(`Demo: Údaje zákazníka uloženy!\n\nJméno: ${demoEditCustomerData.name}\nTelefon: ${demoEditCustomerData.phone}\nE-mail: ${demoEditCustomerData.email}`);
    setDemoEditCustomerOpen(false);
  };

  return (
    <div style={{ maxWidth: 1000, margin: "0 auto", padding: "0 24px" }}>
      {/* Hero Section */}
      <div style={{ 
        textAlign: "center", 
        marginBottom: 48,
        padding: "32px 0",
        background: "linear-gradient(135deg, var(--accent-soft) 0%, transparent 100%)",
        borderRadius: "var(--radius-lg)",
        border: "1px solid var(--border)"
      }}>
        <h1 style={{ fontSize: 42, fontWeight: 800, color: "var(--text)", margin: 0, marginBottom: 12 }}>
          🎯 Vítejte v jobi
        </h1>
        <p style={{ fontSize: 18, color: "var(--muted)", margin: 0, maxWidth: 600, marginLeft: "auto", marginRight: "auto" }}>
          Interaktivní průvodce s praktickými ukázkami – vše si můžete vyzkoušet přímo zde!
        </p>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 40 }}>
        {/* Zakázky - Interaktivní sekce */}
        <section style={{
          background: "var(--panel)",
          backdropFilter: "var(--blur)",
          WebkitBackdropFilter: "var(--blur)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-lg)",
          padding: "32px",
          boxShadow: "var(--shadow-soft)"
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 24 }}>
            <div style={{ 
              width: 48, 
              height: 48, 
              borderRadius: "50%", 
              background: "var(--accent-soft)", 
              display: "flex", 
              alignItems: "center", 
              justifyContent: "center",
              fontSize: 24
            }}>
              📋
            </div>
            <h2 style={{ fontSize: 28, fontWeight: 700, color: "var(--text)", margin: 0 }}>
              Zakázky (Orders)
            </h2>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
            {/* Praktická ukázka 1: Vytvoření zakázky */}
            <div style={{
              background: "var(--bg)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-md)",
              padding: "24px",
              position: "relative"
            }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
                <h3 style={{ fontSize: 20, fontWeight: 600, color: "var(--text)", margin: 0 }}>
                  💡 Praktická ukázka: Vytvoření nové zakázky
                </h3>
                <button
                  onClick={() => setDemoNewOrderOpen(true)}
                  style={{
                    padding: "10px 20px",
                    background: "var(--accent)",
                    color: "white",
                    border: "none",
                    borderRadius: "var(--radius-md)",
                    cursor: "pointer",
                    fontWeight: 600,
                    fontSize: 14,
                    transition: "all 0.2s"
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.opacity = "0.9";
                    e.currentTarget.style.transform = "scale(1.05)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.opacity = "1";
                    e.currentTarget.style.transform = "scale(1)";
                  }}
                >
                  🎯 Vyzkoušet
                </button>
              </div>
              <div style={{ fontSize: 14, color: "var(--text)", lineHeight: 1.7, marginBottom: 16 }}>
                <p style={{ margin: "0 0 12px 0" }}>
                  <strong>Krok 1:</strong> Klikněte na tlačítko "Vyzkoušet" výše a otevře se formulář pro vytvoření zakázky.
                </p>
                <p style={{ margin: "0 0 12px 0" }}>
                  <strong>Krok 2:</strong> Zkuste zadat telefonní číslo <strong>+420123456789</strong> – aplikace vám nabídne automatické přiřazení zákazníka!
                </p>
                <p style={{ margin: "0 0 12px 0" }}>
                  <strong>Krok 3:</strong> Vyplňte informace o zařízení a popište problém.
                </p>
                <p style={{ margin: 0 }}>
                  <strong>Krok 4:</strong> Klikněte na "Vytvořit zakázku" a uvidíte potvrzení.
                </p>
              </div>
            </div>

            {/* Demo Modal - Nová zakázka */}
            {demoNewOrderOpen && (
              <div style={{
                position: "fixed",
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                background: "rgba(0,0,0,0.5)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                zIndex: 1000,
                padding: "20px"
              }} onClick={() => setDemoNewOrderOpen(false)}>
                <div style={{
                  background: "var(--panel)",
                  borderRadius: "var(--radius-lg)",
                  padding: "32px",
                  maxWidth: 600,
                  width: "100%",
                  maxHeight: "90vh",
                  overflow: "auto",
                  border: "1px solid var(--border)",
                  boxShadow: "var(--shadow-lg)"
                }} onClick={(e) => e.stopPropagation()}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
                    <h2 style={{ fontSize: 24, fontWeight: 700, color: "var(--text)", margin: 0 }}>
                      📋 Nová zakázka (Demo)
                    </h2>
                    <button
                      onClick={() => setDemoNewOrderOpen(false)}
                      style={{
                        background: "transparent",
                        border: "none",
                        fontSize: 24,
                        cursor: "pointer",
                        color: "var(--muted)",
                        padding: "4px 8px"
                      }}
                    >
                      ×
                    </button>
                  </div>

                  <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
                    {/* Zákazník */}
                    <div>
                      <h3 style={{ fontSize: 16, fontWeight: 600, color: "var(--text)", margin: "0 0 12px 0" }}>
                        Zákazník
                      </h3>
                      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                        <div>
                          <label style={{ display: "block", fontSize: 13, color: "var(--muted)", marginBottom: 4 }}>
                            Telefon *
                          </label>
                          <input
                            type="text"
                            value={demoNewOrderData.customerPhone}
                            onChange={(e) => handleDemoPhoneChange(e.target.value)}
                            placeholder="+420123456789"
                            style={{
                              width: "100%",
                              padding: "10px",
                              border: "1px solid var(--border)",
                              borderRadius: "var(--radius-sm)",
                              background: "var(--bg)",
                              color: "var(--text)",
                              fontSize: 14
                            }}
                          />
                          <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>
                            💡 Zkuste: +420123456789 nebo +420987654321
                          </div>
                        </div>

                        {/* Customer Match Panel */}
                        {demoMatchedCustomer && demoCustomerMatchDecision === "undecided" && (
                          <div style={{
                            background: "var(--accent-soft)",
                            border: "2px solid var(--accent)",
                            borderRadius: "var(--radius-md)",
                            padding: "16px",
                            marginTop: 8
                          }}>
                            <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text)", marginBottom: 8 }}>
                              🎯 Našli jsme zákazníka!
                            </div>
                            <div style={{ fontSize: 13, color: "var(--text)", marginBottom: 12 }}>
                              <div><strong>Jméno:</strong> {demoMatchedCustomer.name}</div>
                              <div><strong>Telefon:</strong> {demoMatchedCustomer.phone}</div>
                              {demoMatchedCustomer.email && <div><strong>E-mail:</strong> {demoMatchedCustomer.email}</div>}
                              {demoMatchedCustomer.company && <div><strong>Firma:</strong> {demoMatchedCustomer.company}</div>}
                            </div>
                            <div style={{ display: "flex", gap: 8 }}>
                              <button
                                onClick={handleDemoAcceptCustomer}
                                style={{
                                  padding: "8px 16px",
                                  background: "var(--accent)",
                                  color: "white",
                                  border: "none",
                                  borderRadius: "var(--radius-sm)",
                                  cursor: "pointer",
                                  fontWeight: 600,
                                  fontSize: 13
                                }}
                              >
                                ✓ Přiřadit zákazníka
                              </button>
                              <button
                                onClick={handleDemoRejectCustomer}
                                style={{
                                  padding: "8px 16px",
                                  background: "transparent",
                                  color: "var(--text)",
                                  border: "1px solid var(--border)",
                                  borderRadius: "var(--radius-sm)",
                                  cursor: "pointer",
                                  fontWeight: 600,
                                  fontSize: 13
                                }}
                              >
                                Ne, pokračovat bez přiřazení
                              </button>
                            </div>
                          </div>
                        )}

                        <div>
                          <label style={{ display: "block", fontSize: 13, color: "var(--muted)", marginBottom: 4 }}>
                            Jméno
                          </label>
                          <input
                            type="text"
                            value={demoNewOrderData.customerName}
                            onChange={(e) => setDemoNewOrderData(prev => ({ ...prev, customerName: e.target.value }))}
                            placeholder="Jméno zákazníka"
                            style={{
                              width: "100%",
                              padding: "10px",
                              border: "1px solid var(--border)",
                              borderRadius: "var(--radius-sm)",
                              background: "var(--bg)",
                              color: "var(--text)",
                              fontSize: 14
                            }}
                          />
                        </div>

                        <div>
                          <label style={{ display: "block", fontSize: 13, color: "var(--muted)", marginBottom: 4 }}>
                            E-mail
                          </label>
                          <input
                            type="email"
                            value={demoNewOrderData.customerEmail}
                            onChange={(e) => setDemoNewOrderData(prev => ({ ...prev, customerEmail: e.target.value }))}
                            placeholder="email@example.com"
                            style={{
                              width: "100%",
                              padding: "10px",
                              border: "1px solid var(--border)",
                              borderRadius: "var(--radius-sm)",
                              background: "var(--bg)",
                              color: "var(--text)",
                              fontSize: 14
                            }}
                          />
                        </div>
                      </div>
                    </div>

                    {/* Zařízení */}
                    <div>
                      <h3 style={{ fontSize: 16, fontWeight: 600, color: "var(--text)", margin: "0 0 12px 0" }}>
                        Zařízení
                      </h3>
                      <div>
                        <label style={{ display: "block", fontSize: 13, color: "var(--muted)", marginBottom: 4 }}>
                          Zařízení
                        </label>
                        <input
                          type="text"
                          value={demoNewOrderData.device}
                          onChange={(e) => setDemoNewOrderData(prev => ({ ...prev, device: e.target.value }))}
                          placeholder="Např. iPhone 13"
                          style={{
                            width: "100%",
                            padding: "10px",
                            border: "1px solid var(--border)",
                            borderRadius: "var(--radius-sm)",
                            background: "var(--bg)",
                            color: "var(--text)",
                            fontSize: 14
                          }}
                        />
                      </div>
                    </div>

                    {/* Problém */}
                    <div>
                      <h3 style={{ fontSize: 16, fontWeight: 600, color: "var(--text)", margin: "0 0 12px 0" }}>
                        Problém
                      </h3>
                      <textarea
                        value={demoNewOrderData.problem}
                        onChange={(e) => setDemoNewOrderData(prev => ({ ...prev, problem: e.target.value }))}
                        placeholder="Popište problém nebo požadovanou opravu..."
                        rows={4}
                        style={{
                          width: "100%",
                          padding: "10px",
                          border: "1px solid var(--border)",
                          borderRadius: "var(--radius-sm)",
                          background: "var(--bg)",
                          color: "var(--text)",
                          fontSize: 14,
                          fontFamily: "inherit",
                          resize: "vertical"
                        }}
                      />
                    </div>

                    {/* Akce */}
                    <div style={{ display: "flex", gap: 12, justifyContent: "flex-end", marginTop: 8 }}>
                      <button
                        onClick={() => setDemoNewOrderOpen(false)}
                        style={{
                          padding: "10px 20px",
                          background: "transparent",
                          color: "var(--text)",
                          border: "1px solid var(--border)",
                          borderRadius: "var(--radius-sm)",
                          cursor: "pointer",
                          fontWeight: 600,
                          fontSize: 14
                        }}
                      >
                        Zrušit
                      </button>
                      <button
                        onClick={handleDemoCreateTicket}
                        style={{
                          padding: "10px 20px",
                          background: "var(--accent)",
                          color: "white",
                          border: "none",
                          borderRadius: "var(--radius-sm)",
                          cursor: "pointer",
                          fontWeight: 600,
                          fontSize: 14
                        }}
                      >
                        Vytvořit zakázku
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Praktická ukázka 2: Seznam zakázek */}
            <div style={{
              background: "var(--bg)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-md)",
              padding: "24px"
            }}>
              <h3 style={{ fontSize: 20, fontWeight: 600, color: "var(--text)", margin: "0 0 16px 0" }}>
                📋 Praktická ukázka: Seznam zakázek
              </h3>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {mockTickets.map(ticket => {
                  const status = mockStatuses.find(s => s.key === ticket.status);
                  return (
                    <div
                      key={ticket.id}
                      onClick={() => setDemoSelectedTicket(demoSelectedTicket === ticket.id ? null : ticket.id)}
                      style={{
                        padding: "16px",
                        background: demoSelectedTicket === ticket.id ? "var(--accent-soft)" : "var(--bg)",
                        border: `2px solid ${status?.bg || "var(--border)"}`,
                        borderRadius: "var(--radius-md)",
                        cursor: "pointer",
                        transition: "all 0.2s"
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 16, fontWeight: 600, color: "var(--text)", marginBottom: 4 }}>
                            {ticket.customerName}
                          </div>
                          <div style={{ fontSize: 14, color: "var(--muted)", marginBottom: 4 }}>
                            {ticket.device} • {ticket.problem}
                          </div>
                          <div style={{
                            display: "inline-block",
                            padding: "4px 12px",
                            borderRadius: "var(--radius-sm)",
                            fontSize: 12,
                            fontWeight: 600,
                            background: status?.bg || "var(--bg)",
                            color: status?.fg || "var(--text)"
                          }}>
                            {status?.label || ticket.statusLabel}
                          </div>
                        </div>
                        <div style={{ fontSize: 20, marginLeft: 12 }}>
                          {demoSelectedTicket === ticket.id ? "▼" : "▶"}
                        </div>
                      </div>
                      {demoSelectedTicket === ticket.id && (
                        <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--border)" }}>
                          <div style={{ fontSize: 14, color: "var(--text)", lineHeight: 1.6 }}>
                            <div><strong>Zákazník:</strong> {ticket.customerName}</div>
                            <div><strong>Zařízení:</strong> {ticket.device}</div>
                            <div><strong>Problém:</strong> {ticket.problem}</div>
                            <div><strong>Status:</strong> {status?.label}</div>
                          </div>
                          <div style={{ marginTop: 12 }}>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                alert(`Demo: Úprava zakázky #${ticket.id}`);
                              }}
                              style={{
                                padding: "8px 16px",
                                background: "var(--accent)",
                                color: "white",
                                border: "none",
                                borderRadius: "var(--radius-sm)",
                                cursor: "pointer",
                                fontWeight: 600,
                                fontSize: 13
                              }}
                            >
                              ✏️ Upravit zakázku
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 12, fontStyle: "italic" }}>
                💡 Klikněte na zakázku pro zobrazení detailu
              </div>
            </div>
          </div>
        </section>

        {/* Zákazníci - Interaktivní sekce */}
        <section style={{
          background: "var(--panel)",
          backdropFilter: "var(--blur)",
          WebkitBackdropFilter: "var(--blur)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-lg)",
          padding: "32px",
          boxShadow: "var(--shadow-soft)"
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 24 }}>
            <div style={{ 
              width: 48, 
              height: 48, 
              borderRadius: "50%", 
              background: "var(--accent-soft)", 
              display: "flex", 
              alignItems: "center", 
              justifyContent: "center",
              fontSize: 24
            }}>
              👥
            </div>
            <h2 style={{ fontSize: 28, fontWeight: 700, color: "var(--text)", margin: 0 }}>
              Zákazníci (Customers)
            </h2>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
            {/* Praktická ukázka: Seznam zákazníků */}
            <div style={{
              background: "var(--bg)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-md)",
              padding: "24px"
            }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
                <h3 style={{ fontSize: 20, fontWeight: 600, color: "var(--text)", margin: 0 }}>
                  👥 Praktická ukázka: Seznam zákazníků
                </h3>
                <button
                  onClick={() => setDemoCustomerListOpen(!demoCustomerListOpen)}
                  style={{
                    padding: "10px 20px",
                    background: "var(--accent)",
                    color: "white",
                    border: "none",
                    borderRadius: "var(--radius-md)",
                    cursor: "pointer",
                    fontWeight: 600,
                    fontSize: 14
                  }}
                >
                  {demoCustomerListOpen ? "Skrýt" : "Zobrazit zákazníky"}
                </button>
              </div>
              
              {demoCustomerListOpen && (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {mockCustomers.map(customer => (
                    <div
                      key={customer.id}
                      onClick={() => setDemoSelectedCustomer(demoSelectedCustomer === customer.id ? null : customer.id)}
                      style={{
                        padding: "16px",
                        background: demoSelectedCustomer === customer.id ? "var(--accent-soft)" : "var(--bg)",
                        border: "1px solid var(--border)",
                        borderRadius: "var(--radius-md)",
                        cursor: "pointer",
                        transition: "all 0.2s"
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                        <div>
                          <div style={{ fontSize: 16, fontWeight: 600, color: "var(--text)", marginBottom: 4 }}>
                            {customer.name}
                          </div>
                          <div style={{ fontSize: 14, color: "var(--muted)" }}>
                            {customer.phone} {customer.email && `• ${customer.email}`}
                          </div>
                          {customer.company && (
                            <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 4 }}>
                              🏢 {customer.company}
                            </div>
                          )}
                        </div>
                        <div style={{ fontSize: 20 }}>
                          {demoSelectedCustomer === customer.id ? "▼" : "▶"}
                        </div>
                      </div>
                      {demoSelectedCustomer === customer.id && (
                        <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--border)" }}>
                          <div style={{ display: "flex", gap: 8 }}>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDemoEditCustomer(customer.id);
                              }}
                              style={{
                                padding: "8px 16px",
                                background: "var(--accent)",
                                color: "white",
                                border: "none",
                                borderRadius: "var(--radius-sm)",
                                cursor: "pointer",
                                fontWeight: 600,
                                fontSize: 13
                              }}
                            >
                              ✏️ Upravit
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                alert(`Demo: Vytvoření zakázky pro ${customer.name}`);
                              }}
                              style={{
                                padding: "8px 16px",
                                background: "var(--accent-soft)",
                                color: "var(--accent)",
                                border: "1px solid var(--accent)",
                                borderRadius: "var(--radius-sm)",
                                cursor: "pointer",
                                fontWeight: 600,
                                fontSize: 13
                              }}
                            >
                              ➕ Vytvořit zakázku
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Demo Modal - Úprava zákazníka */}
            {demoEditCustomerOpen && (
              <div style={{
                position: "fixed",
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                background: "rgba(0,0,0,0.5)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                zIndex: 1000,
                padding: "20px"
              }} onClick={() => setDemoEditCustomerOpen(false)}>
                <div style={{
                  background: "var(--panel)",
                  borderRadius: "var(--radius-lg)",
                  padding: "32px",
                  maxWidth: 500,
                  width: "100%",
                  border: "1px solid var(--border)",
                  boxShadow: "var(--shadow-lg)"
                }} onClick={(e) => e.stopPropagation()}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
                    <h2 style={{ fontSize: 24, fontWeight: 700, color: "var(--text)", margin: 0 }}>
                      ✏️ Úprava zákazníka (Demo)
                    </h2>
                    <button
                      onClick={() => setDemoEditCustomerOpen(false)}
                      style={{
                        background: "transparent",
                        border: "none",
                        fontSize: 24,
                        cursor: "pointer",
                        color: "var(--muted)",
                        padding: "4px 8px"
                      }}
                    >
                      ×
                    </button>
                  </div>

                  <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                    <div>
                      <label style={{ display: "block", fontSize: 13, color: "var(--muted)", marginBottom: 4 }}>
                        Jméno *
                      </label>
                      <input
                        type="text"
                        value={demoEditCustomerData.name}
                        onChange={(e) => setDemoEditCustomerData(prev => ({ ...prev, name: e.target.value }))}
                        style={{
                          width: "100%",
                          padding: "10px",
                          border: "1px solid var(--border)",
                          borderRadius: "var(--radius-sm)",
                          background: "var(--bg)",
                          color: "var(--text)",
                          fontSize: 14
                        }}
                      />
                    </div>

                    <div>
                      <label style={{ display: "block", fontSize: 13, color: "var(--muted)", marginBottom: 4 }}>
                        Telefon *
                      </label>
                      <input
                        type="text"
                        value={demoEditCustomerData.phone}
                        onChange={(e) => setDemoEditCustomerData(prev => ({ ...prev, phone: e.target.value }))}
                        style={{
                          width: "100%",
                          padding: "10px",
                          border: "1px solid var(--border)",
                          borderRadius: "var(--radius-sm)",
                          background: "var(--bg)",
                          color: "var(--text)",
                          fontSize: 14
                        }}
                      />
                    </div>

                    <div>
                      <label style={{ display: "block", fontSize: 13, color: "var(--muted)", marginBottom: 4 }}>
                        E-mail
                      </label>
                      <input
                        type="email"
                        value={demoEditCustomerData.email}
                        onChange={(e) => setDemoEditCustomerData(prev => ({ ...prev, email: e.target.value }))}
                        style={{
                          width: "100%",
                          padding: "10px",
                          border: "1px solid var(--border)",
                          borderRadius: "var(--radius-sm)",
                          background: "var(--bg)",
                          color: "var(--text)",
                          fontSize: 14
                        }}
                      />
                    </div>

                    <div>
                      <label style={{ display: "block", fontSize: 13, color: "var(--muted)", marginBottom: 4 }}>
                        Firma
                      </label>
                      <input
                        type="text"
                        value={demoEditCustomerData.company}
                        onChange={(e) => setDemoEditCustomerData(prev => ({ ...prev, company: e.target.value }))}
                        style={{
                          width: "100%",
                          padding: "10px",
                          border: "1px solid var(--border)",
                          borderRadius: "var(--radius-sm)",
                          background: "var(--bg)",
                          color: "var(--text)",
                          fontSize: 14
                        }}
                      />
                    </div>

                    <div style={{ display: "flex", gap: 12, justifyContent: "flex-end", marginTop: 8 }}>
                      <button
                        onClick={() => setDemoEditCustomerOpen(false)}
                        style={{
                          padding: "10px 20px",
                          background: "transparent",
                          color: "var(--text)",
                          border: "1px solid var(--border)",
                          borderRadius: "var(--radius-sm)",
                          cursor: "pointer",
                          fontWeight: 600,
                          fontSize: 14
                        }}
                      >
                        Zrušit
                      </button>
                      <button
                        onClick={handleDemoSaveCustomer}
                        style={{
                          padding: "10px 20px",
                          background: "var(--accent)",
                          color: "white",
                          border: "none",
                          borderRadius: "var(--radius-sm)",
                          cursor: "pointer",
                          fontWeight: 600,
                          fontSize: 14
                        }}
                      >
                        Uložit
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </section>

        {/* Nastavení - Interaktivní sekce */}
        <section style={{
          background: "var(--panel)",
          backdropFilter: "var(--blur)",
          WebkitBackdropFilter: "var(--blur)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-lg)",
          padding: "32px",
          boxShadow: "var(--shadow-soft)"
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 24 }}>
            <div style={{ 
              width: 48, 
              height: 48, 
              borderRadius: "50%", 
              background: "var(--accent-soft)", 
              display: "flex", 
              alignItems: "center", 
              justifyContent: "center",
              fontSize: 24
            }}>
              ⚙️
            </div>
            <h2 style={{ fontSize: 28, fontWeight: 700, color: "var(--text)", margin: 0 }}>
              Nastavení (Settings)
            </h2>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 20 }}>
            <div style={{
              background: "var(--bg)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-md)",
              padding: "20px"
            }}>
              <h3 style={{ fontSize: 18, fontWeight: 600, color: "var(--text)", margin: "0 0 12px 0" }}>
                🎨 Správa statusů
              </h3>
              <p style={{ fontSize: 13, color: "var(--text)", lineHeight: 1.6, margin: "0 0 16px 0" }}>
                Vytvářejte, upravujte a mazejte statusy zakázek. Každý status má svou barvu z palety 75 barev.
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
                {mockStatuses.map(status => (
                  <div
                    key={status.key}
                    style={{
                      padding: "8px 12px",
                      borderRadius: "var(--radius-sm)",
                      background: status.bg,
                      color: status.fg,
                      fontSize: 13,
                      fontWeight: 600,
                      textAlign: "center"
                    }}
                  >
                    {status.label}
                  </div>
                ))}
              </div>
              <button
                onClick={() => onNavigate("settings")}
                style={{
                  width: "100%",
                  padding: "10px",
                  background: "var(--accent)",
                  color: "white",
                  border: "none",
                  borderRadius: "var(--radius-sm)",
                  cursor: "pointer",
                  fontWeight: 600,
                  fontSize: 13
                }}
              >
                Spravovat statusy →
              </button>
            </div>

            <div style={{
              background: "var(--bg)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-md)",
              padding: "20px"
            }}>
              <h3 style={{ fontSize: 18, fontWeight: 600, color: "var(--text)", margin: "0 0 12px 0" }}>
                👥 Správa týmu
              </h3>
              <p style={{ fontSize: 13, color: "var(--text)", lineHeight: 1.6, margin: "0 0 16px 0" }}>
                Vytvářejte pozvánky pro nové členy, měňte role a spravujte přístupy k servisu.
              </p>
              <button
                onClick={() => onNavigate("settings")}
                style={{
                  width: "100%",
                  padding: "10px",
                  background: "var(--accent)",
                  color: "white",
                  border: "none",
                  borderRadius: "var(--radius-sm)",
                  cursor: "pointer",
                  fontWeight: 600,
                  fontSize: 13
                }}
              >
                Spravovat tým →
              </button>
            </div>
          </div>
        </section>

        {/* Tipy a triky */}
        <section style={{
          background: "var(--panel)",
          backdropFilter: "var(--blur)",
          WebkitBackdropFilter: "var(--blur)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-lg)",
          padding: "32px",
          boxShadow: "var(--shadow-soft)"
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 24 }}>
            <div style={{ 
              width: 48, 
              height: 48, 
              borderRadius: "50%", 
              background: "var(--accent-soft)", 
              display: "flex", 
              alignItems: "center", 
              justifyContent: "center",
              fontSize: 24
            }}>
              💡
            </div>
            <h2 style={{ fontSize: 28, fontWeight: 700, color: "var(--text)", margin: 0 }}>
              Tipy a triky
            </h2>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))", gap: 20 }}>
            <div style={{
              background: "var(--bg)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-md)",
              padding: "20px"
            }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>🔗</div>
              <h3 style={{ fontSize: 16, fontWeight: 600, color: "var(--text)", margin: "0 0 8px 0" }}>
                Automatické přiřazení
              </h3>
              <p style={{ fontSize: 13, color: "var(--text)", lineHeight: 1.6, margin: 0 }}>
                Při zadání telefonu existujícího zákazníka v nové zakázce vám aplikace automaticky nabídne přiřazení.
              </p>
            </div>

            <div style={{
              background: "var(--bg)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-md)",
              padding: "20px"
            }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>💾</div>
              <h3 style={{ fontSize: 16, fontWeight: 600, color: "var(--text)", margin: "0 0 8px 0" }}>
                Zapamatování přihlášení
              </h3>
              <p style={{ fontSize: 13, color: "var(--text)", lineHeight: 1.6, margin: 0 }}>
                Zaškrtněte "Zapamatovat přihlášení" při přihlášení. Vaše přihlášení zůstane aktivní i po zavření aplikace.
              </p>
            </div>

            <div style={{
              background: "var(--bg)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-md)",
              padding: "20px"
            }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>⌨️</div>
              <h3 style={{ fontSize: 16, fontWeight: 600, color: "var(--text)", margin: "0 0 8px 0" }}>
                Rychlé klávesy
              </h3>
              <p style={{ fontSize: 13, color: "var(--text)", lineHeight: 1.6, margin: 0 }}>
                Použijte <strong>ESC</strong> pro zavření detailu nebo modalu. V modálech také funguje zavření kliknutím na pozadí.
              </p>
            </div>

            <div style={{
              background: "var(--bg)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-md)",
              padding: "20px"
            }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>🔄</div>
              <h3 style={{ fontSize: 16, fontWeight: 600, color: "var(--text)", margin: "0 0 8px 0" }}>
                Změna zákazníka
              </h3>
              <p style={{ fontSize: 13, color: "var(--text)", lineHeight: 1.6, margin: 0 }}>
                Při úpravě zakázky můžete změnit zákazníka zadáním nového telefonu. Aplikace vám nabídne přiřazení existujícího zákazníka.
              </p>
            </div>
          </div>
        </section>

        {/* Call to Action */}
        <div style={{
          textAlign: "center",
          padding: "40px",
          background: "linear-gradient(135deg, var(--accent-soft) 0%, transparent 100%)",
          borderRadius: "var(--radius-lg)",
          border: "1px solid var(--border)"
        }}>
          <h2 style={{ fontSize: 24, fontWeight: 700, color: "var(--text)", margin: "0 0 16px 0" }}>
            🚀 Jste připraveni začít?
          </h2>
          <p style={{ fontSize: 16, color: "var(--muted)", margin: "0 0 24px 0" }}>
            Všechny funkce jsou nyní k dispozici v reálné aplikaci
          </p>
          <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
            <button
              onClick={() => onNavigate("orders")}
              style={{
                padding: "14px 28px",
                background: "var(--accent)",
                color: "white",
                border: "none",
                borderRadius: "var(--radius-md)",
                cursor: "pointer",
                fontWeight: 600,
                fontSize: 15,
                transition: "all 0.2s"
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.opacity = "0.9";
                e.currentTarget.style.transform = "scale(1.05)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.opacity = "1";
                e.currentTarget.style.transform = "scale(1)";
              }}
            >
              📋 Přejít na Zakázky
            </button>
            <button
              onClick={() => onNavigate("customers")}
              style={{
                padding: "14px 28px",
                background: "var(--accent)",
                color: "white",
                border: "none",
                borderRadius: "var(--radius-md)",
                cursor: "pointer",
                fontWeight: 600,
                fontSize: 15,
                transition: "all 0.2s"
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.opacity = "0.9";
                e.currentTarget.style.transform = "scale(1.05)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.opacity = "1";
                e.currentTarget.style.transform = "scale(1)";
              }}
            >
              👥 Přejít na Zákazníky
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
