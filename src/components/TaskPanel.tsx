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
  /** Папка проекта: относительно неё открываются картинки в описании. */
  projectDir: string;
  titleMaxLength: number;
  /** Все метки проекта. */
  labels: Label[];
  participants: Participant[];
  onRelease: () => Promise<void>;
  onChange: (patch: TaskPatch) => void;
  /** Метки применяются сразу, без отложенного сохранения. */
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
 * Боковая панель задачи: название, статус и описание в markdown.
 * Правки копятся и сохраняются пачкой: описание — через полсекунды после ввода,
 * название — при уходе из поля, а всё несохранённое — при закрытии панели или окна.
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
  const [title, setTitle] = useState(task.title);
  const [criteria, setCriteria] = useState(task.acceptanceCriteria ?? "");
  const [descriptionVersion, setDescriptionVersion] = useState(0);
  const [releaseConfirm, setReleaseConfirm] = useState(false);
  const [description, setDescription] = useState(task.description ?? "");
  const descriptionRef = useRef(description);
  descriptionRef.current = description;
  // Пустое описание сразу открываем в редакторе, заполненное — в просмотре.
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

  // Закрытие панели, переход к другой задаче или закрытие окна — дописываем несохранённое.
  useEffect(() => {
    const unregister = registerFlusher(flush);
    return () => {
      unregister();
      flush();
    };
  }, [flush]);

  // Высота поля названия подстраивается под текст.
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

  // Название попадает в pending сразу при вводе, чтобы сохраниться, даже если панель закроют по Esc.
  function onTitleChange(value: string) {
    setTitle(value);
    const trimmed = value.trim();
    if (trimmed && trimmed !== task.title) pending.current.title = trimmed;
    else delete pending.current.title;
  }

  function commitTitle() {
    // Пустое название не сохраняем — возвращаем прежнее.
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
        <aside className="task-panel" role="dialog" aria-label="Задача" onMouseDown={(e) => e.stopPropagation()}>
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
              <button className="icon-btn" disabled={!!task.claim} title={task.claim ? "Сначала освободите задачу" : task.archived ? "Восстановить" : "В архив"} aria-label={task.archived ? "Восстановить задачу" : "В архив"}
                onClick={() => { flush(); task.archived ? onRestore() : onArchive(); }}>
                <Icon name={task.archived ? "restore" : "archive"} />
              </button>
              <button className="icon-btn danger-hover" disabled={!!task.claim} title={task.claim ? "Сначала освободите задачу" : "Удалить задачу"} onClick={() => setConfirmDelete(true)}>
                <Icon name="trash" />
              </button>
              <button className="icon-btn" title="Закрыть (Esc)" onClick={onClose}>
                <Icon name="close" />
              </button>
            </div>
          </div>
  
          {task.archived && <span className="muted small">Задача в архиве</span>}
          <div className="task-metadata">
            <span className="task-code">{taskCode}</span>
            <span className="muted">Изменена: {task.updatedAt ? <time dateTime={new Date(task.updatedAt).toISOString()}>{new Date(task.updatedAt).toLocaleString("ru-RU", { dateStyle: "medium", timeStyle: "short" })}</time> : "неизвестно"}</span>
          </div>
          <textarea
            ref={titleRef}
            className="panel-title"
            rows={1}
            value={title}
            maxLength={titleMaxLength}
            placeholder="Название задачи"
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
            <label htmlFor="task-assignee">Исполнитель</label>
            <select id="task-assignee" value={task.assigneeId ?? ""} disabled={!!task.claim} onChange={(e) => onChange({ assigneeId: e.target.value })}>
              <option value="">Не назначен</option>
              {participants.map((p) => <option key={p.id} value={p.id}>{p.name}{p.kind === "agent" ? " · агент" : ""}</option>)}
            </select>
          </div>
          {task.claim && <div className="agent-session">
            <span className="muted">Сессия: {task.claim.sessionId}</span>
            <button className="link-btn" onClick={() => { flush(); setReleaseConfirm(true); }}>Освободить задачу</button>
          </div>}
          {task.readyForReview && <div className="agent-review" role="status">Готово к проверке — после проверки переместите задачу в Done.</div>}
          {task.question && <div className="agent-question"><strong>Нужен ответ</strong><p>{task.question}</p></div>}
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
            <summary>Условия готовности{criteria ? " · заполнены" : ""}</summary>
            <textarea aria-label="Условия готовности" placeholder="Что должно работать и как это проверить" rows={3} value={criteria}
              onChange={(e) => { const value = e.target.value; setCriteria(value); pending.current.acceptanceCriteria = value; window.clearTimeout(timer.current); timer.current = window.setTimeout(flush, AUTOSAVE_MS); }} onBlur={flush} />
          </details>
          {(task.reports?.length ?? 0) > 0 && <details className="agent-reports">
            <summary>Результаты работы · {task.reports!.length}</summary>
            <div className="agent-report-list">{[...task.reports!].reverse().map((report, index) => (
              <article key={report.createdAt + ":" + index}>
                <header className="muted small">{participants.find((p) => p.id === report.authorId)?.name ?? report.authorId} · {new Date(report.createdAt).toLocaleString("ru-RU")} · {report.sessionId}</header>
                <div className="markdown" onClick={(e) => handleMarkdownClick(e, setError)} dangerouslySetInnerHTML={{ __html: renderMarkdown(report.text, projectDir) }} />
              </article>
            ))}</div>
          </details>}
          <div className="panel-section-header">
            <span className="muted">Описание</span>
            {(description || editing) && (
              <button className="link-btn" onClick={() => (editing ? (flush(), setEditing(false)) : setEditing(true))}>
                {editing ? "Готово" : "Редактировать"}
              </button>
            )}
          </div>
  
          {error && (
            <div className="error-bar panel-error">
              <span>{error}</span>
              <button className="icon-btn" title="Закрыть" onClick={() => setError(null)}>
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
                title="Двойной клик — редактировать"
                onClick={(e) => handleMarkdownClick(e, setError)}
                onDoubleClick={() => setEditing(true)}
                dangerouslySetInnerHTML={{ __html: html }}
              />
            ) : (
              <button className="panel-empty" onClick={() => setEditing(true)}>
                Добавить описание…
              </button>
            )}
          </div>
        </aside>
      </div>

      {/* Диалог вне фона панели: клик по его затемнению не должен закрывать панель. */}
      {releaseConfirm && <ConfirmDialog title="Освободить задачу?" confirmLabel="Освободить"
        onCancel={() => setReleaseConfirm(false)} onConfirm={() => { void onRelease().then(() => setReleaseConfirm(false), (e) => { setError(String(e)); setReleaseConfirm(false); }); }}>
        <p>Текущая сессия больше не сможет отправлять отчёты. Уже записанные результаты сохранятся.</p>
      </ConfirmDialog>}
      {confirmDelete && (
        <ConfirmDialog
          title="Удалить задачу?"
          confirmLabel="Удалить"
          danger
          onCancel={() => setConfirmDelete(false)}
          onConfirm={() => {
            setConfirmDelete(false);
            // Несохранённые правки удаляемой задачи не нужны.
            pending.current = {};
            onDelete();
          }}
        >
          <p>«{task.title}» вместе с описанием будет удалена без возможности восстановления.</p>
        </ConfirmDialog>
      )}
    </>
  );
}
