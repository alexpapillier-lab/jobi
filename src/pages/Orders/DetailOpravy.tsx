/**
 * Karta „Provedené opravy“ v detailu zakázky: řádky oprav s díly (rezervace,
 * objednání u dodavatele), součet se slevou a přidání další opravy.
 * Vyneseno z Orders.tsx beze změny obsahu; zápisy oprav drží kontejner.
 */
import type React from "react";
import { SectionHeading } from "../../components/SectionHeading";
import { WrenchIcon } from "../../components/icons";
import { PerformedRepairItem, PerformedRepairAdder, DiscountPicker, TlacitkaSlev, type PerformedRepair } from "../../components/orders";
import { DilyOpravy } from "../../components/orders/DilyOpravy";
import { showToast } from "../../components/Toast";
import { STORAGE_KEYS } from "../../constants/storageKeys";
import { formatCurrency } from "../../lib/invoiceMath";
import { castkaSlevy, hrubaCena, konecnaCena } from "../../lib/slevaZakazky";
import { najdiPravidlo, type PravidloOdmeny } from "../../lib/odmeny";
import type { PrednastavenaSleva } from "../../lib/prednastaveneSlevy";
import { BARVA_SEKCE, stylSekce } from "../../lib/sekceDetailu";
import { safeLoadDevicesData, type DevicesData, type InventoryData, type DeviceRepair } from "../../lib/catalogStorage";
import type { TicketReservation, TicketOrderItem } from "../../lib/purchaseOrders";
import type { Product as SkladProdukt } from "../../lib/inventoryDb";
import type { NovaProvedenaOprava, TicketEx } from "./typy";
import { card } from "./styly";
import { jeRootOwnerId } from "../../lib/rootOwner";

type Props = {
  detailedTicket: TicketEx;
  /** Rezervace dílů otevřené zakázky (klíčované id, ať pozdní odpověď nepřepíše jinou). */
  ticketReservations: { ticketId: string | null; rows: TicketReservation[] };
  removePerformedRepair: (ticketId: string, repairId: string) => void;
  updatePerformedRepairPrice: (ticketId: string, repairId: string, price: number) => void;
  updatePerformedRepairCosts: (ticketId: string, repairId: string, costs: number) => void;
  updatePerformedRepairTime: (ticketId: string, repairId: string, estimatedTime: number) => void;
  updatePerformedRepairProducts: (ticketId: string, repairId: string, productIds: string[]) => void;
  updatePerformedRepairFields: (ticketId: string, repairId: string, fields: Partial<PerformedRepair>) => void;
  devicesData: DevicesData;
  inventoryData: InventoryData;
  pravidlaOdmen: PravidloOdmeny[];
  activeServiceId: string | null;
  skladProdukty: ReadonlyMap<string, SkladProdukt>;
  rezervovanoCelkem: ReadonlyMap<string, number>;
  objednanoProZakazku: { ticketId: string | null; rows: TicketOrderItem[] };
  /** Oprávnění can_edit_inventory – smí objednat díly u dodavatele. */
  muzeObjednatDily: boolean;
  refreshObjednanoProZakazku: (ticketId: string) => Promise<void>;
  setCloudTickets: React.Dispatch<React.SetStateAction<TicketEx[]>>;
  prednastaveneSlevy: PrednastavenaSleva[];
  availableRepairs: DeviceRepair[];
  addPerformedRepair: (ticketId: string, repair: NovaProvedenaOprava) => void;
  hodinovaSazba: number | null;
  currentUserNickname: string | null | undefined;
  currentUserId: string | undefined;
};

export function DetailOpravy({
  detailedTicket,
  ticketReservations,
  removePerformedRepair,
  updatePerformedRepairPrice,
  updatePerformedRepairCosts,
  updatePerformedRepairTime,
  updatePerformedRepairProducts,
  updatePerformedRepairFields,
  devicesData,
  inventoryData,
  pravidlaOdmen,
  activeServiceId,
  skladProdukty,
  rezervovanoCelkem,
  objednanoProZakazku,
  muzeObjednatDily,
  refreshObjednanoProZakazku,
  setCloudTickets,
  prednastaveneSlevy,
  availableRepairs,
  addPerformedRepair,
  hodinovaSazba,
  currentUserNickname,
  currentUserId,
}: Props) {
  return (
    <div id="detail-opravy" data-tour="detail-opravy" style={{ ...card, ...stylSekce("opravy"), marginTop: 16 }}>
      <SectionHeading icon={<WrenchIcon size={16} />} barva={BARVA_SEKCE.opravy}>Provedené opravy</SectionHeading>

      <div style={{ display: "grid", gap: 8, marginBottom: 12 }}>
        {(detailedTicket.performedRepairs ?? []).map((repair) => {
          // Rezervované/odečtené díly této opravy; uvolněné se neukazují.
          const dily = ticketReservations.ticketId === detailedTicket.id
            ? ticketReservations.rows.filter((r) => r.repairEntryId === repair.id && r.status !== "released")
            : [];
          return (
            <div key={repair.id} style={{ display: "grid", gap: 2 }}>
              <PerformedRepairItem
                repair={repair}
                onRemove={(repairId) => removePerformedRepair(detailedTicket.id, repairId)}
                onUpdatePrice={(repairId, price) => updatePerformedRepairPrice(detailedTicket.id, repairId, price)}
                onUpdateCosts={(repairId, costs) => updatePerformedRepairCosts(detailedTicket.id, repairId, costs)}
                onUpdateTime={(repairId, time) => updatePerformedRepairTime(detailedTicket.id, repairId, time)}
                onUpdateProducts={(repairId, productIds) => updatePerformedRepairProducts(detailedTicket.id, repairId, productIds)}
                onUpdateFields={(repairId, fields) => updatePerformedRepairFields(detailedTicket.id, repairId, fields)}
                devicesData={devicesData}
                inventoryData={inventoryData}
                odmenaMozna={najdiPravidlo(pravidlaOdmen, repair.name) !== null}
              />
              <DilyOpravy
                ticketId={detailedTicket.id}
                serviceId={activeServiceId}
                rows={dily}
                produkty={skladProdukty}
                rezervovanoCelkem={rezervovanoCelkem}
                objednano={objednanoProZakazku.ticketId === detailedTicket.id ? objednanoProZakazku.rows : []}
                muzeObjednat={muzeObjednatDily}
                onObjednano={() => void refreshObjednanoProZakazku(detailedTicket.id)}
              />
            </div>
          );
        })}
        {(detailedTicket.performedRepairs ?? []).length === 0 && (
          <div style={{ color: "var(--muted)", fontSize: 13, padding: 12, textAlign: "center" }}>
            Zatím nebyly přidány žádné opravy
          </div>
        )}
        {(detailedTicket.performedRepairs ?? []).length > 0 && (() => {
          const totalPrice = hrubaCena(detailedTicket.performedRepairs);
          const discountType: "percentage" | "amount" | null = detailedTicket.discountType ?? null;
          const discountValue = detailedTicket.discountValue || 0;
          /* Sleva i konečná cena přes společný vzorec (slevaZakazky.ts).
             Vlastní kopie, která tu byla, neznala strop ani zaokrouhlení:
             sleva 5 000 Kč na zakázce za 1 500 Kč vypsala „Sleva −5 000,00
             Kč“ vedle „Finální cena 0,00 Kč“ – dvě čísla, která si na
             obrazovce odporují a na dokladu jsou pak jiná. */
          const discountAmount = castkaSlevy(totalPrice, discountType, discountValue);
          const finalPrice = konecnaCena(totalPrice, discountType, discountValue);
          
          return (
            <div style={{ 
              padding: 12, 
              borderRadius: 10,
              background: "var(--accent-soft)", 
              border: "1px solid var(--accent)",
              marginTop: 8,
            }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontWeight: 950, fontSize: 14, color: "var(--text)" }}>Celková cena oprav:</span>
                  <span style={{ fontWeight: 950, fontSize: 16, color: "var(--accent)" }}>
                    {formatCurrency(totalPrice)}
                  </span>
                </div>
                
                {/* Discount UI */}
                <div style={{ display: "flex", flexDirection: "column", gap: 6, paddingTop: 8, borderTop: "1px solid var(--border)" }}>
                  <DiscountPicker
                    discountType={discountType ?? null}
                    discountValue={discountValue || 0}
                    onChange={(type, value) => {
                      setCloudTickets((prev) =>
                        prev.map((t) =>
                          t.id === detailedTicket.id
                            ? { ...t, discountType: type, discountValue: type ? value : undefined }
                            : t
                        )
                      );
                    }}
                  />

                  {/* Přednastavené slevy (Nastavení → Zakázky → Slevy): jedno
                      klepnutí místo výběru typu a vypisování hodnoty. Druhé
                      klepnutí na aktivní slevu ji zase sundá. */}
                  <TlacitkaSlev
                    slevy={prednastaveneSlevy}
                    discountType={discountType}
                    discountValue={discountValue}
                    onChange={(type, value) => {
                      setCloudTickets((prev) =>
                        prev.map((t) =>
                          t.id === detailedTicket.id
                            ? { ...t, discountType: type, discountValue: type ? value : undefined }
                            : t
                        )
                      );
                    }}
                  />

                  {discountAmount > 0 && (
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ fontSize: 12, color: "var(--muted)" }}>
                        Sleva {discountType === "percentage" ? `(${discountValue}%)` : ""}:
                      </span>
                      <span style={{ fontSize: 13, color: "var(--accent)", fontWeight: 700 }}>
                        −{formatCurrency(discountAmount)}
                      </span>
                    </div>
                  )}
                  
                  {discountAmount > 0 && (
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingTop: 4, borderTop: "1px solid var(--border)" }}>
                      <span style={{ fontWeight: 950, fontSize: 14, color: "var(--text)" }}>Finální cena:</span>
                      <span style={{ fontWeight: 950, fontSize: 18, color: "var(--accent)" }}>
                        {formatCurrency(finalPrice)}
                      </span>
            </div>
                  )}
                </div>
              </div>
            </div>
          );
        })()}
      </div>

      <PerformedRepairAdder 
        availableRepairs={availableRepairs} 
        onAdd={(repair) => addPerformedRepair(detailedTicket.id, repair)}
        deviceLabel={detailedTicket.deviceLabel}
        devicesData={devicesData}
        inventoryData={inventoryData}
        vychoziSazba={hodinovaSazba ?? undefined}
        /* Majitel aplikace se jako technik nepředvyplňuje: jméno hodinové
           práce jde na doklad zákazníkovi a majitel má být neviditelný. */
        vychoziTechnik={jeRootOwnerId(currentUserId) ? undefined : currentUserNickname ?? undefined}
        vychoziTechnikId={jeRootOwnerId(currentUserId) ? undefined : currentUserId ?? undefined}
        onAddToModel={(repairData) => {
          // Add repair to model in Devices
          const currentDevices = safeLoadDevicesData();
          const newRepair: DeviceRepair = {
            id: `${Date.now()}_${Math.random()}`,
            modelIds: [repairData.modelId],
            name: repairData.name,
            price: repairData.price || 0,
            estimatedTime: repairData.estimatedTime || 0,
            details: "",
            costs: repairData.costs,
            productIds: repairData.productIds,
            createdAt: new Date().toISOString(),
          };
          const updatedDevices = {
            ...currentDevices,
            repairs: [...currentDevices.repairs, newRepair],
          };
          try {
            localStorage.setItem(STORAGE_KEYS.DEVICES, JSON.stringify(updatedDevices));
            // Also add to current ticket
            addPerformedRepair(detailedTicket.id, { name: repairData.name, type: "manual" });
            showToast(`Oprava "${repairData.name}" byla přidána k modelu a do zakázky.`, "success");
          } catch (_e) {
            showToast("Chyba při ukládání opravy k modelu.", "error");
          }
        }}
      />
    </div>
  );
}
