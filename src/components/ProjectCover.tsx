import { convertFileSrc } from "@tauri-apps/api/core";
import type { Project } from "../types";
import { getProjectCoverTheme } from "./projectCoverTheme";

export default function ProjectCover({ project, className }: { project: Project; className?: string }) {
  if (project.coverPath) {
    return <img className={`cover ${className ?? ""}`} src={convertFileSrc(project.coverPath)} alt="" draggable={false} />;
  }
  const initials = Array.from(project.name.trim()).slice(0, 2).join("").toUpperCase();
  return (
    <div className={`cover cover-placeholder ${className ?? ""}`} style={getProjectCoverTheme(project.id).style}>
      <span className="cover-monogram" aria-hidden="true">{initials}</span>
    </div>
  );
}
