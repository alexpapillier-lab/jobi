/**
 * Normalizuje telefonní číslo pro deduplikaci zákazníků.
 * 
 * @param phone - Telefonní číslo (libovolný formát)
 * @returns Normalizované telefonní číslo (string) nebo null, pokud je nevalidní
 * 
 * Normalizace:
 * - Odstranění mezer, pomlček, závorek
 * - `00...` → `+...`
 * - Bez prefixu → default `+420`
 * - Krátká/nevalidní čísla → `null`
 */
export function normalizePhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  
  // Odstranění mezer, pomlček, závorek a dalších znaků
  let cleaned = phone.replace(/[\s\-\(\)]/g, "");
  
  // Odstranění všech nečíselných znaků kromě +
  cleaned = cleaned.replace(/[^\d+]/g, "");
  
  // Prázdný string → null
  if (cleaned.length === 0) return null;
  
  // Pokud začíná na 00, nahradit za +
  if (cleaned.startsWith("00")) {
    cleaned = "+" + cleaned.slice(2);
  }
  
  // Pokud začíná na +, ponechat
  if (cleaned.startsWith("+")) {
    // Zkontrolovat, zda má dostatečnou délku (minimálně + a 1 číslice)
    if (cleaned.length < 2) return null;
    return cleaned;
  }
  
  // Pokud nezačíná na +, přidat default prefix +420
  cleaned = "+420" + cleaned;
  
  // Zkontrolovat minimální délku (minimálně +420 a alespoň 1 další číslice = celkem min 5 znaků)
  // České číslo má obvykle 9 číslic + prefix +420 = 13 znaků celkem
  // Ale přijmeme i kratší čísla, pokud mají alespoň nějaké číslice
  if (cleaned.length < 5) return null; // +420 + minimálně 1 číslice
  
  return cleaned;
}


