import { useEffect, useRef, useState } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { getBoard, saveBoard } from "../api";
import { trackSave } from "../saveTracker";
import type { Board as BoardData, ColumnId, Task } from "../types";
import InlineInput from "./InlineInput";

const COLUMNS: { id: ColumnId; title: string }[] = [
  { id: "todo", title: "Not started" },
  { id: "inProgress", title: "In progress" },
  { id: "done", title: "Done" },
];

/** Лимит длины названия задачи. Должен совпадать с MAX_TITLE_CHARS в src-tauri/src/board.rs. */
const TASK_TITLE_MAX = 2000;

const COLUMN_IDS =COLUMNS.map((c) => c.id) as string[];

/** Короткий уникальный id. crypto.randomUUID есть не во всех контекстах WebView, поэтому свой. */
function newId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/** В какой колонке лежит задача (или сама колонка, если передан её id). */
function findColumn(board: BoardData, id: string): ColumnId | null {
  if (COLUMN_IDS.includes(id)) return id as ColumnId;
  return COLUMNS.find((c) => board[c.id].some((t) => t.id === id))?.id ?? null;
}

export default function Board({ projectId }: { projectId: string }) {
  const [board, setBoard] = useState<BoardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  // Состояние доски до начала перетаскивания: для отмены и чтобы не сохранять, если ничего не поменялось.
  const dragStart = useRef<BoardData | null>(null);
  // Сохранения выполняются строго по очереди, чтобы старая версия не перезаписала новую.
  const saveQueue = useRef<Promise<void>>(Promise.resolve());

  const sensors = useSensors(
    // Небольшой порог, чтобы обычный клик и двойной клик не начинали перетаскивание.
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  useEffect(() => {
    let cancelled = false;
    getBoard(projectId).then(
      (b) => !cancelled && setBoard(b),
      (e) => !cancelled && setError(String(e)),
    );
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  function persist(next: BoardData) {
    saveQueue.current = trackSave(saveQueue.current.then(() => saveBoard(projectId, next))).catch((e) => setError(`Не удалось сохранить доску: ${e}`));
  }

  function update(next: BoardData) {
    setBoard(next);
    persist(next);
  }

  if (error && !board) return <div className="error">{error}</div>;
  if (!board) return <div className="muted">Загрузка…</div>;

  const current = board;

  function addTask(column: ColumnId, title: string) {
    update({ ...current, [column]: [...current[column], { id: newId(), title }] });
  }

  function renameTask(column: ColumnId, id: string, title: string) {
    update({ ...current, [column]: current[column].map((t) => (t.id === id ? { ...t, title } : t)) });
  }

  function deleteTask(column: ColumnId, id: string) {
    update({ ...current, [column]: current[column].filter((t) => t.id !== id) });
  }

  function onDragStart({ active }: DragStartEvent) {
    setActiveId(String(active.id));
    dragStart.current = current;
  }

  // Переход в другую колонку применяем сразу, чтобы карточка «переезжала» под курсором.
  function onDragOver({ active, over }: DragOverEvent) {
    if (!over) return;
    setBoard((b) => {
      if (!b) return b;
      const from = findColumn(b, String(active.id));
      const to = findColumn(b, String(over.id));
      if (!from || !to || from === to) return b;
      const task = b[from].find((t) => t.id === active.id)!;
      const overIndex = b[to].findIndex((t) => t.id === over.id);
      const insertAt = overIndex >= 0 ? overIndex : b[to].length;
      const target = [...b[to]];
      target.splice(insertAt, 0, task);
      return { ...b, [from]: b[from].filter((t) => t.id !== active.id), [to]: target };
    });
  }

  // Порядок внутри колонки меняем по отпусканию, затем сохраняем итог один раз.
  function onDragEnd({ active, over }: DragEndEvent) {
    setActiveId(null);
    const before = dragStart.current;
    dragStart.current = null;
    let next = current;
    if (over) {
      const column = findColumn(current, String(active.id));
      if (column && column === findColumn(current, String(over.id))) {
        const oldIndex = current[column].findIndex((t) => t.id === active.id);
        const newIndex = current[column].findIndex((t) => t.id === over.id);
        if (newIndex >= 0 && oldIndex !== newIndex) {
          next = { ...current, [column]: arrayMove(current[column], oldIndex, newIndex) };
        }
      }
    }
    if (JSON.stringify(next) === JSON.stringify(before)) {
      setBoard(next);
      return;
    }
    update(next);
  }

  function onDragCancel() {
    setActiveId(null);
    if (dragStart.current) setBoard(dragStart.current);
    dragStart.current = null;
  }

  const activeTask = activeId ? COLUMNS.flatMap((c) => current[c.id]).find((t) => t.id === activeId) : undefined;

  return (
    <>
      {error && (
        <div className="error-bar board-error">
          <span>{error}</span>
          <button className="icon-btn" title="Закрыть" onClick={() => setError(null)}>
            ×
          </button>
        </div>
      )}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragEnd={onDragEnd}
        onDragCancel={onDragCancel}
      >
        <div className="board">
          {COLUMNS.map((column) => (
            <Column
              key={column.id}
              id={column.id}
              title={column.title}
              tasks={current[column.id]}
              onAdd={(title) => addTask(column.id, title)}
              onRename={(id, title) => renameTask(column.id, id, title)}
              onDelete={(id) => deleteTask(column.id, id)}
            />
          ))}
        </div>
        <DragOverlay>{activeTask && <div className="task-card overlay-card">{activeTask.title}</div>}</DragOverlay>
      </DndContext>
    </>
  );
}

interface ColumnProps {
  id: ColumnId;
  title: string;
  tasks: Task[];
  onAdd: (title: string) => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
}

function Column({ id, title, tasks, onAdd, onRename, onDelete }: ColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id });
  const [adding, setAdding] = useState(false);
  // Новый key пересоздаёт поле ввода после Enter, чтобы сразу вводить следующую задачу.
  const [inputKey, setInputKey] = useState(0);

  return (
    <section className={`column column-${id}`}>
      <header className="column-header">
        <span className="column-pill">
          <span className="column-dot" />
          {title}
        </span>
        <span className="column-count">{tasks.length}</span>
      </header>

      <SortableContext items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
        <div ref={setNodeRef} className={`column-tasks ${isOver ? "drop-target" : ""}`}>
          {tasks.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              onRename={(t) => onRename(task.id, t)}
              onDelete={() => onDelete(task.id)}
            />
          ))}
        </div>
      </SortableContext>

      {adding ? (
        <div className="task-card editing">
          <InlineInput
            key={inputKey}
            multiline
            maxLength={TASK_TITLE_MAX}
            placeholder="Название задачи"
            onCommit={(value, via) => {
              onAdd(value);
              if (via === "enter") setInputKey((k) => k + 1);
              else setAdding(false);
            }}
            onCancel={() => setAdding(false)}
          />
        </div>
      ) : (
        <button className="add-task" onClick={() => setAdding(true)}>
          + Добавить задачу
        </button>
      )}
    </section>
  );
}

interface TaskCardProps {
  task: Task;
  onRename: (title: string) => void;
  onDelete: () => void;
}

function TaskCard({ task, onRename, onDelete }: TaskCardProps) {
  const [editing, setEditing] = useState(false);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
    disabled: editing,
  });

  const style = { transform: CSS.Translate.toString(transform), transition };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`task-card ${isDragging ? "dragging" : ""} ${editing ? "editing" : ""}`}
      onDoubleClick={() => setEditing(true)}
      {...attributes}
      {...listeners}
    >
      {editing ? (
        <InlineInput
          multiline
          maxLength={TASK_TITLE_MAX}
          initial={task.title}
          onCommit={(title) => {
            setEditing(false);
            onRename(title);
          }}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <>
          <span className="task-title">{task.title}</span>
          <button
            className="icon-btn task-delete"
            title="Удалить задачу"
            // Нажатия на кнопке не должны начинать перетаскивание карточки.
            onPointerDown={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
            onClick={onDelete}
          >
            ×
          </button>
        </>
      )}
    </div>
  );
}
