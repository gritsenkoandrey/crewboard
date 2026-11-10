import { useCallback, useEffect, useState } from "react";
import {
  createProject,
  deleteProject,
  getDataDir,
  listProjects,
  pickFolder,
  renameProject,
  setDataDir,
  type DataDirInfo,
} from "./api";
import ProjectList from "./components/ProjectList";
import ProjectPage from "./components/ProjectPage";
import type { Project } from "./types";

export default function App() {
  const [info, setInfo] = useState<DataDirInfo | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const ready = !!info?.path && !info.missing;

  const reload = useCallback(async () => {
    try {
      setProjects(await listProjects());
    } catch (e) {
      setError(String(e));
    }
  }, []);

  useEffect(() => {
    getDataDir().then(setInfo, (e) => setError(String(e)));
  }, []);

  // Список перечитываем при каждой смене папки данных.
  useEffect(() => {
    if (ready) void reload();
  }, [ready, info?.path, reload]);

  /** Выполняет действие и показывает ошибку в полосе сверху, если оно не удалось. */
  async function run(action: () => Promise<void>) {
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(String(e));
    }
  }

  async function chooseFolder() {
    setError(null);
    const path = await pickFolder(info?.path ?? undefined);
    if (!path) return;
    await run(async () => {
      setInfo(await setDataDir(path));
      setOpenId(null);
    });
  }

  function replaceProject(updated: Project) {
    setProjects((list) => list.map((p) => (p.id === updated.id ? updated : p)));
  }

  if (!info) {
    return <div className="center muted">{error ?? "Загрузка…"}</div>;
  }

  if (!ready) {
    return <SetupScreen info={info} error={error} onChoose={chooseFolder} />;
  }

  const openProject = projects.find((p) => p.id === openId) ?? null;

  return (
    <div className="app">
      <header className="topbar">
        <button className="logo" onClick={() => setOpenId(null)}>
          Task Track
        </button>
        <div className="data-dir muted" title={info.path ?? ""}>
          {info.path}
        </div>
        <button className="btn" onClick={chooseFolder}>
          Сменить папку
        </button>
      </header>
      {error && (
        <div className="error-bar">
          <span>{error}</span>
          <button className="icon-btn" title="Закрыть" onClick={() => setError(null)}>
            ×
          </button>
        </div>
      )}
      <main className="content">
        {openProject ? (
          <ProjectPage
            key={openProject.id}
            project={openProject}
            onBack={() => setOpenId(null)}
            onRename={(name) => run(async () => replaceProject(await renameProject(openProject.id, name)))}
          />
        ) : (
          <ProjectList
            projects={projects}
            onOpen={setOpenId}
            onCreate={(name) =>
              run(async () => {
                const created = await createProject(name);
                setProjects((list) => [created, ...list]);
              })
            }
            onRename={(id, name) => run(async () => replaceProject(await renameProject(id, name)))}
            onDelete={(id) =>
              run(async () => {
                await deleteProject(id);
                setProjects((list) => list.filter((p) => p.id !== id));
              })
            }
          />
        )}
      </main>
    </div>
  );
}

function SetupScreen({ info, error, onChoose }: { info: DataDirInfo; error: string | null; onChoose: () => void }) {
  return (
    <div className="center">
      <div className="setup">
        <h1>Task Track</h1>
        {info.missing ? (
          <p className="warning">
            Папка с данными недоступна:
            <br />
            <code>{info.path}</code>
            <br />
            Подключите диск или выберите другую папку.
          </p>
        ) : (
          <p>
            Выберите папку, где будут храниться проекты. Лучше не на диске C: — тогда данные переживут
            переустановку Windows. Можно выбрать папку в OneDrive или Dropbox для бэкапа.
          </p>
        )}
        <p className="muted">Если папка уже использовалась раньше, все проекты в ней подхватятся.</p>
        <button className="btn primary" onClick={onChoose}>
          Выбрать папку
        </button>
        {error && <p className="error">{error}</p>}
      </div>
    </div>
  );
}
