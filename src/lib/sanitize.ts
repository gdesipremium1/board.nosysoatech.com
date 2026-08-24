import sanitizeHtml from "sanitize-html";

// Allowlist matched exactly to what the description editor (Tiptap) can
// produce: bold/italic, headings (used as the "size" control), paragraphs,
// line breaks, lists, and a text color via inline style. Nothing else.
// This is the real security boundary — it runs server-side on every save,
// independent of whatever the client editor UI allows, so a raw API call
// can't sneak arbitrary HTML/JS past it.
const ALLOWED_TAGS = ["p", "br", "strong", "b", "em", "i", "h2", "h3", "ul", "ol", "li", "span"];

export function sanitizeDescription(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: {
      span: ["style"],
    },
    allowedStyles: {
      span: {
        color: [/^#[0-9a-fA-F]{3,8}$/, /^rgb\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*\)$/],
      },
    },
    disallowedTagsMode: "discard",
    allowedSchemes: [],
  }).trim();
}
