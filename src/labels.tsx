import type { CSSProperties } from "react";
import type { Label } from "./types";

/** Должно совпадать с MAX_LABEL_CHARS в src-tauri/src/board.rs. */
export const LABEL_NAME_MAX = 40;

/**
 * Палитра меток. В файле хранится ключ, а не hex: так цвета можно подправить
 * разом для всех проектов, и они всегда сочетаются с темой.
 */
export const LABEL_COLORS: { key: string; name: string; hex: string }[] = [
  { key: "gray", name: "Серый", hex: "#9b9a97" },
  { key: "brown", name: "Коричневый", hex: "#b07b56" },
  { key: "orange", name: "Оранжевый", hex: "#e8853a" },
  { key: "yellow", name: "Жёлтый", hex: "#d9b13b" },
  { key: "green", name: "Зелёный", hex: "#48b878" },
  { key: "teal", name: "Бирюзовый", hex: "#3aaea3" },
  { key: "blue", name: "Синий", hex: "#4a8fe0" },
  { key: "purple", name: "Фиолетовый", hex: "#9b6ad6" },
  { key: "pink", name: "Розовый", hex: "#d6609f" },
  { key: "red", name: "Красный", hex: "#e05d5d" },
];

export function labelHex(color: string): string {
  return LABEL_COLORS.find((c) => c.key === color)?.hex ?? LABEL_COLORS[0].hex;
}

/** Порядок цветов для новых меток: сначала самые различимые, серый и коричневый — в конце. */
const AUTO_ORDER = ["blue", "green", "orange", "purple", "red", "teal", "pink", "yellow", "brown", "gray"];

/** Цвет для новой метки: первый ещё не занятый в проекте, иначе по кругу. */
export function nextLabelColor(existing: Label[]): string {
  const used = new Set(existing.map((l) => l.color));
  return AUTO_ORDER.find((key) => !used.has(key)) ?? AUTO_ORDER[existing.length % AUTO_ORDER.length];
}

/** CSS-переменная с цветом метки; оттенки фона и текста считаются в App.css через color-mix. */
export function labelStyle(color: string): CSSProperties {
  return { "--label-color": labelHex(color) } as CSSProperties;
}

/** Плашка метки. С onRemove показывает крестик. */
export function LabelPill({ label, onRemove }: { label: Label; onRemove?: () => void }) {
  return (
    <span className="label-pill" style={labelStyle(label.color)} title={label.name}>
      <span className="label-pill-text">{label.name}</span>
      {onRemove && (
        <button
          className="label-pill-remove"
          title="Убрать метку"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
        >
          ×
        </button>
      )}
    </span>
  );
}
