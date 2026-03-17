import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.jobsheet.online",
  appName: "Jobi",
  webDir: "dist",
  server: {
    // Pro development: odkomentovat a spustit npm run dev v rodiči
    // url: "http://localhost:1421",
    // cleartext: true,
  },
};

export default config;
