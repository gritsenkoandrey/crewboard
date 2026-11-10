export interface Project {
  /** Имя папки проекта. Не меняется при переименовании. */
  id: string;
  name: string;
  /** Время создания, мс с 1970 года. 0 — неизвестно. */
  createdAt: number;
  /** Полный путь к файлу обложки. */
  coverPath: string | null;
}
