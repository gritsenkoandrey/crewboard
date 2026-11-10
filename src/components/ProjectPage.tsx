import { useState } from "react";
import type { Project } from "../types";
import Board from "./Board";
import Docs from "./Docs";
import InlineInput from "./InlineInput";
import ProjectCover from "./ProjectCover";

type Tab = "board" | "docs";

interface Props {
  project: Project;
  onBack: () => void;
  onRename: (name: string) => Promise<void>;
}

export default function ProjectPage({ project, onBack, onRename }: Props) {
  const [tab, setTab] = useState<Tab>("board");
  const [renaming, setRenaming] = useState(false);

  return (
    <div className="project-page">
      <div className="project-header">
        <ProjectCover project={project} className="header-cover" />
        <div className="project-header-main">
          <button className="link-btn" onClick={onBack}>
            ← Все проекты
          </button>
          {renaming ? (
            <InlineInput
              className="title-input"
              initial={project.name}
              onCommit={(name) => {
                setRenaming(false);
                void onRename(name);
              }}
              onCancel={() => setRenaming(false)}
            />
          ) : (
            <h1 className="project-title" title="Нажмите, чтобы переименовать" onClick={() => setRenaming(true)}>
              {project.name}
            </h1>
          )}
          <nav className="tabs">
            <button className={tab === "board" ? "active" : ""} onClick={() => setTab("board")}>
              Доска
            </button>
            <button className={tab === "docs" ? "active" : ""} onClick={() => setTab("docs")}>
              Документация
            </button>
          </nav>
        </div>
      </div>

      <div className="tab-content">
        {tab === "board" ? (
          <Board projectId={project.id} />
        ) : (
          <Docs projectId={project.id} />
        )}
      </div>
    </div>
  );
}
