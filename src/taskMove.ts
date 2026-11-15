import type { Board, ColumnId, Task } from "./types";

const columns: ColumnId[] = ["todo", "inProgress", "done"];

export interface TaskMove {
  taskId: string;
  taskNumber?: number;
  from: ColumnId;
  to: ColumnId;
  expectedWorkflow: string;
}

function workflow(task: Task): string {
  return JSON.stringify([
    task.claim ? [task.claim.assigneeId, task.claim.sessionId, task.claim.startedAt] : null,
    Boolean(task.readyForReview), task.question ?? "",
  ]);
}

/** Remember the status change, never an old snapshot of the task's content. */
export function recordTaskMove(before: Board, after: Board, taskId: string): TaskMove | null {
  const from = columns.find((column) => before[column].some((task) => task.id === taskId));
  const to = columns.find((column) => after[column].some((task) => task.id === taskId));
  if (!from || !to || from === to) return null;
  const task = after[to].find((task) => task.id === taskId)!;
  if (task.archived) return null;
  // The backend clears the agent session when a task enters Done. Undo must not revive it.
  const expected = to === "done" ? { ...task, claim: undefined, readyForReview: false, question: undefined } : task;
  return { taskId, taskNumber: task.number, from, to, expectedWorkflow: workflow(expected) };
}

/** Return only the moved task to its old status while preserving all current task fields. */
export function undoTaskMove(board: Board, move: TaskMove): Board | null {
  const task = board[move.to].find((task) => task.id === move.taskId);
  if (!task || task.archived || workflow(task) !== move.expectedWorkflow) return null;
  return {
    ...board,
    [move.to]: board[move.to].filter((task) => task.id !== move.taskId),
    [move.from]: [...board[move.from], task],
  };
}
