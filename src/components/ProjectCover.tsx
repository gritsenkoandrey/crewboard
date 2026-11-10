import { convertFileSrc } from "@tauri-apps/api/core";
import type { Project } from "../types";

/** Пары цветов для заглушки обложки. Цвет выбирается по id, поэтому у проекта он постоянный. */
const GRADIENTS = [
  ["#f6d365", "#fda085"],
  ["#a1c4fd", "#c2e9fb"],
  ["#d4fc79", "#96e6a1"],
  ["#fbc2eb", "#a6c1ee"],
  ["#fddb92", "#d1fdff"],
  ["#89f7fe", "#66a6ff"],
  ["#e0c3fc", "#8ec5fc"],
  ["#ffecd2", "#fcb69f"],
];

function hash(text: string): number {
  let h = 0;
  for (const ch of text) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return Math.abs(h);
}

export default function ProjectCover({ project, className }: { project: Project; className?: string }) {
  if (project.coverPath) {
    return <img className={`cover ${className ?? ""}`} src={convertFileSrc(project.coverPath)} alt="" draggable={false} />;
  }
  const [from, to] = GRADIENTS[hash(project.id) % GRADIENTS.length];
  return (
    <div className={`cover cover-placeholder ${className ?? ""}`} style={{ background: `linear-gradient(135deg, ${from}, ${to})` }}>
      <span>{project.name.trim().charAt(0).toUpperCase()}</span>
    </div>
  );
}
