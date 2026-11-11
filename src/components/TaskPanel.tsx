import Icon from "./Icon";
import { useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { handleMarkdownClick, renderMarkdown } from "../markdown";
import { registerFlusher } from "../saveTracker";
import type { ColumnId, Label, Task } from "../types";
import ConfirmDialog from "./ConfirmDialog";
import LabelPicker from "./LabelPicker";
import MarkdownEditor from "./MarkdownEditor";

export type TaskPatch = Partial<Pick<Task, "title" | "description" | "labels">>;

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
  const [description, setDescription] = useState(task.description ?? "");
  // Пустое описание сразу открываем в редакторе, заполненное — в просмотре.
  const [editing, setEditing] = useState(!task.description);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const titleRef = useRef<HTMLTextAreaElement>(null);
  const pending = useRef<TaskPatch>({});
  const timer = useRef<number | undefined>(undefined);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

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
      if (e.key === "Escape" && !confirmDelete && !e.isComposing) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, confirmDelete]);

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
              <button className="icon-btn" title={task.archived ? "Восстановить" : "В архив"} aria-label={task.archived ? "Восстановить задачу" : "В архив"}
                onClick={() => { flush(); task.archived ? onRestore() : onArchive(); }}>
                <Icon name={task.archived ? "restore" : "archive"} />
              </button>
              <button className="icon-btn danger-hover" title="Удалить задачу" onClick={() => setConfirmDelete(true)}>
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

          <LabelPicker
            labels={labels}
            selected={task.labels ?? []}
            onToggle={(id) => {
              const current = task.labels ?? [];
              onSetLabels(current.includes(id) ? current.filter((l) => l !== id) : [...current, id]);
            }}
            onCreate={onCreateLabel}
          />

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
                <MarkdownEditor initialText={description} onChange={onDescriptionChange} onSave={flush} />
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
