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
};

// Note: mount this with a `key` prop that changes per card (e.g.
// key={card.id}) so the editor's internal state fully resets when the
// selected card changes -- Tiptap doesn't sync external `value` changes
// on its own after the initial mount.
export default function RichTextEditor({ value, onSave }: Props) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [2, 3] } }),
      TextStyle,
      Color,
      Placeholder.configure({ placeholder: "Description de la carte…" }),
    ],
    content: value || "",
    immediatelyRender: false,
    onBlur: ({ editor }) => onSave(editor.getHTML()),
  });

  if (!editor) return null;

  return (
    <div className="rte">
      <div className="rte-toolbar">
        <button
          type="button"
          className={editor.isActive("bold") ? "active" : ""}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => editor.chain().focus().toggleBold().run()}
        >
          Gras
        </button>
        <button
          type="button"
          className={editor.isActive("heading", { level: 2 }) ? "active" : ""}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        >
          Titre
        </button>
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
