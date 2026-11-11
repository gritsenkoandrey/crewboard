export interface Project {
  /** Имя папки проекта. Не меняется при переименовании. */
  id: string;
  name: string;
  /** Время создания, мс с 1970 года. 0 — неизвестно. */
  createdAt: number;
  /** Полный путь к файлу обложки. */
  coverPath: string | null;
  sourceDir?: string | null;
  /** Полный путь к папке проекта. */
  dir: string;
}

export interface Participant { id: string; name: string; kind: "human" | "agent" }
export interface AgentClaim { assigneeId: string; sessionId: string; startedAt: number; token: string }
export interface TaskReport { authorId: string; sessionId: string; createdAt: number; text: string }

export interface Task {
  assigneeId?: string;
  acceptanceCriteria?: string;
  claim?: AgentClaim;
  readyForReview?: boolean;
  question?: string;
  reports?: TaskReport[];
  /** Архивная задача остаётся в исходной колонке. */
  archived?: boolean;
  number?: number;
  /** Единственная дата задачи: создание или последнее изменение, в мс. */
  updatedAt?: number;
  id: string;
  title: string;
  /** Описание в markdown. В файле отсутствует, если пустое. */
  description?: string;
  /** id меток проекта. В файле отсутствует, если меток нет. */
  labels?: string[];
}

export interface Label {
  id: string;
  name: string;
  /** Ключ цвета из палитры (src/labels.ts). */
  color: string;
}

/** Колонки доски. Ключи совпадают с полями board.json. */
export type ColumnId = "todo" | "inProgress" | "done";

export type Board = Record<ColumnId, Task[]> & {
  taskPrefix: string;
  nextTaskNumber: number;
  /** Метки проекта. В старых файлах может отсутствовать. */
  labels?: Label[];
};
