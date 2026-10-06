import { useCallback } from "react";
import { reportSilent } from "../../../lib/reportError";
import { supabase } from "../../../lib/supabaseClient";
import { ulozNaPozdeji, jeTrvalaChyba } from "../../../lib/frontaZapisu";
import { showToast } from "../../../components/Toast";
import { addWatermarkToImageBlob } from "../../../lib/diagnosticPhotoWatermark";
import { uploadDiagnosticPhoto } from "../../../lib/diagnosticPhotosStorage";
import { NOVE_SLOUPCE_REKLAMACE, STAV_PREVEDENO } from "../../../lib/reklamacePrijem";
import type { Database } from "../../../types/supabase";

export type WarrantyClaimRow = Database["public"]["Tables"]["warranty_claims"]["Row"];
export type WarrantyClaimInsert = Database["public"]["Tables"]["warranty_claims"]["Insert"];

/** Generate next warranty claim code: R + YY + 6 digits (e.g. R25000001) */
async function makeWarrantyClaimCode(
  existingClaims: { code: string | null }[],
  activeServiceId: string | null
): Promise<string> {
  if (!activeServiceId) return "R25000001";
  const year = new Date().getFullYear().toString().slice(-2);
  const prefix = `R${year}`;

  // Číslo přiděluje databáze (dalsi_cislo_reklamace) – dvě reklamace založené
  // naráz by si jinak spočítaly stejný kód. Záložní výpočet níž zůstává pro
  // případ, že RPC není k dispozici.
  if (supabase) {
    try {
      const { data, error } = await (supabase as any).rpc("dalsi_cislo_reklamace", {
        p_service_id: activeServiceId,
        p_prefix: prefix,
      });
      if (!error && typeof data === "number" && data > 0) {
        return `${prefix}${String(data).padStart(6, "0")}`;
      }
      console.error("[reklamace] dalsi_cislo_reklamace selhalo, počítám kód lokálně:", error);
    } catch (err) {
      console.error("[reklamace] dalsi_cislo_reklamace nedostupné, počítám kód lokálně:", err);
    }
  }

  let existingCodes: string[] = existingClaims
    .map((c) => c.code || "")
    .filter((code) => code.startsWith(prefix));
  if (existingCodes.length === 0 && supabase) {
    const { data } = await (supabase
      .from("warranty_claims") as any)
      .select("code")
      .eq("service_id", activeServiceId)
      .like("code", `${prefix}%`)
      .order("code", { ascending: false })
      .limit(100);
    if (data?.length) {
      existingCodes = data.map((r: any) => r.code || "").filter((c: string) => c.startsWith(prefix));
    }
  }
  const existingNumbers = existingCodes
    .map((code) => {
      const num = parseInt(code.slice(-6), 10);
      return isNaN(num) ? 0 : num;
    })
    .filter((n) => n > 0);
  const next = existingNumbers.length > 0 ? Math.max(...existingNumbers) + 1 : 1;
  return `${prefix}${String(next).padStart(6, "0")}`;
}

/** Chyba „sloupec neexistuje“ – databáze ještě nemá migraci 20261006100000. */
function chybiSloupec(err: { code?: string; message?: string } | null | undefined): boolean {
  if (!err) return false;
  if (err.code === "42703" || err.code === "PGRST204") return true;
  const m = (err.message ?? "").toLowerCase();
  return m.includes("does not exist") || m.includes("schema cache") || m.includes("could not find the");
}

function bezNovychSloupcu<T extends Record<string, unknown>>(row: T): T {
  const kopie: Record<string, unknown> = { ...row };
  for (const s of NOVE_SLOUPCE_REKLAMACE) delete kopie[s];
  return kopie as T;
}

export type ZalozeniReklamace = {
  /** Řádek reklamace bez service_id a kódu (lib/reklamacePrijem → konceptNaReklamaci). */
  payload: Omit<WarrantyClaimInsert, "service_id" | "code">;
  statusKey: string;
  existingClaims: { code: string | null }[];
  /** Přijímací fotky jako data URL – nahrají se s vodoznakem po založení. */
  fotkyDataUrl?: string[];
  /** Už nahrané fotky (focení přes QR ke konceptu) – jdou rovnou do intake_photos. */
  fotkyHotove?: string[];
  /** Název servisu do vodoznaku. */
  serviceName?: string | null;
};

export function useWarrantyClaims(activeServiceId: string | null) {
  /**
   * Založí reklamaci (se zdrojovou zakázkou i bez ní). U zakázky zapíše do
   * její historie „založena reklamace“. Na databázi bez nových sloupců
   * (claimed_repairs, intake_photos, handoff_method) se založí bez nich –
   * klient může jít ven dřív než migrace a příjem reklamací nesmí přestat jít.
   */
  const zalozReklamaci = useCallback(
    async ({ payload, statusKey, existingClaims, fotkyDataUrl = [], fotkyHotove = [], serviceName = null }: ZalozeniReklamace): Promise<WarrantyClaimRow | null> => {
      if (!activeServiceId || !supabase) {
        showToast("Chybí aktivní servis nebo připojení.", "error");
        return null;
      }
      const code = await makeWarrantyClaimCode(existingClaims, activeServiceId);
      const radek: WarrantyClaimInsert = {
        ...payload,
        service_id: activeServiceId,
        code,
        status: statusKey,
        notes: (payload.notes ?? "").trim(),
        intake_photos: fotkyHotove,
      };
      let novaDb = true;
      let { data, error } = await (supabase.from("warranty_claims") as any).insert(radek).select().single();
      if (error && chybiSloupec(error)) {
        novaDb = false;
        ({ data, error } = await (supabase.from("warranty_claims") as any).insert(bezNovychSloupcu(radek)).select().single());
      }
      if (error || !data) {
        showToast(`Chyba při vytváření reklamace: ${error?.message ?? "neznámá chyba"}`, "error");
        return null;
      }
      let claim = data as WarrantyClaimRow;

      if (claim.source_ticket_id) {
        // Chyba se vrací, nevyhazuje. Bez záznamu v historii nikdo nepozná,
        // že k zakázce vznikla reklamace – proto se aspoň zaloguje.
        const uid = (await supabase.auth.getUser()).data.user?.id ?? null;
        const { error: histErr } = await (supabase.from("ticket_history") as any).insert({
          ticket_id: claim.source_ticket_id,
          service_id: activeServiceId,
          action: "warranty_claim_created",
          changed_by: uid,
          details: { warranty_claim_id: claim.id, warranty_claim_code: claim.code },
        });
        if (histErr) reportSilent({ code: "claims.history_insert_failed", error: histErr, source: "useWarrantyClaims.zalozReklamaci" });
      }

      // Přijímací fotky: nahrávají se až s id reklamace (složka <servis>/<reklamace>/).
      if (fotkyDataUrl.length > 0) {
        if (!novaDb) {
          showToast("Přijímací fotky se neuložily – databáze ještě nemá sloupec pro fotky reklamace.", "info");
        } else {
          try {
            const urls: string[] = [];
            for (const dataUrl of fotkyDataUrl) {
              const blob = await addWatermarkToImageBlob(dataUrl, { cislo: claim.code, servis: serviceName });
              const file = new File([blob], "photo.jpg", { type: "image/jpeg" });
              urls.push(await uploadDiagnosticPhoto(supabase, activeServiceId, claim.id, file));
            }
            const vsechny = [...fotkyHotove, ...urls];
            const { data: upd, error: updErr } = await (supabase.from("warranty_claims") as any)
              .update({ intake_photos: vsechny })
              .eq("id", claim.id)
              .select()
              .single();
            if (updErr) throw updErr;
            if (upd) claim = upd as WarrantyClaimRow;
          } catch (err) {
            reportSilent({ code: "claims.intake_photos_failed", error: err, source: "useWarrantyClaims.zalozReklamaci" });
            showToast("Reklamace je založená, ale přijímací fotky se nepodařilo nahrát. Přidejte je v detailu znovu.", "error");
          }
        }
      }

      showToast(`Reklamace ${claim.code} vytvořena`, "success");
      return claim;
    },
    [activeServiceId]
  );

  /** Historie nové zakázky: „Vzniklo z reklamace R…“ (historii reklamace píše trigger). */
  const zapisHistoriiPrevodu = useCallback(
    async (claim: WarrantyClaimRow, ticketId: string) => {
      if (!supabase || !activeServiceId) return;
      const uid = (await supabase.auth.getUser()).data.user?.id ?? null;
      const { error } = await (supabase.from("ticket_history") as any).insert({
        ticket_id: ticketId,
        service_id: activeServiceId,
        action: "created_from_warranty_claim",
        changed_by: uid,
        details: { warranty_claim_id: claim.id, warranty_claim_code: claim.code },
      });
      if (error) reportSilent({ code: "claims.convert_history_failed", error, source: "useWarrantyClaims.oznacPrevedeni" });
    },
    [activeServiceId]
  );

  /**
   * Reklamace převedená na zakázku: systémový koncový stav, odkaz na zakázku.
   * Zapíše se jen tehdy, když reklamace ještě převedená není (souběh dvou lidí
   * – druhý dostane null a hlášku). Historii reklamace zapíše trigger.
   * Bez sloupce converted_ticket_id (stará databáze) se uloží jen stav
   * a odkaz na zakázku do poznámky.
   */
  const oznacPrevedeni = useCallback(
    async (claim: WarrantyClaimRow, ticket: { id: string; code?: string | null }): Promise<WarrantyClaimRow | null> => {
      if (!supabase) {
        showToast("Chybí připojení.", "error");
        return null;
      }
      const ted = new Date().toISOString();
      const { data, error } = await (supabase.from("warranty_claims") as any)
        .update({ status: STAV_PREVEDENO, converted_ticket_id: ticket.id, converted_at: ted, completed_at: ted })
        .eq("id", claim.id)
        .is("converted_ticket_id", null)
        .select()
        .maybeSingle();
      if (error && chybiSloupec(error)) {
        const poznamka = [claim.notes?.trim(), `Převedeno na zakázku ${ticket.code ?? ""}`.trim()].filter(Boolean).join("\n\n");
        const druhy = await (supabase.from("warranty_claims") as any)
          .update({ status: STAV_PREVEDENO, completed_at: ted, notes: poznamka })
          .eq("id", claim.id)
          .select()
          .maybeSingle();
        if (druhy.error || !druhy.data) {
          showToast(`Zakázka je založená, ale reklamaci se nepodařilo uzavřít: ${druhy.error?.message ?? "neznámá chyba"}`, "error");
          return null;
        }
        await zapisHistoriiPrevodu(claim, ticket.id);
        return druhy.data as WarrantyClaimRow;
      }
      if (error) {
        showToast(`Zakázka je založená, ale reklamaci se nepodařilo uzavřít: ${error.message}`, "error");
        return null;
      }
      if (!data) {
        showToast("Reklamaci mezitím převedl někdo jiný. Nově založenou zakázku zkontrolujte, ať není dvakrát.", "error");
        return null;
      }
      await zapisHistoriiPrevodu(claim, ticket.id);
      return data as WarrantyClaimRow;
    },
    [zapisHistoriiPrevodu]
  );

  const updateClaimStatus = useCallback(
    async (claimId: string, newStatusKey: string, completedAt?: string | null, popis?: string): Promise<boolean> => {
      if (!supabase) {
        showToast("Chybí připojení.", "error");
        return false;
      }
      const payload: Record<string, any> = { status: newStatusKey };
      if (completedAt) payload.completed_at = completedAt;
      const { error } = await (supabase.from("warranty_claims") as any)
        .update(payload)
        .eq("id", claimId);
      if (error) {
        // Výpadek spojení: stav dojde do databáze z fronty, na obrazovce
        // zůstává nový. Rollback by tu jen vrátil ručičku zpátky a člověk by
        // stav klikal znovu – dokud by mu to nepřestalo dávat smysl.
        if (!jeTrvalaChyba(error)) {
          ulozNaPozdeji({
            klic: `warranty_claims:${claimId}:status`,
            tabulka: "warranty_claims",
            id: claimId,
            data: payload,
            popis: `Stav reklamace · ${popis || claimId}`,
            serviceId: activeServiceId,
            chyba: error,
          });
          showToast("Spojení vypadlo – stav reklamace se uloží sám, jakmile bude připojení. Neztratí se.", "info");
          return true;
        }
        showToast(`Chyba při změně statusu reklamace: ${error.message}`, "error");
        return false;
      }
      return true;
    },
    [activeServiceId]
  );

  type ClaimUpdate = Database["public"]["Tables"]["warranty_claims"]["Update"];
  const updateClaim = useCallback(
    async (claimId: string, payload: ClaimUpdate, popis?: string): Promise<WarrantyClaimRow | null> => {
      if (!supabase) {
        showToast("Chybí připojení.", "error");
        return null;
      }
      const { data, error } = await (supabase.from("warranty_claims") as any)
        .update(payload)
        .eq("id", claimId)
        .select()
        .single();
      if (error) {
        /*
         * Reklamace se do teď ukládala na jeden pokus: při výpadku spojení
         * zůstal jen červený toast a všechno, co technik do detailu napsal
         * (protokol o zákrocích, poznámka, adresa), viselo v paměti okna –
         * po jeho zavření to bylo pryč. Fronta drží cílový stav řádku
         * a dopíše ho sama.
         */
        if (!jeTrvalaChyba(error)) {
          ulozNaPozdeji({
            klic: `warranty_claims:${claimId}:detail`,
            tabulka: "warranty_claims",
            id: claimId,
            data: payload as Record<string, unknown>,
            popis: `Reklamace · ${popis || claimId}`,
            serviceId: activeServiceId,
            chyba: error,
          });
          showToast("Spojení vypadlo – reklamace se uloží sama, jakmile bude připojení. Neztratí se.", "info");
          // Volající si tím doplní svůj stav; v databázi to bude z fronty.
          return { id: claimId, ...(payload as object) } as WarrantyClaimRow;
        }
        showToast(`Chyba při úpravě reklamace: ${error.message}`, "error");
        return null;
      }
      showToast("Reklamace upravena", "success");
      return data as WarrantyClaimRow;
    },
    [activeServiceId]
  );

  const deleteClaim = useCallback(
    async (claimId: string): Promise<boolean> => {
      if (!supabase) {
        showToast("Chybí připojení.", "error");
        return false;
      }
      const { error } = await (supabase.from("warranty_claims") as any).delete().eq("id", claimId);
      if (error) {
        showToast(`Chyba při mazání reklamace: ${error.message}`, "error");
        return false;
      }
      showToast("Reklamace smazána", "success");
      return true;
    },
    []
  );

  return { zalozReklamaci, oznacPrevedeni, makeWarrantyClaimCode, updateClaimStatus, updateClaim, deleteClaim };
}
