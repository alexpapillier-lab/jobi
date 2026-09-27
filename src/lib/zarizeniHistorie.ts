/**
 * Historie zařízení podle sériového čísla / IMEI a kontrola IMEI.
 *
 * Servis chce při příjmu vědět, že tenhle telefon už tu byl (reklamace,
 * opakovaná závada, „minule jsme měnili displej“). IMEI se navíc dá ověřit
 * kontrolní číslicí (Luhn), takže překlep z klávesnice je vidět hned.
 */
export function normalizujSeriove(s: string | null | undefined): string {
  return (s ?? "").toUpperCase().replace(/[^0-9A-Z]/g, "");
}

/** 15 číslic = IMEI (po odstranění mezer a pomlček). */
export function vypadaJakoImei(s: string | null | undefined): boolean {
  return /^\d{15}$/.test(normalizujSeriove(s));
}

/** Luhnova kontrolní číslice IMEI. Pro jiné řetězce vrací true (nic se nekontroluje). */
export function platnyImei(s: string | null | undefined): boolean {
  const n = normalizujSeriove(s);
  if (!/^\d{15}$/.test(n)) return true;
  let soucet = 0;
  for (let i = 0; i < 15; i++) {
    let c = n.charCodeAt(i) - 48;
    if (i % 2 === 1) {
      c *= 2;
      if (c > 9) c -= 9;
    }
    soucet += c;
  }
  return soucet % 10 === 0;
}

export type ZaznamZarizeni = { id: string; code?: string | null; createdAt: string; serialOrImei?: string | null; issueShort?: string | null; requestedRepair?: string | null; status?: string | null };

/**
 * Zakázky se stejným sériovým číslem / IMEI (bez ohledu na mezery a
 * velikost písmen), nejnovější první. Krátké řetězce (pod 6 znaků) se
 * neporovnávají – to nejsou identifikátory, to jsou poznámky typu „bez SN“.
 */
export function najdiStejneZarizeni<T extends ZaznamZarizeni>(zakazky: T[], seriove: string | null | undefined, vynechatId?: string): T[] {
  const klic = normalizujSeriove(seriove);
  if (klic.length < 6) return [];
  return zakazky
    .filter((t) => t.id !== vynechatId && normalizujSeriove(t.serialOrImei) === klic)
    .sort((a, b) => {
      const ta = new Date(a.createdAt).getTime();
      const tb = new Date(b.createdAt).getTime();
      // Neplatné datum by v komparátoru dalo NaN a rozhodilo celé pořadí.
      return (Number.isNaN(tb) ? 0 : tb) - (Number.isNaN(ta) ? 0 : ta);
    });
}

/**
 * Sériové číslo Apple: 12 znaků (do roku 2021) nebo 10 znaků (nová
 * náhodná čísla), jen písmena a číslice, aspoň jedno písmeno – jinak by
 * sem spadl i kus IMEI. Kontrolní číslici Apple nemá, hlídá se jen tvar.
 */
export function vypadaJakoAppleSeriove(s: string | null | undefined): boolean {
  const n = normalizujSeriove(s);
  return (n.length === 10 || n.length === 12) && /[A-Z]/.test(n) && /^[A-Z0-9]+$/.test(n);
}

export type StavSerioveho = {
  druh: "prazdne" | "imei" | "apple" | "jine";
  /** false jen tam, kde se dá chyba poznat (IMEI); jiný text je vždy „v pořádku“. */
  platne: boolean;
  /** Krátký text k poli; u „jine“ a prázdna nic. */
  hlaska?: string;
};

/**
 * Co uživatel do pole IMEI / SN napsal a jestli to sedí.
 *
 * Samé číslice o délce 13–17 bere jako pokus o IMEI (15 číslic je norma,
 * o jednu víc nebo míň je překlep) – jiné číselné identifikátory tak
 * dlouhé v servisu nebývají. Kratší nebo delší čísla i cokoliv s písmeny,
 * co není Apple, se nehodnotí.
 */
export function stavSerioveho(s: string | null | undefined): StavSerioveho {
  const n = normalizujSeriove(s);
  if (!n) return { druh: "prazdne", platne: true };
  if (/^\d{13,17}$/.test(n)) {
    if (n.length !== 15) return { druh: "imei", platne: false, hlaska: `IMEI má 15 číslic, zadáno ${n.length}.` };
    if (!platnyImei(n)) return { druh: "imei", platne: false, hlaska: "IMEI nevypadá platně – nesedí kontrolní číslice, zkontrolujte překlep." };
    return { druh: "imei", platne: true, hlaska: "IMEI je platné." };
  }
  if (vypadaJakoAppleSeriove(n)) return { druh: "apple", platne: true, hlaska: "Sériové číslo Apple ve správném tvaru." };
  return { druh: "jine", platne: true };
}

/** Odkaz na veřejnou kontrolu IMEI (model, blacklist); jen pro platné IMEI, jinak null. */
export function odkazKontrolaImei(s: string | null | undefined): string | null {
  const n = normalizujSeriove(s);
  return vypadaJakoImei(n) && platnyImei(n) ? `https://www.imei.info/?imei=${n}` : null;
}

/**
 * Zařízení Apple podle názvu – u něj má smysl ptát se na Find My
 * (aktivační zámek). „Watch“ samo o sobě nestačí: Galaxy Watch Find My nemá.
 */
export function jeAppleZarizeni(nazev: string | null | undefined): boolean {
  return /iphone|ipad|ipod|imac|macbook|\bmac\b|apple\s*watch|watch\s*(series|ultra|se)\b|airpods|\bapple\b/i.test(nazev ?? "");
}

/**
 * Záruční oprava bez podkladu se nedá uplatnit – servis potřebuje datum
 * nákupu, nebo aspoň doklad (číslo účtenky, faktura, „má v e-mailu“).
 */
export function chybiPodkladZaruky(z: { warrantyClaim?: boolean | null; purchaseDate?: string | null; purchaseProof?: string | null }): boolean {
  return !!z.warrantyClaim && !(z.purchaseDate ?? "").trim() && !(z.purchaseProof ?? "").trim();
}
