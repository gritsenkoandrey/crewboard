import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

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

/** Системный диалог выбора папки. Возвращает null, если пользователь его закрыл. */
export async function pickFolder(defaultPath?: string): Promise<string | null> {
  const result = await open({ directory: true, multiple: false, defaultPath, title: "Папка с данными Task Track" });
  return typeof result === "string" ? result : null;
}
