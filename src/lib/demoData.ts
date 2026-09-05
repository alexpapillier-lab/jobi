/**
 * Ukázková data pro nový servis.
 *
 * Nový servis je prázdný: bez ceníku se nedá vyzkoušet příjem ani tisk, a
 * zkoušet to na ostrých datech nikdo nechce. Tohle založí pár značek,
 * modelů a oprav s cenami a jednu vzorovou zakázku – a umí je zase přesně
 * smazat. Založené řádky si pamatuje nastavení servisu, takže úklid nemaže
 * nic, co si servis pořídil sám.
 */
import { supabase } from "./supabaseClient";
import { loadServiceConfig, mergeServiceConfig } from "./serviceSettingsSync";

export type DemoStopa = {
  brandIds: string[];
  categoryIds: string[];
  modelIds: string[];
  repairIds: string[];
  ticketIds: string[];
  createdAt: string;
};

const ZNACKA = "Ukázka (Apple)";

/** Co se založí – malý, ale kompletní ceník na vyzkoušení. */
const KATALOG: Array<{ model: string; opravy: Array<{ name: string; price: number; costs?: number; minutes?: number }> }> = [
  {
    model: "iPhone 13",
    opravy: [
      { name: "Výměna displeje", price: 3990, costs: 2200, minutes: 45 },
      { name: "Výměna baterie", price: 1490, costs: 550, minutes: 30 },
      { name: "Čištění nabíjecího konektoru", price: 390, costs: 0, minutes: 20 },
    ],
  },
  {
    model: "iPhone 14 Pro",
    opravy: [
      { name: "Výměna displeje", price: 6990, costs: 4300, minutes: 60 },
      { name: "Výměna zadního skla", price: 2990, costs: 900, minutes: 90 },
    ],
  },
];

/** Číslo pro ukázkovou zakázku ve stejném tvaru, jaký servis používá. */
async function dalsiKodZakazky(serviceId: string): Promise<string> {
  const config = await loadServiceConfig(serviceId);
  const surova = typeof config?.abbreviation === "string" ? config.abbreviation : "";
  const prefix = (surova.trim().toUpperCase().replace(/[^A-Z0-9]/g, "") || "SRV").slice(0, 6);
  const rok = new Date().getFullYear().toString().slice(-2);
  const zaklad = prefix + rok;
  let dalsi = 1;
  if (supabase) {
    const { data } = await (supabase.from("tickets") as any)
      .select("code")
      .eq("service_id", serviceId)
      .like("code", zaklad + "%")
      .order("code", { ascending: false })
      .limit(1);
    const posledni = Array.isArray(data) && data[0]?.code ? String(data[0].code) : "";
    const cislo = parseInt(posledni.slice(-6), 10);
    if (Number.isFinite(cislo) && cislo > 0) dalsi = cislo + 1;
  }
  return zaklad + String(dalsi).padStart(6, "0");
}

export async function demoStopa(serviceId: string): Promise<DemoStopa | null> {
  const config = await loadServiceConfig(serviceId);
  const raw = config?.demo_data as DemoStopa | undefined;
  if (!raw || !Array.isArray(raw.modelIds)) return null;
  return raw;
}

/** Založí ukázkový ceník a jednu zakázku. Vrací, co vzniklo. */
export async function vytvoritDemoData(serviceId: string): Promise<{ error?: string }> {
  if (!supabase) return { error: "Supabase není k dispozici" };
  const stopa: DemoStopa = { brandIds: [], categoryIds: [], modelIds: [], repairIds: [], ticketIds: [], createdAt: new Date().toISOString() };
  try {
    const { data: brand, error: brandErr } = await (supabase.from("device_brands") as any)
      .insert({ service_id: serviceId, name: ZNACKA })
      .select("id")
      .single();
    if (brandErr) throw new Error(brandErr.message);
    stopa.brandIds.push(brand.id);

    const { data: kategorie, error: katErr } = await (supabase.from("device_categories") as any)
      .insert({ service_id: serviceId, brand_id: brand.id, name: "Telefony", order_index: 0 })
      .select("id")
      .single();
    if (katErr) throw new Error(katErr.message);
    stopa.categoryIds.push(kategorie.id);

    for (let i = 0; i < KATALOG.length; i++) {
      const polozka = KATALOG[i];
      const { data: model, error: modelErr } = await (supabase.from("device_models") as any)
        .insert({ service_id: serviceId, category_id: kategorie.id, name: polozka.model, order_index: i })
        .select("id")
        .single();
      if (modelErr) throw new Error(modelErr.message);
      stopa.modelIds.push(model.id);

      for (let j = 0; j < polozka.opravy.length; j++) {
        const o = polozka.opravy[j];
        const { data: oprava, error: opravaErr } = await (supabase.from("repairs") as any)
          .insert({
            service_id: serviceId,
            name: o.name,
            price: o.price,
            costs: o.costs ?? null,
            estimated_time: o.minutes ?? null,
            model_ids: [model.id],
            order_index: j,
          })
          .select("id")
          .single();
        if (opravaErr) throw new Error(opravaErr.message);
        stopa.repairIds.push(oprava.id);
      }
    }

    // Vzorová zakázka: ať je na čem vyzkoušet příjem, stav i tisk.
    // Číslo se odvozuje stejně jako u běžné zakázky, jinak by v seznamu
    // svítila pomlčka a vypadala by rozbitě.
    const kod = await dalsiKodZakazky(serviceId);
    const { data: ticket, error: ticketErr } = await (supabase.from("tickets") as any)
      .insert({
        service_id: serviceId,
        title: "iPhone 13",
        notes: "Rozbitý displej po pádu (ukázková zakázka)",
        code: kod,
        customer_name: "Ukázkový zákazník",
        customer_phone: "+420 777 123 456",
        device_label: "iPhone 13",
        device_condition: "Prasklý displej, jinak bez poškození",
        estimated_price: 3990,
      })
      .select("id")
      .single();
    if (ticketErr) throw new Error(ticketErr.message);
    stopa.ticketIds.push(ticket.id);

    await mergeServiceConfig(serviceId, { demo_data: stopa });
    return {};
  } catch (e) {
    // Co se stihlo vytvořit, ať nezůstane viset bez záznamu.
    await mergeServiceConfig(serviceId, { demo_data: stopa });
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

/** Smaže přesně to, co založila `vytvoritDemoData`. */
export async function smazatDemoData(serviceId: string): Promise<{ error?: string }> {
  if (!supabase) return { error: "Supabase není k dispozici" };
  const stopa = await demoStopa(serviceId);
  if (!stopa) return {};
  const smaz = async (tabulka: string, ids: string[]) => {
    if (ids.length === 0) return;
    const { error } = await (supabase!.from(tabulka) as any).delete().in("id", ids);
    if (error) throw new Error(`${tabulka}: ${error.message}`);
  };
  try {
    // Zakázky se nemažou natvrdo (nemají DELETE politiku, jde to jen přes RPC
    // do koše) – jinak by se tiše nesmazalo nic a hlásili bychom úspěch.
    for (const id of stopa.ticketIds) {
      const { error } = await (supabase as any).rpc("soft_delete_ticket", { p_ticket_id: id });
      if (error) throw new Error(`zakázka: ${error.message}`);
    }
    await smaz("repairs", stopa.repairIds);
    await smaz("device_models", stopa.modelIds);
    await smaz("device_categories", stopa.categoryIds);
    await smaz("device_brands", stopa.brandIds);
    await mergeServiceConfig(serviceId, { demo_data: null });
    return {};
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}
