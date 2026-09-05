import { useEffect, useMemo, useState } from "react";
import { AppLogo } from "./AppLogo";
import { useTheme } from "../theme/ThemeProvider";
import { assetUrl } from "../lib/assetUrl";

/**
 * Aktuální logo Jobi: PNG podle motivu (logos/<motiv>.png), stejné jako
 * v postranní liště. Přihlašovací obrazovka a „O aplikaci“ dřív kreslily
 * staré SVG přes AppLogo, takže aplikace měla dvě různá loga. AppLogo tu
 * zůstává jen jako záloha, když se PNG nenačte.
 */
export function ThemeLogo({ size = 64, style }: { size?: number; style?: React.CSSProperties }) {
  const { theme } = useTheme();
  const [failed, setFailed] = useState(false);
  const url = useMemo(() => assetUrl(`logos/${theme}.png`), [theme]);
  useEffect(() => setFailed(false), [url]);
  if (failed) return <AppLogo size={size} style={style} />;
  return (
    <img
      src={url}
      alt=""
      onError={() => setFailed(true)}
      style={{ width: size, height: size, objectFit: "contain", borderRadius: size * 0.22, ...style }}
    />
  );
}
