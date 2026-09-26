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
import { zkratkaZConfigu } from "./servisy";

export type DemoStopa = {
  brandIds: string[];
  categoryIds: string[];
  modelIds: string[];
  repairIds: string[];
  ticketIds: string[];
  /** Ukázkové díly ve skladu (starší stopa je nemá). */
  productIds?: string[];
  createdAt: string;
};

/**
 * Stavy pro ukázkové zakázky podle stavů servisu: nový servis má výchozí
 * sadu, ale i servis s vlastními názvy dostane smysluplný rozklad – jedna
 * přijatá, jedna rozpracovaná, jedna připravená a jedna vydaná.
 */
async function ukazkoveStavy(serviceId: string): Promise<{ prijato: string; rozpracovano: string; pripraveno: string; vydano: string }> {
  const { data } = await (supabase!.from("service_statuses") as any).select("key,label,is_final").eq("service_id", serviceId);
  const stavy = (Array.isArray(data) ? data : []) as Array<{ key: string; label: string; is_final: boolean }>;
  const nekoncove = stavy.filter((s) => !s.is_final).map((s) => s.key);
  const koncove = stavy.filter((s) => s.is_final && !/(cancel|storno)/i.test(s.key) && !/(storn|zruš|nerealiz|neopraven|odmítn)/i.test(s.label)).map((s) => s.key);
  const vyber = (preferovane: string[], seznam: string[], zaloha: string) => preferovane.find((k) => seznam.includes(k)) ?? seznam[0] ?? zaloha;
  const prijato = vyber(["received"], nekoncove, "received");
  const rozpracovano = vyber(["repair", "diagnosis", "in_progress", "waiting_part"], nekoncove.filter((k) => k !== prijato), prijato);
  const pripraveno = vyber(["ready", "ready_for_pickup"], nekoncove.filter((k) => k !== prijato && k !== rozpracovano), rozpracovano);
  const vydano = vyber(["completed", "issued", "done"], koncove, "completed");
  return { prijato, rozpracovano, pripraveno, vydano };
}

const DNY = 24 * 3600_000;

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

/**
 * Číslo pro ukázkovou zakázku ve stejném tvaru, jaký servis používá.
 *
 * Zkratka se hledá stejně jako v generátoru čísel (`zkratkaZConfigu`), tedy
 * na obou místech configu i podle názvu firmy. Dřív se tu četlo jen
 * `config.abbreviation`: servisu, který má zkratku uloženou jen v
 * `companyData` (starší servis, ruční zásah), pak ukázková zakázka přistála
 * v seznamu jako „SRV…“ vedle ostrých „ASB…“ a vypadalo to jako chyba
 * číslování.
 */
async function dalsiKodZakazky(serviceId: string): Promise<string> {
  const config = await loadServiceConfig(serviceId);
  const prefix = zkratkaZConfigu(config);
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

    // Dva ukázkové díly ve skladu – navázané na model, ať je vidět rezervace a odpis.
    stopa.productIds = [];
    const dily = [
      { name: "Displej iPhone 13 (OLED, náhradní)", sku: "UK-DISP-13", price: 3200, purchase_price: 2200, model_ids: [stopa.modelIds[0]] },
      { name: "Baterie iPhone 13", sku: "UK-BAT-13", price: 900, purchase_price: 550, model_ids: [stopa.modelIds[0]] },
    ];
    for (const d of dily) {
      const { data: produkt, error: prodErr } = await (supabase.from("inventory_products") as any)
        .insert({ service_id: serviceId, ...d, description: "Ukázkový díl – smažete v Prvních krocích." })
        .select("id")
        .single();
      // Sklad je doplněk ukázky: bez něj se nemá přerušit zbytek.
      if (!prodErr && produkt?.id) stopa.productIds.push(produkt.id);
    }

    // Ukázkové zakázky ve čtyřech stavech: přijatá, rozpracovaná, připravená
    // k převzetí a vydaná před pár dny (ta jediná jde do Statistik).
    // Čísla se odvozují stejně jako u běžné zakázky, jinak by v seznamu
    // svítila pomlčka a vypadala by rozbitě.
    const stavy = await ukazkoveStavy(serviceId);
    const ted = Date.now();
    const oprava = (nazev: string, cena: number, naklady: number, extra: Record<string, unknown> = {}) => ({ id: `ukazka_${Math.random().toString(36).slice(2, 10)}`, name: nazev, type: "manual", price: cena, costs: naklady, ...extra });
    const zakazky: Array<Record<string, unknown>> = [
      {
        title: "iPhone 13", device_label: "iPhone 13", status: stavy.prijato,
        notes: "Rozbitý displej po pádu (ukázková zakázka)", customer_name: "Ukázka – Jana Nováková", customer_phone: "+420 777 123 456",
        device_condition: "Prasklý displej, jinak bez poškození", estimated_price: 3990,
        performed_repairs: [oprava("Výměna displeje", 3990, 2200)],
        created_at: new Date(ted - 1 * DNY).toISOString(),
      },
      {
        title: "iPhone 14 Pro", device_label: "iPhone 14 Pro", status: stavy.rozpracovano,
        notes: "Rozbité zadní sklo (ukázková zakázka)", customer_name: "Ukázka – Petr Dvořák", customer_phone: "+420 777 234 567",
        device_condition: "Zadní sklo prasklé v rohu", estimated_price: 2990,
        performed_repairs: [oprava("Výměna zadního skla", 2990, 900)],
        diagnostic_text: "Zadní sklo rozbité, rám bez deformace. Kamera v pořádku.",
        created_at: new Date(ted - 3 * DNY).toISOString(),
      },
      {
        title: "iPhone 13", device_label: "iPhone 13", status: stavy.pripraveno,
        notes: "Rychle se vybíjí (ukázková zakázka)", customer_name: "Ukázka – Lucie Malá", customer_phone: "+420 777 345 678",
        device_condition: "Bez viditelného poškození, baterie 78 %", estimated_price: 1490,
        performed_repairs: [oprava("Výměna baterie", 1490, 550), oprava("Čištění nabíjecího konektoru", 390, 0, { nabidnuto: true })],
        diagnostic_text: "Kapacita baterie 78 %, vyměněna za novou. Nabíjecí konektor zanesený – vyčištěn.",
        created_at: new Date(ted - 5 * DNY).toISOString(),
      },
      {
        title: "iPhone 13", device_label: "iPhone 13", status: stavy.vydano,
        notes: "Prasklý displej (ukázková zakázka)", customer_name: "Ukázka – Tomáš Král", customer_phone: "+420 777 456 789",
        device_condition: "Prasklý displej, dotyk funguje", estimated_price: 3990,
        performed_repairs: [oprava("Výměna displeje", 3990, 2200)],
        discount_type: "percentage", discount_value: 10,
        diagnostic_text: "Displej vyměněn, dotyk i jas otestovány.",
        created_at: new Date(ted - 9 * DNY).toISOString(),
        completed_at: new Date(ted - 6 * DNY).toISOString(),
      },
    ];
    for (const z of zakazky) {
      const kod = await dalsiKodZakazky(serviceId);
      const { data: ticket, error: ticketErr } = await (supabase.from("tickets") as any)
        .insert({ service_id: serviceId, code: kod, ...z })
        .select("id")
        .single();
      if (ticketErr) throw new Error(ticketErr.message);
      stopa.ticketIds.push(ticket.id);
    }

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
    await smaz("inventory_products", stopa.productIds ?? []);
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
