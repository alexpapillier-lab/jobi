import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { safeLoadCompanyData, defaultCompanyData } from "./companyData";

const mockStorage: Record<string, string> = {};
const mockLocalStorage = {
  getItem: vi.fn((key: string) => mockStorage[key] ?? null),
  setItem: vi.fn((key: string, value: string) => { mockStorage[key] = value; }),
  removeItem: vi.fn((key: string) => { delete mockStorage[key]; }),
  clear: vi.fn(() => { for (const k in mockStorage) delete mockStorage[k]; }),
  get length() { return Object.keys(mockStorage).length; },
  key: vi.fn((_: number) => null),
};

describe("defaultCompanyData", () => {
  it("returns all fields with empty/default values", () => {
    const d = defaultCompanyData();
    expect(d.name).toBe("");
    expect(d.language).toBe("cs");
    expect(d.defaultPhonePrefix).toBe("+420");
    expect(d.ico).toBe("");
  });
});

describe("safeLoadCompanyData", () => {
  beforeEach(() => {
    for (const k in mockStorage) delete mockStorage[k];
    vi.stubGlobal("localStorage", mockLocalStorage);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns defaults when localStorage is empty", () => {
    const data = safeLoadCompanyData();
    expect(data.name).toBe("");
    expect(data.language).toBe("cs");
  });

  it("parses valid JSON from localStorage", () => {
    mockStorage["jobsheet_company_v1"] = JSON.stringify({ name: "My Company", ico: "999", phone: "+420111" });
    const data = safeLoadCompanyData();
    expect(data.name).toBe("My Company");
    expect(data.ico).toBe("999");
    expect(data.phone).toBe("+420111");
    expect(data.email).toBe("");
  });

  it("returns defaults for invalid JSON", () => {
    mockStorage["jobsheet_company_v1"] = "not-json";
    const data = safeLoadCompanyData();
    expect(data.name).toBe("");
  });

  it("ignores non-string field values", () => {
    mockStorage["jobsheet_company_v1"] = JSON.stringify({ name: 42, ico: true });
    const data = safeLoadCompanyData();
    expect(data.name).toBe("");
    expect(data.ico).toBe("");
  });
});
