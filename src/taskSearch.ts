import type { ColumnId, Task } from "./types";

export interface SearchTask {
  task: Task;
  code: string;
  column: ColumnId;
  status: string;
}

function normalize(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/ё/g, "е").replace(/[‐‑‒–—−]/g, "-").trim().replace(/\s+/g, " ");
}

/** Search the whole project without changing task data or the board's active filters. */
export function searchTasks(tasks: readonly SearchTask[], query: string): SearchTask[] {
  const needle = normalize(query);
  const words = needle.split(" ");
  return tasks.flatMap((entry) => {
    const code = normalize(entry.code);
    const title = normalize(entry.task.title);
    const searchable = `${code} ${title}`;
    if (needle && !words.every((word) => searchable.includes(word))) return [];
    const exactNumber = /^\d+$/.test(needle) && Number(needle) === entry.task.number;
    const rank = !needle || code === needle || exactNumber ? 0 : code.startsWith(needle) ? 1 : title.startsWith(needle) ? 2 : 3;
    return [{ entry, rank }];
  }).sort((a, b) => a.rank - b.rank || (a.entry.task.number ?? Infinity) - (b.entry.task.number ?? Infinity))
    .map(({ entry }) => entry);
}
