import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { AuthProvider } from "./auth/AuthProvider";
import { AppUpdateProvider } from "./context/AppUpdateContext";

import "./styles/theme.css";
import "./styles/ui.css";
import "./styles/mobile.css";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { zapniObnovuPoChybeModulu } from "./lib/aktualizaceWebu";
import { oznacProstredi } from "./lib/prostredi";

// Stará záložka po vydání nové verze webu: chybějící modul = jedno obnovení.
zapniObnovuPoChybeModulu();
// Proti stagingu (npm run dev:staging…) štítek STAGING, ať se nesplete s produkcí.
oznacProstredi();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <AuthProvider>
        <AppUpdateProvider>
          <App />
        </AppUpdateProvider>
      </AuthProvider>
    </ErrorBoundary>
  </React.StrictMode>
);
