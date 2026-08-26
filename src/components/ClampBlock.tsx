"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

type Props = {
  html?: string;
  text?: string;
  lines: number;
  emptyText: string;
  className: string;
};

// Read-only preview for a description or a note: clamps to `lines`, and
// only shows "Voir plus" when the content actually overflows that clamp --
// measured directly (scrollHeight vs clientHeight), not guessed from a
// character count, so it stays correct across fonts/zoom/rich formatting.
export default function ClampBlock({ html, text, lines, emptyText, className }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [overflowing, setOverflowing] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const content = html ?? text ?? "";

  useEffect(() => {
    setExpanded(false);
  }, [content]);

  useLayoutEffect(() => {
    if (expanded) return;
    const el = ref.current;
    setOverflowing(!!el && el.scrollHeight > el.clientHeight + 2);
  }, [content, expanded, lines]);

  const isEmpty = content.trim().length === 0;

  if (isEmpty) {
    return <div className={`${className} empty`}>{emptyText}</div>;
  }

  const style = expanded ? undefined : ({ WebkitLineClamp: lines } as React.CSSProperties);

  return (
    <div>
      {html !== undefined ? (
        <div
          ref={ref}
          className={className + (expanded ? "" : " clamp")}
          style={style}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : (
        <div ref={ref} className={className + (expanded ? "" : " clamp")} style={style}>
          {text}
        </div>
      )}
      {overflowing && (
        <button type="button" className="see-more" onClick={() => setExpanded((v) => !v)}>
          {expanded ? "Voir moins" : "Voir plus"}
        </button>
      )}
    </div>
  );
}
