/**
 * Typy stránky Zakázky – sdílené kontejnerem (Orders.tsx), panely, detailem i hooky.
 * Vyneseno z Orders.tsx beze změny obsahu.
 */
import type React from "react";
import type { Ticket } from "../../mock/tickets";
import type { NavKey } from "../../layout/Sidebar";
import type { Rezervace } from "../../lib/rezervace";
import type { PerformedRepair } from "../../components/orders/types";
import type { KontrolaPoOpraveData } from "../../lib/kontrolniSeznamy";
import type { ZapujckaData } from "../../lib/zapujcka";
import type { PortalTicketFields } from "../../lib/portal";
import type { ZvyrazneniStavu } from "../../lib/zvyrazneniStavu";
import type { DeviceModel } from "../../lib/catalogStorage";

export type GroupKey = "all" | "active" | "final" | "reklamace" | "moje" | "presun";
export type ClaimsSubGroup = "all" | "active" | "final";
export type DisplayMode = "list" | "grid" | "compact" | "compact-extra" | "timeline" | "stripe" | "status-grouped";
export type UIConfig = {
  app: { fabNewOrderEnabled: boolean; uiScale: number; postupZakazky?: boolean };
  sidebar: { position: "left" | "right" | "bottom" };
  home: { orderFilters: { selectedQuickStatusFilters: string[] } };
  orders: { displayMode: DisplayMode; pageSize: number; customerPhoneRequired: boolean; statusGroupedOrder?: string[]; zvyrazneniStavu?: ZvyrazneniStavu };
};
export type OpenTicketIntent = {
  ticketId: string;
  mode?: "panel" | "detail";
  returnToPage?: NavKey;
  returnToCustomerId?: string;
  openSmsPanel?: boolean;
};
export type OrdersProps = {
  activeServiceId: string | null;
  /** Název aktivního servisu – jde do vodoznaku fotek. */
  serviceName?: string | null;
  smsPanelTicketIdRef?: React.MutableRefObject<string | null> | null;
  newOrderPrefill: { customerId?: string; rezervace?: Rezervace } | null;
  onNewOrderPrefillConsumed: () => void;

  openTicketIntent: OpenTicketIntent | null;
  onOpenTicketIntentConsumed: () => void;

  openClaimIntent?: { claimId: string } | null;
  onOpenClaimIntentConsumed?: () => void;

  onOpenCustomer?: (customerId: string) => void;
  onReturnToPage?: (page: NavKey, customerId?: string) => void;
  onCreateInvoice?: (prefill: {
    ticketId: string;
    customerId?: string;
    customerName?: string;
    customerEmail?: string;
    customerPhone?: string;
    customerIco?: string;
    customerDic?: string;
    customerAddress?: string;
    branchId?: string | null;
    items?: { name: string; qty: number; unit: string; unit_price: number; vat_rate: number }[];
  }) => void;
  /** When ticket already has an invoice, open that invoice (navigate to Faktury and open editor). */
  onOpenInvoice?: (invoiceId: string) => void;

  /** When true, detail panel (ticket/claim) is closed. Used when navigating to e.g. Faktury so the preview does not stay on top. */
  closeDetailWhen?: boolean;
  /**
   * SMS jsou pro servis dostupné: má aktivní číslo A ZÁROVEŇ zaplacený modul.
   * App to počítá jako smsProvisioned && hasModule("sms"); Orders si dřív
   * ověřovaly jen to číslo, takže se SMS tlačítko ukazovalo i servisům
   * s vypnutým modulem. Bez propu radši skryté – modul je placený.
   */
  smsEnabled?: boolean;
};
export type TicketEx = Ticket & {
  customerId?: string;
  customerEmail?: string;
  customerAddressStreet?: string;
  customerAddressCity?: string;
  customerAddressZip?: string;
  customerCompany?: string;
  customerIco?: string;
  customerInfo?: string;

  devicePasscode?: string;
  deviceCondition?: string;
  deviceAccessories?: string;
  /** Záruční (true) / pozáruční (false) oprava; null = neuvedeno (tickets.warranty_claim). */
  warrantyClaim?: boolean | null;
  /** Datum nákupu (ISO datum) a doklad o koupi – podklad záruky. */
  purchaseDate?: string;
  purchaseProof?: string;
  /** Apple: Find My vypnuto při příjmu; null = neuvedeno / netýká se (tickets.find_my_off). */
  findMyOff?: boolean | null;

  discountType?: "percentage" | "amount" | null; // typ slevy: procenta, částka, nebo žádná
  discountValue?: number; // hodnota slevy (% nebo Kč)
  requestedRepair?: string;
  handoffMethod?: string;
  handbackMethod?: string;
  deviceNote?: string;
  externalId?: string;
  /** Přidělený technik (auth.users.id), null = nepřiděleno. */
  assignedTo?: string | null;
  /** Kde zařízení fyzicky je (zásilky mezi pobočkami); null = na své pobočce. */
  locationBranchId?: string | null;
  /** Zásilka, ve které právě cestuje; null = necestuje. */
  transitShipmentId?: string | null;
  /** Poslední uložení (updated_at) – upozornění „leží jinde X dní bez změny“. */
  updatedAt?: string | null;
  estimatedPrice?: number;
  performedRepairs?: PerformedRepair[];
  /** Kontrola po opravě (tickets.test_checklist). */
  testChecklist?: KontrolaPoOpraveData;
  /** Náhradní zařízení půjčené zákazníkovi (tickets.loaner). */
  loaner?: ZapujckaData;
  
  diagnosticText?: string; // text diagnostiky
  diagnosticPhotos?: string[]; // URL diagnostických fotek (po vytvoření)
  diagnosticPhotosBefore?: string[]; // URL fotek při příjmu / před vytvořením
  
  expectedDoneAt?: string; // předpokládané dokončení (ISO)
  version?: number; // optimistic locking version
  /** Pobočka, kde zakázka leží (null = bez pobočky / starší záznam). */
  branchId?: string | null;
  /**
   * Má řádek všechny sloupce (detail), nebo jen ty pro seznam?
   *
   * Seznam zakázek čte úzkou sadu sloupců (src/lib/sloupceZakazky.ts), takže
   * `undefined` u diagnostiky nebo zápůjčky nemusí znamenat „prázdné“, ale
   * „nenačtené“. Detail se proto nad neúplným řádkem vůbec nevykreslí –
   * jinak by ho uložení přepsalo prázdnem.
   */
  uplna?: boolean;
} & PortalTicketFields; // zákaznický portál: portalToken, quoteAmount, quoteNote, quoteStatus, quoteSentAt, quoteDecidedAt, quoteDecisionMeta, intakeSignatureUrl, intakeSignedAt, portalLastOpenedAt
export type DeviceRow = {
  deviceLabel: string;
  serialOrImei: string;
  devicePasscode: string;
  deviceCondition: string;
  deviceAccessories: string;
  /** Záruční oprava + její podklad (datum nákupu ISO, doklad); viz chybiPodkladZaruky. */
  warrantyClaim: boolean;
  purchaseDate: string;
  purchaseProof: string;
  /** Find My vypnuto – ptá se jen u zařízení Apple, do databáze jde jinak null. */
  findMyOff: boolean;
  requestedRepair: string;
  handoffMethod: string;
  handbackMethod: string;
  deviceNote: string;
  externalId: string;
  estimatedPrice?: number;
  /** Opravy vybrané z ceníku už při příjmu – do zakázky jdou jako provedené opravy s cenou z ceníku. */
  plannedRepairs?: PerformedRepair[];
  /** Sleva zadaná už při příjmu (přednastavená nebo vlastní) – na zakázku jde hned při založení. */
  discountType?: "percentage" | "amount" | null;
  discountValue?: number;
  /** Ručně napsaná předschválená cena před slevou (viz lib/cenaPriPrijmu). */
  cenaPredSlevou?: number;
  /** Předpokládané datum/čas dokončení – primárně kopírováno z prvního zařízení */
  expectedCompletionAt?: string | null;
};
export type NewOrderDraft = {
  customerId?: string;
  customerName: string;
  customerPhone: string;
  customerEmail: string;
  addressStreet: string;
  addressCity: string;
  addressZip: string;
  company: string;
  ico: string;
  customerInfo: string;

  devices: DeviceRow[];

  diagnosticPhotosBefore?: string[]; // data URLs – fotky při příjmu (před vytvořením zakázky)
  /** Pobočka nové zakázky; bez hodnoty se použije aktivní / domovská / výchozí. */
  branchId?: string | null;
  /** Rezervace z webu, ze které zakázka vzniká – po založení se označí jako převedená. */
  rezervaceId?: string;
};
export type ModelWithHierarchy = DeviceModel & {
  fullName: string;
  brandName: string;
  categoryName: string;
};

/** Zákazník dohledaný při příjmu podle telefonu nebo jména (nabídka „Přiřadit zákazníka“). */
export type ShodaZakaznika = {
  id: string;
  name: string;
  phone?: string;
  email?: string;
  company?: string;
};

/** Rozepsané změny v detailu, které se ukládají až při zavření (diagnostika, fotky, opravy). */
export type DirtyFlags = {
  diagnosticText: boolean;
  diagnosticPhotos: boolean;
  performedRepairs: boolean;
};

/** Otevřený lightbox diagnostických fotek. */
export type FotoLightboxStav = { urls: string[]; index: number; ticketCode?: string };

/** Jeden QR odkaz v okně „Vyfotit z telefonu“. */
export type PolozkaQrFoceni = { deviceLabel: string; url: string };

/** Vstup pro přidání provedené opravy (z ceníku, ručně nebo hodinová práce). */
export type NovaProvedenaOprava = {
  name: string;
  type: "selected" | "manual" | "hourly";
  repairId?: string;
  price?: number;
  costs?: number;
  estimatedTime?: number;
  productIds?: string[];
  hodiny?: number;
  sazba?: number;
  technik?: string;
  technikUserId?: string;
  zMereni?: boolean;
};
