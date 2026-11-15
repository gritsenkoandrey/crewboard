import type { Task } from "./types";

export function compareTaskNumbers(a: Pick<Task, "number">, b: Pick<Task, "number">): number {
  return (a.number ?? Infinity) - (b.number ?? Infinity);
}

/** Display numbered tasks first without changing stored order or task metadata. */
export function sortTasksByNumber<T extends Pick<Task, "number">>(tasks: readonly T[]): T[] {
  return [...tasks].sort(compareTaskNumbers);
}
