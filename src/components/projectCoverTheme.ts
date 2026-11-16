import type { CSSProperties } from "react";

const PALETTES = [
  ["#9b5062", "#f3d1aa", "#deb2b3", "#f3d1aa"],
  ["#375da5", "#bce3ed", "#9fbce8", "#bce3ed"],
  ["#176b67", "#dcebb6", "#8dc8b5", "#dcebb6"],
  ["#6248a6", "#ecc3e2", "#b5a5e5", "#ecc3e2"],
  ["#8e6b36", "#d7e1c4", "#d9c595", "#d7e1c4"],
  ["#3b6d87", "#d3c5eb", "#9acbd0", "#d3c5eb"],
  ["#5f5799", "#e3d9f2", "#b3b0df", "#e3d9f2"],
  ["#a36278", "#f3d5bd", "#dfb3c7", "#f3d5bd"],
] as const;

/** Keep the cover and its surrounding light in the same stable project palette. */
export function getProjectCoverTheme(id: string) {
  let hash = 0;
  for (const ch of id) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  const seed = Math.abs(hash);
  const colors = PALETTES[seed % PALETTES.length];
  return {
    style: {
      "--cover-from": colors[0], "--cover-light": colors[1], "--cover-to": colors[2],
      "--cover-accent": colors[3],
    } as CSSProperties,
  };
}
