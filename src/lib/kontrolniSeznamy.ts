/**
 * Kontrola po opravě: co technik prověří, než zařízení vrátí.
 *
 * Šablony jsou na servis (service_settings.config.kontrolniSeznamy) a vybírají
 * se podle názvu zařízení – „iPhone 13“ padne na telefon, „Lenovo notebook“
 * na počítač. Výsledek kontroly se ukládá k zakázce (tickets.test_checklist)
 * a jde do protokolu, aby zákazník viděl, co bylo ověřeno.
 */
export type SablonaKontroly = {
  id: string;
  nazev: string;
  /** Slova v názvu zařízení, podle kterých se šablona nabídne (bez ohledu na velikost písmen). Prázdné = obecná. */
  klicovaSlova: string[];
  polozky: string[];
};

export type StavPolozky = "ok" | "chyba" | "neoverovano";

export type PolozkaKontroly = {
  text: string;
  stav: StavPolozky | null;
  poznamka?: string;
};

export type KontrolaPoOpraveData = {
  sablonaId: string;
  sablonaNazev: string;
  polozky: PolozkaKontroly[];
  /** ISO čas poslední změny. */
  upraveno: string;
};

export const VYCHOZI_SABLONY: SablonaKontroly[] = [
  {
    id: "telefon",
    nazev: "Telefon a tablet",
    klicovaSlova: ["iphone", "ipad", "samsung", "xiaomi", "huawei", "pixel", "telefon", "mobil", "tablet", "galaxy", "redmi", "honor", "oneplus", "motorola", "nokia"],
    polozky: [
      "Displej a dotyk po celé ploše",
      "Přední i zadní kamera, blesk",
      "Mikrofon, reproduktor a sluchátko",
      "Nabíjení a přenos dat konektorem",
      "Tlačítka a vibrace",
      "Wi-Fi, Bluetooth a mobilní síť",
      "Face ID / Touch ID",
      "Šrouby, těsnění a lícování krytu",
    ],
  },
  {
    id: "pocitac",
    nazev: "Notebook a počítač",
    klicovaSlova: ["notebook", "laptop", "macbook", "lenovo", "thinkpad", "dell", "hp", "asus", "acer", "pc", "počítač", "imac", "mac mini"],
    polozky: [
      "Start systému a přihlášení",
      "Klávesnice a touchpad",
      "Displej bez vad, jas a barvy",
      "Porty USB, HDMI, čtečka",
      "Wi-Fi a Bluetooth",
      "Baterie a nabíjení",
      "Zvuk a mikrofon, kamera",
      "Teploty a ventilátor pod zátěží",
    ],
  },
  {
    id: "obecne",
    nazev: "Obecná kontrola",
    klicovaSlova: [],
    polozky: [
      "Závada z příjmu odstraněna",
      "Základní funkce zařízení",
      "Vizuální kontrola, čištění",
      "Příslušenství vráceno se zařízením",
    ],
  },
];

/** Šablony z nastavení servisu; špatný nebo prázdný tvar znamená výchozí. */
export function normalizujSablony(raw: unknown): SablonaKontroly[] {
  if (!Array.isArray(raw)) return VYCHOZI_SABLONY;
  const vysledek: SablonaKontroly[] = [];
  for (const s of raw as Array<Partial<SablonaKontroly>>) {
    if (!s || typeof s !== "object") continue;
    const nazev = typeof s.nazev === "string" ? s.nazev.trim() : "";
    const polozky = Array.isArray(s.polozky) ? s.polozky.filter((p): p is string => typeof p === "string" && p.trim() !== "").map((p) => p.trim()) : [];
    if (!nazev || polozky.length === 0) continue;
    vysledek.push({
      id: typeof s.id === "string" && s.id ? s.id : `s_${vysledek.length}`,
      nazev,
      klicovaSlova: Array.isArray(s.klicovaSlova) ? s.klicovaSlova.filter((k): k is string => typeof k === "string").map((k) => k.trim().toLowerCase()).filter(Boolean) : [],
      polozky,
    });
  }
  return vysledek.length > 0 ? vysledek : VYCHOZI_SABLONY;
}

/**
 * Šablona pro zařízení podle názvu. Vyhraje první, jejíž klíčové slovo je v
 * názvu; jinak obecná (bez klíčových slov), jinak první v pořadí.
 */
export function vyberSablonu(sablony: SablonaKontroly[], nazevZarizeni?: string | null): SablonaKontroly | undefined {
  if (sablony.length === 0) return undefined;
  const nazev = (nazevZarizeni ?? "").toLowerCase();
  if (nazev) {
    const podleSlova = sablony.find((s) => s.klicovaSlova.some((k) => k && nazev.includes(k)));
    if (podleSlova) return podleSlova;
  }
  return sablony.find((s) => s.klicovaSlova.length === 0) ?? sablony[0];
}

export function zalozKontrolu(sablona: SablonaKontroly): KontrolaPoOpraveData {
  return {
    sablonaId: sablona.id,
    sablonaNazev: sablona.nazev,
    polozky: sablona.polozky.map((text) => ({ text, stav: null })),
    upraveno: new Date().toISOString(),
  };
}

export function shrnutiKontroly(kontrola: KontrolaPoOpraveData | null | undefined): { hotovo: number; celkem: number; chyb: number; dokonceno: boolean } {
  const polozky = kontrola?.polozky ?? [];
  const hotovo = polozky.filter((p) => p.stav !== null).length;
  const chyb = polozky.filter((p) => p.stav === "chyba").length;
  return { hotovo, celkem: polozky.length, chyb, dokonceno: polozky.length > 0 && hotovo === polozky.length };
}
