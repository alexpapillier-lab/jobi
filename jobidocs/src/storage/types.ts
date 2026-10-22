/**
 * Úložiště šablon – rozhraní, přes které editor (Dokumenty, Značka) čte
 * a ukládá šablony, nahrává obrázky značky a tiskne zkušební dokument.
 *
 * Editor je jeden a sdílený: běží v desktopovém JobiDocs i ve webové
 * verzi Jobi (Nastavení → Dokumenty a tisk → Šablony dokumentů). Liší se
 * jen tím, kudy jdou data:
 * - desktop: místní server JobiDocs (Electron, HTTP na 127.0.0.1) – viz
 *   `desktop.ts`, chování je stejné jako před zavedením rozhraní;
 * - web: přímo Supabase pod přihlášeným uživatelem Jobi – viz
 *   `src/lib/sablonyDokumentuWeb.ts` v Jobi.
 *
 * Obě cesty zapisují tentýž řádek `service_document_settings` (config.v2)
 * s kontrolou verze, takže šablona uložená na webu je v JobiDocs stejná
 * a naopak.
 */
import type { DocType, DocumentData, DocumentsV2, SampleKind } from "../../core/index";

export type ServiceEntry = { service_id: string; service_name: string; role: string };

/** Servisy, aktivní servis, údaje firmy pro náhled a oprávnění. */
export type Context = {
  services: ServiceEntry[];
  activeServiceId: string | null;
  companyData: Record<string, unknown> | null;
  canManageDocuments: boolean;
};

export type LoadedDocuments = {
  documents: DocumentsV2;
  version: number;
  updated_at: string | null;
  source: "supabase" | "context" | "local" | "default";
  canManage: boolean;
  online: boolean;
};

export type SavedDocuments = { ok: true; version: number; updated_at: string | null; documents: DocumentsV2; savedTo: "supabase" | "local" };

/** Skutečný doklad z Jobi pro náhled šablony. */
export type RecentItem = { id: string; label: string; data: DocumentData };

export type BrandAssetKind = "logo" | "stamp" | "letterhead";

/** Co se má zkušebně vytisknout nebo uložit jako PDF. */
export type PrintRequest = {
  serviceId: string;
  docType: DocType;
  /** Rozpracované šablony – tiskne se to, co je v editoru, i neuložené. */
  documents: DocumentsV2;
  /** Ukázková data (krátká / dlouhá) – desktop si je dosadí sám. */
  sample?: SampleKind;
  /** Skutečný doklad z Jobi, když je v náhledu vybraný. */
  data?: DocumentData;
  /** Data přesně tak, jak je ukazuje náhled (ukázka i skutečný doklad). */
  previewData: DocumentData;
};

export type DocumentsStorage = {
  kind: "desktop" | "web";
  context(): Promise<Context>;
  load(serviceId: string): Promise<LoadedDocuments>;
  /**
   * Uloží šablony. `ifVersion` = verze, ze které uživatel vycházel; když
   * mezitím uložil někdo jiný, vyhodí chybu se `status: 409` a `body.version`
   * (viz `chybaKonfliktu`). Bez `ifVersion` se přepíše bez kontroly.
   */
  save(serviceId: string, documents: DocumentsV2, ifVersion?: number): Promise<SavedDocuments>;
  /** Soubor z disku → hodnota do `brand` (data: URL, nebo adresa v úložišti). */
  prepareBrandAsset(file: File, kind: BrandAssetKind): Promise<string>;
  recent(serviceId: string, docType: DocType): Promise<RecentItem[]>;
  /** Zkušební tisk. Vrací text hlášky po úspěchu, `null` = bez hlášky. */
  testPrint(req: PrintRequest): Promise<string | null>;
  /** Uložení ukázky jako PDF. Vrací text hlášky po úspěchu, `null` = bez hlášky. */
  savePdf(req: PrintRequest): Promise<string | null>;
};

/** Chyba při uložení, které předběhl někdo jiný (stejný tvar jako 409 z místního API). */
export type ChybaUlozeni = Error & { status?: number; body?: { version?: number; updated_at?: string | null } };

export function chybaKonfliktu(version: number, updated_at: string | null = null): ChybaUlozeni {
  const err = new Error("Šablonu mezitím změnil někdo jiný.") as ChybaUlozeni;
  err.status = 409;
  err.body = { version, updated_at };
  return err;
}

export function jeKonflikt(e: unknown): e is ChybaUlozeni {
  return !!e && typeof e === "object" && (e as ChybaUlozeni).status === 409;
}
