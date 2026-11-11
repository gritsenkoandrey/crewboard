import type { Board, ColumnId } from "./types";
const columns: ColumnId[] = ["todo", "inProgress", "done"];

/** Only content and status edits change the date; sorting cards does not. */
export function stampBoard(previous: Board, next: Board, now = Date.now()): Board {
  const old = new Map(columns.flatMap((column) => previous[column].map((task) => [task.id, { task, column }] as const)));
  let number = Math.max(previous.nextTaskNumber, next.nextTaskNumber, ...columns.flatMap((c) => next[c].map((t) => (t.number ?? 0) + 1)), 1);
  const result = { ...next };
  for (const column of columns) {
    result[column] = next[column].map((task) => {
      const before = old.get(task.id);
      const changed = !before || Boolean(before.task.archived) !== Boolean(task.archived) || before.column !== column || before.task.title !== task.title
        || (before.task.assigneeId ?? "") !== (task.assigneeId ?? "")
        || (before.task.acceptanceCriteria ?? "") !== (task.acceptanceCriteria ?? "")
        || (before.task.description ?? "") !== (task.description ?? "")
        || JSON.stringify([...(before.task.labels ?? [])].sort()) !== JSON.stringify([...(task.labels ?? [])].sort());
      return { ...task, number: before?.task.number ?? task.number ?? number++, updatedAt: changed ? now : before?.task.updatedAt };
    });
  }
  result.nextTaskNumber = number;
  return result;
}

export function taskCode(prefix: string, number?: number): string {
  return number ? prefix + "-" + number : "";
}

/** Preserve status, position, number and content when archiving/restoring. */
export function setTaskArchived(board: Board, id: string, archived: boolean): Board {
  const result = { ...board };
  for (const column of columns) result[column] = board[column].map((task) => task.id === id ? { ...task, archived } : task);
  return result;
}
