/**
 * Tisk a export dokumentu – hlavně chybové stavy.
 *
 * Proč zrovna tohle: desktopová větev jde přes JobiDocs a nativní dialog, což
 * v prohlížeči nikdo neotestuje. Zajímá nás jediné – že se uživatel o každém
 * selhání dozví a že se nic neztratí potichu.
 */
import { describe, it, expect, vi } from "vitest";
import { spojCestu, spustDesktopovyDokument, spustWebovyDokument, vychoziSlozkaProExport, type ZavislostiDokumentu } from "./tiskDokumentu";
import type { DocumentData } from "./documentData";

const DATA = { ticket: { code: "Z-1" } } as unknown as DocumentData;
const SERVIS = "882beee7-4564-4d10-8ac6-16dc19240b57";

type Zaznamy = {
  hlasky: Array<{ text: string; druh: string }>;
  telemetrie: Array<{ action: string; result: string; errorMessage?: string }>;
  exporty: string[];
};

function zavislosti(prepis: Partial<ZavislostiDokumentu> = {}): { z: ZavislostiDokumentu; zaznamy: Zaznamy } {
  const zaznamy: Zaznamy = { hlasky: [], telemetrie: [], exporty: [] };
  let cas = 0;
  const z: ZavislostiDokumentu = {
    jobiDocsBezi: async () => true,
    tisk: async () => ({ ok: true }),
    exportPdf: async () => ({ ok: true }),
    vyberCilovySoubor: async () => "/Users/test/Desktop/zakazka-Z-1.pdf",
    tiskVProhlizeci: async () => {},
    hlaska: (text, druh) => zaznamy.hlasky.push({ text, druh }),
    hotovyExport: (cesta) => zaznamy.exporty.push(cesta),
    telemetrie: (e) => zaznamy.telemetrie.push(e),
    ted: () => (cas += 10),
    ...prepis,
  };
  return { z, zaznamy };
}

const chyby = (zaznamy: Zaznamy) => zaznamy.hlasky.filter((h) => h.druh === "error");

describe("desktopový tisk přes JobiDocs", () => {
  it("bez spuštěného JobiDocs netiskne a řekne proč", async () => {
    const tisk = vi.fn();
    const { z, zaznamy } = zavislosti({ jobiDocsBezi: async () => false, tisk });
    await spustDesktopovyDokument("print", "zakazkovy_list", SERVIS, DATA, "z.pdf", z);
    expect(tisk).not.toHaveBeenCalled();
    expect(chyby(zaznamy)[0].text).toContain("Spusťte JobiDocs");
  });

  it("úspěšný tisk potvrdí uživateli, že úloha odešla", async () => {
    const { z, zaznamy } = zavislosti();
    await spustDesktopovyDokument("print", "zakazkovy_list", SERVIS, DATA, "z.pdf", z);
    expect(zaznamy.hlasky).toEqual([{ text: "Úloha odeslána do fronty", druh: "success" }]);
    expect(zaznamy.telemetrie[0]).toMatchObject({ action: "print", result: "success" });
  });

  it("chybějící tiskárna se ukáže uživateli, ne jen do konzole", async () => {
    const { z, zaznamy } = zavislosti({ tisk: async () => ({ ok: false, error: "No printer found" }) });
    await spustDesktopovyDokument("print", "zakazkovy_list", SERVIS, DATA, "z.pdf", z);
    expect(chyby(zaznamy)[0].text).toContain("No printer found");
    expect(zaznamy.telemetrie[0]).toMatchObject({ action: "print", result: "error", errorMessage: "No printer found" });
  });

  it("chybějící šablona dostane návod, co s tím", async () => {
    const { z, zaznamy } = zavislosti({ tisk: async () => ({ ok: false, error: "Template not found" }) });
    await spustDesktopovyDokument("print", "zakazkovy_list", SERVIS, DATA, "z.pdf", z);
    expect(chyby(zaznamy)[0].text).toContain("restartujte JobiDocs");
  });

  it("výjimka při komunikaci s JobiDocs skončí hláškou, ne tichem", async () => {
    const { z, zaznamy } = zavislosti({
      tisk: async () => {
        throw new Error("error sending request");
      },
    });
    await spustDesktopovyDokument("print", "zakazkovy_list", SERVIS, DATA, "z.pdf", z);
    expect(chyby(zaznamy)[0].text).toBe("Chyba tisku: error sending request");
    expect(zaznamy.telemetrie[0]).toMatchObject({ result: "error" });
  });
});

describe("desktopový export do PDF", () => {
  it("uloží na cestu z dialogu a nabídne ji uživateli", async () => {
    const exportPdf = vi.fn(async () => ({ ok: true }));
    const { z, zaznamy } = zavislosti({ exportPdf });
    await spustDesktopovyDokument("export", "zakazkovy_list", SERVIS, DATA, "zakazka-Z-1.pdf", z);
    expect(exportPdf).toHaveBeenCalledWith("zakazkovy_list", SERVIS, DATA, "/Users/test/Desktop/zakazka-Z-1.pdf");
    expect(zaznamy.exporty).toEqual(["/Users/test/Desktop/zakazka-Z-1.pdf"]);
  });

  it("dialog dostane navržený název souboru", async () => {
    const vyberCilovySoubor = vi.fn(async () => "/tmp/x.pdf");
    const { z } = zavislosti({ vyberCilovySoubor });
    await spustDesktopovyDokument("export", "zarucni_list", SERVIS, DATA, "zarucni-list-Z-1.pdf", z);
    expect(vyberCilovySoubor).toHaveBeenCalledWith("zarucni-list-Z-1.pdf");
  });

  it("zavřený dialog nic neuloží a neotravuje chybou", async () => {
    const exportPdf = vi.fn();
    const { z, zaznamy } = zavislosti({ vyberCilovySoubor: async () => null, exportPdf });
    await spustDesktopovyDokument("export", "zakazkovy_list", SERVIS, DATA, "z.pdf", z);
    expect(exportPdf).not.toHaveBeenCalled();
    expect(zaznamy.hlasky).toEqual([]);
    expect(zaznamy.telemetrie).toEqual([]);
  });

  it("selhání zápisu souboru uživatel uvidí – jinak by čekal na PDF, které nevzniklo", async () => {
    const { z, zaznamy } = zavislosti({ exportPdf: async () => ({ ok: false, error: "EACCES: permission denied" }) });
    await spustDesktopovyDokument("export", "zakazkovy_list", SERVIS, DATA, "z.pdf", z);
    expect(chyby(zaznamy)[0].text).toContain("permission denied");
    expect(zaznamy.exporty).toEqual([]);
  });

  it("rozbitý nativní dialog se nezamění za zavřený dialog", async () => {
    // Když plugin selže (chybí oprávnění v capabilities), musí přijít chyba.
    const { z, zaznamy } = zavislosti({
      vyberCilovySoubor: async () => {
        throw new Error("dialog.save not allowed");
      },
    });
    await spustDesktopovyDokument("export", "zakazkovy_list", SERVIS, DATA, "z.pdf", z);
    expect(chyby(zaznamy)[0].text).toBe("Chyba exportu: dialog.save not allowed");
    expect(zaznamy.telemetrie[0]).toMatchObject({ action: "export", result: "error" });
  });

  it("bez JobiDocs se dialog vůbec neotevře", async () => {
    const vyberCilovySoubor = vi.fn();
    const { z, zaznamy } = zavislosti({ jobiDocsBezi: async () => false, vyberCilovySoubor });
    await spustDesktopovyDokument("export", "zakazkovy_list", SERVIS, DATA, "z.pdf", z);
    expect(vyberCilovySoubor).not.toHaveBeenCalled();
    expect(chyby(zaznamy)[0].text).toContain("export do PDF");
  });
});

describe("webová větev dělá totéž co desktopová", () => {
  it("úspěšný tisk zapíše telemetrii se stejnou akcí", async () => {
    const { z, zaznamy } = zavislosti();
    await spustWebovyDokument("print", "zakazkovy_list", SERVIS, DATA, z);
    expect(zaznamy.telemetrie[0]).toMatchObject({ action: "print", docType: "zakazkovy_list", result: "success" });
  });

  it("u exportu poradí, kde v dialogu zvolit PDF", async () => {
    const { z, zaznamy } = zavislosti();
    await spustWebovyDokument("export", "faktura", SERVIS, DATA, z);
    expect(zaznamy.hlasky[0]).toEqual({ text: "V tiskovém dialogu zvolte cíl „Uložit jako PDF“.", druh: "info" });
  });

  it("selhání tiskového dialogu prohlížeče uživatel uvidí", async () => {
    const { z, zaznamy } = zavislosti({
      tiskVProhlizeci: async () => {
        throw new Error("Nepodařilo se připravit tiskový náhled.");
      },
    });
    await spustWebovyDokument("print", "zakazkovy_list", SERVIS, DATA, z);
    expect(chyby(zaznamy)[0].text).toBe("Tisk se nezdařil: Nepodařilo se připravit tiskový náhled.");
  });

  it("obě větve hlásí chybu stejného typu – žádná ji nespolkne", async () => {
    const { z: zWeb, zaznamy: web } = zavislosti({
      tiskVProhlizeci: async () => {
        throw new Error("boom");
      },
    });
    const { z: zDesk, zaznamy: desk } = zavislosti({
      tisk: async () => {
        throw new Error("boom");
      },
    });
    await spustWebovyDokument("print", "zakazkovy_list", SERVIS, DATA, zWeb);
    await spustDesktopovyDokument("print", "zakazkovy_list", SERVIS, DATA, "z.pdf", zDesk);
    expect(chyby(web)).toHaveLength(1);
    expect(chyby(desk)).toHaveLength(1);
    expect(web.telemetrie[0].result).toBe("error");
    expect(desk.telemetrie[0].result).toBe("error");
  });
});

describe("cesta k exportovanému souboru", () => {
  it("nezdvojí oddělovač, když složka končí lomítkem", () => {
    expect(spojCestu("/Users/test/Downloads/", "Faktura_1.pdf")).toBe("/Users/test/Downloads/Faktura_1.pdf");
    expect(spojCestu("/Users/test/Downloads", "Faktura_1.pdf")).toBe("/Users/test/Downloads/Faktura_1.pdf");
  });

  it("na Windows nemíchá lomítka – cesta se ukazuje uživateli v hlášce", () => {
    expect(spojCestu("C:\\Users\\test\\Downloads", "Faktura_1.pdf")).toBe("C:\\Users\\test\\Downloads\\Faktura_1.pdf");
    expect(spojCestu("C:\\Users\\test\\Downloads\\", "Faktura_1.pdf")).toBe("C:\\Users\\test\\Downloads\\Faktura_1.pdf");
  });
});

describe("výchozí složka pro export dokladu", () => {
  it("přednost mají Stažené", async () => {
    const slozka = await vychoziSlozkaProExport({
      downloadDir: async () => "/Users/test/Downloads",
      desktopDir: async () => "/Users/test/Desktop",
    });
    expect(slozka).toBe("/Users/test/Downloads");
  });

  it("bez složky Stažené padne na Plochu", async () => {
    const slozka = await vychoziSlozkaProExport({
      downloadDir: async () => {
        throw new Error("path.download_dir not allowed");
      },
      desktopDir: async () => "/Users/test/Desktop",
    });
    expect(slozka).toBe("/Users/test/Desktop");
  });

  it("když nejde ani jedna, je to chyba – ne tichý zápis do /tmp", async () => {
    // Dřív se v tomhle případě uložilo do /tmp a uživateli se ohlásilo
    // „PDF uložen“. Soubor nikdo nenašel a systém ho po čase smazal.
    const beh = vychoziSlozkaProExport({
      downloadDir: async () => {
        throw new Error("nic");
      },
      desktopDir: async () => {
        throw new Error("taky nic");
      },
    });
    await expect(beh).rejects.toThrow("Stažené ani Plocha");
  });
});
