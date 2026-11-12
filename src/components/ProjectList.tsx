import { useI18n } from "../i18n";
import Icon from "./Icon";
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
  onChangeCover: (id: string) => Promise<void>;
  onRemoveCover: (id: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

export default function ProjectList({
  projects,
  onOpen,
  onCreate,
  onRename,
  onChangeCover,
  onRemoveCover,
  onDelete,
}: Props) {
  const { t, locale } = useI18n();
  const dateFormat = new Intl.DateTimeFormat(locale, { day: "numeric", month: "long", year: "numeric" });
  const [creating, setCreating] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [menuId, setMenuId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Project | null>(null);

  return (
    <div className="project-grid">
      {creating ? (
        <div className="project-card new-card editing">
          <InlineInput
            placeholder={t("Project name")}
            onCommit={(name) => {
              setCreating(false);
              void onCreate(name);
            }}
            onCancel={() => setCreating(false)}
          />
          <span className="muted hint">{t("Enter to create, Esc to cancel")}</span>
        </div>
      ) : (
        <button className="project-card new-card" onClick={() => setCreating(true)}>
          <span className="plus">+</span>
          {t("New project")}</button>
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
            title={t("Actions")}
            onClick={(e) => {
              e.stopPropagation();
              setMenuId(menuId === project.id ? null : project.id);
            }}
          >
            <Icon name="more" />
          </button>
          {menuId === project.id && (
            <Menu onClose={() => setMenuId(null)}>
              <button
                onClick={() => {
                  setMenuId(null);
                  setRenamingId(project.id);
                }}
              >
                {t("Rename")}</button>
              <button
                onClick={() => {
                  setMenuId(null);
                  void onChangeCover(project.id);
                }}
              >
                {project.coverPath ? t("Change cover") : t("Add cover")}
              </button>
              {project.coverPath && (
                <button
                  onClick={() => {
                    setMenuId(null);
                    void onRemoveCover(project.id);
                  }}
                >
                  {t("Remove cover")}</button>
              )}
              <button
                className="danger-text"
                onClick={() => {
                  setMenuId(null);
                  setDeleting(project);
                }}
              >
                {t("Delete")}</button>
            </Menu>
          )}
        </div>
      ))}

      {deleting && (
        <ConfirmDialog
          title={t("Delete project?")}
          confirmLabel={t("Delete")}
          danger
          onCancel={() => setDeleting(null)}
          onConfirm={() => {
            const id = deleting.id;
            setDeleting(null);
            void onDelete(id);
          }}
        >
          <p>
            {t("Project “{name}”, including all tasks and documents, will be moved to the Windows Recycle Bin. You can restore it from there.", { name: deleting.name })}
          </p>
        </ConfirmDialog>
      )}
    </div>
  );
}

/** Card dropdown menu. Closes on outside clicks and Escape. */
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
