import { useState, useEffect, useRef } from "react";
import { useAuth } from "../auth/AuthProvider";
import { getPendingInviteToken, setPendingInviteToken, clearPendingInviteToken } from "../lib/pendingInvite";
import { supabase } from "../lib/supabaseClient";
import { AppLogo } from "./AppLogo";
import { getLogoColors } from "../lib/logoPresets";

export function Login({ onLogin: _onLogin }: { onLogin: () => void }) {
  const { signIn, signUp, configError } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [inviteToken, setInviteToken] = useState("");
  const [isSignUp, setIsSignUp] = useState(false);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [prefillLoading, setPrefillLoading] = useState(false);
  const [prefillError, setPrefillError] = useState("");
  const [rememberMe, setRememberMe] = useState(true);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Check for pending invite token
  useEffect(() => {
    const pending = getPendingInviteToken();
    if (pending) {
      setInviteToken(pending);
      setIsSignUp(true); // Auto-switch to signup if invite token exists
    }
  }, []);

  // Animated background
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    let animationFrameId: number;
    let time = 0;

    const particles: Array<{
      x: number;
      y: number;
      vx: number;
      vy: number;
      size: number;
      hue: number;
    }> = [];

    // Create particles
    for (let i = 0; i < 50; i++) {
      particles.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        vx: (Math.random() - 0.5) * 0.5,
        vy: (Math.random() - 0.5) * 0.5,
        size: Math.random() * 3 + 1,
        hue: 260 + Math.random() * 40, // Purple range
      });
    }

    const animate = () => {
      time += 0.01;
      ctx.fillStyle = "rgba(15, 23, 42, 0.1)";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      particles.forEach((particle) => {
        particle.x += particle.vx + Math.sin(time + particle.x * 0.01) * 0.5;
        particle.y += particle.vy + Math.cos(time + particle.y * 0.01) * 0.5;

        if (particle.x < 0 || particle.x > canvas.width) particle.vx *= -1;
        if (particle.y < 0 || particle.y > canvas.height) particle.vy *= -1;

        const gradient = ctx.createRadialGradient(particle.x, particle.y, 0, particle.x, particle.y, particle.size * 20);
        gradient.addColorStop(0, `hsla(${particle.hue}, 70%, 60%, 0.6)`);
        gradient.addColorStop(1, `hsla(${particle.hue}, 70%, 60%, 0)`);

        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(particle.x, particle.y, particle.size * 20, 0, Math.PI * 2);
        ctx.fill();
      });

      animationFrameId = requestAnimationFrame(animate);
    };

    animate();

    const handleResize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };

    window.addEventListener("resize", handleResize);

    return () => {
      cancelAnimationFrame(animationFrameId);
      window.removeEventListener("resize", handleResize);
    };
  }, []);

  const fetchInvitePrefill = async () => {
    const token = inviteToken.trim();
    if (!token || !supabase) return;
    setPrefillError("");
    setPrefillLoading(true);
    try {
      const { data, error: fnError } = await supabase.functions.invoke("invite-info", { body: { token } });
      if (fnError) throw fnError;
      if (data?.error) throw new Error(data.error);
      if (data?.email) setEmail(data.email);
    } catch (err: any) {
      setPrefillError(err?.message || "Nepodařilo načíst pozvánku");
    } finally {
      setPrefillLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setIsLoading(true);

    try {
      if (isSignUp) {
        if (!inviteToken || !inviteToken.trim()) {
          setError("Kód z pozvánky je povinný.");
          setIsLoading(false);
          return;
        }
        if (password !== confirmPassword) {
          setError("Hesla se neshodují.");
          setIsLoading(false);
          return;
        }
        if (password.length < 6) {
          setError("Heslo musí mít alespoň 6 znaků.");
          setIsLoading(false);
          return;
        }
        setPendingInviteToken(inviteToken.trim());
        await signUp(email, password);
        setError("Registrace úspěšná! Zkontrolujte svůj email pro potvrzení.");
        setIsLoading(false);
      } else {
        await signIn(email, password);
        // Store remember me preference
        if (rememberMe) {
          localStorage.setItem("jobsheet_remember_me", "true");
          localStorage.setItem("jobsheet_last_email", email);
        } else {
          localStorage.removeItem("jobsheet_remember_me");
          localStorage.removeItem("jobsheet_last_email");
        }
      }
    } catch (err: any) {
      setError(err?.message || "Neočekávaná chyba při přihlašování");
      setIsLoading(false);
    }
  };

  // Load remembered email
  useEffect(() => {
    if (!isSignUp && localStorage.getItem("jobsheet_remember_me") === "true") {
      const lastEmail = localStorage.getItem("jobsheet_last_email");
      if (lastEmail) {
        setEmail(lastEmail);
        setRememberMe(true);
      }
    }
  }, [isSignUp]);

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: "linear-gradient(135deg, #1e1b4b 0%, #312e81 25%, #4c1d95 50%, #6d28d9 75%, #8b5cf6 100%)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        zIndex: 99999,
        overflow: "hidden",
      }}
    >
      {/* Animated background canvas */}
      <canvas
        ref={canvasRef}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "100%",
          height: "100%",
          pointerEvents: "none",
        }}
      />

      {/* Animated gradient overlay */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: `
            radial-gradient(circle at 20% 50%, rgba(139, 92, 246, 0.3) 0%, transparent 50%),
            radial-gradient(circle at 80% 80%, rgba(109, 40, 217, 0.3) 0%, transparent 50%),
            radial-gradient(circle at 40% 20%, rgba(76, 29, 149, 0.2) 0%, transparent 50%)
          `,
          animation: "pulse 8s ease-in-out infinite",
        }}
      />

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.8; transform: scale(1.1); }
        }
      `}</style>

      <div
        style={{
          width: "100%",
          maxWidth: 440,
          background: "rgba(255, 255, 255, 0.95)",
          backdropFilter: "blur(20px)",
          WebkitBackdropFilter: "blur(20px)",
          borderRadius: 28,
          padding: "48px 40px",
          boxShadow: "0 25px 80px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(255, 255, 255, 0.1)",
          border: "1px solid rgba(255, 255, 255, 0.2)",
          position: "relative",
          zIndex: 1,
        }}
      >
        <div style={{ textAlign: "center", marginBottom: 36 }}>
          <div style={{ margin: "0 auto 20px", display: "flex", justifyContent: "center" }}>
            <AppLogo
              size={72}
              colors={getLogoColors("dark", "purple")}
              modern
            />
          </div>
          <h1
            style={{
              fontSize: 36,
              fontWeight: 800,
              color: "#1e1b4b",
              margin: 0,
              marginBottom: 8,
              letterSpacing: "-0.02em",
            }}
          >
            jobi
          </h1>
          <p style={{ fontSize: 15, color: "#64748b", margin: 0, fontWeight: 500 }}>
            {isSignUp ? "Vytvořte si nový účet" : "Přihlaste se do systému"}
          </p>
        </div>

        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          {configError && (
            <div
              style={{
                padding: "14px 18px",
                borderRadius: 12,
                background: "rgba(239, 68, 68, 0.1)",
                border: "1px solid rgba(239, 68, 68, 0.3)",
                color: "#dc2626",
                fontSize: 13,
                fontWeight: 500,
              }}
            >
              {configError}
            </div>
          )}

          {isSignUp && (
            <>
              <div>
                <label
                  style={{
                    display: "block",
                    fontSize: 13,
                    fontWeight: 600,
                    color: "#1e293b",
                    marginBottom: 8,
                  }}
                >
                  Kód z pozvánky
                </label>
                <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                  <input
                    type="text"
                    value={inviteToken}
                    onChange={(e) => {
                      const newToken = e.target.value;
                      setInviteToken(newToken);
                      setPrefillError("");
                      if (newToken.trim()) {
                        setPendingInviteToken(newToken.trim());
                      } else {
                        clearPendingInviteToken();
                      }
                    }}
                    placeholder="Zadej kód z e-mailu"
                    required
                    style={{
                      flex: 1,
                      padding: "16px 18px",
                      borderRadius: 12,
                      border: error && !inviteToken.trim() ? "2px solid #ef4444" : "1px solid #e2e8f0",
                      background: "#ffffff",
                      color: "#1e293b",
                      fontSize: 15,
                      fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif",
                      outline: "none",
                      transition: "all 0.2s ease",
                      boxShadow: error && !inviteToken.trim() ? "0 0 0 3px rgba(239, 68, 68, 0.1)" : "none",
                    }}
                    onFocus={(e) => {
                      e.currentTarget.style.borderColor = "#8b5cf6";
                      e.currentTarget.style.boxShadow = "0 0 0 3px rgba(139, 92, 246, 0.1)";
                    }}
                    onBlur={(e) => {
                      e.currentTarget.style.borderColor = "#e2e8f0";
                      e.currentTarget.style.boxShadow = "none";
                    }}
                  />
                  <button
                    type="button"
                    onClick={fetchInvitePrefill}
                    disabled={!inviteToken.trim() || prefillLoading}
                    style={{
                      padding: "16px 18px",
                      borderRadius: 12,
                      border: "1px solid #8b5cf6",
                      background: prefillLoading ? "#e2e8f0" : "#8b5cf6",
                      color: "#fff",
                      fontWeight: 600,
                      fontSize: 14,
                      cursor: prefillLoading ? "not-allowed" : "pointer",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {prefillLoading ? "…" : "Načíst pozvánku"}
                  </button>
                </div>
                {prefillError && (
                  <div style={{ marginTop: 6, fontSize: 12, color: "#dc2626" }}>{prefillError}</div>
                )}
              </div>
              <div>
                <label
                  style={{
                    display: "block",
                    fontSize: 13,
                    fontWeight: 600,
                    color: "#1e293b",
                    marginBottom: 8,
                  }}
                >
                  Email (doplněn z pozvánky)
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="vas@email.cz"
                  required
                  style={{
                    width: "100%",
                    padding: "16px 18px",
                    borderRadius: 12,
                    border: error ? "2px solid #ef4444" : "1px solid #e2e8f0",
                    background: "#ffffff",
                    color: "#1e293b",
                    fontSize: 15,
                    fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif",
                    outline: "none",
                    transition: "all 0.2s ease",
                    boxShadow: error ? "0 0 0 3px rgba(239, 68, 68, 0.1)" : "none",
                  }}
                  onFocus={(e) => {
                    e.currentTarget.style.borderColor = "#8b5cf6";
                    e.currentTarget.style.boxShadow = "0 0 0 3px rgba(139, 92, 246, 0.1)";
                  }}
                  onBlur={(e) => {
                    e.currentTarget.style.borderColor = error ? "#ef4444" : "#e2e8f0";
                    e.currentTarget.style.boxShadow = error ? "0 0 0 3px rgba(239, 68, 68, 0.1)" : "none";
                  }}
                />
              </div>
            </>
          )}

          {!isSignUp && (
            <div>
              <label
                style={{
                  display: "block",
                  fontSize: 13,
                  fontWeight: 600,
                  color: "#1e293b",
                  marginBottom: 8,
                }}
              >
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="vas@email.cz"
                autoFocus
                required
                style={{
                  width: "100%",
                  padding: "16px 18px",
                  borderRadius: 12,
                  border: error ? "2px solid #ef4444" : "1px solid #e2e8f0",
                  background: "#ffffff",
                  color: "#1e293b",
                  fontSize: 15,
                  fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif",
                  outline: "none",
                  transition: "all 0.2s ease",
                  boxShadow: error ? "0 0 0 3px rgba(239, 68, 68, 0.1)" : "none",
                }}
                onFocus={(e) => {
                  e.currentTarget.style.borderColor = "#8b5cf6";
                  e.currentTarget.style.boxShadow = "0 0 0 3px rgba(139, 92, 246, 0.1)";
                }}
                onBlur={(e) => {
                  e.currentTarget.style.borderColor = error ? "#ef4444" : "#e2e8f0";
                  e.currentTarget.style.boxShadow = error ? "0 0 0 3px rgba(239, 68, 68, 0.1)" : "none";
                }}
              />
            </div>
          )}

          <div>
            <label
              style={{
                display: "block",
                fontSize: 13,
                fontWeight: 600,
                color: "#1e293b",
                marginBottom: 8,
              }}
            >
              Heslo
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={isSignUp ? "Alespoň 6 znaků" : "••••••••"}
              required
              style={{
                width: "100%",
                padding: "16px 18px",
                borderRadius: 12,
                border: error ? "2px solid #ef4444" : "1px solid #e2e8f0",
                background: "#ffffff",
                color: "#1e293b",
                fontSize: 15,
                fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif",
                outline: "none",
                transition: "all 0.2s ease",
                boxShadow: error ? "0 0 0 3px rgba(239, 68, 68, 0.1)" : "none",
              }}
              onFocus={(e) => {
                e.currentTarget.style.borderColor = "#8b5cf6";
                e.currentTarget.style.boxShadow = "0 0 0 3px rgba(139, 92, 246, 0.1)";
              }}
              onBlur={(e) => {
                e.currentTarget.style.borderColor = error ? "#ef4444" : "#e2e8f0";
                e.currentTarget.style.boxShadow = error ? "0 0 0 3px rgba(239, 68, 68, 0.1)" : "none";
              }}
            />
          </div>

          {isSignUp && (
            <div>
              <label
                style={{
                  display: "block",
                  fontSize: 13,
                  fontWeight: 600,
                  color: "#1e293b",
                  marginBottom: 8,
                }}
              >
                Heslo znovu
              </label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="••••••••"
                required
                style={{
                  width: "100%",
                  padding: "16px 18px",
                  borderRadius: 12,
                  border: error && password !== confirmPassword ? "2px solid #ef4444" : "1px solid #e2e8f0",
                  background: "#ffffff",
                  color: "#1e293b",
                  fontSize: 15,
                  fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif",
                  outline: "none",
                  transition: "all 0.2s ease",
                  boxShadow: error && password !== confirmPassword ? "0 0 0 3px rgba(239, 68, 68, 0.1)" : "none",
                }}
                onFocus={(e) => {
                  e.currentTarget.style.borderColor = "#8b5cf6";
                  e.currentTarget.style.boxShadow = "0 0 0 3px rgba(139, 92, 246, 0.1)";
                }}
                onBlur={(e) => {
                  e.currentTarget.style.borderColor = error && password !== confirmPassword ? "#ef4444" : "#e2e8f0";
                  e.currentTarget.style.boxShadow = error && password !== confirmPassword ? "0 0 0 3px rgba(239, 68, 68, 0.1)" : "none";
                }}
              />
            </div>
          )}

          {!isSignUp && (
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input
                type="checkbox"
                id="rememberMe"
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
                style={{
                  width: 18,
                  height: 18,
                  cursor: "pointer",
                  accentColor: "#8b5cf6",
                }}
              />
              <label
                htmlFor="rememberMe"
                style={{
                  fontSize: 14,
                  color: "#475569",
                  cursor: "pointer",
                  userSelect: "none",
                  fontWeight: 500,
                }}
              >
                Zapamatovat přihlášení
              </label>
            </div>
          )}

          {error && (
            <div
              style={{
                padding: "14px 18px",
                borderRadius: 12,
                background: "rgba(239, 68, 68, 0.1)",
                border: "1px solid rgba(239, 68, 68, 0.3)",
                color: "#dc2626",
                fontSize: 13,
                display: "flex",
                alignItems: "center",
                gap: 10,
                fontWeight: 500,
              }}
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              {error}
            </div>
          )}

          {/* Only show Sign In button when NOT in signup mode */}
          {!isSignUp && (
            <button
              type="submit"
              disabled={isLoading}
              style={{
                width: "100%",
                padding: "18px",
                borderRadius: 12,
                border: "none",
                background: isLoading
                  ? "#cbd5e1"
                  : "linear-gradient(135deg, #8b5cf6 0%, #6d28d9 100%)",
                color: "white",
                fontSize: 16,
                fontWeight: 700,
                cursor: isLoading ? "not-allowed" : "pointer",
                fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif",
                boxShadow: isLoading ? "none" : "0 8px 24px rgba(139, 92, 246, 0.4)",
                transition: "all 0.2s ease",
                opacity: isLoading ? 0.7 : 1,
                marginTop: 8,
              }}
              onMouseEnter={(e) => {
                if (!isLoading) {
                  e.currentTarget.style.transform = "translateY(-2px)";
                  e.currentTarget.style.boxShadow = "0 12px 32px rgba(139, 92, 246, 0.5)";
                }
              }}
              onMouseLeave={(e) => {
                if (!isLoading) {
                  e.currentTarget.style.transform = "translateY(0)";
                  e.currentTarget.style.boxShadow = "0 8px 24px rgba(139, 92, 246, 0.4)";
                }
              }}
            >
              {isLoading ? "Přihlašování..." : "Přihlásit se"}
            </button>
          )}

          {/* Show Sign Up button only in signup mode */}
          {isSignUp && (
            <button
              type="submit"
              disabled={isLoading}
              style={{
                width: "100%",
                padding: "18px",
                borderRadius: 12,
                border: "none",
                background: isLoading
                  ? "#cbd5e1"
                  : "linear-gradient(135deg, #8b5cf6 0%, #6d28d9 100%)",
                color: "white",
                fontSize: 16,
                fontWeight: 700,
                cursor: isLoading ? "not-allowed" : "pointer",
                fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif",
                boxShadow: isLoading ? "none" : "0 8px 24px rgba(139, 92, 246, 0.4)",
                transition: "all 0.2s ease",
                opacity: isLoading ? 0.7 : 1,
                marginTop: 8,
              }}
              onMouseEnter={(e) => {
                if (!isLoading) {
                  e.currentTarget.style.transform = "translateY(-2px)";
                  e.currentTarget.style.boxShadow = "0 12px 32px rgba(139, 92, 246, 0.5)";
                }
              }}
              onMouseLeave={(e) => {
                if (!isLoading) {
                  e.currentTarget.style.transform = "translateY(0)";
                  e.currentTarget.style.boxShadow = "0 8px 24px rgba(139, 92, 246, 0.4)";
                }
              }}
            >
              {isLoading ? "Registrace..." : "Registrovat se"}
            </button>
          )}
        </form>

        <div style={{ marginTop: 28, textAlign: "center", paddingTop: 24, borderTop: "1px solid #e2e8f0" }}>
          <button
            type="button"
            onClick={() => {
              setIsSignUp(!isSignUp);
              setError("");
              setPrefillError("");
              if (!isSignUp) setConfirmPassword("");
            }}
            style={{
              background: "none",
              border: "none",
              color: "#8b5cf6",
              fontSize: 14,
              cursor: "pointer",
              fontWeight: 600,
              fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif",
              transition: "all 0.2s ease",
              padding: "8px 12px",
              borderRadius: 8,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.opacity = "0.8";
              e.currentTarget.style.background = "rgba(139, 92, 246, 0.1)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.opacity = "1";
              e.currentTarget.style.background = "transparent";
            }}
          >
            {isSignUp ? "Mám už účet" : "Mám kód z pozvánky"}
          </button>
        </div>
        {isSignUp && (
          <p style={{ marginTop: 12, fontSize: 13, color: "var(--muted)", textAlign: "center", maxWidth: 320 }}>
            Už máš účet? Zadej kód z pozvánky, přepni na „Mám už účet“ a přihlas se – přidáš se do servisu bez nové registrace.
          </p>
        )}
      </div>
    </div>
  );
}

// Helper functions for App.tsx
// Note: These are legacy functions. App.tsx should use AuthProvider instead.
export function isAuthenticated(): boolean {
  if (!supabase) return false;
  // Check if there's a session in localStorage (Supabase stores it there)
  try {
    // Supabase stores session in localStorage with key pattern: sb-<project-ref>-auth-token
    // We check for any key that contains 'auth-token' and 'supabase'
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && (key.includes('supabase.auth.token') || (key.includes('auth-token') && key.includes('sb-')))) {
        const stored = localStorage.getItem(key);
        if (stored) {
          try {
            const parsed = JSON.parse(stored);
            // Check if it has access_token and it's not expired
            if (parsed?.access_token) {
              // Basic check - if expires_at exists and is in the past, return false
              if (parsed?.expires_at) {
                const expiresAt = new Date(parsed.expires_at * 1000);
                if (expiresAt > new Date()) {
                  return true;
                }
              } else {
                return true;
              }
            }
          } catch {
            // Continue checking other keys
          }
        }
      }
    }
    return false;
  } catch {
    return false;
  }
}

// Note: setAuthenticated is a no-op - authentication state is managed by Supabase
// This function exists for compatibility with App.tsx
export function setAuthenticated(_value: boolean): void {
  // Authentication state is managed by Supabase auth, not by this function
  // App.tsx should use session from useAuth hook instead
}
