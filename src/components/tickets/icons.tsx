/**
 * Ikony pro karty zakázek.
 *
 * Sada se přestěhovala do src/components/icons.tsx, aby ji mohla používat
 * celá aplikace, ne jen komponenty zakázek. Tenhle soubor jen re-exportuje,
 * aby se nemusely měnit importy v deseti komponentách – a hlavně aby
 * nevznikly dvě různé sady ikon.
 */
export {
  DeviceIcon,
  WrenchIcon,
  ClockIcon,
  UserIcon,
  PrintIcon,
  DragIcon,
} from "../icons";
