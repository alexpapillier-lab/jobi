/**
 * Náhled fotky zařízení nebo podpisu zákazníka.
 *
 * Fotky leží v neveřejném úložišti, takže se do `<img src>` nesmí dát URL
 * uložená u zakázky – ta je jen identifikátor souboru. Komponenta si odkaz
 * podepíše sama a sama ho i obnovuje, aby fotka nepřestala jít zobrazit
 * v okně, které je otevřené déle, než odkaz platí.
 *
 * Proč komponenta a ne hook v místě použití: náhledy se vykreslují uvnitř
 * podmíněných bloků a cyklů v Orders.tsx, kde hook zavolat nejde.
 */

import type { CSSProperties, KeyboardEventHandler, MouseEventHandler } from "react";
import { supabase } from "../lib/supabaseClient";
import { usePodepsanaFotka } from "../hooks/usePodepsaneFotky";

export type FotkaZakazkyProps = {
  /** URL uložená u zakázky (veřejný tvar) nebo staré base64 `data:` URL. */
  url: string;
  alt: string;
  style?: CSSProperties;
  className?: string;
  role?: string;
  tabIndex?: number;
  loading?: "lazy" | "eager";
  onClick?: MouseEventHandler<HTMLImageElement>;
  onKeyDown?: KeyboardEventHandler<HTMLImageElement>;
};

export function FotkaZakazky({ url, alt, ...rest }: FotkaZakazkyProps) {
  const podepsana = usePodepsanaFotka(supabase, url);
  return <img src={podepsana ?? url} alt={alt} {...rest} />;
}
