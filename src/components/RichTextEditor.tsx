"use client";

import { useEffect, useRef, useState } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { TextStyle } from "@tiptap/extension-text-style";
import { Color } from "@tiptap/extension-color";
import { Placeholder } from "@tiptap/extension-placeholder";
import { PRESET_COLORS } from "@/lib/colors";
import { EMOJI_LIST } from "@/lib/emoji";

type Props = {
  value: string;
  onSave: (html: string) => void;
  placeholder?: string;
  // For a title: no heading/lists/quote/code (a title becoming its own
  // <h2> makes no sense), and Enter confirms instead of inserting a line
  // break -- it's meant to stay one line, just with bold/color available.
  minimal?: boolean;
  onEnterKey?: () => void;
  // Fires on every keystroke (Tiptap's onUpdate) with the current HTML,
  // unlike onSave which only commits on blur -- lets the parent enable a
  // save/publish button (or flag unsaved changes) immediately instead of
  // waiting for the field to lose focus. Callers that only need a "the
  // user typed something" signal can ignore the argument.
  onChange?: (html: string) => void;
  // Sets the `lang` attribute on the editable DOM node, which is what the
  // browser's own spellchecker uses to pick a dictionary -- without it,
  // it just guesses from the browser's UI language and flags perfectly
  // fine words in the "wrong" one. Defaults to French (this app's
  // audience); pass "en" for an English card.
  lang?: "fr" | "en";
};

// Note: mount this with a `key` prop that changes per card (e.g.
// key={card.id}) so the editor's internal state fully resets when the
// selected card changes -- Tiptap doesn't sync external `value` changes
// on its own after the initial mount.
export default function RichTextEditor({
  value,
  onSave,
  placeholder = "Description de la carte…",
  minimal = false,
  onEnterKey,
  onChange,
  lang = "fr",
}: Props) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure(
        minimal
          ? {
              heading: false,
              bulletList: false,
              orderedList: false,
              blockquote: false,
              codeBlock: false,
              horizontalRule: false,
            }
          : { heading: { levels: [2, 3] } }
      ),
      TextStyle,
      Color,
      Placeholder.configure({ placeholder }),
    ],
    content: value || "",
    immediatelyRender: false,
    onBlur: ({ editor }) => onSave(editor.getHTML()),
    onUpdate: ({ editor }) => onChange?.(editor.getHTML()),
    ...(minimal
      ? {
          editorProps: {
            handleKeyDown: (_view: unknown, event: KeyboardEvent) => {
              if (event.key === "Enter") {
                event.preventDefault();
                // Deferred: onEnterKey typically unmounts this editor (it's
                // what flips the parent out of "editing" mode). Calling
                // that synchronously from inside ProseMirror's own keydown
                // dispatch tears the view down while the transaction for
                // *this* keydown is still unwinding on the stack --
                // that's the "Cannot read properties of undefined
                // (reading 'dispatchTransaction')" crash. Letting the
                // current dispatch finish first (a plain setTimeout 0)
                // avoids it.
                const html = editor!.getHTML();
                setTimeout(() => {
                  onSave(html);
                  onEnterKey?.();
                }, 0);
                return true;
              }
              return false;
            },
          },
        }
      : {}),
  });

  // `content`/`extensions` are only read once at mount (see the note
  // above), but `lang` can change while this exact editor instance stays
  // mounted (toggling the card's FR/EN switch while its description is
  // already open for editing) -- so it's applied directly to the live
  // ProseMirror DOM node on every change, rather than baked into
  // editorProps at construction time.
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    editor.view.dom.setAttribute("lang", lang);
    editor.view.dom.setAttribute("spellcheck", "true");
  }, [editor, lang]);

  const [emojiOpen, setEmojiOpen] = useState(false);
  const emojiRef = useRef<HTMLDivElement | null>(null);

  // Close the emoji popover on an outside click -- each editor instance
  // (title, description, one per comment/note) owns its own picker state,
  // so this only listens while *this* instance's popover is open.
  useEffect(() => {
    if (!emojiOpen) return;
    function onPointerDown(e: MouseEvent) {
      if (!emojiRef.current?.contains(e.target as Node)) {
        setEmojiOpen(false);
      }
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [emojiOpen]);

  if (!editor) return null;

  return (
    <div className={"rte" + (minimal ? " rte-minimal" : "")}>
      <div className="rte-toolbar">
        <button
          type="button"
          className={editor.isActive("bold") ? "active" : ""}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => editor.chain().focus().toggleBold().run()}
        >
          Gras
        </button>
        {!minimal && (
          <button
            type="button"
            className={editor.isActive("heading", { level: 2 }) ? "active" : ""}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
          >
            Titre
          </button>
        )}
        <span className="rte-sep" />
        {PRESET_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            className="rte-swatch"
            style={{ background: c }}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => editor.chain().focus().setColor(c).run()}
            aria-label={`Couleur ${c}`}
          />
        ))}
        <button
          type="button"
          className="rte-clear"
          title="Retirer la couleur"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => editor.chain().focus().unsetColor().run()}
        >
          &times;
        </button>
        <span className="rte-sep" />
        <div className="emoji-wrap" ref={emojiRef}>
          <button
            type="button"
            className={"emoji-btn" + (emojiOpen ? " active" : "")}
            title="Insérer un emoji"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setEmojiOpen((v) => !v)}
          >
            😀
          </button>
          {emojiOpen && (
            <div className="emoji-pop">
              <div className="emoji-pop-head">Choisir un emoji</div>
              <div className="emoji-grid">
                {EMOJI_LIST.map((e) => (
                  <button
                    key={e}
                    type="button"
                    className="emoji-cell"
                    onMouseDown={(ev) => ev.preventDefault()}
                    onClick={() => {
                      editor.chain().focus().insertContent(e).run();
                      setEmojiOpen(false);
                    }}
                  >
                    {e}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
      <EditorContent editor={editor} className="rte-content" />
    </div>
  );
}
