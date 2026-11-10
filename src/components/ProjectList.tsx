import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Project } from "../types";
import ConfirmDialog from "./ConfirmDialog";
import InlineInput from "./InlineInput";
import ProjectCover from "./ProjectCover";

interface Props {
  projects: Project[];
  onOpen: (id: string) => void;
  onCreate: (name: string) => Promise<void>;
  onRename: (id: string, name: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

const dateFormat = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", year: "numeric" });

export default function ProjectList({ projects, onOpen, onCreate, onRename, onDelete }: Props) {
  const [creating, setCreating] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [menuId, setMenuId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Project | null>(null);

  return (
    <div className="project-grid">
      {creating ? (
        <div className="project-card new-card editing">
          <InlineInput
            placeholder="Название проекта"
            onCommit={(name) => {
              setCreating(false);
              void onCreate(name);
            }}
            onCancel={() => setCreating(false)}
          />
          <span className="muted hint">Enter — создать, Esc — отмена</span>
        </div>
      ) : (
        <button className="project-card new-card" onClick={() => setCreating(true)}>
          <span className="plus">+</span>
          Новый проект
        </button>
      )}

      {projects.map((project) => (
        <div
          key={project.id}
          className="project-card"
          role="button"
          tabIndex={0}
          onClick={() => renamingId !== project.id && onOpen(project.id)}
          onKeyDown={(e) => e.key === "Enter" && e.target === e.currentTarget && onOpen(project.id)}
        >
          <ProjectCover project={project} />
          <div className="project-info">
            {renamingId === project.id ? (
              <InlineInput
                initial={project.name}
                onCommit={(name) => {
                  setRenamingId(null);
                  void onRename(project.id, name);
                }}
                onCancel={() => setRenamingId(null)}
              />
            ) : (
              <div className="project-name" title={project.name}>
                {project.name}
              </div>
            )}
            {project.createdAt > 0 && <div className="muted small">{dateFormat.format(project.createdAt)}</div>}
          </div>
          <button
            className="icon-btn card-menu-btn"
            title="Действия"
            onClick={(e) => {
              e.stopPropagation();
              setMenuId(menuId === project.id ? null : project.id);
            }}
          >
            ⋯
          </button>
          {menuId === project.id && (
            <Menu onClose={() => setMenuId(null)}>
              <button
                onClick={() => {
                  setMenuId(null);
                  setRenamingId(project.id);
                }}
              >
                Переименовать
              </button>
              <button
                className="danger-text"
                onClick={() => {
                  setMenuId(null);
                  setDeleting(project);
                }}
              >
                Удалить
              </button>
            </Menu>
          )}
        </div>
      ))}

      {deleting && (
        <ConfirmDialog
          title="Удалить проект?"
          confirmLabel="Удалить"
          danger
          onCancel={() => setDeleting(null)}
          onConfirm={() => {
            const id = deleting.id;
            setDeleting(null);
            void onDelete(id);
          }}
        >
          <p>
            Проект «{deleting.name}» со всеми задачами и документацией будет перемещён в корзину Windows. Оттуда его
            можно восстановить.
          </p>
        </ConfirmDialog>
      )}
    </div>
  );
}

/** Выпадающее меню карточки. Закрывается по клику вне него и по Escape. */
function Menu({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return (
    <div ref={ref} className="menu" onClick={(e) => e.stopPropagation()}>
      {children}
    </div>
  );
}
