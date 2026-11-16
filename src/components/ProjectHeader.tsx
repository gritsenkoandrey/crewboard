import { convertFileSrc } from "@tauri-apps/api/core";
import type { ReactNode } from "react";
import type { Project } from "../types";
import { getProjectCoverTheme } from "./projectCoverTheme";

export default function ProjectHeader({ project, children }: { project: Project; children: ReactNode }) {
  return (
    <div className="project-header" style={getProjectCoverTheme(project.id).style}>
      <div className={`project-header-glow${project.coverPath ? " project-header-glow-with-image" : ""}`} aria-hidden="true">
        {project.coverPath && <div className="project-header-glow-image" style={{
          backgroundImage: `url(${JSON.stringify(convertFileSrc(project.coverPath))})`,
        }} />}
      </div>
      {children}
    </div>
  );
}
