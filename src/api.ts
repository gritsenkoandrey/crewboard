import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type { Board, Project } from "./types";

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

export function saveBoard(id: string, board: Board): Promise<void> {
  return invoke("save_board", { id, board });
}

export interface Readme {
  text: string;
  /** Папка проекта: относительно неё открываются картинки. */
  dir: string;
}

export function getReadme(id: string): Promise<Readme> {
  return invoke("get_readme", { id });
}

export function saveReadme(id: string, text: string): Promise<void> {
  return invoke("save_readme", { id, text });
}

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
