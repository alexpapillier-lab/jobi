import { describe, it, expect } from "vitest";
import { onboardingKroky, pocetHotovych, vsePovinneHotovo, type OnboardingStav } from "./onboardingKroky";

/**
 * Karta „První kroky“ je to jediné, co nového zákazníka v prázdné aplikaci
 * navádí. Když se krok neodškrtne, ačkoli ho splnil, přestane seznamu věřit;
 * a když se odškrtne, ačkoli ho nesplnil, odejde od pultu s dokumenty, na
 * kterých chybí IČO.
 */
function stav(zmeny: Partial<OnboardingStav> = {}): OnboardingStav {
  return {
    config: {},
    zakazek: 0,
    clenu: 1,
    jobiDocsBezi: false,
    desktop: false,
    odkazJobiDocs: "https://appjobi.com/stazeni",
    ...zmeny,
  };
}

function krok(s: OnboardingStav, id: string) {
  const k = onboardingKroky(s).find((x) => x.id === id);
  if (!k) throw new Error(`Krok ${id} v seznamu není.`);
  return k;
}

const PLNA_FIRMA = { name: "Auto Servis Brno", ico: "12345678", addressStreet: "Nádražní 1", addressCity: "Brno" };

describe("první kroky nového servisu", () => {
  it("úplně nový servis nemá hotové nic povinného", () => {
    const kroky = onboardingKroky(stav());
    expect(pocetHotovych(kroky)).toBe(0);
    expect(vsePovinneHotovo(kroky)).toBe(false);
  });

  it("údaje firmy chtějí všechna čtyři pole – tisknou se v hlavičce dokladu", () => {
    expect(krok(stav({ config: { companyData: PLNA_FIRMA } }), "firma").hotovo).toBe(true);
    // Bez města je adresa na příjemce k ničemu, i když zbytek je vyplněný.
    expect(krok(stav({ config: { companyData: { ...PLNA_FIRMA, addressCity: "" } } }), "firma").hotovo).toBe(false);
    // Samé mezery nejsou vyplněný údaj.
    expect(krok(stav({ config: { companyData: { ...PLNA_FIRMA, ico: "   " } } }), "firma").hotovo).toBe(false);
  });

  it("kontakt stačí jeden – telefon nebo e-mail", () => {
    expect(krok(stav({ config: { companyData: { phone: "+420777123456" } } }), "kontakt").hotovo).toBe(true);
    expect(krok(stav({ config: { companyData: { email: "servis@example.cz" } } }), "kontakt").hotovo).toBe(true);
    expect(krok(stav({ config: { companyData: {} } }), "kontakt").hotovo).toBe(false);
  });

  it("zkratku pozná na obou místech configu – jinak by ji chtěl po servisu, který ji má", () => {
    expect(krok(stav({ config: { abbreviation: "ASB" } }), "zkratka").hotovo).toBe(true);
    expect(krok(stav({ config: { companyData: { abbreviation: "ASB" } } }), "zkratka").hotovo).toBe(true);
    expect(krok(stav({ config: {} }), "zkratka").hotovo).toBe(false);
  });

  it("nouzové SRV se za nastavenou zkratku nepovažuje – právě na to má krok upozornit", () => {
    expect(krok(stav({ config: { abbreviation: "SRV" } }), "zkratka").hotovo).toBe(false);
  });

  it("samotný název firmy zkratku neodškrtne – čísla by pak nešlo zpětně přepsat", () => {
    // Generátor si z názvu poradí, ale majitel si má zkratku vědomě potvrdit,
    // dokud ještě nemá vytištěné doklady s číslem.
    expect(krok(stav({ config: { companyData: { name: "Auto Servis Brno" } } }), "zkratka").hotovo).toBe(false);
  });

  it("první zakázka se odškrtne, jakmile nějaká je", () => {
    expect(krok(stav({ zakazek: 0 }), "zakazka").hotovo).toBe(false);
    expect(krok(stav({ zakazek: 1 }), "zakazka").hotovo).toBe(true);
  });

  it("kolega se počítá až od druhého člena – majitel sám tým není", () => {
    expect(krok(stav({ clenu: 1 }), "tym").hotovo).toBe(false);
    expect(krok(stav({ clenu: 2 }), "tym").hotovo).toBe(true);
  });
});

describe("dojití do konce", () => {
  const hotovyServis = stav({
    config: { abbreviation: "ASB", companyData: { ...PLNA_FIRMA, abbreviation: "ASB", phone: "+420777123456" } },
    zakazek: 1,
  });

  it("v prohlížeči se seznam dá dokončit i bez JobiDocs – jinak by nezmizel nikdy", () => {
    const kroky = onboardingKroky({ ...hotovyServis, desktop: false, jobiDocsBezi: false });
    expect(krok({ ...hotovyServis, desktop: false }, "jobidocs").volitelny).toBe(true);
    expect(vsePovinneHotovo(kroky)).toBe(true);
  });

  it("na desktopu je tisk povinný – bez JobiDocs se doklad nevytiskne", () => {
    const bez = onboardingKroky({ ...hotovyServis, desktop: true, jobiDocsBezi: false });
    expect(vsePovinneHotovo(bez)).toBe(false);
    const s = onboardingKroky({ ...hotovyServis, desktop: true, jobiDocsBezi: true });
    expect(vsePovinneHotovo(s)).toBe(true);
  });

  it("pozvání kolegy seznam nikdy nedrží otevřený", () => {
    const kroky = onboardingKroky({ ...hotovyServis, clenu: 1 });
    expect(vsePovinneHotovo(kroky)).toBe(true);
    expect(pocetHotovych(kroky)).toBeLessThan(kroky.length);
  });

  it("nenačtený config nic neodškrtne, ale ani nespadne", () => {
    const kroky = onboardingKroky(stav({ config: null }));
    expect(() => pocetHotovych(kroky)).not.toThrow();
    expect(pocetHotovych(kroky)).toBe(0);
  });
});

describe("kam krok odkazuje", () => {
  it("každý nesplněný krok kromě první zakázky nabízí, kam jít", () => {
    // Zakázku zákazník založí tlačítkem, které je hned pod seznamem, proto
    // jediná nemá odskok. Ostatní kroky bez odkazu by byly slepé uličky.
    for (const k of onboardingKroky(stav())) {
      if (k.id === "zakazka") continue;
      expect(k.cil || k.odkaz, `Krok ${k.id} nemá kam poslat.`).toBeTruthy();
    }
  });

  it("ve webové verzi vede krok o tisku na stažení aplikace, ne do Nastavení", () => {
    const k = krok(stav({ desktop: false }), "jobidocs");
    expect(k.odkaz).toBe("https://appjobi.com/stazeni");
    expect(k.cil).toBeUndefined();
  });

  it("na desktopu vede do Nastavení tisku, ne na web", () => {
    const k = krok(stav({ desktop: true }), "jobidocs");
    expect(k.cil).toBe("orders_tisk_dokumentu");
    expect(k.odkaz).toBeUndefined();
  });
});
