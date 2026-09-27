/**
 * Ceník oprav (zařízení, modely, opravy) z databáze s obnovou při změně a
 * sklad pro otevřenou zakázku (produkty, rezervace, objednávky u dodavatele).
 * Vyneseno z Orders.tsx beze změny obsahu; názvy stavů zůstávají.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../../../lib/supabaseClient";
import { loadDevicesFromDb } from "../../../lib/devicesDb";
import { loadInventoryFromDb, type Product as SkladProdukt } from "../../../lib/inventoryDb";
import { loadReservations, loadTicketOrderItems, type TicketOrderItem } from "../../../lib/purchaseOrders";
import { safeLoadDevicesData, type DevicesData, type InventoryData, type DeviceRepair } from "../../../lib/catalogStorage";
import type { ModelWithHierarchy } from "../typy";

export function useKatalogASklad(activeServiceId: string | null, detailId: string | null) {
  // Ceník oprav (Zařízení a opravy) žije v DB. Dřív se tu četl jednou při
  // startu z localStorage, kam ho zapisovala jen stará verze stránky
  // Zařízení – v čistém prohlížeči byl proto katalog v zakázkách prázdný
  // („Vybrat z katalogu“ nic nenabídlo). Teď se načte z DB a při změně
  // ceníku se obnoví.
  const [devicesData, setDevicesData] = useState<DevicesData>(() => safeLoadDevicesData());
  useEffect(() => {
    if (!activeServiceId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const load = async () => {
      const res = await loadDevicesFromDb(activeServiceId);
      if (cancelled || res.error) return;
      setDevicesData(res.data);
    };
    const scheduleReload = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { void load(); }, 800);
    };
    void load();
    const channel = supabase
      ? supabase
          .channel(`orders-devices:${activeServiceId}`)
          // Tabulka se jmenuje `repairs`; pod názvem „device_repairs“ žádná
          // neexistuje, takže se odběr tiše navázal a nikdy nic neposlal –
          // změna ceníku se v otevřené zakázce neprojevila až do načtení
          // stránky znovu. Supabase na neznámou tabulku nijak neupozorní.
          .on("postgres_changes", { event: "*", schema: "public", table: "repairs", filter: `service_id=eq.${activeServiceId}` }, scheduleReload)
          .on("postgres_changes", { event: "*", schema: "public", table: "device_models", filter: `service_id=eq.${activeServiceId}` }, scheduleReload)
          .subscribe()
      : null;
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      if (channel && supabase) void supabase.removeChannel(channel);
    };
  }, [activeServiceId]);
  /**
   * Produkty skladu pro výběr dílů u provedených oprav. Čtou se z databáze –
   * starší kopie v localStorage vzniká jen na stránce Sklad a na jiném
   * počítači je prázdná, takže výběr dílů nic nenabízel. Načítá se při
   * otevření detailu, aby stav skladu odpovídal.
   */
  const [inventoryData, setInventoryData] = useState<InventoryData>({ brands: [], categories: [], models: [], products: [] });
  /**
   * Sklad z databáze v plné podobě (stav, dodavatel, nákupní cena) plus živé
   * rezervace přes všechny zakázky – z toho řádek „Díly“ pozná, že díl není
   * skladem, a nabídne objednání u dodavatele (components/orders/DilyOpravy).
   */
  const [skladProdukty, setSkladProdukty] = useState<ReadonlyMap<string, SkladProdukt>>(new Map());
  const [rezervovanoCelkem, setRezervovanoCelkem] = useState<ReadonlyMap<string, number>>(new Map());
  /** Položky objednávek u dodavatele založené kvůli otevřené zakázce; klíčované id, ať pozdní odpověď nepřepíše jinou. */
  const [objednanoProZakazku, setObjednanoProZakazku] = useState<{ ticketId: string | null; rows: TicketOrderItem[] }>({ ticketId: null, rows: [] });
  const refreshObjednanoProZakazku = useCallback(async (ticketId: string) => {
    const res = await loadTicketOrderItems(ticketId);
    if (res.error) return;
    setObjednanoProZakazku({ ticketId, rows: res.data });
  }, []);
  useEffect(() => {
    if (!activeServiceId || !detailId) return;
    let zruseno = false;
    void loadReservations(activeServiceId).then((res) => {
      if (zruseno || res.error) return;
      setRezervovanoCelkem(res.data);
    });
    void loadTicketOrderItems(detailId).then((res) => {
      if (zruseno || res.error) return;
      setObjednanoProZakazku({ ticketId: detailId, rows: res.data });
    });
    void loadInventoryFromDb(activeServiceId).then((res) => {
      if (zruseno || res.error) return;
      setSkladProdukty(new Map(res.data.products.map((p) => [p.id, p])));
      setInventoryData({
        brands: [],
        categories: [],
        models: [],
        products: res.data.products.map((p) => ({
          id: p.id,
          name: p.name,
          modelIds: p.modelIds,
          stock: p.stock,
          price: p.price,
          sku: p.sku,
          description: p.description,
          imageUrl: p.imageUrl,
          repairIds: p.repairIds,
          createdAt: p.createdAt,
        })),
      });
    });
    return () => {
      zruseno = true;
    };
  }, [activeServiceId, detailId]);

  const modelsWithHierarchy: ModelWithHierarchy[] = useMemo(() => {
    if (!devicesData || !Array.isArray(devicesData.models)) return [];
    return devicesData.models
      .map((model) => {
        if (!model || !model.id || !model.name) return null;
        const category = devicesData.categories?.find((c) => c && c.id === model.categoryId);
        const brand = category && devicesData.brands ? devicesData.brands.find((b) => b && b.id === category.brandId) : null;
        const brandName = brand?.name ?? "";
        const categoryName = category?.name ?? "";
        return {
          ...model,
          categoryName,
          brandName,
          fullName: brand ? `${brand.name} ${model.name}` : model.name,
        } satisfies ModelWithHierarchy;
      })
      .filter((m): m is ModelWithHierarchy => m !== null);
  }, [devicesData]);
  /** Opravy z ceníku pro zařízení podle názvu – stejné párování pro detail i pro příjem. */
  const repairsForDeviceLabel = useCallback(
    (label: string | undefined | null): DeviceRepair[] => {
      const trimmed = (label || "").trim();
      if (!trimmed) return [];
      if (!devicesData || !Array.isArray(devicesData.models) || !Array.isArray(devicesData.repairs)) return [];
      const deviceName = trimmed.toLowerCase();
      const matchingModels = devicesData.models.filter(
        (m) => m && m.name && (m.name.toLowerCase().includes(deviceName) || deviceName.includes(m.name.toLowerCase()))
      );
      const modelIds = matchingModels.map((m) => m.id).filter(Boolean);
      if (modelIds.length === 0) return [];
      return devicesData.repairs.filter((r) => r && r.modelIds && r.modelIds.some((mid: string) => modelIds.includes(mid)));
    },
    [devicesData]
  );

  return {
    devicesData,
    inventoryData,
    skladProdukty,
    rezervovanoCelkem,
    objednanoProZakazku,
    refreshObjednanoProZakazku,
    modelsWithHierarchy,
    repairsForDeviceLabel,
  };
}
