import { useI18n } from "../i18n";
import Icon from "./Icon";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { DndContext, DragOverlay, KeyboardSensor, PointerSensor, closestCenter, pointerWithin, useSensor, useSensors, type DragEndEvent, type Modifier, type UniqueIdentifier } from "@dnd-kit/core";
import { SortableContext, rectSortingStrategy, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Project } from "../types";
import ConfirmDialog from "./ConfirmDialog";
import InlineInput from "./InlineInput";
import ProjectCover from "./ProjectCover";

interface Props {
  projects: Project[];
  reordering: boolean;
  onReorder: (id: string, targetId: string, before: boolean) => Promise<void>;
  onOpen: (id: string) => void;
  onCreate: (name: string) => Promise<void>;
  onRename: (id: string, name: string) => Promise<void>;
  onChangeCover: (id: string) => Promise<void>;
  onRemoveCover: (id: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

type ProjectView = "grid" | "list";
const VIEW_KEY = "project-library-view";

const containProjectPreview: Modifier = ({ activeNodeRect, scrollableAncestorRects, transform, windowRect }) => {
  const bounds = scrollableAncestorRects[0] ?? windowRect;
  if (!bounds || !activeNodeRect) return transform;
  return {
    ...transform,
    x: Math.max(bounds.left - activeNodeRect.left, Math.min(transform.x, bounds.right - activeNodeRect.right)),
    y: Math.max(bounds.top - activeNodeRect.top, Math.min(transform.y, bounds.bottom - activeNodeRect.bottom)),
  };
};

const keepRowAligned: Modifier = ({ transform }) => ({ ...transform, x: 0 });

function loadView(): ProjectView {
  try {
    return localStorage.getItem(VIEW_KEY) === "list" ? "list" : "grid";
  } catch {
    return "grid";
  }
}

export default function ProjectList({
  projects,
  reordering,
  onReorder,
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
  const [view, setView] = useState<ProjectView>(loadView);
  const [draggedId, setDraggedId] = useState<UniqueIdentifier | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const draggable = projects.length > 1 && !reordering && renamingId === null;
  const draggedProject = projects.find((project) => project.id === draggedId);

  function switchView(next: ProjectView) {
    setView(next);
    try {
      localStorage.setItem(VIEW_KEY, next);
    } catch {
      // The view still works when storage is unavailable.
    }
  }

  function onDragEnd({ active, over }: DragEndEvent) {
    setDraggedId(null);
    if (!over || active.id === over.id) return;
    const from = projects.findIndex((project) => project.id === active.id);
    const to = projects.findIndex((project) => project.id === over.id);
    if (from !== -1 && to !== -1) void onReorder(String(active.id), String(over.id), from > to);
  }

  function announcePosition(id: UniqueIdentifier) {
    const index = projects.findIndex((project) => project.id === id);
    if (index !== -1) return t("Position {position} of {total}", { position: index + 1, total: projects.length });
  }

  return (
    <div className="project-library">
      <div className="project-library-toolbar">
        <div className="segmented" role="group" aria-label={t("Project view")}>
          <button type="button" className={view === "grid" ? "active" : ""} aria-pressed={view === "grid"} onClick={() => switchView("grid")}>{t("Tiles")}</button>
          <button type="button" className={view === "list" ? "active" : ""} aria-pressed={view === "list"} onClick={() => switchView("list")}>{t("List")}</button>
        </div>
      </div>
      <DndContext
        sensors={sensors}
        collisionDetection={(args) => args.pointerCoordinates ? pointerWithin(args) : closestCenter(args)}
        accessibility={{
          screenReaderInstructions: {
            draggable: t("Press Space to pick up the project. Use the arrow keys to move it, Space to drop it, or Escape to cancel."),
          },
          announcements: {
            onDragStart: ({ active }) => {
              const project = projects.find(({ id }) => id === active.id);
              if (project) return t("Picked up project “{name}”", { name: project.name });
            },
            onDragOver: ({ over }) => over ? announcePosition(over.id) : undefined,
            onDragEnd: ({ over }) => over ? announcePosition(over.id) : t("Project move cancelled"),
            onDragCancel: () => t("Project move cancelled"),
          },
        }}
        onDragStart={({ active }) => { setMenuId(null); setDraggedId(active.id); }}
        onDragCancel={() => setDraggedId(null)}
        onDragEnd={onDragEnd}
      >
        <SortableContext items={projects.map((project) => project.id)} strategy={view === "grid" ? rectSortingStrategy : verticalListSortingStrategy}>
          <div className={`project-grid${view === "list" ? " project-list-layout" : ""}`}>
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
              <SortableProjectCard
                key={project.id}
                project={project}
                showHandle={projects.length > 1}
                draggable={draggable}
                onOpen={renamingId === project.id ? undefined : () => onOpen(project.id)}
              >
                <ProjectInfo project={project} dateFormat={dateFormat}>
                  {renamingId === project.id && (
                    <InlineInput
                      initial={project.name}
                      onCommit={(name) => {
                        setRenamingId(null);
                        void onRename(project.id, name);
                      }}
                      onCancel={() => setRenamingId(null)}
                    />
                  )}
                </ProjectInfo>
                <button
                  className="icon-btn card-menu-btn"
                  title={t("Actions")}
                  aria-label={t("Actions")}
                  aria-expanded={menuId === project.id}
                  disabled={reordering}
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
              </SortableProjectCard>
            ))}
          </div>
        </SortableContext>
        {createPortal(
          <DragOverlay
            className={`project-drag-preview${view === "list" ? " project-list-layout" : ""}`}
            modifiers={view === "list" ? [containProjectPreview, keepRowAligned] : [containProjectPreview]}
            dropAnimation={null}
          >
            {draggedProject && (
              <div className="project-card" aria-hidden="true">
                <ProjectCover project={draggedProject} />
                <ProjectInfo project={draggedProject} dateFormat={dateFormat} />
                <span className="icon-btn project-drag-handle"><Icon name="grip" /></span>
              </div>
            )}
          </DragOverlay>,
          document.body,
        )}
      </DndContext>

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
            {t("Project “{name}”, including all tasks and documents, will be moved to the Windows Recycle Bin. You can undo the deletion from the notification or restore it from the Recycle Bin.", { name: deleting.name })}
          </p>
        </ConfirmDialog>
      )}
    </div>
  );
}

function ProjectInfo({ project, dateFormat, children }: {
  project: Project;
  dateFormat: Intl.DateTimeFormat;
  children?: ReactNode;
}) {
  return (
    <div className="project-info">
      {children || <div className="project-name" title={project.name}>{project.name}</div>}
      {project.createdAt > 0 && <div className="muted small">{dateFormat.format(project.createdAt)}</div>}
    </div>
  );
}

function SortableProjectCard({ project, showHandle, draggable, onOpen, children }: {
  project: Project;
  showHandle: boolean;
  draggable: boolean;
  onOpen?: () => void;
  children: ReactNode;
}) {
  const { t } = useI18n();
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } =
    useSortable({ id: project.id, disabled: !draggable });
  const moveLabel = t("Move project “{name}”", { name: project.name });
  return (
    <div ref={setNodeRef} className={`project-card${isDragging ? " project-drop-placeholder" : ""}`}
      style={{ transform: CSS.Translate.toString(transform), transition }}>
      {onOpen && <button type="button" className="project-open" aria-label={project.name} title={project.name} onClick={onOpen} />}
      <ProjectCover project={project} />
      {showHandle && (
        <button type="button" ref={setActivatorNodeRef} {...attributes} {...listeners} className="icon-btn project-drag-handle"
          aria-label={moveLabel} aria-roledescription={t("Project drag handle")} title={moveLabel}>
          <Icon name="grip" />
        </button>
      )}
      {children}
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
