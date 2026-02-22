import type { PrimaryStatusKey } from "./statuses";

export type Ticket = {
  id: string;
  code: string;
  customerName: string;
  customerPhone?: string;
  deviceLabel: string;
  serialOrImei?: string;
  issueShort: string;
  status: PrimaryStatusKey;
  createdAt: string;
};

export const MOCK_TICKETS: Ticket[] = [
  {
    id: "1",
    code: "IRP2501350",
    customerName: "Alequi Papi",
    customerPhone: "+420 736 513 666",
    deviceLabel: "Dyson Supersonic",
    serialOrImei: "P3BEURFJ6169A",
    issueShort: "Vadný kabel",
    status: "received",
    createdAt: new Date().toISOString(),
  },
];
