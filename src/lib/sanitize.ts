import sanitizeHtml from "sanitize-html";

// Allowlist matched exactly to what the description editor (Tiptap) can
// produce: bold/italic, headings (used as the "size" control), paragraphs,
// line breaks, lists, and a text color via inline style. Nothing else.
// This is the real security boundary — it runs server-side on every save,
// independent of whatever the client editor UI allows, so a raw API call
// can't sneak arbitrary HTML/JS past it.
const ALLOWED_TAGS = ["p", "br", "strong", "b", "em", "i", "h2", "h3", "ul", "ol", "li", "span"];

const COLOR_PATTERN = /^(#[0-9a-fA-F]{3,8}|rgb\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*\))$/;

// Same rule as the description's inline color: only a plain hex/rgb value,
// nothing else. Applied to card.titleColor, which -- like description --
// reaches the server via a raw JSON PUT, not just through the color-swatch
// UI, so this check is the real boundary, not the swatches themselves.
export function sanitizeColor(color: string | undefined): string | undefined {
  if (!color) return undefined;
  return COLOR_PATTERN.test(color) ? color : undefined;
}

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

// Titles, attachment notes, sub-ticket titles: same idea as the
// description, but no block-level tags at all -- "discard" mode unwraps
// them (keeps the text, drops the tag), so even a raw API call that sends
// <h2>/<p>/<ul> can't turn a one-line title into a multi-line block. What's
// left is inline-only HTML, safe to embed inside a <span>/<div>/<button>
// without ever producing invalid nesting.
const INLINE_ONLY_TAGS = ["strong", "b", "em", "i", "span"];

export function sanitizeInline(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: INLINE_ONLY_TAGS,
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
