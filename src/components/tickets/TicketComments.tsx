import React from "react";
import { SectionHeading } from "../SectionHeading";
import { ChatIcon } from "../icons";
import { formatCZ, type TicketComment } from "./types";

const border = "1px solid var(--border)";

type Props = {
  ticketId: string;
  comments: TicketComment[];
  draft: string;
  onDraftChange: (ticketId: string, value: string) => void;
  onAdd: (ticketId: string) => void;
  onTogglePin: (ticketId: string, commentId: string) => void;
  card: React.CSSProperties;
  primaryBtn: React.CSSProperties;
  baseFieldTextArea: React.CSSProperties;
};

export function TicketComments({
  ticketId,
  comments,
  draft,
  onDraftChange,
  onAdd,
  onTogglePin,
  card,
  primaryBtn,
  baseFieldTextArea,
}: Props) {
  return (
    <div style={{ ...card, marginTop: 16 }}>
      <SectionHeading icon={<ChatIcon size={16} />} size="sm">
        Interní komentáře (chat)
      </SectionHeading>

      <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
        {comments.map((c) => {
          const commentAuthorName = c.author_nickname ?? c.author ?? "Servis";
          const commentAvatarUrl = c.author_avatar_url?.trim() || null;
          return (
            <div
              key={c.id}
              style={{
                border,
                borderRadius: 14,
                background: "var(--panel)",
                padding: 12,
                boxShadow: c.pinned ? "0 14px 30px rgba(0,0,0,0.16)" : "none",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
                <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                  {commentAvatarUrl ? (
                    <img
                      src={commentAvatarUrl}
                      alt=""
                      style={{
                        width: 28,
                        height: 28,
                        borderRadius: 10,
                        objectFit: "cover",
                        border: "1px solid var(--border)",
                      }}
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = "none";
                      }}
                    />
                  ) : (
                    <div
                      style={{
                        width: 28,
                        height: 28,
                        borderRadius: 10,
                        background: "var(--accent-soft)",
                        color: "var(--accent)",
                        display: "grid",
                        placeItems: "center",
                        fontSize: 12,
                        fontWeight: 800,
                      }}
                    >
                      {(commentAuthorName || "?").charAt(0).toUpperCase()}
                    </div>
                  )}
                  <div style={{ fontWeight: 950 }}>{commentAuthorName}</div>
                  {c.pinned && (
                    <div
                      style={{
                        fontSize: 11,
                        fontWeight: 950,
                        padding: "4px 8px",
                        borderRadius: 999,
                        background: "var(--panel-2)",
                        border,
                        color: "var(--muted)",
                      }}
                    >
                      PINNED
                    </div>
                  )}
                </div>

                <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                  <div style={{ color: "var(--muted)", fontSize: 12 }}>{formatCZ(c.createdAt)}</div>
                  <button
                    onClick={() => onTogglePin(ticketId, c.id)}
                    style={{
                      padding: "8px 10px",
                      borderRadius: 12,
                      border,
                      background: c.pinned ? "var(--panel-2)" : "var(--panel)",
                      color: "var(--text)",
                      fontWeight: 950,
                      cursor: "pointer",
                      fontFamily: "inherit",
                    }}
                    title={c.pinned ? "Odepnout" : "Připnout"}
                  >
                    {c.pinned ? "Unpin" : "Pin"}
                  </button>
                </div>
              </div>

              <div style={{ marginTop: 6, whiteSpace: "pre-wrap" }}>{c.text}</div>
            </div>
          );
        })}

        {comments.length === 0 && <div style={{ color: "var(--muted)" }}>Zatím žádné komentáře.</div>}

        <div style={{ display: "grid", gap: 8 }}>
          <textarea
            value={draft}
            onChange={(e) => onDraftChange(ticketId, e.target.value)}
            style={{ ...baseFieldTextArea, minHeight: 90 }}
            placeholder="Napiš interní komentář k zakázce…"
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                onAdd(ticketId);
              }
            }}
          />

          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
            <div style={{ color: "var(--muted)", fontSize: 12 }}>
              Tip: <b>Ctrl+Enter</b> pro odeslání.
            </div>
            <button style={{ ...primaryBtn, padding: "10px 14px" }} onClick={() => onAdd(ticketId)}>
              Přidat komentář
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
