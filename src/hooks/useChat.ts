import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  KANAL_SERVIS,
  frontaJakoZpravy,
  hledej,
  jePlatnyKlic,
  kanalZpravy,
  naFrontuChatu,
  nactiKanaly,
  nactiNeprectene,
  nactiPripnutou,
  nactiZpravy,
  nahledZpravy,
  obnovReakce,
  odesliFrontuChatu,
  oznacPrecteno,
  posliZpravu,
  prepniReakci,
  pripni,
  reaguj,
  smaz,
  sledujChat,
  souhrnNeprectenych,
  type Kanal,
  type NeodeslanaZprava,
  type PrilohaChatu,
  type Zminka,
  type ZpravaChatu,
} from "../lib/chat";
import { maUpozornit, oknoMaFokus, upozorniNaZpravu, zacinkej } from "../lib/chatUpozorneni";
import { useClenoveServisu } from "./useClenoveServisu";

/**
 * Stav plovoucího chatu: kanály, nepřečtené, zprávy aktivního kanálu,
 * realtime odběr a fronta neodeslaných.
 *
 * Aktivní kanál se pamatuje na zařízení zvlášť pro každý servis – kdo
 * pracuje hlavně na jedné pobočce, nechce po každém startu přepínat.
 */

const klicKanalu = (serviceId: string) => `jobi_chat_kanal__${serviceId}`;

function nactiUlozenyKanal(serviceId: string): string {
  try {
    const v = localStorage.getItem(klicKanalu(serviceId));
    return v && jePlatnyKlic(v) ? v : KANAL_SERVIS;
  } catch {
    return KANAL_SERVIS;
  }
}

function ulozKanal(serviceId: string, kanal: string): void {
  try {
    localStorage.setItem(klicKanalu(serviceId), kanal);
  } catch {
    /* soukromý režim */
  }
}

/** Nahradí zprávu se stejným id, nebo ji přidá na konec – realtime i vlastní odeslání chodí dvakrát. */
function slouc(seznam: ZpravaChatu[], z: ZpravaChatu): ZpravaChatu[] {
  const i = seznam.findIndex((x) => x.id === z.id);
  if (i < 0) return [...seznam, z];
  const kopie = seznam.slice();
  // Reakce se u zprávy nevozí – zůstávají ty, co už máme.
  kopie[i] = { ...z, reakce: z.reakce.length > 0 ? z.reakce : seznam[i].reakce };
  return kopie;
}

export type UseChatVstup = {
  serviceId: string | null;
  userId: string | null;
  zapnuto: boolean;
  /** Je panel otevřený? Podle toho se rozhoduje o upozornění a označení přečteno. */
  otevreno: boolean;
};

export function useChat({ serviceId, userId, zapnuto, otevreno }: UseChatVstup) {
  const aktivni = !!serviceId && !!userId && zapnuto;
  const { clenove, jmeno } = useClenoveServisu(serviceId, aktivni);
  const clenPodleId = useMemo(() => new Map(clenove.map((c) => [c.userId, c])), [clenove]);
  const clen = useCallback((id: string | null | undefined) => (id ? clenPodleId.get(id) ?? null : null), [clenPodleId]);

  const [kanaly, setKanaly] = useState<Kanal[]>([]);
  const [neprectene, setNeprectene] = useState<Record<string, number>>({});
  const [aktivniKanal, setAktivniKanalState] = useState<string>(() => (serviceId ? nactiUlozenyKanal(serviceId) : KANAL_SERVIS));
  const [serverZpravy, setServerZpravy] = useState<ZpravaChatu[]>([]);
  const [fronta, setFronta] = useState<NeodeslanaZprava[]>([]);
  const [pripnuta, setPripnuta] = useState<ZpravaChatu | null>(null);
  const [nacitam, setNacitam] = useState(false);
  const [nacitamStarsi, setNacitamStarsi] = useState(false);
  const [maStarsi, setMaStarsi] = useState(false);
  const [chyba, setChyba] = useState<string | null>(null);

  // Realtime callbacky potřebují aktuální stav bez opakovaného přihlašování odběru.
  const aktivniKanalRef = useRef(aktivniKanal);
  const otevrenoRef = useRef(otevreno);
  const kanalyRef = useRef(kanaly);
  const jmenoRef = useRef(jmeno);
  const serverZpravyRef = useRef(serverZpravy);
  aktivniKanalRef.current = aktivniKanal;
  otevrenoRef.current = otevreno;
  kanalyRef.current = kanaly;
  jmenoRef.current = jmeno;
  serverZpravyRef.current = serverZpravy;

  /* Označí aktivní kanál za přečtený – lokálně hned, na serveru na pozadí. */
  const oznacAktivniPrecteno = useCallback(() => {
    if (!serviceId) return;
    const kanal = aktivniKanalRef.current;
    setNeprectene((prev) => {
      if (!prev[kanal]) return prev;
      const { [kanal]: _pryc, ...zbytek } = prev;
      return zbytek;
    });
    void oznacPrecteno(serviceId, kanal);
  }, [serviceId]);

  const nactiSouhrn = useCallback(async () => {
    if (!serviceId) return;
    try {
      setNeprectene(await nactiNeprectene(serviceId));
    } catch {
      /* bublina zůstane s posledním známým stavem */
    }
  }, [serviceId]);

  // Kanály a nepřečtené při startu; kanály znovu při každém otevření panelu (nový kolega).
  useEffect(() => {
    if (!aktivni || !serviceId) {
      setKanaly([]);
      setNeprectene({});
      return;
    }
    let zivy = true;
    void nactiKanaly(serviceId)
      .then((k) => {
        if (!zivy) return;
        setKanaly(k);
        // Uložený kanál může být pobočka, ke které už nemám přístup.
        setAktivniKanalState((cur) => (k.some((x) => x.kanal === cur) ? cur : KANAL_SERVIS));
      })
      .catch((e: unknown) => {
        if (zivy) setChyba(e instanceof Error ? e.message : "Kanály se nenačetly");
      });
    void nactiSouhrn();
    return () => {
      zivy = false;
    };
  }, [aktivni, serviceId, otevreno, nactiSouhrn]);

  // Změna servisu → kanál z paměti zařízení.
  useEffect(() => {
    if (serviceId) setAktivniKanalState(nactiUlozenyKanal(serviceId));
  }, [serviceId]);

  const setAktivniKanal = useCallback(
    (kanal: string) => {
      if (!jePlatnyKlic(kanal)) return;
      setAktivniKanalState(kanal);
      if (serviceId) ulozKanal(serviceId, kanal);
    },
    [serviceId]
  );

  // Zprávy aktivního kanálu.
  const nacteni = useRef(0);
  const nactiKanal = useCallback(async () => {
    if (!aktivni || !serviceId) {
      setServerZpravy([]);
      setPripnuta(null);
      return;
    }
    const id = ++nacteni.current;
    setNacitam(true);
    setChyba(null);
    try {
      const [{ zpravy, maStarsi: dalsi }, pin] = await Promise.all([nactiZpravy(serviceId, aktivniKanal), nactiPripnutou(serviceId, aktivniKanal)]);
      if (id !== nacteni.current) return;
      setServerZpravy(zpravy);
      setMaStarsi(dalsi);
      setPripnuta(pin);
      if (otevrenoRef.current && oknoMaFokus()) oznacAktivniPrecteno();
    } catch (e) {
      if (id === nacteni.current) setChyba(e instanceof Error ? e.message : "Zprávy se nenačetly");
    } finally {
      if (id === nacteni.current) setNacitam(false);
    }
  }, [aktivni, serviceId, aktivniKanal, oznacAktivniPrecteno]);

  useEffect(() => {
    // Zavřený panel zprávy nepotřebuje – načtou se při otevření. Šetří to
    // dotazy u lidí, kteří chat nepoužívají.
    if (!otevreno) return;
    void nactiKanal();
  }, [nactiKanal, otevreno]);

  const nactiStarsi = useCallback(async () => {
    if (!serviceId || nacitamStarsi || serverZpravy.length === 0) return;
    setNacitamStarsi(true);
    try {
      const nejstarsi = serverZpravy[0].createdAt;
      const { zpravy, maStarsi: dalsi } = await nactiZpravy(serviceId, aktivniKanal, nejstarsi);
      setServerZpravy((prev) => {
        const ids = new Set(prev.map((z) => z.id));
        return [...zpravy.filter((z) => !ids.has(z.id)), ...prev];
      });
      setMaStarsi(dalsi);
    } catch (e) {
      setChyba(e instanceof Error ? e.message : "Starší zprávy se nenačetly");
    } finally {
      setNacitamStarsi(false);
    }
  }, [serviceId, aktivniKanal, nacitamStarsi, serverZpravy]);

  // Fronta neodeslaných – její stav se kreslí jako „odesílá se“.
  useEffect(() => naFrontuChatu(setFronta), []);

  /* Po doručení z fronty se řádek rovnou vloží – realtime vlastní zprávu
     přinese taky, ale později, a mezitím by po zmizení z fronty chyběla. */
  const naOdeslano = useCallback(
    (z: ZpravaChatu) => {
      if (!userId) return;
      if (kanalZpravy(z, userId) !== aktivniKanalRef.current) return;
      setServerZpravy((prev) => slouc(prev, z));
    },
    [userId]
  );

  useEffect(() => {
    if (!aktivni) return;
    const znovu = () => void odesliFrontuChatu(naOdeslano);
    window.addEventListener("online", znovu);
    if (otevreno) znovu();
    return () => window.removeEventListener("online", znovu);
  }, [aktivni, otevreno, naOdeslano]);

  // Realtime.
  const souhrnCasovac = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!aktivni || !serviceId || !userId) return;
    const odhlas = sledujChat(
      serviceId,
      ({ udalost, zprava }) => {
        const kanal = kanalZpravy(zprava, userId);
        const jeCizi = zprava.senderId !== userId;
        const vAktivnim = kanal === aktivniKanalRef.current;

        if (udalost === "UPDATE") {
          if (vAktivnim) {
            setServerZpravy((prev) => (prev.some((z) => z.id === zprava.id) ? slouc(prev, zprava) : prev));
            setPripnuta((prev) => {
              if (zprava.pinned && !zprava.deletedAt) return prev && prev.createdAt > zprava.createdAt ? prev : zprava;
              return prev?.id === zprava.id ? null : prev;
            });
          }
          return;
        }

        if (vAktivnim) {
          setServerZpravy((prev) => slouc(prev, zprava));
          if (otevrenoRef.current && oknoMaFokus() && jeCizi) oznacAktivniPrecteno();
        }
        if (jeCizi && !(vAktivnim && otevrenoRef.current && oknoMaFokus())) {
          setNeprectene((prev) => ({ ...prev, [kanal]: (prev[kanal] ?? 0) + 1 }));
          // Lokální počítadlo je odhad; server ví, co jsem četl jinde.
          if (souhrnCasovac.current) clearTimeout(souhrnCasovac.current);
          souhrnCasovac.current = setTimeout(() => void nactiSouhrn(), 2500);
        }
        if (maUpozornit({ jeCizi, kanal, aktivniKanal: aktivniKanalRef.current, panelOtevren: otevrenoRef.current, oknoMaFokus: oknoMaFokus() })) {
          zacinkej();
          const odesilatel = jmenoRef.current(zprava.senderId) ?? "Kolega";
          const nazevKanalu = kanalyRef.current.find((k) => k.kanal === kanal)?.nazev;
          const titulek = kanal === KANAL_SERVIS || kanal.startsWith("dm:") ? odesilatel : `${odesilatel} · ${nazevKanalu ?? "pobočka"}`;
          void upozorniNaZpravu({ titulek, text: nahledZpravy(zprava), kanal });
        }
      },
      ({ udalost, reakce }) => {
        if (!reakce) {
          // Smazání bez sloupců – načíst reakce viditelných zpráv znovu.
          const ids = serverZpravyRef.current.map((z) => z.id);
          if (ids.length === 0) return;
          void obnovReakce(ids).then((mapa) => setServerZpravy((prev) => prev.map((z) => ({ ...z, reakce: mapa.get(z.id) ?? [] }))));
          return;
        }
        setServerZpravy((prev) => {
          const i = prev.findIndex((z) => z.id === reakce.messageId);
          if (i < 0) return prev;
          const z = prev[i];
          const bez = z.reakce.filter((r) => !(r.userId === reakce.userId && r.emoji === reakce.emoji));
          const nove = udalost === "INSERT" ? [...bez, reakce] : bez;
          const kopie = prev.slice();
          kopie[i] = { ...z, reakce: nove };
          return kopie;
        });
      }
    );
    return () => {
      odhlas();
      if (souhrnCasovac.current) clearTimeout(souhrnCasovac.current);
    };
  }, [aktivni, serviceId, userId, oznacAktivniPrecteno, nactiSouhrn]);

  // Návrat do okna s otevřeným panelem = přečteno.
  useEffect(() => {
    if (!aktivni || !otevreno) return;
    const naFokus = () => {
      if (oknoMaFokus() && (neprectene[aktivniKanalRef.current] ?? 0) > 0) oznacAktivniPrecteno();
    };
    window.addEventListener("focus", naFokus);
    document.addEventListener("visibilitychange", naFokus);
    return () => {
      window.removeEventListener("focus", naFokus);
      document.removeEventListener("visibilitychange", naFokus);
    };
  }, [aktivni, otevreno, neprectene, oznacAktivniPrecteno]);

  // Otevření panelu / přepnutí kanálu s nepřečtenými = přečteno.
  useEffect(() => {
    if (!aktivni || !otevreno) return;
    if ((neprectene[aktivniKanal] ?? 0) > 0 && oknoMaFokus()) oznacAktivniPrecteno();
  }, [aktivni, otevreno, aktivniKanal, neprectene, oznacAktivniPrecteno]);

  const odeslat = useCallback(
    (v: { text: string; mentions?: Zminka[]; attachments?: PrilohaChatu[] }) => {
      if (!serviceId || !userId) return;
      if (!v.text.trim() && !(v.attachments && v.attachments.length > 0)) return;
      posliZpravu({ serviceId, kanal: aktivniKanal, senderId: userId, text: v.text, mentions: v.mentions, attachments: v.attachments }, naOdeslano);
    },
    [serviceId, userId, aktivniKanal, naOdeslano]
  );

  const pripnout = useCallback(async (id: string, pinned: boolean) => {
    await pripni(id, pinned);
    setServerZpravy((prev) => prev.map((z) => (z.id === id ? { ...z, pinned } : z)));
    setPripnuta((prev) => {
      if (!pinned) return prev?.id === id ? null : prev;
      const z = serverZpravyRef.current.find((x) => x.id === id);
      return z ? { ...z, pinned: true } : prev;
    });
  }, []);

  const smazat = useCallback(async (id: string) => {
    await smaz(id);
    const ted = new Date().toISOString();
    setServerZpravy((prev) => prev.map((z) => (z.id === id ? { ...z, deletedAt: ted } : z)));
    setPripnuta((prev) => (prev?.id === id ? null : prev));
  }, []);

  const reagovat = useCallback(
    async (z: ZpravaChatu, emoji: string) => {
      if (!userId || z.stav) return;
      const { reakce, pridano } = prepniReakci(z.reakce, z.id, userId, emoji);
      setServerZpravy((prev) => prev.map((x) => (x.id === z.id ? { ...x, reakce } : x)));
      try {
        await reaguj(z.id, userId, emoji, pridano);
      } catch {
        // Vrátit zpět – server to odmítl.
        setServerZpravy((prev) => prev.map((x) => (x.id === z.id ? { ...x, reakce: z.reakce } : x)));
        throw new Error("Reakce se neuložila");
      }
    },
    [userId]
  );

  const hledat = useCallback((dotaz: string) => (serviceId ? hledej(serviceId, dotaz) : Promise.resolve([])), [serviceId]);

  /* Zprávy k vykreslení: serverové + čekající ve frontě (které server ještě nevrátil). */
  const zpravy = useMemo(() => {
    if (!serviceId) return serverZpravy;
    const ids = new Set(serverZpravy.map((z) => z.id));
    const cekajici = frontaJakoZpravy(fronta, serviceId, aktivniKanal).filter((z) => !ids.has(z.id));
    return cekajici.length === 0 ? serverZpravy : [...serverZpravy, ...cekajici];
  }, [serverZpravy, fronta, serviceId, aktivniKanal]);

  const celkemNeprectenych = useMemo(() => souhrnNeprectenych(neprectene), [neprectene]);

  return {
    kanaly,
    neprectene,
    celkemNeprectenych,
    aktivniKanal,
    setAktivniKanal,
    zpravy,
    pripnuta,
    nacitam,
    nacitamStarsi,
    maStarsi,
    chyba,
    nactiStarsi,
    obnov: nactiKanal,
    odeslat,
    pripnout,
    smazat,
    reagovat,
    hledat,
    clenove,
    clen,
    jmeno,
  };
}
