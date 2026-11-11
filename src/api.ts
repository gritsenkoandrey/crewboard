import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type { Board, Project, Participant } from "./types";

export interface DataDirInfo {
  /** Путь из настроек, если папка уже выбиралась. */
  path: string | null;
  /** Папка выбрана, но сейчас недоступна. */
  missing: boolean;
}

export function getDataDir(): Promise<DataDirInfo> {
  return invoke("get_data_dir");
}

export function setDataDir(path: string): Promise<DataDirInfo> {
  return invoke("set_data_dir", { path });
}

export function listProjects(): Promise<Project[]> {
  return invoke("list_projects");
}

export function createProject(name: string): Promise<Project> {
  return invoke("create_project", { name });
}

export function renameProject(id: string, name: string): Promise<Project> {
  return invoke("rename_project", { id, name });
}

/** Перемещает папку проекта в корзину Windows. */
export function deleteProject(id: string): Promise<void> {
  return invoke("delete_project", { id });
}

export function getBoard(id: string): Promise<Board> {
  return invoke("get_board", { id });
}

export function saveBoard(id: string, board: Board, base: Board): Promise<Board> {
  return invoke("save_board", { id, board, base });
}

export interface ProjectDocument { id: string; name: string; file: string; externalPath?: string }
export interface DocumentContent { text: string; dir: string; revision: string }
export function listDocuments(id: string): Promise<ProjectDocument[]> { return invoke("list_documents", { id }); }
export function createDocument(id: string, name: string): Promise<ProjectDocument[]> { return invoke("create_document", { id, name }); }
export function renameDocument(id: string, documentId: string, name: string): Promise<ProjectDocument[]> { return invoke("rename_document", { id, documentId, name }); }
export function reorderDocuments(id: string, documentIds: string[]): Promise<ProjectDocument[]> { return invoke("reorder_documents", { id, documentIds }); }
export function getDocument(id: string, documentId: string): Promise<DocumentContent> { return invoke("get_document", { id, documentId }); }
export function saveDocument(id: string, documentId: string, text: string, baseText: string): Promise<string> { return invoke("save_document", { id, documentId, text, baseText }); }
export function deleteDocument(id: string, documentId: string): Promise<ProjectDocument[]> { return invoke("delete_document", { id, documentId }); }

/** Копирует картинку в папку проекта и делает её обложкой. */
export function setCover(id: string, source: string): Promise<Project> {
  return invoke("set_cover", { id, source });
}

export function removeCover(id: string): Promise<Project> {
  return invoke("remove_cover", { id });
}

/** Диалог выбора картинки для обложки. Возвращает null, если пользователь его закрыл. */
export async function pickImage(): Promise<string | null> {
  const result = await open({
    multiple: false,
    title: "Обложка проекта",
    filters: [{ name: "Картинки", extensions: ["png", "jpg", "jpeg", "webp", "gif", "bmp", "avif"] }],
  });
  return typeof result === "string" ? result : null;
}

/** Системный диалог выбора папки. Возвращает null, если пользователь его закрыл. */
export async function pickFolder(defaultPath?: string): Promise<string | null> {
  const result = await open({ directory: true, multiple: false, defaultPath, title: "Папка с данными Task Track" });
  return typeof result === "string" ? result : null;
}

export interface DocumentRevision { id: string; revision: string | null; error: string | null }
export function documentRevisions(id: string): Promise<DocumentRevision[]> { return invoke("document_revisions", { id }); }
export function linkDocument(id: string, source: string, documentId?: string): Promise<ProjectDocument[]> { return invoke("link_document", { id, source, documentId: documentId ?? null }); }
export function unlinkDocument(id: string, documentId: string): Promise<ProjectDocument[]> { return invoke("unlink_document", { id, documentId }); }
export async function pickMarkdown(): Promise<string | null> {
  const file = await open({ multiple: false, title: "Подключить Markdown-файл", filters: [{ name: "Markdown", extensions: ["md"] }] });
  return typeof file === "string" ? file : null;
}

export function getParticipants(): Promise<Participant[]> { return invoke("get_participants"); }
export function createParticipant(name: string, kind: string): Promise<Participant[]> { return invoke("create_participant", { name, kind }); }
export function getSourceDir(id: string): Promise<string | null> { return invoke("get_source_dir", { id }); }
export function setSourceDir(id: string, path: string | null): Promise<string | null> { return invoke("set_source_dir", { id, path }); }
export function releaseTask(id: string, taskId: string): Promise<Board> { return invoke("release_task", { id, taskId }); }
