import { useEffect, useState } from "react";
import { jeObrazek, podepsanaPriloha, type PrilohaChatu } from "../../lib/chat";
import { DocumentIcon } from "../icons";

/**
 * Příloha zprávy. Bucket je neveřejný, takže se odkaz nejdřív podepíše –
 * stejně jako u fotek zakázek. Obrázek se ukáže jako náhled, ostatní
 * soubory jako odkaz s názvem a velikostí.
 */

function velikost(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${Math.round(b / 1024)} kB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}

export function ChatPriloha({ priloha, moje }: { priloha: PrilohaChatu; moje: boolean }) {
  /* Odkaz je svázaný s cestou – když se změní příloha, starý odkaz se
     prostě nepoužije, není potřeba ho v efektu nulovat. */
  const [stav, setStav] = useState<{ path: string; url: string | null; chyba: boolean } | null>(null);
  const url = stav?.path === priloha.path ? stav.url : null;
  const chyba = stav?.path === priloha.path ? stav.chyba : false;

  useEffect(() => {
    let zivy = true;
    const path = priloha.path;
    const podepis = () =>
      void podepsanaPriloha(path).then((u) => {
        if (zivy) setStav({ path, url: u, chyba: !u });
      });
    podepis();
    // Podpis platí hodinu; panel bývá otevřený déle.
    const obnova = setInterval(podepis, 25 * 60_000);
    return () => {
      zivy = false;
      clearInterval(obnova);
    };
  }, [priloha.path]);

  const obrazek = jeObrazek(priloha);
  const barva = moje ? "var(--accent-fg, #fff)" : "var(--text)";

  if (obrazek && url) {
    return (
      <a href={url} target="_blank" rel="noopener noreferrer" style={{ display: "block", marginTop: 4 }} aria-label={`Otevřít obrázek ${priloha.name}`}>
        <img src={url} alt={priloha.name} loading="lazy" style={{ display: "block", maxWidth: "100%", maxHeight: 220, borderRadius: 10, border: "1px solid var(--border)", objectFit: "cover" }} />
      </a>
    );
  }

  return (
    <a
      href={url ?? undefined}
      target="_blank"
      rel="noopener noreferrer"
      aria-disabled={!url}
      title={chyba ? "Přílohu se nepodařilo načíst" : priloha.name}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        marginTop: 4,
        padding: "6px 10px",
        borderRadius: 10,
        border: "1px solid var(--border)",
        background: moje ? "rgba(255,255,255,0.14)" : "var(--panel)",
        color: barva,
        textDecoration: "none",
        fontSize: "var(--text-sm)",
        maxWidth: "100%",
        opacity: url ? 1 : 0.7,
        cursor: url ? "pointer" : "default",
      }}
    >
      <DocumentIcon size={16} />
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>{priloha.name}</span>
      <span style={{ opacity: 0.75, flex: "0 0 auto" }}>{chyba ? "nedostupné" : velikost(priloha.size)}</span>
    </a>
  );
}
