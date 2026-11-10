import { useEffect, useRef, useState } from "react";
import { LABEL_NAME_MAX, LabelPill, labelStyle } from "../labels";
import type { Label } from "../types";

interface Props {
  /** Все метки проекта. */
  labels: Label[];
  /** id меток задачи. */
  selected: string[];
  onToggle: (id: string) => void;
  /** Создать метку с таким названием и сразу повесить на задачу. */
  onCreate: (name: string) => void;
}

/**
 * Метки задачи: плашки выбранных и выпадающий список с поиском.
 * Если введённого названия нет среди меток — предлагает создать новую.
 */
export default function LabelPicker({ labels, selected, onToggle, onCreate }: Props) {
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
  // Пункты списка: найденные метки, затем «Создать…».
  const itemCount = matches.length + (canCreate ? 1 : 0);

  useEffect(() => setActive(0), [query]);

  // Клик мимо списка закрывает его.
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
    } else if (canCreate) {
      onCreate(query.trim());
      setQuery("");
    }
  }

  return (
    <div className="label-picker" ref={rootRef}>
      <div className="label-picker-row">
        {selectedLabels.map((label) => (
          <LabelPill key={label.id} label={label} onRemove={() => onToggle(label.id)} />
        ))}
        <button className="label-add" onClick={() => (open ? close() : setOpen(true))}>
          {selectedLabels.length ? "+" : "+ Добавить метку"}
        </button>
      </div>

      {open && (
        <div className="label-dropdown">
          <input
            autoFocus
            className="label-search"
            value={query}
            maxLength={LABEL_NAME_MAX}
            placeholder={labels.length ? "Найти или создать метку…" : "Название новой метки…"}
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
                // Закрываем только список, а не всю панель задачи.
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
                Создать «{query.trim()}»
              </button>
            )}
            {itemCount === 0 && <div className="label-empty muted">Начните вводить название</div>}
          </div>
        </div>
      )}
    </div>
  );
}
