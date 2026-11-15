import { useI18n } from "../i18n";
import type { Message } from "../locales";
import Icon from "./Icon";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
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
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { getBoard, saveBoard, getParticipants, releaseTask, deleteTask as removeTask, restoreDeletedTask } from "../api";
import { stampBoard, taskCode, setTaskArchived } from "../taskMetadata";
import { compareTaskNumbers, sortTasksByNumber } from "../taskOrdering";
import { registerFlusher, trackSave } from "../saveTracker";
import { loadViewPreferences, saveViewPreferences } from "../viewPreferences";
import { recordTaskMove, undoTaskMove, type TaskMove } from "../taskMove";
import { LabelPill, labelStyle, nextLabelColor } from "../labels";
import type { Board as BoardData, ColumnId, Label, Task, Participant } from "../types";
import InlineInput from "./InlineInput";
import LabelFilter, { NO_LABEL } from "./LabelFilter";
import AssigneeFilter, { NO_ASSIGNEE } from "./AssigneeFilter";
import LabelManager from "./LabelManager";
import ConfirmDialog from "./ConfirmDialog";
import TaskArchive from "./TaskArchive";
import TaskSearch from "./TaskSearch";
import TaskPanel, { type TaskPatch } from "./TaskPanel";

const COLUMNS: { id: ColumnId; title: Message }[] = [
  { id: "todo", title: "Not started" },
  { id: "inProgress", title: "In progress" },
  { id: "done", title: "Done" },
];

/** Task title length limit. Must match MAX_TITLE_CHARS in src-tauri/src/board.rs. */
const TASK_TITLE_MAX = 2000;

const COLUMN_IDS =COLUMNS.map((c) => c.id) as string[];

/** Generate a short unique ID because crypto.randomUUID is unavailable in some WebView contexts. */
function newId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/**
 * Choose a drop target under the pointer first: a card or empty column space.
 * Use the nearest target only when outside all columns.
 * closestCorners alone misses in tall columns because adjacent column corners can be closer.
 */
const collisionDetection: CollisionDetection = (args) => {
  const underPointer = pointerWithin(args);
  if (underPointer.length > 0) {
    const cards = underPointer.filter((c) => !COLUMN_IDS.includes(String(c.id)));
    return cards.length > 0 ? cards : underPointer;
  }
  return closestCorners(args);
};

/** Find the task's column, or the column itself if given a column ID. */
function findColumn(board: BoardData, id: string): ColumnId | null {
  if (COLUMN_IDS.includes(id)) return id as ColumnId;
  return COLUMNS.find((c) => board[c.id].some((t) => t.id === id))?.id ?? null;
}

export default function Board({ projectId, projectDir, actionsTarget }: { projectId: string; projectDir: string; actionsTarget: HTMLElement | null }) {
  const { t } = useI18n();
  const [board, setBoard] = useState<BoardData | null>(null);
  const [reloadConfirm, setReloadConfirm] = useState(false);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const pendingSaves = useRef(0);
  const generation = useRef(0);
  const saveFailed = useRef(false);
  const failedBase = useRef<BoardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const [filter, setFilter] = useState<Set<string>>(() => loadFilter(projectId));
  const [assigneeFilter, setAssigneeFilter] = useState<Set<string>>(() => loadFilter(projectId, "assignee"));
  const [initialView] = useState(() => loadViewPreferences(projectDir));
  const [filtersOpen, setFiltersOpen] = useState(initialView.filtersOpen);
  const scrollArea = useRef<HTMLDivElement>(null);
  const scrollRestored = useRef(false);
  const scrollPosition = useRef({ scrollTop: initialView.scrollTop, scrollLeft: initialView.scrollLeft });
  const scrollSaveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const filtersId = useId();
  const [managingLabels, setManagingLabels] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [archivedNotice, setArchivedNotice] = useState<string | null>(null);
  const [moveNotice, setMoveNotice] = useState<TaskMove | null>(null);
  const moveNoticeRef = useRef<TaskMove | null>(null);
  const [undoingMove, setUndoingMove] = useState(false);
  const undoInProgress = useRef(false);
  const [deletedTaskNotice, setDeletedTaskNotice] = useState<{ token: string; number?: number } | null>(null);
  const [deletionBusy, setDeletionBusy] = useState(false);
  const deletionRunning = useRef(false);
  // Keep the current board for delayed edits, such as task panel autosaves:
  // apply them to the latest state rather than a stale closure snapshot.
  const boardRef = useRef<BoardData | null>(null);
  boardRef.current = board;
  // Keep the board state before dragging to allow cancellation and skip saves when nothing changes.
  const dragStart = useRef<BoardData | null>(null);
  // Serialize saves so an older version cannot overwrite a newer one.
  const saveQueue = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing || e.altKey || !(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== "f") return;
      const target = e.target instanceof HTMLElement ? e.target : null;
      if (document.querySelector('[role="dialog"]') || target?.isContentEditable || target?.closest("input, textarea, select, .cm-editor")) return;
      if (!boardRef.current || dragStart.current) return;
      e.preventDefault();
      setSearchOpen(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Restore once, after asynchronous board loading has created the scroll area.
  useLayoutEffect(() => {
    const area = scrollArea.current;
    if (!area || scrollRestored.current) return;
    area.scrollTop = initialView.scrollTop;
    area.scrollLeft = initialView.scrollLeft;
    scrollPosition.current = { scrollTop: area.scrollTop, scrollLeft: area.scrollLeft };
    scrollRestored.current = true;
  }, [board, initialView]);

  useEffect(() => {
    const save = () => {
      clearTimeout(scrollSaveTimer.current);
      if (scrollRestored.current) saveViewPreferences(projectDir, scrollPosition.current);
    };
    const unregister = registerFlusher(save);
    window.addEventListener("pagehide", save);
    return () => {
      unregister();
      window.removeEventListener("pagehide", save);
      save();
    };
  }, [projectDir]);

  const sensors = useSensors(
    // Use a small movement threshold so clicks and double-clicks do not start dragging.
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

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const members = await getParticipants();
        if (!cancelled) setParticipants(members);
        if (pendingSaves.current === 0 && !dragStart.current && !saveFailed.current) {
          const version = generation.current;
          const fresh = await getBoard(projectId);
          if (!cancelled && pendingSaves.current === 0 && generation.current === version && !dragStart.current && !saveFailed.current) {
            boardRef.current = fresh; setBoard(fresh);
          }
        }
      } catch { /* retry after a temporary storage error */ }
      if (!cancelled) timer = setTimeout(poll, 2000);
    }
    void poll();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [projectId]);

  function persist(next: BoardData, base: BoardData, version: number) {
    pendingSaves.current += 1;
    saveQueue.current = trackSave(saveQueue.current.then(async () => {
      const mergeBase = failedBase.current ?? base;
      try {
        const saved = await saveBoard(projectId, next, mergeBase);
        failedBase.current = null;
        saveFailed.current = false;
        setError(null);
        if (generation.current === version && !dragStart.current) {
          boardRef.current = saved; setBoard(saved);
        }
      } catch (e) {
        saveFailed.current = true;
        failedBase.current = mergeBase;
        setError(String(e));
      } finally { pendingSaves.current -= 1; }
    }));
  }

  function update(next: BoardData, previous = boardRef.current) {
    if (!previous) return;
    next = stampBoard(previous, next);
    generation.current += 1;
    boardRef.current = next;
    setBoard(next);
    persist(next, previous, generation.current);
  }

  /** Applies a change to the latest board state and saves it. */
  function change(fn: (b: BoardData) => BoardData) {
    const b = boardRef.current;
    if (b) update(fn(b));
  }

  function showMoveNotice(move: TaskMove | null) {
    moveNoticeRef.current = move;
    setMoveNotice(move);
  }

  async function undoLastMove() {
    const move = moveNoticeRef.current;
    if (!move || undoInProgress.current || dragStart.current) return;
    undoInProgress.current = true;
    setUndoingMove(true);
    let reading = false;
    try {
      await saveQueue.current;
      if (saveFailed.current) {
        setError(t("Resolve the save error before undoing the move."));
        return;
      }
      if (moveNoticeRef.current !== move) return;
      pendingSaves.current += 1;
      reading = true;
      const version = ++generation.current;
      const fresh = await getBoard(projectId);
      if (moveNoticeRef.current !== move) return;
      if (generation.current !== version || dragStart.current) {
        setError(t("The board changed while undoing. Try again."));
        return;
      }
      const next = undoTaskMove(fresh, move);
      if (!next) {
        boardRef.current = fresh;
        setBoard(fresh);
        showMoveNotice(null);
        setError(t("The task changed after the move. Undo is no longer available."));
        return;
      }
      update(next, fresh);
      showMoveNotice(null);
      await saveQueue.current;
    } catch (e) {
      setError(String(e));
    } finally {
      if (reading) pendingSaves.current -= 1;
      undoInProgress.current = false;
      setUndoingMove(false);
    }
  }

  function changeFilter(next: Set<string>) {
    setFilter(next);
    saveFilter(projectId, next);
  }
  function changeAssigneeFilter(next: Set<string>) {
    setAssigneeFilter(next);
    saveFilter(projectId, next, "assignee");
  }

  if (error && !board) return <div className="error">{error}</div>;
  if (!board) return <div className="muted">{t("Loading…")}</div>;

  // Derive display order on every render, including polling and drag previews.
  const current: BoardData = {
    ...board,
    todo: sortTasksByNumber(board.todo),
    inProgress: sortTasksByNumber(board.inProgress),
    done: sortTasksByNumber(board.done),
  };
  const labels = current.labels ?? [];

  // Exclude deleted labels from the filter. Match any selected label: show a task if it has at least one
  // selected label, or no labels when the unlabeled filter is selected.
  const activeFilter = new Set([...filter].filter((k) => k === NO_LABEL || labels.some((l) => l.id === k)));
  const matchesLabels = (task: Task) => {
    if (activeFilter.size === 0) return true;
    const own = task.labels ?? [];
    return own.length === 0 ? activeFilter.has(NO_LABEL) : own.some((id) => activeFilter.has(id));
  };

  // Preserve access to tasks whose assignee is absent from the shared participant list.
  const assignees: Pick<Participant, "id" | "name">[] = [...participants];
  const assigneeIds = new Set(assignees.map((participant) => participant.id));
  for (const task of COLUMNS.flatMap((column) => current[column.id])) {
    if (task.assigneeId && !assigneeIds.has(task.assigneeId)) {
      assigneeIds.add(task.assigneeId);
      assignees.push({ id: task.assigneeId, name: task.assigneeId });
    }
  }
  const activeAssignees = new Set([...assigneeFilter].filter((id) => id === NO_ASSIGNEE || assigneeIds.has(id)));
  const activeFilterCount = activeFilter.size + activeAssignees.size;
  const filterSummary: { id: string; kind: "label" | "assignee"; name: string; color?: string }[] = [];
  for (const label of labels) {
    if (activeFilter.has(label.id)) filterSummary.push({ ...label, kind: "label" });
  }
  if (activeFilter.has(NO_LABEL)) filterSummary.push({ id: NO_LABEL, kind: "label", name: t("Unlabeled") });
  for (const assignee of assignees) {
    if (activeAssignees.has(assignee.id)) filterSummary.push({ ...assignee, kind: "assignee" });
  }
  if (activeAssignees.has(NO_ASSIGNEE)) filterSummary.push({ id: NO_ASSIGNEE, kind: "assignee", name: t("Without assignee") });
  const isVisible = (task: Task) => !task.archived && matchesLabels(task)
    && (activeAssignees.size === 0 || activeAssignees.has(task.assigneeId || NO_ASSIGNEE));

  // Count tasks per label and unlabeled tasks for the filter and label dialog.
  const counts = new Map<string, number>();
  const assigneeCounts = new Map<string, number>();
  for (const task of COLUMNS.flatMap((c) => current[c.id])) {
    if (task.archived) continue;
    const own = task.labels ?? [];
    if (own.length === 0) counts.set(NO_LABEL, (counts.get(NO_LABEL) ?? 0) + 1);
    for (const id of own) counts.set(id, (counts.get(id) ?? 0) + 1);
    if (matchesLabels(task)) {
      const id = task.assigneeId || NO_ASSIGNEE;
      assigneeCounts.set(id, (assigneeCounts.get(id) ?? 0) + 1);
    }
  }

  const archivedTasks = COLUMNS.flatMap((c) => current[c.id].filter((task) => task.archived).map((task) => ({ task, column: c.id, status: t(c.title) })))
    .sort((a, b) => compareTaskNumbers(a.task, b.task));
  // Include archived tasks in label management because deleting a label affects all tasks.
  const labelUsage = new Map<string, number>();
  for (const task of COLUMNS.flatMap((c) => current[c.id])) {
    for (const id of task.labels ?? []) labelUsage.set(id, (labelUsage.get(id) ?? 0) + 1);
  }

  function archiveTask(id: string) {
    setDeletedTaskNotice(null);
    showMoveNotice(null);
    change((b) => setTaskArchived(b, id, true));
    setOpenTaskId(null);
    setArchivedNotice(id);
  }

  function restoreTask(id: string) {
    setDeletedTaskNotice(null);
    showMoveNotice(null);
    change((b) => setTaskArchived(b, id, false));
    if (archivedNotice === id) setArchivedNotice(null);
  }

  function addTask(column: ColumnId, title: string) {
    // Assign the active filter labels to new tasks so they do not immediately disappear from the board.
    const withLabels = [...activeFilter].filter((k) => k !== NO_LABEL);
    const task: Task = withLabels.length ? { id: newId(), title, labels: withLabels } : { id: newId(), title };
    change((b) => ({ ...b, [column]: [...b[column], task] }));
  }

  function createLabel(name: string, assignTo?: string, color?: string) {
    change((b) => {
      const existing = b.labels ?? [];
      const label: Label = { id: newId(), name, color: color ?? nextLabelColor(existing) };
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

  /** Deletes a label and removes it from all tasks in a single write. */
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
      if (!column) return b; // The task has already been deleted.
      return { ...b, [column]: b[column].map((t) => (t.id === id ? { ...t, ...patch } : t)) };
    });
  }

  /** Moves a task to another column; display order is determined by its number. */
  function moveTask(id: string, to: ColumnId) {
    const before = boardRef.current;
    if (!before) return;
    const from = findColumn(before, id);
    if (!from || from === to) return;
    const task = before[from].find((task) => task.id === id)!;
    const next = { ...before, [from]: before[from].filter((task) => task.id !== id), [to]: [...before[to], task] };
    update(next, before);
    showMoveNotice(recordTaskMove(before, next, id));
    setDeletedTaskNotice(null);
    setArchivedNotice(null);
  }

  function deleteTask(id: string) {
    if (deletionRunning.current || undoInProgress.current || dragStart.current) return;
    deletionRunning.current = true;
    setDeletionBusy(true);
    showMoveNotice(null);
    setArchivedNotice(null);
    if (openTaskId === id) setOpenTaskId(null);
    void trackSave((async () => {
      let mutating = false;
      try {
        await saveQueue.current;
        if (saveFailed.current) throw new Error(t("Resolve the board save error first"));
        const before = boardRef.current;
        if (!before) return;
        const column = findColumn(before, id);
        const task = column ? before[column].find((task) => task.id === id) : undefined;
        if (!task) return;
        const version = ++generation.current;
        pendingSaves.current += 1;
        mutating = true;
        const deleted = await removeTask(projectId, task);
        if (generation.current === version && !dragStart.current) {
          boardRef.current = deleted.board;
          setBoard(deleted.board);
          setError(null);
        }
        setDeletedTaskNotice({ token: deleted.token, number: deleted.number ?? undefined });
      } catch (e) { setError(String(e)); }
      finally {
        if (mutating) pendingSaves.current -= 1;
        deletionRunning.current = false;
        setDeletionBusy(false);
      }
    })());
  }

  async function undoTaskDeletion() {
    if (!deletedTaskNotice || deletionRunning.current || undoInProgress.current || dragStart.current) return;
    deletionRunning.current = true;
    setDeletionBusy(true);
    let mutating = false;
    try {
      await saveQueue.current;
      if (saveFailed.current) throw new Error(t("Resolve the board save error first"));
      const version = ++generation.current;
      pendingSaves.current += 1;
      mutating = true;
      const restored = await restoreDeletedTask(projectId, deletedTaskNotice.token);
      if (generation.current === version && !dragStart.current) {
        boardRef.current = restored;
        setBoard(restored);
        setError(null);
      }
      setDeletedTaskNotice(null);
    } catch (e) { setError(String(e)); }
    finally {
      if (mutating) pendingSaves.current -= 1;
      deletionRunning.current = false;
      setDeletionBusy(false);
    }
  }

  function onDragStart({ active }: DragStartEvent) {
    setActiveId(String(active.id));
    dragStart.current = current;
  }

  // Apply column changes immediately so the card follows the pointer.
  function onDragOver({ active, over }: DragOverEvent) {
    if (!over) return;
    setBoard((b) => {
      if (!b) return b;
      const from = findColumn(b, String(active.id));
      const to = findColumn(b, String(over.id));
      if (!from || !to || from === to) return b;
      const task = b[from].find((t) => t.id === active.id)!;
      return { ...b, [from]: b[from].filter((t) => t.id !== active.id), [to]: [...b[to], task] };
    });
  }

  // Only status changes are saved: dropping within a column cannot change numeric order.
  function onDragEnd({ active, over }: DragEndEvent) {
    setActiveId(null);
    const before = dragStart.current;
    dragStart.current = null;
    if (!over) {
      if (before) setBoard(before);
      return;
    }
    const next = current;
    if (JSON.stringify(next) === JSON.stringify(before)) {
      setBoard(next);
      return;
    }
    update(next, before ?? current);
    if (before) {
      const move = recordTaskMove(before, next, String(active.id));
      if (move) { showMoveNotice(move); setArchivedNotice(null); setDeletedTaskNotice(null); }
    }
  }

  function onDragCancel() {
    setActiveId(null);
    if (dragStart.current) setBoard(dragStart.current);
    dragStart.current = null;
  }

  const activeTask = activeId ? COLUMNS.flatMap((c) => current[c.id]).find((t) => t.id === activeId) : undefined;
  const activeColumn = activeId ? findColumn(current, activeId) : null;
  const openColumn = openTaskId ? findColumn(current, openTaskId) : null;
  const openTask = openColumn ? current[openColumn].find((t) => t.id === openTaskId) : undefined;

  return (
    <div className="board-view" aria-busy={deletionBusy} inert={deletionBusy}>
      {actionsTarget && createPortal(
        <>
          <button type="button" className="btn task-search-button" disabled={deletionBusy} aria-keyshortcuts="Control+f" title={t("Search tasks (Ctrl+F)")} onClick={() => setSearchOpen(true)}>
            <Icon name="search" />{t("Search")}
          </button>
          <button className="btn archive-button" disabled={deletionBusy} title={t("Open archive")} onClick={() => setArchiveOpen(true)}>
            <Icon name="archive" /> {t("Archive")}<span className="archive-count">{archivedTasks.length}</span>
          </button>
        </>,
        actionsTarget,
      )}
      {error && (
        <div className="error-bar board-error">
          <span>{error}</span>
          {saveFailed.current && <div className="board-conflict-actions">
            <button className="btn small-btn" disabled={pendingSaves.current > 0} onClick={() => {
              if (boardRef.current && failedBase.current) persist(boardRef.current, failedBase.current, generation.current);
            }}>{t("Retry save")}</button>
            <button className="btn small-btn" onClick={() => setReloadConfirm(true)}>{t("Load current board")}</button>
          </div>}
          <button className="icon-btn" title={t("Close")} onClick={() => { if (!saveFailed.current) setError(null); }}>
                <Icon name="close" />
              </button>
        </div>
      )}
      <div className="board-toolbar">
        <div className="board-filter-heading">
          <button type="button" className="board-filter-toggle" aria-expanded={filtersOpen} aria-controls={filtersId}
            title={t(filtersOpen ? "Hide filters" : "Show filters")} onClick={() => {
              const next = !filtersOpen;
              setFiltersOpen(next);
              saveViewPreferences(projectDir, { filtersOpen: next });
            }}>
            <Icon name="chevron" />{t("Filters")}
            {activeFilterCount > 0 && <span className="board-filter-count" aria-label={t("Active filters: {count}", { count: activeFilterCount })}>{activeFilterCount}</span>}
          </button>
          {!filtersOpen && filterSummary.length > 0 && <div className="board-active-filters" role="group" aria-label={t("Active filters")}>
            {filterSummary.map((item) => {
              const removeLabel = t(item.kind === "label" ? "Remove label filter: {name}" : "Remove assignee filter: {name}", { name: item.name });
              return <button key={`${item.kind}:${item.id}`} type="button" className={`board-active-filter board-active-filter-${item.kind}`}
                style={item.kind === "label" ? labelStyle(item.color ?? "gray") : undefined} title={removeLabel} aria-label={removeLabel}
                onClick={() => {
                  const next = new Set(item.kind === "label" ? activeFilter : activeAssignees);
                  next.delete(item.id);
                  if (item.kind === "label") changeFilter(next); else changeAssigneeFilter(next);
                }}>
                {item.kind === "label" ? <span className="label-dot" aria-hidden="true" /> : <Icon name="users" />}
                <span className="board-active-filter-name">{item.name}</span><Icon name="close" className="board-active-filter-remove" />
              </button>;
            })}
          </div>}
          {activeFilterCount > 0 && <div className="board-toolbar-actions">
            <button type="button" className="board-filter-reset"
              onClick={() => { changeFilter(new Set()); changeAssigneeFilter(new Set()); }}><Icon name="close" />{t("Reset filters")}</button>
          </div>}
        </div>
        <div id={filtersId} className="board-filters" hidden={!filtersOpen}>
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
          <AssigneeFilter participants={assignees} counts={assigneeCounts} selected={activeAssignees}
            onToggle={(id) => {
              const next = new Set(activeAssignees);
              if (next.has(id)) next.delete(id); else next.add(id);
              changeAssigneeFilter(next);
            }} onClear={() => changeAssigneeFilter(new Set())} />
        </div>
      </div>
      <DndContext
        sensors={sensors}
        collisionDetection={collisionDetection}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragEnd={onDragEnd}
        onDragCancel={onDragCancel}
      >
        <div ref={scrollArea} className="board-scroll" tabIndex={0} role="region" aria-label={t("Board")}
          onScroll={(e) => {
            if (!scrollRestored.current) return;
            scrollPosition.current = { scrollTop: e.currentTarget.scrollTop, scrollLeft: e.currentTarget.scrollLeft };
            clearTimeout(scrollSaveTimer.current);
            scrollSaveTimer.current = setTimeout(() => saveViewPreferences(projectDir, scrollPosition.current), 150);
          }}>
        <div className="board">
          {COLUMNS.map((column) => (
            <Column
              key={column.id}
              id={column.id}
              title={t(column.title)}
              taskPrefix={current.taskPrefix}
              tasks={current[column.id].filter(isVisible)}
              total={current[column.id].filter((t) => !t.archived).length}
              labels={labels}
              participants={participants}
              onAdd={(title) => addTask(column.id, title)}
              onOpen={setOpenTaskId}
              onDelete={deleteTask}
            />
          ))}
        </div>
        </div>
        <DragOverlay>{activeTask && <div className={`task-card overlay-card column-${activeColumn}`}><div className="task-body"><span className="task-code">{taskCode(current.taskPrefix, activeTask.number)}</span><span>{activeTask.title}</span></div></div>}</DragOverlay>
      </DndContext>

      {searchOpen && <TaskSearch
        tasks={COLUMNS.flatMap((column) => current[column.id].map((task) => ({ task, code: taskCode(current.taskPrefix, task.number), column: column.id, status: t(column.title) })))}
        onClose={() => setSearchOpen(false)}
        onOpen={(id) => { setSearchOpen(false); setOpenTaskId(id); }} />}

      {openTask && openColumn && (
        <TaskPanel
          key={openTask.id}
          task={openTask}
          taskCode={taskCode(current.taskPrefix, openTask.number)}
          column={openColumn}
          columns={COLUMNS.map((column) => ({ ...column, title: t(column.title) }))}
          projectDir={projectDir}
          titleMaxLength={TASK_TITLE_MAX}
          labels={labels}
          participants={participants}
          onRelease={async () => {
            await saveQueue.current;
            if (saveFailed.current) throw new Error("Resolve the board save error first");
            pendingSaves.current += 1;
            generation.current += 1;
            try {
              const fresh = await releaseTask(projectId, openTask.id);
              generation.current += 1;
              boardRef.current = fresh; setBoard(fresh);
            } finally { pendingSaves.current -= 1; }
          }}
          onChange={(patch) => updateTask(openTask.id, patch)}
          onSetLabels={(ids) => updateTask(openTask.id, { labels: ids })}
          onCreateLabel={(name) => createLabel(name, openTask.id)}
          onMove={(to) => moveTask(openTask.id, to)}
          onArchive={() => archiveTask(openTask.id)}
          onRestore={() => restoreTask(openTask.id)}
          onDelete={() => deleteTask(openTask.id)}
          onClose={() => setOpenTaskId(null)}
        />
      )}

      {reloadConfirm && <ConfirmDialog title={t("Load current board?")} confirmLabel={t("Load")} danger
        onCancel={() => setReloadConfirm(false)} onConfirm={() => {
          setReloadConfirm(false);
          if (openTaskId) { setError(t("Close the open task and copy any edits you need to keep first")); return; }
          const version = ++generation.current;
          void saveQueue.current.then(() => getBoard(projectId)).then((fresh) => {
            if (generation.current !== version) return;
            failedBase.current = null; saveFailed.current = false; generation.current += 1;
            boardRef.current = fresh; setBoard(fresh); setError(null);
          }, (e) => setError(String(e)));
        }}><p>{t("Unsaved edits in this window will be replaced with data from disk. Copy any edits you want to keep first.")}</p></ConfirmDialog>}
      {archiveOpen && (
        <TaskArchive tasks={archivedTasks} prefix={current.taskPrefix} labels={labels}
          onRestore={restoreTask}
          onOpen={(id) => { setArchiveOpen(false); setOpenTaskId(id); }}
          onClose={() => setArchiveOpen(false)} />
      )}
      {archivedNotice && (
        <div className="archive-toast" role="status">
          <span>{t("Task moved to archive")}</span>
          <button className="link-btn" onClick={() => restoreTask(archivedNotice)}>{t("Undo")}</button>
          <button className="icon-btn" aria-label={t("Dismiss notification")} onClick={() => setArchivedNotice(null)}><Icon name="close" /></button>
        </div>
      )}
      {moveNotice && (
        <div className="archive-toast move-toast" role="status">
          <span>{t("Task {code} moved to {status}", { code: taskCode(current.taskPrefix, moveNotice.taskNumber), status: t(COLUMNS.find((column) => column.id === moveNotice.to)!.title) })}</span>
          <button type="button" className="link-btn" disabled={undoingMove || !!activeId} onClick={() => void trackSave(undoLastMove())}>{t(undoingMove ? "Undoing…" : "Undo")}</button>
          <button type="button" className="icon-btn" disabled={undoingMove} aria-label={t("Dismiss notification")} onClick={() => showMoveNotice(null)}><Icon name="close" /></button>
        </div>
      )}
      {deletedTaskNotice && (
        <div className="archive-toast deletion-toast" role="status">
          <span>{t("Task {code} deleted", { code: taskCode(current.taskPrefix, deletedTaskNotice.number) })}</span>
          <button type="button" className="link-btn" disabled={deletionBusy || !!activeId} onClick={() => void trackSave(undoTaskDeletion())}>{t(deletionBusy ? "Undoing…" : "Undo")}</button>
          <button type="button" className="icon-btn" disabled={deletionBusy} aria-label={t("Dismiss notification")} onClick={() => setDeletedTaskNotice(null)}><Icon name="close" /></button>
        </div>
      )}
      {managingLabels && (
        <LabelManager
          labels={labels}
          usage={labelUsage}
          onCreate={(name, color) => createLabel(name, undefined, color)}
          onUpdate={updateLabel}
          onDelete={deleteLabel}
          onClose={() => setManagingLabels(false)}
        />
      )}
    </div>
  );
}

/** Persist each filter separately for each project; retain existing label preferences. */
function filterKey(projectId: string, kind: "label" | "assignee") {
  return `${kind}-filter:${projectId}`;
}

function loadFilter(projectId: string, kind: "label" | "assignee" = "label"): Set<string> {
  try {
    const saved = JSON.parse(localStorage.getItem(filterKey(projectId, kind)) ?? "[]");
    return new Set(Array.isArray(saved) ? saved.filter((k) => typeof k === "string") : []);
  } catch {
    return new Set();
  }
}

function saveFilter(projectId: string, filter: Set<string>, kind: "label" | "assignee" = "label") {
  try {
    localStorage.setItem(filterKey(projectId, kind), JSON.stringify([...filter]));
  } catch {
    // Failure to persist the filter is nonfatal.
  }
}

interface ColumnProps {
  id: ColumnId;
  title: string;
  taskPrefix: string;
  /** Visible tasks after filtering. */
  tasks: Task[];
  /** Total tasks in the column. */
  total: number;
  labels: Label[];
  participants: Participant[];
  onAdd: (title: string) => void;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
}

function Column({ id, title, taskPrefix, tasks, total, labels, participants, onAdd, onOpen, onDelete }: ColumnProps) {
  const { t } = useI18n();
  const { setNodeRef, isOver } = useDroppable({ id });
  const [adding, setAdding] = useState(false);
  // A new key recreates the input after Enter, ready for the next task.
  const [inputKey, setInputKey] = useState(0);

  return (
    // Use the full column height as the drop zone, rather than just the card list:
    // otherwise, shorter columns cannot accept drops when the board is scrolled down.
    <section ref={setNodeRef} className={`column column-${id} ${isOver ? "drop-target" : ""}`}>
      <header className="column-header">
        <span className="column-pill">
          <span className="column-dot" />
          {title}
        </span>
        <span className="column-count" title={tasks.length < total ? t("Some tasks are hidden by the filter") : undefined}>
          {tasks.length < total ? t("{visible} of {total}", { visible: tasks.length, total }) : total}
        </span>
      </header>

      <SortableContext items={tasks.map((t) => t.id)} strategy={() => null}>
        <div className="column-tasks">
          {tasks.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              code={taskCode(taskPrefix, task.number)}
              labels={labels}
              participants={participants}
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
            placeholder={t("Task title")}
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
          {t("+ Add task")}</button>
      )}
    </section>
  );
}

interface TaskCardProps {
  participants: Participant[];
  code: string;
  task: Task;
  labels: Label[];
  onOpen: () => void;
  onDelete: () => void;
}

function TaskCard({ task, code, labels, participants, onOpen, onDelete }: TaskCardProps) {
  const { t } = useI18n();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: task.id });

  const style = { transform: CSS.Translate.toString(transform), transition };
  const hasDescription = !!task.description?.trim();
  // Keep labels in project order.
  const taskLabels = labels.filter((l) => task.labels?.includes(l.id));

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`task-card ${isDragging ? "dragging" : ""}`}
      // Dragging starts after moving 5px, so a regular click opens the task.
      onClick={onOpen}
      {...attributes}
      {...listeners}
    >
      <div className="task-body">
        <span className="task-code">{code}</span>
        {(task.assigneeId || task.readyForReview || task.question) && <div className="task-agent-badges">
          {task.assigneeId && <span>{participants.find((p) => p.id === task.assigneeId)?.name ?? task.assigneeId}</span>}
          {task.readyForReview && <span className="review-badge">{t("Ready for review")}</span>}
          {task.question && <span className="question-badge">{t("Needs an answer")}</span>}
        </div>}
        <span className="task-title">
          {task.title}
          {hasDescription && (
            <span className="task-has-desc" title={t("Has a description")}>
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
        disabled={!!task.claim}
        title={task.claim ? t("Release the task first") : t("Delete task")}
        // Button clicks must not start dragging or open the task.
        onPointerDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
      >
                <Icon name="close" />
              </button>
    </div>
  );
}
