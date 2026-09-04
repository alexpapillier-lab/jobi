import { createContext, useContext, useEffect, type ReactNode } from "react";

/**
 * Hlídání neuložených změn při přepínání sekcí Nastavení.
 *
 * Formulář (Údaje firmy, DPH, profil…) se přihlásí přes useRegisterUnsaved
 * a Nastavení se ho před přepnutím sekce zeptá, jestli má něco rozdělaného.
 * Když ano, ukáže dialog Uložit / Zahodit / Zpět místo tichého zahození.
 *
 * Registrace jde přes ref (ne stav), aby každé písmeno napsané do formuláře
 * nepřekreslovalo celé Nastavení.
 */
export type UnsavedHandle = {
  dirty: boolean;
  save: () => Promise<void> | void;
  discard: () => void;
};

type Register = (handle: UnsavedHandle | null) => void;

const UnsavedGuardContext = createContext<Register>(() => {});

export function UnsavedGuardProvider({ register, children }: { register: Register; children: ReactNode }) {
  return <UnsavedGuardContext.Provider value={register}>{children}</UnsavedGuardContext.Provider>;
}

/** Zavolat v každém renderu formuláře; při odmontování se odhlásí sám. */
export function useRegisterUnsaved(handle: UnsavedHandle) {
  const register = useContext(UnsavedGuardContext);
  useEffect(() => {
    register(handle);
  });
  useEffect(() => () => register(null), [register]);
}
