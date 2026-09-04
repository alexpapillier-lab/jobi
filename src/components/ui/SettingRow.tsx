import type { ReactNode } from "react";

/**
 * Řádek nastavení: popisek (a případný popis) vlevo, ovládací prvek vpravo.
 *
 * V Nastavení se tenhle vzor opakoval jako ručně psaný <label> s vlastním
 * rámečkem, odsazením 12 px a pozadím – každá karta tak vypadala jako
 * karta v kartě. Tady je z toho hustý řádek s min. výškou 44 px (dotyk)
 * a tenkou linkou mezi sourozenci (viz .ui-setting-row v ui.css).
 *
 * `clickable` vykreslí řádek jako <label>, takže klik na text přepne
 * zaškrtávátko uvnitř. NEpoužívat u řádků s víc tlačítky (Segmented) –
 * klik na popisek by aktivoval první z nich.
 */
export function SettingRow({
  label,
  description,
  control,
  clickable = false,
  className = "",
}: {
  label: ReactNode;
  description?: ReactNode;
  control: ReactNode;
  clickable?: boolean;
  className?: string;
}) {
  const cls = ["ui-setting-row", className].filter(Boolean).join(" ");
  const body = (
    <>
      <span className="ui-setting-row__text">
        <span className="ui-setting-row__label">{label}</span>
        {description ? <span className="ui-setting-row__desc">{description}</span> : null}
      </span>
      <span className="ui-setting-row__control">{control}</span>
    </>
  );
  return clickable ? <label className={cls}>{body}</label> : <div className={cls}>{body}</div>;
}

/** Obal pro několik SettingRow – kreslí mezi nimi oddělovací linky. */
export function SettingRows({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={["ui-setting-rows", className].filter(Boolean).join(" ")}>{children}</div>;
}
