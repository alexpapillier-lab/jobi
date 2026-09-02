import { useRef, useState, useEffect } from "react";

export function PdfPreviewIframe({ srcDoc }: { srcDoc: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const availableWidth = entry.contentRect.width;
        setScale(Math.min(1, availableWidth / 794));
      }
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  const scaledHeight = Math.round(1123 * scale);

  return (
    <div ref={containerRef} style={{ width: "100%", overflow: "hidden" }}>
      <div style={{ width: "100%", height: scaledHeight, display: "flex", justifyContent: "center" }}>
        <div style={{ width: 794, height: 1123, flexShrink: 0, transform: `scale(${scale})`, transformOrigin: "top center", boxShadow: "0 4px 24px rgba(0,0,0,0.12)", borderRadius: 4 }}>
          <iframe
            srcDoc={srcDoc}
            style={{ width: 794, height: 1123, border: "none", display: "block" }}
            title="PDF náhled"
          />
        </div>
      </div>
    </div>
  );
}
