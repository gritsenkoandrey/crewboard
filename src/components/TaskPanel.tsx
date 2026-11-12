import { useI18n } from "../i18n";
import Icon from "./Icon";
import { useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { handleMarkdownClick, renderMarkdown } from "../markdown";
import { registerFlusher } from "../saveTracker";
import type { ColumnId, Label, Task, Participant } from "../types";
import ConfirmDialog from "./ConfirmDialog";
import LabelPicker from "./LabelPicker";
import MarkdownEditor from "./MarkdownEditor";

export type TaskPatch = Partial<Pick<Task, "title" | "description" | "labels" | "assigneeId" | "acceptanceCriteria">>;

interface Props {
  task: Task;
  taskCode: string;
  column: ColumnId;
  columns: { id: ColumnId; title: string }[];
  /** Project folder used to resolve relative image paths in the description. */
  projectDir: string;
  titleMaxLength: number;
  /** All project labels. */
  labels: Label[];
  participants: Participant[];
  onRelease: () => Promise<void>;
  onChange: (patch: TaskPatch) => void;
  /** Apply label changes immediately, without delayed saving. */
  onSetLabels: (ids: string[]) => void;
  onCreateLabel: (name: string) => void;
  onMove: (column: ColumnId) => void;
  onArchive: () => void;
  onRestore: () => void;
  onDelete: () => void;
  onClose: () => void;
}

const AUTOSAVE_MS = 500;

/**
 * Task side panel: title, status, and Markdown description.
 * Batch edits: save the description half a second after typing,
 * the title on blur, and all unsaved edits when the panel or window closes.
 */
export default function TaskPanel({
  task,
  taskCode,
  column,
  columns,
  projectDir,
  titleMaxLength,
  labels,
  participants,
  onRelease,
  onChange,
  onSetLabels,
  onCreateLabel,
  onMove,
  onArchive,
  onRestore,
  onDelete,
  onClose,
}: Props) {
  const { t, locale } = useI18n();
  const [title, setTitle] = useState(task.title);
  const [criteria, setCriteria] = useState(task.acceptanceCriteria ?? "");
  const [descriptionVersion, setDescriptionVersion] = useState(0);
  const [releaseConfirm, setReleaseConfirm] = useState(false);
  const [description, setDescription] = useState(task.description ?? "");
  const descriptionRef = useRef(description);
  descriptionRef.current = description;
  // Open empty descriptions in the editor and existing descriptions in preview mode.
  const [editing, setEditing] = useState(!task.description);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const titleRef = useRef<HTMLTextAreaElement>(null);
  const pending = useRef<TaskPatch>({});
  const timer = useRef<number | undefined>(undefined);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => { if (!("title" in pending.current)) setTitle(task.title); }, [task.title]);
  useEffect(() => { if (!("acceptanceCriteria" in pending.current)) setCriteria(task.acceptanceCriteria ?? ""); }, [task.acceptanceCriteria]);
  useEffect(() => {
    if (!("description" in pending.current) && descriptionRef.current !== (task.description ?? "")) { setDescription(task.description ?? ""); setDescriptionVersion((v) => v + 1); }
  }, [task.description]);

  const flush = useCallback(() => {
    window.clearTimeout(timer.current);
    const patch = pending.current;
    pending.current = {};
    if (Object.keys(patch).length > 0) onChangeRef.current(patch);
  }, []);

  // Flush unsaved edits when closing the panel or window, or switching to another task.
  useEffect(() => {
    const unregister = registerFlusher(flush);
    return () => {
      unregister();
      flush();
    };
  }, [flush]);

  // Resize the title input to fit its text.
  useLayoutEffect(() => {
    const el = titleRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [title]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !confirmDelete && !releaseConfirm && !e.isComposing) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, confirmDelete, releaseConfirm]);

  // Queue title edits immediately so they are saved even when Escape closes the panel.
  function onTitleChange(value: string) {
    setTitle(value);
    const trimmed = value.trim();
    if (trimmed && trimmed !== task.title) pending.current.title = trimmed;
    else delete pending.current.title;
  }

  function commitTitle() {
    // Revert an empty title instead of saving it.
    if (!title.trim()) setTitle(task.title);
    flush();
  }

  function onDescriptionChange(value: string) {
    setDescription(value);
    pending.current.description = value;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(flush, AUTOSAVE_MS);
  }

  const deferred = useDeferredValue(description);
  const html = useMemo(() => renderMarkdown(deferred, projectDir), [deferred, projectDir]);

  return (
    <>
      <div className="panel-backdrop" onMouseDown={onClose}>
        <aside className="task-panel" role="dialog" aria-label={t("Task")} onMouseDown={(e) => e.stopPropagation()}>
          <div className="panel-top">
            <div className="status-switch">
              {columns.map((c) => (
                <button
                  key={c.id}
                  className={`column-${c.id} ${c.id === column ? "active" : ""}`}
                  disabled={task.archived}
                  onClick={() => c.id !== column && onMove(c.id)}
                >
                  <span className="column-dot" />
                  {c.title}
                </button>
              ))}
            </div>
            <div className="panel-actions">
              <button className="icon-btn" disabled={!!task.claim} title={task.claim ? t("Release the task first") : task.archived ? t("Restore") : t("Archive task")} aria-label={task.archived ? t("Restore task") : t("Archive task")}
                onClick={() => { flush(); task.archived ? onRestore() : onArchive(); }}>
                <Icon name={task.archived ? "restore" : "archive"} />
              </button>
              <button className="icon-btn danger-hover" disabled={!!task.claim} title={task.claim ? t("Release the task first") : t("Delete task")} onClick={() => setConfirmDelete(true)}>
                <Icon name="trash" />
              </button>
              <button className="icon-btn" title={t("Close (Esc)")} onClick={onClose}>
                <Icon name="close" />
              </button>
            </div>
          </div>
  
          {task.archived && <span className="muted small">{t("Task is archived")}</span>}
          <div className="task-metadata">
            <span className="task-code">{taskCode}</span>
            <span className="muted">{t("Updated:")} {task.updatedAt ? <time dateTime={new Date(task.updatedAt).toISOString()}>{new Date(task.updatedAt).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" })}</time> : t("unknown")}</span>
          </div>
          <textarea
            ref={titleRef}
            className="panel-title"
            rows={1}
            value={title}
            maxLength={titleMaxLength}
            placeholder={t("Task title")}
            onChange={(e) => onTitleChange(e.target.value)}
            onBlur={commitTitle}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                e.preventDefault();
                e.currentTarget.blur();
              }
            }}
          />

          <div className="agent-assignment">
            <label htmlFor="task-assignee">{t("Assignee")}</label>
            <select id="task-assignee" value={task.assigneeId ?? ""} disabled={!!task.claim} onChange={(e) => onChange({ assigneeId: e.target.value })}>
              <option value="">{t("Unassigned")}</option>
              {participants.map((p) => <option key={p.id} value={p.id}>{p.name}{p.kind === "agent" ? t(" · agent") : ""}</option>)}
            </select>
          </div>
          {task.claim && <div className="agent-session">
            <span className="muted">{t("Session: {session}", { session: task.claim.sessionId })}</span>
            <button className="link-btn" onClick={() => { flush(); setReleaseConfirm(true); }}>{t("Release task")}</button>
          </div>}
          {task.readyForReview && <div className="agent-review" role="status">{t("Ready for review — move the task to Done after reviewing it.")}</div>}
          {task.question && <div className="agent-question"><strong>{t("Needs an answer")}</strong><p>{task.question}</p></div>}
          <LabelPicker
            labels={labels}
            selected={task.labels ?? []}
            onToggle={(id) => {
              const current = task.labels ?? [];
              onSetLabels(current.includes(id) ? current.filter((l) => l !== id) : [...current, id]);
            }}
            onCreate={onCreateLabel}
          />

          <details className="agent-criteria">
            <summary>{t("Acceptance criteria")}{criteria ? t(" · filled in") : ""}</summary>
            <textarea aria-label={t("Acceptance criteria")} placeholder={t("What should work and how to verify it")} rows={3} value={criteria}
              onChange={(e) => { const value = e.target.value; setCriteria(value); pending.current.acceptanceCriteria = value; window.clearTimeout(timer.current); timer.current = window.setTimeout(flush, AUTOSAVE_MS); }} onBlur={flush} />
          </details>
          {(task.reports?.length ?? 0) > 0 && <details className="agent-reports">
            <summary>{t("Work reports · {count}", { count: task.reports!.length })}</summary>
            <div className="agent-report-list">{[...task.reports!].reverse().map((report, index) => (
              <article key={report.createdAt + ":" + index}>
                <header className="muted small">{participants.find((p) => p.id === report.authorId)?.name ?? report.authorId} · {new Date(report.createdAt).toLocaleString(locale)} · {report.sessionId}</header>
                <div className="markdown" onClick={(e) => handleMarkdownClick(e, setError)} dangerouslySetInnerHTML={{ __html: renderMarkdown(report.text, projectDir) }} />
              </article>
            ))}</div>
          </details>}
          <div className="panel-section-header">
            <span className="muted">{t("Description")}</span>
            {(description || editing) && (
              <button className="link-btn" onClick={() => {
                if (editing) {
                  flush();
                  onClose();
                } else {
                  setEditing(true);
                }
              }}>
                {editing ? t("Done") : t("Edit")}
              </button>
            )}
          </div>
  
          {error && (
            <div className="error-bar panel-error">
              <span>{error}</span>
              <button className="icon-btn" title={t("Close")} onClick={() => setError(null)}>
                <Icon name="close" />
              </button>
            </div>
          )}
  
          <div className="panel-body">
            {editing ? (
              <div className="panel-editor">
                <MarkdownEditor key={descriptionVersion} initialText={description} onChange={onDescriptionChange} onSave={flush} />
              </div>
            ) : description.trim() ? (
              <article
                className="markdown panel-preview"
                title={t("Double-click to edit")}
                onClick={(e) => handleMarkdownClick(e, setError)}
                onDoubleClick={() => setEditing(true)}
                dangerouslySetInnerHTML={{ __html: html }}
              />
            ) : (
              <button className="panel-empty" onClick={() => setEditing(true)}>
                {t("Add description…")}</button>
            )}
          </div>
        </aside>
      </div>

      {/* Keep the dialog outside the panel backdrop so clicking its overlay does not close the panel. */}
      {releaseConfirm && <ConfirmDialog title={t("Release task?")} confirmLabel={t("Release")}
        onCancel={() => setReleaseConfirm(false)} onConfirm={() => { void onRelease().then(() => setReleaseConfirm(false), (e) => { setError(String(e)); setReleaseConfirm(false); }); }}>
        <p>{t("The current session will no longer be able to submit reports. Existing reports will be kept.")}</p>
      </ConfirmDialog>}
      {confirmDelete && (
        <ConfirmDialog
          title={t("Delete task?")}
          confirmLabel={t("Delete")}
          danger
          onCancel={() => setConfirmDelete(false)}
          onConfirm={() => {
            setConfirmDelete(false);
            // Discard unsaved edits for the task being deleted.
            pending.current = {};
            onDelete();
          }}
        >
          <p>{t("“{name}” and its description will be permanently deleted.", { name: task.title })}</p>
        </ConfirmDialog>
      )}
    </>
  );
}
