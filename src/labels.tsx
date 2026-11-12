import { useI18n } from "./i18n";
import type { Message } from "./locales";
import type { CSSProperties } from "react";
import type { Label } from "./types";

/** Must match MAX_LABEL_CHARS in src-tauri/src/board.rs. */
export const LABEL_NAME_MAX = 40;

/**
 * Label palette. Store keys rather than hex values so colors can be adjusted
 * across all projects at once and stay consistent with the theme.
 */
export const LABEL_COLORS: { key: string; name: Message; hex: string }[] = [
  { key: "gray", name: "Gray", hex: "#9b9a97" },
  { key: "brown", name: "Brown", hex: "#b07b56" },
  { key: "orange", name: "Orange", hex: "#e8853a" },
  { key: "yellow", name: "Yellow", hex: "#d9b13b" },
  { key: "green", name: "Green", hex: "#48b878" },
  { key: "teal", name: "Teal", hex: "#3aaea3" },
  { key: "blue", name: "Blue", hex: "#4a8fe0" },
  { key: "purple", name: "Purple", hex: "#9b6ad6" },
  { key: "pink", name: "Pink", hex: "#d6609f" },
  { key: "red", name: "Red", hex: "#e05d5d" },
];

export function labelHex(color: string): string {
  return LABEL_COLORS.find((c) => c.key === color)?.hex ?? LABEL_COLORS[0].hex;
}

/** New label color order: distinct colors first, gray and brown last. */
const AUTO_ORDER = ["blue", "green", "orange", "purple", "red", "teal", "pink", "yellow", "brown", "gray"];

/** Choose the first unused project color for a new label, otherwise cycle through the palette. */
export function nextLabelColor(existing: Label[]): string {
  const used = new Set(existing.map((l) => l.color));
  return AUTO_ORDER.find((key) => !used.has(key)) ?? AUTO_ORDER[existing.length % AUTO_ORDER.length];
}

/** Label color CSS variable; App.css derives background and text shades using color-mix. */
export function labelStyle(color: string): CSSProperties {
  return { "--label-color": labelHex(color) } as CSSProperties;
}

/** Label pill. Show a remove button when onRemove is provided. */
export function LabelPill({ label, onRemove }: { label: Label; onRemove?: () => void }) {
  const { t } = useI18n();
  return (
    <span className="label-pill" style={labelStyle(label.color)} title={label.name}>
      <span className="label-pill-text">{label.name}</span>
      {onRemove && (
        <button
          className="label-pill-remove"
          title={t("Remove label")}
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
