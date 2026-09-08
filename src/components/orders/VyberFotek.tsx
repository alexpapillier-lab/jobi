import { useRef, type CSSProperties, type ReactNode } from "react";
import { Button } from "../ui";
import { CameraIcon } from "../icons";
import { useFoceniNaTelefonu } from "../../hooks/useFoceniNaTelefonu";

/**
 * Výběr fotek k zakázce.
 *
 * Na počítači jedno tlačítko „Nahrát soubory“ jako dřív. Na telefonu dvě:
 * „Vyfotit“ otevře rovnou zadní kameru, „Z galerie“ nechá vybrat víc fotek
 * najednou.
 *
 * Proč jeden `<input>` a ne dva: logika nahrání (vodoznak, Storage, zápis
 * k zakázce) sedí v `onChange` toho inputu v Orders.tsx a je na každém ze
 * čtyř míst jiná; komponenta ji jen obalí. E2E testy navíc hledají v sekci
 * jediný `input[type="file"]`.
 *
 * Proč se `capture` nastavuje až při klepnutí: kdyby byl na inputu natvrdo,
 * iPhone by vzal možnost vybrat z galerie a ignoroval by `multiple`.
 * Pro galerii se zase musí odebrat, jinak by si prohlížeč pamatoval kameru.
 */
export type VyberFotekProps = {
  /** Ten `<input type="file">` s celým `onChange`. */
  children: ReactNode;
  /** Text tlačítka na počítači („Nahrát soubory“, „Nahrát fotky“). */
  popisek: ReactNode;
  disabled?: boolean;
  /** Vzhled tlačítka na počítači – pole jako dřív (`baseFieldInput`). */
  style?: CSSProperties;
};

export function VyberFotek({ children, popisek, disabled, style }: VyberFotekProps) {
  const telefon = useFoceniNaTelefonu();
  const obal = useRef<HTMLSpanElement>(null);

  const otevri = (kamera: boolean) => {
    if (disabled) return;
    const input = obal.current?.querySelector<HTMLInputElement>('input[type="file"]');
    if (!input) return;
    if (kamera) input.setAttribute("capture", "environment");
    else input.removeAttribute("capture");
    input.click();
  };

  if (!telefon) {
    return (
      <label style={{ ...style, cursor: disabled ? "wait" : "pointer" }}>
        {children}
        {popisek}
      </label>
    );
  }

  return (
    <span ref={obal} style={{ display: "contents" }}>
      {children}
      <Button variant="soft" size="sm" disabled={disabled} onClick={() => otevri(true)} icon={<CameraIcon size={14} />}>
        Vyfotit
      </Button>
      <Button variant="soft" size="sm" disabled={disabled} onClick={() => otevri(false)}>
        Z galerie
      </Button>
    </span>
  );
}
