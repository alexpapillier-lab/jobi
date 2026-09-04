/**
 * SPAYD (Short Payment Descriptor) – řetězec pro český QR platba kód.
 *
 * Formát: SPD*1.0*ACC:{IBAN}*AM:{částka}*CC:CZK*X-VS:{vs}*MSG:{zpráva}
 *
 * Port generateSpaydString ze src/lib/invoiceToJobiDocs.ts + převod českého
 * čísla účtu („předčíslí-číslo/kód banky“) na IBAN, který tam chyběl
 * (faktury mají IBAN v nastavení, portál musí vystačit i s číslem účtu).
 */

export type SpaydVstup = {
  iban?: string | null;
  bankAccount?: string | null;
  amount: number;
  vs?: string | null;
  message?: string | null;
  currency?: string | null;
};

/** Mod 97 nad dlouhým číslem zapsaným jako string (BigInt by šel taky, tohle je bez závislostí). */
function mod97(cislice: string): number {
  let zbytek = 0;
  for (let i = 0; i < cislice.length; i++) {
    zbytek = (zbytek * 10 + (cislice.charCodeAt(i) - 48)) % 97;
  }
  return zbytek;
}

/**
 * Převod českého čísla účtu na IBAN.
 * Přijímá „19-2000145399/0800“, „2000145399/0800“ i s mezerami.
 * Vrací null, když tvar nesedí.
 */
export function czAccountToIban(bankAccount: string | null | undefined): string | null {
  const raw = (bankAccount ?? "").replace(/\s/g, "");
  const m = raw.match(/^(?:(\d{1,6})-)?(\d{2,10})\/(\d{4})$/);
  if (!m) return null;
  const predcisli = (m[1] ?? "").padStart(6, "0");
  const cislo = m[2].padStart(10, "0");
  const banka = m[3];
  const bban = `${banka}${predcisli}${cislo}`;
  // Kontrolní číslice: 98 - (BBAN + "CZ00" jako čísla) mod 97; C=12, Z=35
  const kontrola = 98 - mod97(`${bban}123500`);
  return `CZ${String(kontrola).padStart(2, "0")}${bban}`;
}

/** Hrubá kontrola tvaru IBANu vč. mod-97 – ať do QR nejde překlep. */
export function ibanPlatny(iban: string): boolean {
  const s = iban.replace(/\s/g, "").toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(s)) return false;
  const preskladano = s.slice(4) + s.slice(0, 4);
  const cislice = preskladano.replace(/[A-Z]/g, (ch) => String(ch.charCodeAt(0) - 55));
  return mod97(cislice) === 1;
}

/**
 * Sestaví SPAYD řetězec. Přednost má IBAN, jinak se zkusí převést číslo účtu.
 * Vrací null, když není žádný použitelný účet nebo částka není kladná.
 */
export function buildSpayd(vstup: SpaydVstup): string | null {
  let iban = (vstup.iban ?? "").replace(/\s/g, "").toUpperCase();
  if (!iban || !ibanPlatny(iban)) {
    iban = czAccountToIban(vstup.bankAccount) ?? "";
  }
  if (!iban) return null;

  const castka = Number(vstup.amount);
  if (!Number.isFinite(castka) || castka <= 0) return null;

  const parts = ["SPD*1.0", `ACC:${iban}`, `AM:${castka.toFixed(2)}`, `CC:${vstup.currency || "CZK"}`];

  const vs = (vstup.vs ?? "").replace(/\D/g, "").slice(0, 10);
  if (vs) parts.push(`X-VS:${vs}`);

  // MSG: max 60 znaků, hvězdička je oddělovač – nesmí být uvnitř
  const msg = (vstup.message ?? "").replace(/\*/g, " ").trim().slice(0, 60);
  if (msg) parts.push(`MSG:${msg}`);

  return parts.join("*");
}
