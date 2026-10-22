/**
 * Které úložiště editor používá. Bez Provideru je to desktop (JobiDocs),
 * takže aplikace JobiDocs nic nastavovat nemusí; webová verze Jobi editor
 * obalí Providerem s webovým úložištěm.
 */
import { createContext, useContext } from "react";
import { desktopStorage } from "./desktop";
import type { DocumentsStorage } from "./types";

export const DocumentsStorageContext = createContext<DocumentsStorage>(desktopStorage);

export function useDocumentsStorage(): DocumentsStorage {
  return useContext(DocumentsStorageContext);
}
