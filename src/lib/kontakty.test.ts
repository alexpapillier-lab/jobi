import { describe, expect, it } from "vitest";
import { BOOK, esc, normTelefon, odpovezDav, prihlaseni, vizitka, vizitky } from "../../supabase/functions/_shared/kontakty";

const karta = {
  id: "c1",
  jmeno: "Jan Novák",
  telefon: "777 123 456",
  email: "Jan@Example.cz",
  firma: "Novák s.r.o.",
  ico: "12345678",
  ulice: "Dlouhá 5",
  mesto: "Praha",
  psc: "11000",
  zeme: null,
  zakazky: [{ kod: "IRP26000253", zarizeni: "Dyson V10", prijato: "2026-10-23T08:00:00Z" }],
};

describe("vizitka zákazníka", () => {
  it("jméno, telefon +420, e-mail malými, firma, adresa, IČO a zakázky v poznámce", () => {
    const v = vizitka(karta, "iSwap").vcard;
    expect(v).toContain("UID:jobi-c1\r\n");
    expect(v).toContain("FN:Jan Novák\r\n");
    expect(v).toContain("N:Novák;Jan;;;\r\n");
    expect(v).toContain("ORG:Novák s.r.o.\r\n");
    expect(v).toContain("TITLE:Dyson V10 · IRP26000253\r\n");
    expect(v).toContain("TEL;TYPE=CELL:+420777123456\r\n");
    expect(v).toContain("EMAIL;TYPE=INTERNET:jan@example.cz\r\n");
    expect(v).toContain("ADR;TYPE=HOME:;;Dlouhá 5;Praha;;11000;\r\n");
    expect(v).toContain("NOTE:IČO: 12345678\\nZakázky iSwap:\\nIRP26000253 · Dyson V10 · 23. 10. 2026\r\n");
    expect(v.startsWith("BEGIN:VCARD\r\nVERSION:3.0\r\n")).toBe(true);
  });

  it("bez firmy, adresy a zakázek jen to podstatné; etag se mění s obsahem", () => {
    const a = vizitka({ id: "c2", jmeno: "Eva", telefon: null, email: "eva@x.cz" }, "S");
    expect(a.vcard).toContain("ORG:Zákazník S\r\n");
    expect(a.vcard).not.toContain("ADR");
    expect(a.vcard).not.toContain("NOTE");
    expect(a.vcard).not.toContain("TEL");
    expect(vizitka({ id: "c2", jmeno: "Eva", email: "eva@y.cz" }, "S").etag).not.toBe(a.etag);
  });

  it("escapování vCard 3.0 a telefony", () => {
    expect(esc("a;b,c\\d\ne")).toBe("a\\;b\\,c\\\\d\\ne");
    expect(normTelefon("00421 905 123 456")).toBe("+421905123456");
    expect(normTelefon("420777123456")).toBe("+420777123456");
    expect(normTelefon("")).toBe("");
  });

  it("karty bez jména se vynechají", () => {
    expect(vizitky([karta, { id: "x", jmeno: "  " }], "S")).toHaveLength(1);
  });
});

describe("CardDAV odpovědi", () => {
  const karty = vizitky([karta], "iSwap");
  const zavolej = (metoda: string, cesta: string, telo = "", depth = "1") => odpovezDav({ metoda, cesta, depth, telo, karty, nazevAdresare: "Zákazníci iSwap" });

  it("principal ukazuje domovskou složku, adresář má sync-token a kartu", () => {
    expect(zavolej("PROPFIND", "/carddav/", "", "0").body).toContain("<card:addressbook-home-set><d:href>/carddav/home/</d:href>");
    const kniha = zavolej("PROPFIND", BOOK).body!;
    expect(kniha).toContain("<d:displayname>Zákazníci iSwap</d:displayname>");
    expect(kniha).toContain(`${BOOK}jobi-c1.vcf`);
    expect(kniha).toMatch(/<d:sync-token>https:\/\/api\.appjobi\.com\/carddav\/sync\/v1-/);
  });

  it("sync-collection: se stejným tokenem nic, jinak karty s daty", () => {
    const prvni = zavolej("REPORT", BOOK, "<d:sync-collection><d:sync-token/><d:prop><card:address-data/></d:prop></d:sync-collection>").body!;
    expect(prvni).toContain("<card:address-data>BEGIN:VCARD");
    const token = prvni.match(/<d:sync-token>([^<]+)</)![1];
    const druhy = zavolej("REPORT", BOOK, `<d:sync-collection><d:sync-token>${token}</d:sync-token></d:sync-collection>`).body!;
    expect(druhy).not.toContain("<d:response>");
  });

  it("multiget s atributem v href (iPhone) vrátí jen požadované", () => {
    const telo = `<C:addressbook-multiget xmlns:C="urn:ietf:params:xml:ns:carddav"><A:href xmlns:A="DAV:">${BOOK}jobi-c1.vcf</A:href></C:addressbook-multiget>`;
    expect(zavolej("REPORT", BOOK, telo).body).toContain("FN:Jan Novák");
    expect(zavolej("REPORT", BOOK, `<C:addressbook-multiget><A:href>${BOOK}jine.vcf</A:href></C:addressbook-multiget>`).body).not.toContain("BEGIN:VCARD");
  });

  it("jen pro čtení a GET vizitky", () => {
    expect(zavolej("PUT", `${BOOK}jobi-c1.vcf`).status).toBe(403);
    const g = zavolej("GET", `${BOOK}jobi-c1.vcf`);
    expect(g.status).toBe(200);
    expect(g.headers["Content-Type"]).toContain("text/vcard");
  });

  it("přihlášení z hlavičky Basic", () => {
    expect(prihlaseni(`Basic ${btoa("Jobi-ABC:tajne:heslo")}`)).toEqual({ login: "jobi-abc", heslo: "tajne:heslo" });
    expect(prihlaseni("Bearer x")).toBeNull();
    expect(prihlaseni(null)).toBeNull();
  });
});

describe("profil pro iPhone (.mobileconfig)", async () => {
  const { profilIphone } = await import("./kontaktyTelefon");
  it("účet CardDAV na api.appjobi.com s jménem a heslem, text escapovaný", () => {
    const x = profilIphone({ login: "jobi-abc", heslo: "a<b&c", servis: "Servis & spol." });
    expect(x).toContain("<key>PayloadType</key><string>com.apple.carddav.account</string>");
    expect(x).toContain("<key>CardDAVHostName</key><string>api.appjobi.com</string>");
    expect(x).toContain("<key>CardDAVPrincipalURL</key><string>/carddav/</string>");
    expect(x).toContain("<key>CardDAVUsername</key><string>jobi-abc</string>");
    expect(x).toContain("<key>CardDAVPassword</key><string>a&lt;b&amp;c</string>");
    expect(x).toContain("Zákazníci Servis &amp; spol.");
    expect(x).not.toMatch(/&(?!amp;|lt;|gt;|quot;)/);
  });
});
