import React, { useState } from "react";
import { Button } from "../ui";
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
  /** Uložení upraveného textu vlastního komentáře. */
  onEdit?: (ticketId: string, commentId: string, text: string) => void | Promise<void>;
  /** Přihlášený uživatel – upravovat jde jen vlastní komentáře. */
  currentUserId?: string | null;
  /**
   * Aktuální profily autorů (podle author_id). Komentář si při uložení
   * pamatuje jméno a fotku z té doby; když si člověk fotku přidá později,
   * starší komentáře by zůstaly bez ní. Tady má přednost živý profil.
   */
  authorProfiles?: Record<string, { nickname: string | null; avatarUrl: string | null }>;
  card: React.CSSProperties;
  baseFieldTextArea: React.CSSProperties;
};

export function TicketComments({
  ticketId,
  comments,
  draft,
  onDraftChange,
  onAdd,
  onTogglePin,
  onEdit,
  currentUserId,
  authorProfiles,
  card,
  baseFieldTextArea,
}: Props) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const startEdit = (c: TicketComment) => {
    setEditingId(c.id);
    setEditText(c.text);
  };
  const saveEdit = async () => {
    if (!editingId || !onEdit) return;
    const text = editText.trim();
    if (!text) return;
    await onEdit(ticketId, editingId, text);
    setEditingId(null);
  };
  return (
    <div style={{ ...card, marginTop: 16 }}>
      <SectionHeading icon={<ChatIcon size={16} />} size="sm">
        Interní komentáře (chat)
      </SectionHeading>

      <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
        {comments.map((c) => {
          const live = c.author_id ? authorProfiles?.[c.author_id] : undefined;
          const commentAuthorName = live?.nickname?.trim() || c.author_nickname || c.author || "Servis";
          const commentAvatarUrl = live?.avatarUrl?.trim() || c.author_avatar_url?.trim() || null;
          const isOwn = !!currentUserId && c.author_id === currentUserId;
          const isEditing = editingId === c.id;
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
                      Připnuto
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
                    {c.pinned ? "Odepnout" : "Připnout"}
                  </button>
                  {isOwn && onEdit && !isEditing && (
                    <button
                      onClick={() => startEdit(c)}
                      style={{ padding: "8px 10px", borderRadius: 12, border, background: "var(--panel)", color: "var(--text)", fontWeight: 950, cursor: "pointer", fontFamily: "inherit" }}
                      title="Upravit komentář"
                    >
                      Upravit
                    </button>
                  )}
                </div>
              </div>

              {isEditing ? (
                <div style={{ marginTop: 8, display: "grid", gap: 8 }}>
                  <textarea
                    value={editText}
                    onChange={(e) => setEditText(e.target.value)}
                    style={{ ...baseFieldTextArea, minHeight: 80 }}
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === "Escape") setEditingId(null);
                      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void saveEdit(); }
                    }}
                  />
                  <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                    <Button variant="soft" size="sm" onClick={() => setEditingId(null)}>Zrušit</Button>
                    <Button variant="primary" size="sm" onClick={() => void saveEdit()} disabled={!editText.trim()}>Uložit</Button>
                  </div>
                </div>
              ) : (
                <div style={{ marginTop: 6, whiteSpace: "pre-wrap" }}>{c.text}</div>
              )}
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
            <Button variant="primary" onClick={() => onAdd(ticketId)}>
              Přidat komentář
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
