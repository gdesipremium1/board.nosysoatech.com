"use client";

import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { TextStyle } from "@tiptap/extension-text-style";
import { Color } from "@tiptap/extension-color";
import { Placeholder } from "@tiptap/extension-placeholder";
import { PRESET_COLORS } from "@/lib/colors";

type Props = {
  value: string;
  onSave: (html: string) => void;
  placeholder?: string;
  // For a title: no heading/lists/quote/code (a title becoming its own
  // <h2> makes no sense), and Enter confirms instead of inserting a line
  // break -- it's meant to stay one line, just with bold/color available.
  minimal?: boolean;
  onEnterKey?: () => void;
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
      </div>
      <EditorContent editor={editor} className="rte-content" />
    </div>
  );
}
