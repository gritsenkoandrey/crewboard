import { useI18n } from "../i18n";
import { useEffect, useRef, useState } from "react";
import { LABEL_NAME_MAX, LabelPill, labelStyle } from "../labels";
import type { Label } from "../types";

interface Props {
  /** All project labels. */
  labels: Label[];
  /** Task label IDs. */
  selected: string[];
  onToggle: (id: string) => void;
  /** Create a label with this name and immediately assign it to the task. */
  onCreate: (name: string) => void;
}

/**
 * Task labels: selected label pills and a searchable dropdown.
 * Offer to create a label if the entered name does not exist.
 */
export default function LabelPicker({ labels, selected, onToggle, onCreate }: Props) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);

  const selectedLabels = selected
    .map((id) => labels.find((l) => l.id === id))
    .filter((l): l is Label => !!l);

  const q = query.trim().toLowerCase();
  const matches = labels.filter((l) => l.name.toLowerCase().includes(q));
  const exact = labels.some((l) => l.name.toLowerCase() === q);
  const canCreate = q.length > 0 && !exact;
  // List items: matching labels, followed by the create option.
  const itemCount = matches.length + (canCreate ? 1 : 0);

  useEffect(() => setActive(0), [query]);

  // Close the dropdown when clicking outside it.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) close();
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  function close() {
    setOpen(false);
    setQuery("");
  }

  function choose(index: number) {
    if (index < matches.length) {
      onToggle(matches[index].id);
      close();
    } else if (canCreate) {
      onCreate(query.trim());
      close();
    }
  }

  return (
    <div className="label-picker" ref={rootRef}>
      <div className="label-picker-row">
        {selectedLabels.map((label) => (
          <LabelPill key={label.id} label={label} onRemove={() => onToggle(label.id)} />
        ))}
        <button className="label-add" onClick={() => (open ? close() : setOpen(true))}>
          {selectedLabels.length ? "+" : t("+ Add label")}
        </button>
      </div>

      {open && (
        <div className="label-dropdown">
          <input
            autoFocus
            className="label-search"
            value={query}
            maxLength={LABEL_NAME_MAX}
            placeholder={labels.length ? t("Find or create a label…") : t("New label name…")}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing) return;
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive((a) => Math.min(a + 1, itemCount - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((a) => Math.max(a - 1, 0));
              } else if (e.key === "Enter") {
                e.preventDefault();
                if (itemCount > 0) choose(active);
              } else if (e.key === "Escape") {
                // Close only the dropdown, leaving the task panel open.
                e.stopPropagation();
                close();
              }
            }}
          />
          <div className="label-options">
            {matches.map((label, i) => (
              <button
                key={label.id}
                className={`label-option ${i === active ? "active" : ""}`}
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(i)}
              >
                <span className="label-option-check">{selected.includes(label.id) ? "✓" : ""}</span>
                <span className="label-dot" style={labelStyle(label.color)} />
                {label.name}
              </button>
            ))}
            {canCreate && (
              <button
                className={`label-option create ${active === matches.length ? "active" : ""}`}
                onMouseEnter={() => setActive(matches.length)}
                onClick={() => choose(matches.length)}
              >
                <span className="label-option-check">+</span>
                {t("Create “{name}”", { name: query.trim() })}
              </button>
            )}
            {itemCount === 0 && <div className="label-empty muted">{t("Start typing a name")}</div>}
          </div>
        </div>
      )}
    </div>
  );
}
