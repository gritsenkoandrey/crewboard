export interface Project {
  /** Project folder name. Does not change when the project is renamed. */
  id: string;
  name: string;
  /** Creation time in milliseconds since the Unix epoch. 0 means unknown. */
  createdAt: number;
  /** Absolute path to the cover image file. */
  coverPath: string | null;
  sourceDir?: string | null;
  /** Absolute path to the project folder. */
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
  /** Archived tasks stay in their original column. */
  archived?: boolean;
  number?: number;
  /** The task's sole timestamp: creation or last update, in milliseconds. */
  updatedAt?: number;
  id: string;
  title: string;
  /** Markdown description. Omitted from the file when empty. */
  description?: string;
  /** Project label IDs. Omitted from the file when no labels are assigned. */
  labels?: string[];
}

export interface Label {
  id: string;
  name: string;
  /** Color key from the palette (src/labels.ts). */
  color: string;
}

/** Board columns. Keys match the fields in board.json. */
export type ColumnId = "todo" | "inProgress" | "done";

export type Board = Record<ColumnId, Task[]> & {
  taskPrefix: string;
  nextTaskNumber: number;
  /** Project labels. May be absent in older files. */
  labels?: Label[];
};
