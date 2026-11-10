export interface Project {
  /** Имя папки проекта. Не меняется при переименовании. */
  id: string;
  name: string;
  /** Время создания, мс с 1970 года. 0 — неизвестно. */
  createdAt: number;
  /** Полный путь к файлу обложки. */
  coverPath: string | null;
}

export interface Task {
  id: string;
  title: string;
}

/** Колонки доски. Ключи совпадают с полями board.json. */
export type ColumnId = "todo" | "inProgress" | "done";

export type Board = Record<ColumnId, Task[]>;
