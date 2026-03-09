import { useEffect, useRef, useState } from "react";
import { formatNoteStamp } from "../lib/format";
import type { Language } from "../types/core";

type NoteItem = { id: string; note: string; createdAt: string };

type NotesPanelProps = {
  noteItems: NoteItem[];
  tagItems: string[];
  language: Language;
  title?: string;
  onAddNote: (text: string) => Promise<void>;
  onDeleteNote: (noteId: string) => Promise<void>;
  onSaveNote: (noteId: string, newText: string) => Promise<void>;
  onAddTag: (tag: string) => Promise<void>;
  onDeleteTag: (tag: string) => Promise<void>;
};

export function NotesPanel({
  noteItems,
  tagItems,
  language,
  title,
  onAddNote,
  onDeleteNote,
  onSaveNote,
  onAddTag,
  onDeleteTag,
}: NotesPanelProps) {
  const tr = language === "tr";
  const [noteInput, setNoteInput] = useState("");
  const [tagInput, setTagInput] = useState("");
  const [openNoteMenuId, setOpenNoteMenuId] = useState<string | null>(null);
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editingNoteValue, setEditingNoteValue] = useState("");
  const [savingNoteId, setSavingNoteId] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const handler = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target || !listRef.current) return;
      if (openNoteMenuId && !listRef.current.contains(target)) {
        if (editingNoteId) {
          void saveNote(editingNoteId);
        } else {
          setOpenNoteMenuId(null);
        }
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [openNoteMenuId, editingNoteId]);

  function openNoteCard(noteId: string) {
    if (editingNoteId && editingNoteId !== noteId) {
      setEditingNoteId(null);
      setEditingNoteValue("");
    }
    setOpenNoteMenuId(noteId);
  }

  async function handleAddNote() {
    const trimmed = noteInput.trim();
    if (!trimmed) return;
    await onAddNote(trimmed);
    setNoteInput("");
  }

  async function handleAddTag() {
    const trimmed = tagInput.trim();
    if (!trimmed) return;
    await onAddTag(trimmed);
    setTagInput("");
  }

  async function saveNote(noteId: string) {
    if (savingNoteId === noteId) return;
    const trimmed = editingNoteValue.trim();
    if (!trimmed) return;
    const current = noteItems.find((item) => item.id === noteId);
    if (current && current.note.trim() === trimmed) {
      setEditingNoteId(null);
      setEditingNoteValue("");
      setOpenNoteMenuId(null);
      return;
    }
    setSavingNoteId(noteId);
    try {
      await onSaveNote(noteId, trimmed);
      setEditingNoteId(null);
      setEditingNoteValue("");
      setOpenNoteMenuId(null);
    } finally {
      setSavingNoteId(null);
    }
  }

  async function handleDelete(noteId: string) {
    await onDeleteNote(noteId);
    setOpenNoteMenuId(null);
    if (editingNoteId === noteId) {
      setEditingNoteId(null);
      setEditingNoteValue("");
    }
  }

  return (
    <section className="panel buyer-ref-main-panel seller-notes-panel">
      <div className="panel-header seller-notes-header">
        <h2>{title ?? (tr ? "Notlar & Etiketler" : "Notes & Tags")}</h2>
        <span className="seller-notes-count-pill">
          {`${noteItems.length} ${tr ? "Not" : "Notes"} | ${tagItems.length} ${tr ? "Etiket" : "Tags"}`}
        </span>
      </div>
      <div className="seller-notes-layout">
        <div className="seller-notes-col">
          <p className="seller-notes-col-title">{tr ? "Notlar" : "Notes"}</p>
          <div className="seller-notes-input-row">
            <input
              value={noteInput}
              onChange={(event) => setNoteInput(event.target.value)}
              placeholder={tr ? "Not yaz..." : "Type note..."}
              onKeyDown={(event) => {
                if (event.key !== "Enter") return;
                event.preventDefault();
                void handleAddNote();
              }}
            />
            <button className="ghost seller-notes-add-btn" type="button" onClick={() => void handleAddNote()}>
              {tr ? "Not Ekle" : "Add Note"}
            </button>
          </div>
          <div className="buyer-ref-note-list seller-note-list" ref={listRef}>
            {noteItems.length === 0 ? (
              <p className="panel-meta">{tr ? "Henüz not yok." : "No notes yet."}</p>
            ) : (
              noteItems.map((note) => (
                <article
                  key={note.id}
                  className={[
                    "buyer-ref-note-item seller-note-item",
                    openNoteMenuId === note.id ? "is-open" : "",
                    editingNoteId === note.id ? "is-editing" : "",
                  ].filter(Boolean).join(" ")}
                  onClick={() => openNoteCard(note.id)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(event) => {
                    const target = event.target as HTMLElement | null;
                    if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) {
                      return;
                    }
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      openNoteCard(note.id);
                    }
                  }}
                >
                  {editingNoteId === note.id ? (
                    <div className="buyer-ref-note-edit-row" onClick={(event) => event.stopPropagation()}>
                      <input
                        value={editingNoteValue}
                        onChange={(event) => setEditingNoteValue(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            void saveNote(note.id);
                          }
                        }}
                        onBlur={() => void saveNote(note.id)}
                        disabled={savingNoteId === note.id}
                      />
                    </div>
                  ) : (
                    <div className="seller-note-item-row">
                      <p>{note.note}</p>
                      <div className="seller-note-item-meta">
                        <span>{formatNoteStamp(note.createdAt, language)}</span>
                        <button
                          className="ghost seller-note-inline-edit"
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            setEditingNoteId(note.id);
                            setEditingNoteValue(note.note);
                          }}
                        >
                          ✎
                        </button>
                      </div>
                    </div>
                  )}
                  {editingNoteId !== note.id && openNoteMenuId === note.id ? (
                    <div className="buyer-ref-note-actions" onClick={(event) => event.stopPropagation()}>
                      <button
                        className="ghost is-danger"
                        type="button"
                        onClick={() => void handleDelete(note.id)}
                      >
                        {tr ? "Sil" : "Delete"}
                      </button>
                    </div>
                  ) : null}
                </article>
              ))
            )}
          </div>
        </div>

        <div className="seller-notes-col">
          <p className="seller-notes-col-title">{tr ? "Etiketler" : "Tags"}</p>
          <div className="seller-notes-input-row">
            <input
              value={tagInput}
              onChange={(event) => setTagInput(event.target.value)}
              placeholder={tr ? "Etiket yaz..." : "Type tag..."}
              onKeyDown={(event) => {
                if (event.key !== "Enter") return;
                event.preventDefault();
                void handleAddTag();
              }}
            />
            <button className="ghost seller-notes-add-btn is-tag" type="button" onClick={() => void handleAddTag()}>
              {tr ? "Etiket Ekle" : "Add Tag"}
            </button>
          </div>
          <div className="buyer-ops-tag-list seller-tag-list">
            {tagItems.map((tag) => (
              <span key={tag} className="buyer-ops-tag">
                <span>{tag}</span>
                <button
                  className="buyer-ops-tag-remove"
                  type="button"
                  onClick={() => void onDeleteTag(tag)}
                  aria-label={`${tr ? "Sil" : "Delete"} ${tag}`}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
          {tagItems.length === 0 ? (
            <p className="panel-meta">{tr ? "Henüz etiket eklenmemiş." : "No tags yet."}</p>
          ) : null}
        </div>
      </div>
    </section>
  );
}
