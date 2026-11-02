"use client";

import { useEffect, useRef, useState } from "react";

// Drop-down multi-select with checkboxes. An empty selection means "all",
// so a table shows everything until the user narrows it down; "none" is
// kept as a sentinel value so it doesn't read as "all".

export type Option = { value: string; label: string; group?: string };

const NONE = "__none__";

export default function MultiSelect({
  label,
  options,
  selected,
  onChange,
}: {
  label: string;
  options: Option[];
  selected: string[];
  onChange: (values: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const chosen = selected.filter((v) => v !== NONE);
  const all = selected.length === 0;
  const summary = all ? "tous" : `${chosen.length}/${options.length}`;
  const toggle = (v: string) => {
    const base = all ? options.map((o) => o.value) : chosen;
    const next = base.includes(v) ? base.filter((x) => x !== v) : [...base, v];
    onChange(next.length === options.length ? [] : next.length === 0 ? [NONE] : next);
  };
  const isOn = (v: string) => selected.length === 0 || selected.includes(v);

  // Keep the options' order, grouped when they carry a group.
  const groups: [string, Option[]][] = [];
  for (const o of options) {
    const g = o.group ?? "";
    const last = groups[groups.length - 1];
    if (last && last[0] === g) last[1].push(o);
    else groups.push([g, [o]]);
  }

  return (
    <div className="mk-ms" ref={ref}>
      <button
        type="button"
        className={"mk-ms-trigger" + (all ? "" : " filtered")}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        {label} <b>({summary})</b> <span aria-hidden="true">▾</span>
      </button>
      {open && (
        <div className="mk-ms-panel" role="listbox" aria-multiselectable="true" aria-label={label}>
          <div className="mk-ms-actions">
            <button type="button" onClick={() => onChange([])}>
              Tout
            </button>
            <button type="button" onClick={() => onChange([NONE])}>
              Aucun
            </button>
          </div>
          <div className="mk-ms-list">
            {groups.map(([g, opts]) => (
              <div key={g || "_"}>
                {g && <div className="mk-ms-group">{g}</div>}
                {opts.map((o) => (
                  <label key={o.value} className="mk-ms-option">
                    <input type="checkbox" checked={isOn(o.value)} onChange={() => toggle(o.value)} />
                    {o.label}
                  </label>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// Applies a selection: empty = everything.
export function pick<T extends string>(values: T[], selected: string[]): T[] {
  return selected.length === 0 ? values : values.filter((v) => selected.includes(v));
}
