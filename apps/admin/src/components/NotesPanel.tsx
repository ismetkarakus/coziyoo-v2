import { useEffect, useRef, useState } from "react";
import { formatNoteStamp } from "../lib/format";
import type { Language } from "../types/core";

type NoteItem = { id: string; note: string; createdAt: string; createdByUsername?: string | null };

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
  onSaveNote,
  onAddTag,
  onDeleteTag,
}: NotesPanelProps) {
  const tr = language === "tr";
  const [noteInput, setNoteInput] = useState("");
  const [tagPopoverOpen, setTagPopoverOpen] = useState(false);
  const [tagPopoverInput, setTagPopoverInput] = useState("");
  const [openNoteId, setOpenNoteId] = useState<string | null>(null);
  const [openNoteValue, setOpenNoteValue] = useState("");
  const [savingOpenNote, setSavingOpenNote] = useState(false);
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editingNoteValue, setEditingNoteValue] = useState("");
  const [savingNoteId, setSavingNoteId] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const tagPopoverRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const handler = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (editingNoteId && listRef.current && !listRef.current.contains(target)) {
        void saveNote(editingNoteId);
      }
      if (tagPopoverOpen && tagPopoverRef.current && !tagPopoverRef.current.contains(target)) {
        setTagPopoverOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [editingNoteId, tagPopoverOpen]);

  useEffect(() => {
    if (!tagPopoverOpen) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setTagPopoverOpen(false);
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [tagPopoverOpen]);

  async function handleAddNote() {
    const trimmed = noteInput.trim();
    if (!trimmed) return;
    await onAddNote(trimmed);
    setNoteInput("");
  }

  async function handleAddTag() {
    const trimmed = tagPopoverInput.trim();
    if (!trimmed) return;
    await onAddTag(trimmed);
    setTagPopoverInput("");
    setTagPopoverOpen(false);
  }

  async function saveNote(noteId: string) {
    if (savingNoteId === noteId) return;
    const trimmed = editingNoteValue.trim();
    if (!trimmed) return;
    const current = noteItems.find((item) => item.id === noteId);
    if (current && current.note.trim() === trimmed) {
      setEditingNoteId(null);
      setEditingNoteValue("");
      return;
    }
    setSavingNoteId(noteId);
    try {
      await onSaveNote(noteId, trimmed);
      setEditingNoteId(null);
      setEditingNoteValue("");
    } finally {
      setSavingNoteId(null);
    }
  }

  const openNote = openNoteId ? noteItems.find((item) => item.id === openNoteId) : null;
  useEffect(() => {
    if (openNote) {
      setOpenNoteValue(openNote.note);
    }
  }, [openNoteId]);

  async function saveOpenNote() {
    if (!openNoteId || savingOpenNote) return;
    const trimmed = openNoteValue.trim();
    if (!trimmed) return;
    setSavingOpenNote(true);
    try {
      await onSaveNote(openNoteId, trimmed);
      setOpenNoteId(null);
    } finally {
      setSavingOpenNote(false);
    }
  }

  return (
    <section className="panel buyer-ref-main-panel seller-notes-panel">
      <div className="panel-header seller-notes-header">
      </div>
      <div className="seller-notes-layout seller-notes-layout--single">
        <div className="seller-notes-col seller-notes-col--tags">
          <div className="seller-notes-tags-head" ref={tagPopoverRef}>
            <span className="seller-notes-tag-label">{tr ? "Etiket" : "Tag"}</span>
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
            <button
              className="ghost seller-notes-plus-btn"
              type="button"
              onClick={() => setTagPopoverOpen((prev) => !prev)}
              aria-label={tr ? "Etiket ekle" : "Add tag"}
            >
              +
            </button>
            {tagPopoverOpen ? (
              <div className="seller-notes-tag-popover">
                <input
                  autoFocus
                  value={tagPopoverInput}
                  onChange={(event) => setTagPopoverInput(event.target.value)}
                  placeholder={tr ? "Etiket gir..." : "Enter tag..."}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter") return;
                    event.preventDefault();
                    void handleAddTag();
                  }}
                />
              </div>
            ) : null}
          </div>
          {tagItems.length === 0 ? (
            <p className="panel-meta">{tr ? "Henüz etiket eklenmemiş." : "No tags yet."}</p>
          ) : null}
        </div>

        <div className="seller-notes-col seller-notes-col--notes">
          <div className="seller-notes-notes-head">
            <p className="seller-notes-col-title">{tr ? "Notlar" : "Notes"}</p>
            <div className="seller-notes-count-pill">
              <span className="seller-notes-count-notes">{`${noteItems.length} ${tr ? "Not" : "Notes"}`}</span>
              <span className="seller-notes-count-tags">{`${tagItems.length} ${tr ? "Etiket" : "Tags"}`}</span>
            </div>
          </div>
          <div className="seller-notes-notes-grid">
            <div className="seller-notes-input-row seller-notes-input-row--compact">
              <div className="seller-notes-input-shell">
                <input
                  autoFocus
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
                  {tr ? "Kaydet" : "Save"}
                </button>
              </div>
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
                      editingNoteId === note.id ? "is-editing" : "",
                    ].filter(Boolean).join(" ")}
                    onClick={() => {
                      if (editingNoteId) return;
                      setOpenNoteId(note.id);
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
                      <div className="seller-note-item-row seller-note-item-row--todo">
                        <div className="seller-note-item-main">
                          <p>{note.note}</p>
                          <div className="seller-note-item-footer">
                            <div className="seller-note-item-footer-left">
                              <span className="seller-note-item-date">{formatNoteStamp(note.createdAt, language)}</span>
                              <button
                                className="ghost seller-note-inline-edit"
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  setOpenNoteId(null);
                                  setEditingNoteId(note.id);
                                  setEditingNoteValue(note.note);
                                }}
                              >
                                ✎
                              </button>
                            </div>
                            <span className="seller-note-item-author">{note.createdByUsername ?? (tr ? "yonetici" : "admin")}</span>
                          </div>
                        </div>
                     </div>
                   )}
                  </article>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
      {openNote ? (
        <div
          className="seller-note-modal-backdrop"
          role="presentation"
          onClick={() => setOpenNoteId(null)}
        >
          <div
            className="seller-note-modal"
            role="dialog"
            aria-modal="true"
            onClick={(event) => event.stopPropagation()}
          >
            <textarea
              className="seller-note-modal-input"
              value={openNoteValue}
              onChange={(event) => setOpenNoteValue(event.target.value)}
              placeholder={tr ? "Not yaz..." : "Type note..."}
              autoFocus
            />
            <div className="seller-note-modal-actions">
              <button
                className="ghost seller-note-modal-save"
                type="button"
                onClick={() => void saveOpenNote()}
                disabled={savingOpenNote}
              >
                {tr ? "Kaydet" : "Save"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
