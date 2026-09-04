/**
 * Ukázková data pro editor. Krátká varianta odpovídá běžné zakázce,
 * dlouhá slouží k ověření, jak se dokument chová, když je toho hodně.
 */
import type { DocType, DocumentData, Party } from "./types.js";

export type SampleKind = "short" | "long" | "empty";

const SERVICE: Party = {
  name: "iSwap Repair Point Praha",
  person: "Jakub Zima",
  ico: "01028359",
  address: "U Vokovické školy 299/4, 160 00 Praha",
  phone: "+420 773 118 472",
  email: "servis@iswap.cz",
  web: "www.servis.iswap.cz",
};

const PHOTO = (label: string) =>
  `data:image/svg+xml;utf8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="450"><rect width="100%" height="100%" fill="#dfe6ec"/><text x="50%" y="50%" font-family="sans-serif" font-size="28" fill="#6b7a88" text-anchor="middle" dominant-baseline="middle">${label}</text></svg>`
  )}`;

const LONG_TEXT =
  "Telefon přijat s nefunkční dotykovou vrstvou v pravém horním rohu displeje. Po rozebrání zjištěno mechanické poškození displeje a mírné prohnutí rámu; základní deska bez známek kontaktu s kapalinou, indikátory vlhkosti neaktivní. Kondice baterie 84 %, doporučena výměna do půl roku. Face ID funkční. ";

export function sampleData(docType: DocType, kind: SampleKind = "short", service: Party = SERVICE): DocumentData {
  const svc = { ...SERVICE, ...stripEmpty(service) };
  if (kind === "empty") return { service: svc };
  const long = kind === "long";

  const common: DocumentData = {
    number: docType === "faktura" ? "FV-2026-0042" : docType.includes("reklamace") ? "R26000012" : "IRPAZ2601527",
    relatedNumber: docType.includes("reklamace") || docType === "faktura" ? "IRPAZ2601252" : undefined,
    pin: "9398",
    service: svc,
    customer: {
      name: "Jan Novák",
      phone: "+420 777 123 456",
      email: "jan.novak@email.cz",
      address: "Havlíčkova 45, 110 00 Praha 1",
      company: long ? "Novák Consulting s.r.o." : undefined,
      ico: docType === "faktura" ? "87654321" : undefined,
      dic: docType === "faktura" ? "CZ87654321" : undefined,
    },
    device: {
      name: "iPhone 13 Pro 128 GB, grafitová",
      serial: "F2LXK1ABCD9",
      imei: "35 412906 789012 3",
      passcode: "1234",
      condition: long ? "Prasklé zadní sklo, škrábance na rámu a na displeji, mírně prohnutý rám u tlačítek hlasitosti" : "Škrábance na rámu, jinak bez poškození",
      accessories: long ? "Průhledný kryt, nabíjecí kabel USB-C, krabička" : "Bez příslušenství",
      issue: long
        ? "Nefunguje dotyk v pravém horním rohu displeje, občas se objeví zelené pruhy. Zákazník uvádí pád na dlažbu; problém se zhoršuje. Prosí o kontrolu baterie."
        : "Nefunguje dotyk v pravém horním rohu displeje",
    },
    dates: {
      received: "2026-09-01",
      eta: "2026-09-05",
      completed: "2026-09-03",
      diagnosed: "2026-09-03",
      released: "2026-09-04",
      issued: "2026-09-03",
      taxable: "2026-09-03",
      due: "2026-09-17",
    },
    handoff: { receive: "Osobně", return: "Pomocí poštovní zásilky" },
    items: long
      ? [
          { name: "Výměna displeje iPhone 13 Pro (originál)", qty: 1, unit: "ks", unitPrice: 5990, vatRate: 21, total: 5990 },
          { name: "Výměna baterie (originál)", qty: 1, unit: "ks", unitPrice: 2190, vatRate: 21, total: 2190 },
          { name: "Výměna zadního skla", qty: 1, unit: "ks", unitPrice: 2490, vatRate: 21, total: 2490 },
          { name: "Diagnostika", qty: 1, unit: "ks", unitPrice: 0, vatRate: 21, total: 0 },
          { name: "Ochranné sklo + lepení", qty: 1, unit: "ks", unitPrice: 390, vatRate: 21, total: 390 },
          { name: "Práce technika", qty: 1.5, unit: "hod", unitPrice: 600, vatRate: 21, total: 900 },
        ]
      : [{ name: "Výměna displeje iPhone 13 Pro (originál)", qty: 1, unit: "ks", unitPrice: 5990, vatRate: 21, total: 5990 }],
    totals: long
      ? { subtotal: 9884.3, vat: 2075.7, total: 11960, currency: "CZK", vatPayer: true, estimated: 12000 }
      : { subtotal: 4950.41, vat: 1039.59, total: 5990, currency: "CZK", vatPayer: true, estimated: 6000 },
    diagnostic: long ? LONG_TEXT.repeat(4).trim() : LONG_TEXT.trim(),
    note: long ? "Zákazník žádá zavolat před opravou nad 6 000 Kč. Platba kartou při vyzvednutí." : "",
    photos: long ? [PHOTO("Foto 1"), PHOTO("Foto 2"), PHOTO("Foto 3")] : [PHOTO("Foto 1")],
    warranty: { months: 12, until: "2027-09-03" },
    payment: { account: "19-2000145399/0800", iban: "CZ65 0800 0000 1920 0014 5399", swift: "GIBACZPX", vs: "2026000042", spayd: "SPD*1.0*ACC:CZ6508000000192000145399*AM:5990.00*CC:CZK*X-VS:2026000042*MSG:Faktura FV-2026-0042" },
  };
  if (docType === "zakazkovy_list") {
    // Na zakázkovém listu ještě nejsou provedené opravy.
    common.items = [];
    common.totals = { estimated: long ? 12000 : 6000, currency: "CZK" };
  }
  return common;
}

function stripEmpty(p: Party): Party {
  const out: Party = {};
  for (const [k, v] of Object.entries(p)) {
    if (typeof v === "string" && v.trim()) (out as Record<string, string>)[k] = v.trim();
  }
  return out;
}

/** Party servisu z companyData, jak ho posílá Jobi. */
export function serviceFromCompanyData(cd: Record<string, unknown> | null | undefined): Party {
  const s = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
  if (!cd) return {};
  const address = [s(cd.addressStreet), [s(cd.addressZip), s(cd.addressCity)].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  return {
    name: s(cd.name) ?? s(cd.abbreviation),
    ico: s(cd.ico),
    dic: s(cd.dic),
    address: address || undefined,
    phone: s(cd.phone),
    email: s(cd.email),
    web: s(cd.website)?.replace(/^https?:\/\//, ""),
  };
}
