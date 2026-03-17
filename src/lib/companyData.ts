import { STORAGE_KEYS } from "../constants/storageKeys";

export type CompanyData = {
  abbreviation: string;
  name: string;
  ico: string;
  dic: string;
  language: string;
  defaultPhonePrefix: string;
  addressStreet: string;
  addressCity: string;
  addressZip: string;
  phone: string;
  email: string;
  website: string;
  bankAccount: string;
  iban: string;
  swift: string;
};

export function defaultCompanyData(): CompanyData {
  return {
    abbreviation: "",
    name: "",
    ico: "",
    dic: "",
    language: "cs",
    defaultPhonePrefix: "+420",
    addressStreet: "",
    addressCity: "",
    addressZip: "",
    phone: "",
    email: "",
    website: "",
    bankAccount: "",
    iban: "",
    swift: "",
  };
}

export function safeLoadCompanyData(): CompanyData {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.COMPANY);
    if (!raw) return defaultCompanyData();
    const parsed = JSON.parse(raw);
    const d = defaultCompanyData();
    return {
      abbreviation: typeof parsed?.abbreviation === "string" ? parsed.abbreviation : d.abbreviation,
      name: typeof parsed?.name === "string" ? parsed.name : d.name,
      ico: typeof parsed?.ico === "string" ? parsed.ico : d.ico,
      dic: typeof parsed?.dic === "string" ? parsed.dic : d.dic,
      language: typeof parsed?.language === "string" ? parsed.language : d.language,
      defaultPhonePrefix: typeof parsed?.defaultPhonePrefix === "string" ? parsed.defaultPhonePrefix : d.defaultPhonePrefix,
      addressStreet: typeof parsed?.addressStreet === "string" ? parsed.addressStreet : d.addressStreet,
      addressCity: typeof parsed?.addressCity === "string" ? parsed.addressCity : d.addressCity,
      addressZip: typeof parsed?.addressZip === "string" ? parsed.addressZip : d.addressZip,
      phone: typeof parsed?.phone === "string" ? parsed.phone : d.phone,
      email: typeof parsed?.email === "string" ? parsed.email : d.email,
      website: typeof parsed?.website === "string" ? parsed.website : d.website,
      bankAccount: typeof parsed?.bankAccount === "string" ? parsed.bankAccount : d.bankAccount,
      iban: typeof parsed?.iban === "string" ? parsed.iban : d.iban,
      swift: typeof parsed?.swift === "string" ? parsed.swift : d.swift,
    };
  } catch {
    return defaultCompanyData();
  }
}
