import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { AuthProvider } from "./auth/AuthProvider";
import { AppUpdateProvider } from "./context/AppUpdateContext";

import "./styles/theme.css";
import { ErrorBoundary } from "./components/ErrorBoundary";

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
