import { useEffect, useRef, useState, type CSSProperties } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  pointerWithin,
  type CollisionDetection,
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
import { LabelPill, nextLabelColor } from "../labels";
import type { Board as BoardData, ColumnId, Label, Task } from "../types";
import InlineInput from "./InlineInput";
import LabelFilter, { NO_LABEL } from "./LabelFilter";
import LabelManager from "./LabelManager";
import TaskPanel, { type TaskPatch } from "./TaskPanel";

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

/**
 * Куда бросаем карточку. Сначала смотрим, что под курсором: карточка (вставить рядом с ней)
 * или пустое место колонки (в конец колонки). Только если курсор вне колонок — ближайшая цель.
 * Чистый closestCorners в длинных колонках промахивается: углы соседней колонки оказываются ближе.
 */
const collisionDetection: CollisionDetection = (args) => {
  const underPointer = pointerWithin(args);
  if (underPointer.length > 0) {
    const cards = underPointer.filter((c) => !COLUMN_IDS.includes(String(c.id)));
    return cards.length > 0 ? cards : underPointer;
  }
  return closestCorners(args);
};

/** В какой колонке лежит задача (или сама колонка, если передан её id). */
function findColumn(board: BoardData, id: string): ColumnId | null {
  if (COLUMN_IDS.includes(id)) return id as ColumnId;
  return COLUMNS.find((c) => board[c.id].some((t) => t.id === id))?.id ?? null;
}

export default function Board({ projectId, projectDir }: { projectId: string; projectDir: string }) {
  const [board, setBoard] = useState<BoardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const [filter, setFilter] = useState<Set<string>>(() => loadFilter(projectId));
  const [managingLabels, setManagingLabels] = useState(false);
  // Высота закреплённой полосы фильтра: под ней прилипают заголовки колонок.
  // Меряем по факту, потому что метки могут переноситься на несколько строк.
  const [toolbar, setToolbar] = useState<HTMLDivElement | null>(null);
  const [toolbarHeight, setToolbarHeight] = useState(0);
  useEffect(() => {
    if (!toolbar) return;
    // Первый замер сразу, не дожидаясь ResizeObserver: он срабатывает только на отрисовке кадра.
    setToolbarHeight(toolbar.offsetHeight);
    const observer = new ResizeObserver(() => setToolbarHeight(toolbar.offsetHeight));
    observer.observe(toolbar);
    return () => observer.disconnect();
  }, [toolbar]);
  // Актуальная доска для правок, которые приходят с задержкой (автосохранение панели задачи):
  // они должны применяться к свежему состоянию, а не к копии из замыкания.
  const boardRef = useRef<BoardData | null>(null);
  boardRef.current = board;
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
    boardRef.current = next;
    setBoard(next);
    persist(next);
  }

  /** Применяет изменение к самой свежей версии доски и сохраняет. */
  function change(fn: (b: BoardData) => BoardData) {
    const b = boardRef.current;
    if (b) update(fn(b));
  }

  function changeFilter(next: Set<string>) {
    setFilter(next);
    saveFilter(projectId, next);
  }

  if (error && !board) return <div className="error">{error}</div>;
  if (!board) return <div className="muted">Загрузка…</div>;

  const current = board;
  const labels = current.labels ?? [];

  // Фильтр без удалённых меток. «Любая из выбранных»: задача видна, если есть хоть одна выбранная метка
  // (или у неё нет меток, когда выбрано «без меток»).
  const activeFilter = new Set([...filter].filter((k) => k === NO_LABEL || labels.some((l) => l.id === k)));
  const isVisible = (task: Task) => {
    if (activeFilter.size === 0) return true;
    const own = task.labels ?? [];
    return own.length === 0 ? activeFilter.has(NO_LABEL) : own.some((id) => activeFilter.has(id));
  };

  // Сколько задач с каждой меткой и без меток — для фильтра и окна меток.
  const counts = new Map<string, number>();
  for (const task of COLUMNS.flatMap((c) => current[c.id])) {
    const own = task.labels ?? [];
    if (own.length === 0) counts.set(NO_LABEL, (counts.get(NO_LABEL) ?? 0) + 1);
    for (const id of own) counts.set(id, (counts.get(id) ?? 0) + 1);
  }

  function addTask(column: ColumnId, title: string) {
    // При включённом фильтре новая задача получает выбранные метки, иначе она сразу исчезла бы с доски.
    const withLabels = [...activeFilter].filter((k) => k !== NO_LABEL);
    const task: Task = withLabels.length ? { id: newId(), title, labels: withLabels } : { id: newId(), title };
    change((b) => ({ ...b, [column]: [...b[column], task] }));
  }

  function createLabel(name: string, assignTo?: string) {
    change((b) => {
      const existing = b.labels ?? [];
      const label: Label = { id: newId(), name, color: nextLabelColor(existing) };
      let next: BoardData = { ...b, labels: [...existing, label] };
      const column = assignTo ? findColumn(next, assignTo) : null;
      if (column) {
        next = {
          ...next,
          [column]: next[column].map((t) => (t.id === assignTo ? { ...t, labels: [...(t.labels ?? []), label.id] } : t)),
        };
      }
      return next;
    });
  }

  function updateLabel(id: string, patch: Partial<Pick<Label, "name" | "color">>) {
    change((b) => ({ ...b, labels: (b.labels ?? []).map((l) => (l.id === id ? { ...l, ...patch } : l)) }));
  }

  /** Удаляет метку и снимает её со всех задач одной записью. */
  function deleteLabel(id: string) {
    change((b) => {
      const strip = (tasks: Task[]) =>
        tasks.map((t) => (t.labels?.includes(id) ? { ...t, labels: t.labels.filter((l) => l !== id) } : t));
      return {
        ...b,
        labels: (b.labels ?? []).filter((l) => l.id !== id),
        todo: strip(b.todo),
        inProgress: strip(b.inProgress),
        done: strip(b.done),
      };
    });
    if (filter.has(id)) changeFilter(new Set([...filter].filter((k) => k !== id)));
  }

  function updateTask(id: string, patch: TaskPatch) {
    change((b) => {
      const column = findColumn(b, id);
      if (!column) return b; // Задачу уже удалили.
      return { ...b, [column]: b[column].map((t) => (t.id === id ? { ...t, ...patch } : t)) };
    });
  }

  /** Переносит задачу в конец другой колонки. */
  function moveTask(id: string, to: ColumnId) {
    change((b) => {
      const from = findColumn(b, id);
      if (!from || from === to) return b;
      const task = b[from].find((t) => t.id === id)!;
      return { ...b, [from]: b[from].filter((t) => t.id !== id), [to]: [...b[to], task] };
    });
  }

  function deleteTask(id: string) {
    if (openTaskId === id) setOpenTaskId(null);
    change((b) => {
      const column = findColumn(b, id);
      return column ? { ...b, [column]: b[column].filter((t) => t.id !== id) } : b;
    });
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
  const openColumn = openTaskId ? findColumn(current, openTaskId) : null;
  const openTask = openColumn ? current[openColumn].find((t) => t.id === openTaskId) : undefined;

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
      <div ref={setToolbar} className="board-toolbar">
        <LabelFilter
          labels={labels}
          counts={counts}
          selected={activeFilter}
          onToggle={(key) => {
            const next = new Set(activeFilter);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            changeFilter(next);
          }}
          onClear={() => changeFilter(new Set())}
          onManage={() => setManagingLabels(true)}
        />
      </div>
      <DndContext
        sensors={sensors}
        collisionDetection={collisionDetection}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragEnd={onDragEnd}
        onDragCancel={onDragCancel}
      >
        <div className="board" style={{ "--toolbar-h": `${toolbarHeight}px` } as CSSProperties}>
          {COLUMNS.map((column) => (
            <Column
              key={column.id}
              id={column.id}
              title={column.title}
              tasks={current[column.id].filter(isVisible)}
              total={current[column.id].length}
              labels={labels}
              onAdd={(title) => addTask(column.id, title)}
              onOpen={setOpenTaskId}
              onDelete={deleteTask}
            />
          ))}
        </div>
        <DragOverlay>{activeTask && <div className="task-card overlay-card">{activeTask.title}</div>}</DragOverlay>
      </DndContext>

      {openTask && openColumn && (
        <TaskPanel
          key={openTask.id}
          task={openTask}
          column={openColumn}
          columns={COLUMNS}
          projectDir={projectDir}
          titleMaxLength={TASK_TITLE_MAX}
          labels={labels}
          onChange={(patch) => updateTask(openTask.id, patch)}
          onSetLabels={(ids) => updateTask(openTask.id, { labels: ids })}
          onCreateLabel={(name) => createLabel(name, openTask.id)}
          onMove={(to) => moveTask(openTask.id, to)}
          onDelete={() => deleteTask(openTask.id)}
          onClose={() => setOpenTaskId(null)}
        />
      )}

      {managingLabels && (
        <LabelManager
          labels={labels}
          usage={counts}
          onCreate={(name) => createLabel(name)}
          onUpdate={updateLabel}
          onDelete={deleteLabel}
          onClose={() => setManagingLabels(false)}
        />
      )}
    </>
  );
}

/** Фильтр по меткам запоминается для каждого проекта отдельно. */
function filterKey(projectId: string) {
  return `label-filter:${projectId}`;
}

function loadFilter(projectId: string): Set<string> {
  try {
    const saved = JSON.parse(localStorage.getItem(filterKey(projectId)) ?? "[]");
    return new Set(Array.isArray(saved) ? saved.filter((k) => typeof k === "string") : []);
  } catch {
    return new Set();
  }
}

function saveFilter(projectId: string, filter: Set<string>) {
  try {
    localStorage.setItem(filterKey(projectId), JSON.stringify([...filter]));
  } catch {
    // Не запомним фильтр — не страшно.
  }
}

interface ColumnProps {
  id: ColumnId;
  title: string;
  /** Видимые задачи (с учётом фильтра). */
  tasks: Task[];
  /** Всего задач в колонке. */
  total: number;
  labels: Label[];
  onAdd: (title: string) => void;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
}

function Column({ id, title, tasks, total, labels, onAdd, onOpen, onDelete }: ColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id });
  const [adding, setAdding] = useState(false);
  // Новый key пересоздаёт поле ввода после Enter, чтобы сразу вводить следующую задачу.
  const [inputKey, setInputKey] = useState(0);

  return (
    // Зона сброса — вся колонка во всю высоту доски, а не только список карточек:
    // иначе в короткую колонку нельзя бросить задачу, если доска прокручена вниз.
    <section ref={setNodeRef} className={`column column-${id} ${isOver ? "drop-target" : ""}`}>
      <header className="column-header">
        <span className="column-pill">
          <span className="column-dot" />
          {title}
        </span>
        <span className="column-count" title={tasks.length < total ? "Часть задач скрыта фильтром" : undefined}>
          {tasks.length < total ? `${tasks.length} из ${total}` : total}
        </span>
      </header>

      <SortableContext items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
        <div className="column-tasks">
          {tasks.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              labels={labels}
              onOpen={() => onOpen(task.id)}
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
  labels: Label[];
  onOpen: () => void;
  onDelete: () => void;
}

function TaskCard({ task, labels, onOpen, onDelete }: TaskCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: task.id });

  const style = { transform: CSS.Translate.toString(transform), transition };
  const hasDescription = !!task.description?.trim();
  // Метки в порядке, заданном в проекте.
  const taskLabels = labels.filter((l) => task.labels?.includes(l.id));

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`task-card ${isDragging ? "dragging" : ""}`}
      // Перетаскивание стартует только после сдвига на 5px, поэтому обычный клик открывает задачу.
      onClick={onOpen}
      {...attributes}
      {...listeners}
    >
      <div className="task-body">
        <span className="task-title">
          {task.title}
          {hasDescription && (
            <span className="task-has-desc" title="Есть описание">
              ≡
            </span>
          )}
        </span>
        {taskLabels.length > 0 && (
          <div className="task-labels">
            {taskLabels.map((label) => (
              <LabelPill key={label.id} label={label} />
            ))}
          </div>
        )}
      </div>
      <button
        className="icon-btn task-delete"
        title="Удалить задачу"
        // Нажатия на кнопке не должны начинать перетаскивание или открывать задачу.
        onPointerDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
      >
        ×
      </button>
    </div>
  );
}
