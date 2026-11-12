import { useI18n } from "./i18n";
import AgentSettings from "./components/AgentSettings";
import Icon from "./components/Icon";
import LanguageSwitcher from "./components/LanguageSwitcher";
import { useCallback, useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { flushAll } from "./saveTracker";
import {
  createProject,
  deleteProject,
  getDataDir,
  listProjects,
  pickFolder,
  pickImage,
  removeCover,
  renameProject,
  setCover,
  setDataDir,
  type DataDirInfo,
} from "./api";
import ProjectList from "./components/ProjectList";
import ProjectPage from "./components/ProjectPage";
import type { Project } from "./types";

export default function App() {
  const { t } = useI18n();
  const [agentSettings, setAgentSettings] = useState(false);
  const [deletingProject, setDeletingProject] = useState(false);
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

  // Flush pending and unfinished saves before closing the window.
  // Tauri waits for the handler to finish before closing the window.
  useEffect(() => {
    let unlisten: Promise<(() => void) | undefined>;
    try {
      unlisten = getCurrentWindow()
        .onCloseRequested(() => flushAll())
        .catch(() => undefined);
    } catch {
      // Outside a Tauri window (for example, in a browser), there is no window event to subscribe to.
      return;
    }
    return () => {
      void unlisten.then((fn) => fn?.());
    };
  }, []);

  // Reload the list whenever the data folder changes.
  useEffect(() => {
    if (ready) void reload();
  }, [ready, info?.path, reload]);

  /** Runs an action and displays any error in the top bar. */
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

  function changeCover(id: string) {
    return run(async () => {
      const source = await pickImage();
      if (source) replaceProject(await setCover(id, source));
    });
  }

  function deleteCover(id: string) {
    return run(async () => replaceProject(await removeCover(id)));
  }

  if (!info) {
    return <div className="center muted">{error ?? t("Loading…")}</div>;
  }

  if (!ready) {
    return <SetupScreen info={info} error={error} onChoose={chooseFolder} />;
  }

  const openProject = projects.find((p) => p.id === openId) ?? null;

  return (
    <div className="app" aria-busy={deletingProject}>
      <header className="topbar" inert={deletingProject}>
        <button className="logo" onClick={() => setOpenId(null)}>
          Crewboard
        </button>
        <div className="data-dir muted" title={info.path ?? ""}>
          {info.path}
        </div>
        <div className="topbar-actions">
          <LanguageSwitcher />
          <button className="topbar-action" title={t("Participants")} aria-label={t("Participants")}
            aria-haspopup="dialog" aria-expanded={agentSettings} onClick={() => setAgentSettings(true)}>
            <Icon name="users" />
            <span>{t("Participants")}</span>
          </button>
          <button className="topbar-action" title={t("Change data folder")} aria-label={t("Change data folder")} onClick={chooseFolder}>
            <Icon name="folder" />
            <span>{t("Change folder")}</span>
          </button>
        </div>
      </header>
      {error && (
        <div className="error-bar">
          <span>{error}</span>
          <button className="icon-btn" title={t("Close")} onClick={() => setError(null)}>
            ×
          </button>
        </div>
      )}
      {agentSettings && <AgentSettings onClose={() => setAgentSettings(false)} />}
      {deletingProject && <div className="project-deletion-status" role="status">{t("Moving project to the Recycle Bin…")}</div>}
      <main className="content" inert={deletingProject}>
        {openProject ? (
          <ProjectPage
            key={openProject.id}
            project={openProject}
            onBack={() => setOpenId(null)}
            onRename={(name) => run(async () => replaceProject(await renameProject(openProject.id, name)))}
            onChangeCover={() => changeCover(openProject.id)}
            onRemoveCover={() => deleteCover(openProject.id)}
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
            onChangeCover={changeCover}
            onRemoveCover={deleteCover}
            onDelete={async (id) => {
              setDeletingProject(true);
              try {
                await run(async () => {
                  await deleteProject(id);
                  setProjects((list) => list.filter((p) => p.id !== id));
                });
              } finally { setDeletingProject(false); }
            }}
          />
        )}
      </main>
    </div>
  );
}

function SetupScreen({ info, error, onChoose }: { info: DataDirInfo; error: string | null; onChoose: () => void }) {
  const { t } = useI18n();
  return (
    <div className="center">
      <div className="setup">
        <div className="setup-language"><LanguageSwitcher /></div>
        <h1>Crewboard</h1>
        {info.missing ? (
          <p className="warning">
            {t("Data folder is unavailable:")}<br />
            <code>{info.path}</code>
            <br />
            {t("Connect the drive or select another folder.")}</p>
        ) : (
          <p>
            {t("Choose a folder for your projects. Use a separate drive or a backed-up folder to keep your data after reinstalling Windows.")}
          </p>
        )}
        <p className="muted">{t("Existing projects in this folder will be loaded automatically.")}</p>
        <button className="btn primary" onClick={onChoose}>
          {t("Choose folder")}</button>
        {error && <p className="error">{error}</p>}
      </div>
    </div>
  );
}
